// Hit Zero (Contract 7): a cheer-routine rhythm game in a DOM/canvas overlay. "Hit zero" is what
// cheerleaders call a routine with zero deductions.
//
//   import { createHitZero } from './rhythm/index.js'
//   const hz = createHitZero({ audio, container, level, onDone(result) })
//     audio      the Contract 6 audio object, or null: an internal metronome keeps time instead
//     container  the element to cover (default document.body)
//     level      1 | 4 | 7 (or 'Level 4'): preselected on the ready card
//     onDone     called once when the overlay closes, with the last finished routine's result (or null)
//   more options, all optional:
//     autostart    skip the ready card               autoplay   a perfect bot plays (tests and demos; implies autostart)
//     seed         chart seed (same seed, same chart: phase 2 squads play one chart together)
//     onResult(r)  every finished routine            onMove(m)  every motion hit ('highV', 'liberty', ...): for avatar.setAnim(m)
//     look         performer colours { skin, hair, bow, top, shorts, shoes }
//     practiceBeat the internal metronome's little beat (default: on when there is no audio module)
//     rate         runs the internal clock fast (tests only)
//   hz.el, hz.phase    'ready' | 'starting' | 'play' | 'finale' | 'judges' | 'calib' | 'closed'
//   hz.start(level)    start a routine now (call from a tap so the music can start)
//   hz.close()         close: calls onDone(result)          hz.destroy()  remove without onDone
//   hz.state           a snapshot for tests: { phase, level, songBeat, score, combo, counts, spirit, fullOut, finished, result }
//   hz._test           internals for the dev pages and Playwright (chart notes, song clock, lane positions)
//
// result = the judge.js summary + { level, title, sub, newBest, judges: [{ id, name, category, card, line }] }
//
// While it is open it keeps the keyboard to itself (A S D, arrows, Space, Enter, Esc do not reach
// the world). The app still freezes the player and restores its own music in onDone.

import { PALETTE, STORAGE_KEYS, PERF } from '../config.js';
import { safeStorageGet, safeStorageSet } from '../core/util.js';
import { buildChart, levelInfo, LEVELS, MOTION_SETS } from './charts.js';
import { createRun } from './judge.js';
import { createSource } from './source.js';
import { createField, laneAt, LANE_COLORS, drawNoteSample } from './field.js';
import { createFx } from './fx.js';
import { createJudgesPanel } from './judges.js';
import { JUDGES, judgeLine, verdictWord, comboCall, shakeItOff, countInCall, sectionCall, resultTitle, HOW_TO } from './lines.js';
import { poseSkeleton, blendSkeleton, drawBow } from './figure.js';
import { openCalibration, readLatency } from './calibrate.js';

const BEST_KEY = STORAGE_KEYS.rhythmBest || 'c9.rhythm.best.v1';
const KEY_LANES = { KeyA: 0, KeyS: 1, KeyD: 2, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 1, ArrowRight: 2 };
const WORLD_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyM', 'Space', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight']);
const VERDICT_COLORS = { perfect: PALETTE.pink, good: PALETTE.teamB, miss: '#8f84a6' };
const REVEAL = [0.8, 1.75, 2.7, 3.55]; // seconds into the results: three cards, then the total

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

// Activate on the element's own pointerup (taps while another finger is down still work), and
// swallow the click that follows. Keyboard clicks still activate.
function onTap(node, fn) {
  let id = null;
  let sx = 0;
  let sy = 0;
  let last = -1e9;
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    id = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
  });
  node.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 18) return;
    last = performance.now();
    fn(e);
  });
  node.addEventListener('pointercancel', () => {
    id = null;
  });
  node.addEventListener('click', (e) => {
    if (performance.now() - last < 800) return;
    fn(e);
  });
}

const fmtScore = (n) => Math.round(n).toLocaleString('en-US');

// the audio module may answer with a promise: a rejected one is no reason to shout
const quiet = (p) => {
  if (p && typeof p.catch === 'function') p.catch(() => {});
};

let cssPromise = null;
function ensureCss() {
  if (cssPromise) return cssPromise;
  const href = new URL('../../css/rhythm.css', import.meta.url).href;
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === href);
  if (existing && existing.sheet) return (cssPromise = Promise.resolve());
  const link = existing || document.createElement('link');
  cssPromise = new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 2500);
  });
  if (!existing) {
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
  return cssPromise;
}

function readBest() {
  const out = {};
  try {
    const v = JSON.parse(safeStorageGet(BEST_KEY) || '{}');
    for (const L of LEVELS) {
      const b = v && v[L.id];
      if (b && Number.isFinite(b.score) && b.score >= 0 && b.score < 1e9) out[L.id] = { score: Math.round(b.score), hitZero: b.hitZero === true };
    }
  } catch (err) { /* junk in storage: start fresh */ }
  return out;
}

export function createHitZero(opts = {}) {
  const audio = opts.audio && typeof opts.audio === 'object' ? opts.audio : null;
  const container = opts.container || document.body;
  const onDone = typeof opts.onDone === 'function' ? opts.onDone : null;
  const onResult = typeof opts.onResult === 'function' ? opts.onResult : null;
  const onMove = typeof opts.onMove === 'function' ? opts.onMove : null;
  const autoplay = !!opts.autoplay;
  // dev only: how good the autoplay bot is (1 = perfect; lower misses some and drifts off the beat)
  const botSkill = Number.isFinite(Number(opts.botSkill)) ? Math.max(0, Math.min(1, Number(opts.botSkill))) : 1;
  const autostart = !!opts.autostart || autoplay;
  const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 11;
  const rate = Number(opts.rate) > 0 && Number(opts.rate) <= 16 ? Number(opts.rate) : 1;
  const look = opts.look && typeof opts.look === 'object' ? opts.look : undefined;
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const finePointer = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
  // the pixel budget from config: phones and tablets draw at 1.5x at most
  const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const maxDpr = mobile ? PERF.maxPixelRatioMobile : PERF.maxPixelRatioDesktop;
  let level = levelInfo(opts.level);

  const sfx = (name, o) => {
    try {
      if (audio && typeof audio.sfx === 'function') quiet(audio.sfx(name, o));
    } catch (err) { /* sound is a bonus */ }
  };
  const music = (id, o) => {
    try {
      if (audio && typeof audio.music === 'function') quiet(audio.music(id, o));
    } catch (err) { /* sound is a bonus */ }
  };

  // ---------------------------------------------------------------- DOM
  const root = el('div', 'c9-hz c9-hz--ready');
  if (container === document.body) root.classList.add('c9-hz--fixed');
  if (calm) root.classList.add('c9-hz--calm');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Hit Zero');
  root.style.visibility = 'hidden';
  const canvas = el('canvas', 'c9-hz-field');
  const sky = el('canvas', 'c9-hz-sky');
  const pad = el('div', 'c9-hz-pad');
  pad.setAttribute('aria-hidden', 'true');

  const hud = el('div', 'c9-hz-hud');
  const top = el('div', 'c9-hz-top');
  const levelChip = el('div', 'c9-hz-chip', level.name.toUpperCase());
  const scoreEl = el('div', 'c9-hz-score', '0');
  scoreEl.setAttribute('aria-label', 'Score');
  top.append(levelChip, scoreEl);
  const ticker = el('div', 'c9-hz-ticker');
  ticker.setAttribute('aria-hidden', 'true');
  const secEl = el('span', 'c9-hz-sec', '');
  const cellsWrap = el('span', 'c9-hz-cells');
  const cells = [];
  for (let i = 1; i <= 8; i++) {
    const c = el('i', null, String(i));
    cells.push(c);
    cellsWrap.appendChild(c);
  }
  ticker.append(secEl, cellsWrap);
  const spiritEl = el('div', 'c9-hz-spirit');
  const spiritLabel = el('span', 'c9-hz-spirit-label', 'SPIRIT');
  const spiritTrack = el('span', 'c9-hz-spirit-track');
  const spiritFill = el('i');
  spiritTrack.appendChild(spiritFill);
  spiritEl.append(spiritLabel, spiritTrack);
  const callEl = el('div', 'c9-hz-call');
  hud.append(top, ticker, spiritEl);

  const closeBtn = el('button', 'c9-hz-x');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close Hit Zero');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  // the ready card
  const ready = el('section', 'c9-hz-ready c9-hz-card');
  ready.setAttribute('aria-label', 'Get ready');
  const logo = el('div', 'c9-hz-logo');
  const logoBow = el('canvas', 'c9-hz-logo-bow');
  logo.append(logoBow, el('h1', 'c9-hz-title', 'HIT ZERO'));
  const tag = el('p', 'c9-hz-tag', 'Tap to the beat. Zero deductions!');
  const how = el('div', 'c9-hz-how');
  const howCanvases = [];
  for (const [kind, title, line] of [['tap', HOW_TO.tap, HOW_TO.tapLine], ['hold', HOW_TO.hold, HOW_TO.holdLine], ['stunt', HOW_TO.stunt, HOW_TO.stuntLine]]) {
    const item = el('div', 'c9-hz-how-item');
    const c = el('canvas');
    howCanvases.push([c, kind]);
    item.append(c, el('b', null, title), el('span', null, line));
    how.appendChild(item);
  }
  const levelsEl = el('div', 'c9-hz-levels');
  levelsEl.setAttribute('role', 'radiogroup');
  levelsEl.setAttribute('aria-label', 'Level');
  const lvlBtns = LEVELS.map((L) => {
    const b = el('button', 'c9-hz-lvl');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.append(el('b', null, L.name), el('span', 'c9-hz-lvl-tag', L.tag), el('small', null, L.blurb), el('em', 'c9-hz-lvl-best', ''));
    onTap(b, () => {
      level = L;
      refreshReady();
      sfx('tap', { volume: 0.4 });
    });
    levelsEl.appendChild(b);
    return b;
  });
  const blurbEl = el('p', 'c9-hz-blurb', '');
  const goBtn = el('button', 'c9-hz-btn c9-hz-btn-primary c9-hz-go', "LET'S GO!");
  goBtn.type = 'button';
  const readyRow = el('div', 'c9-hz-row');
  const calibBtn = el('button', 'c9-hz-btn c9-hz-btn-small', 'Timing check');
  const soundBtn = el('button', 'c9-hz-btn c9-hz-btn-small', 'Sound');
  calibBtn.type = 'button';
  soundBtn.type = 'button';
  readyRow.append(calibBtn, soundBtn);
  const keysHint = el('p', 'c9-hz-keys', HOW_TO.keys);
  keysHint.hidden = !finePointer;
  ready.append(logo, tag, how, levelsEl, blurbEl, goBtn, readyRow, keysHint);

  // the results: judges, quotes, total
  const results = el('section', 'c9-hz-results');
  results.setAttribute('aria-label', 'The judges');
  const resHead = el('header', 'c9-hz-res-head');
  const bigEl = el('h2', 'c9-hz-big', '');
  const subEl = el('p', 'c9-hz-sub', '');
  resHead.append(bigEl, subEl);
  const panelCanvas = el('canvas', 'c9-hz-panel');
  const quotes = el('ol', 'c9-hz-quotes');
  const quoteEls = JUDGES.map((j) => {
    const li = el('li', 'c9-hz-quote');
    const who = el('div', 'c9-hz-who');
    who.append(el('b', null, j.name), el('span', null, j.category));
    const card = el('em', 'c9-hz-qcard', '');
    const text = el('q', null, '');
    li.append(who, card, text);
    quotes.appendChild(li);
    return { li, card, text };
  });
  const total = el('div', 'c9-hz-total');
  const totalLabel = el('span', 'c9-hz-total-label', 'SCORE');
  const totalNum = el('b', 'c9-hz-total-num', '0');
  const bestTag = el('span', 'c9-hz-best', 'NEW BEST!');
  total.append(totalLabel, totalNum, bestTag);
  const stats = el('div', 'c9-hz-stats');
  const resActions = el('div', 'c9-hz-actions');
  const againBtn = el('button', 'c9-hz-btn c9-hz-btn-primary', 'Again!');
  const levelsBtn = el('button', 'c9-hz-btn', 'Levels');
  const doneBtn = el('button', 'c9-hz-btn', 'Done');
  for (const b of [againBtn, levelsBtn, doneBtn]) b.type = 'button';
  resActions.append(againBtn, levelsBtn, doneBtn);
  results.append(resHead, panelCanvas, quotes, total, stats, resActions);
  results.hidden = true;

  root.append(canvas, pad, hud, callEl, ready, results, sky, closeBtn);
  container.appendChild(root);

  // ---------------------------------------------------------------- state
  const source = createSource({ audio, practiceBeat: opts.practiceBeat ?? !audio, rate });
  const field = createField({ calm });
  const fx = createFx({ calm });
  const skyFx = createFx({ calm, max: 420 });
  const panel = createJudgesPanel();
  const ctx = canvas.getContext('2d');
  const skyCtx = sky.getContext('2d');
  const panelCtx = panelCanvas.getContext('2d');
  let phase = 'ready';
  let chart = null;
  let run = null;
  let raf = 0;
  let lastFrame = 0;
  let t = 0;
  let W = 1;
  let H = 1;
  let dpr = 1;
  let rootLeft = 0;
  let rootTop = 0;
  let destroyed = false;
  let runToken = 0;
  let calib = null;
  let lastResult = null;
  let result = null;
  let resultsAt = 0;
  let resultStep = 0;
  let finaleAt = 0;
  let song = 0;
  let songBeat = -99;
  let lastBeatInt = null;
  let sectionIdx = -1;
  let firstDraw = 0;
  let shownScore = -1;
  let hypeFn = null;
  let keyHints = finePointer ? ['A', 'S', 'D'] : null;
  let motions = MOTION_SETS.intro.slice();
  let flipAt = -10;
  const flip = [1, 1, 1];
  const glow = [0, 0, 0];
  const lanePress = [0, 0, 0];
  const pointerLane = new Map();
  const keyLane = new Map();
  const bot = { next: 0, down: [false, false, false], until: [0, 0, 0] };
  let poseFrom = blendSkeleton(poseSkeleton('ready'), poseSkeleton('ready'), 0, {});
  let poseTo = 'ready';
  let poseAt = 0;
  let poseHold = 0;
  const figure = blendSkeleton(poseFrom, poseFrom, 0, {});
  const celebrate = { until: 0, next: 0 };

  // CONTENT's hype lines, when that module is there
  import('../content/hype.js').then((m) => {
    if (m && typeof m.hype === 'function') hypeFn = m.hype;
  }).catch(() => {});

  // ---------------------------------------------------------------- layout
  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    rootLeft = r.left;
    rootTop = r.top;
    dpr = Math.max(1, Math.min(maxDpr, window.devicePixelRatio || 1));
    for (const c of [canvas, sky]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const sb = spiritEl.getBoundingClientRect();
    const topPx = sb.height ? sb.bottom - r.top + 10 : 130;
    field.resize(W, H, dpr, topPx);
    pad.style.top = Math.max(0, field.layout.zoneTop) + 'px';
    sizePanel();
  }

  function sizePanel() {
    if (results.hidden) return;
    const b = panelCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(b.width));
    const h = Math.max(1, Math.round(b.height));
    if (panelCanvas.width !== Math.round(w * dpr) || panelCanvas.height !== Math.round(h * dpr)) {
      panelCanvas.width = Math.round(w * dpr);
      panelCanvas.height = Math.round(h * dpr);
    }
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => resize());
    ro.observe(root);
  }
  window.addEventListener('resize', resize);

  function drawStatic() {
    // the logo bow and the how-to pictures
    const d = Math.min(2, window.devicePixelRatio || 1);
    logoBow.width = 64 * d;
    logoBow.height = 44 * d;
    const g = logoBow.getContext('2d');
    g.scale(d, d);
    drawBow(g, 32, 20, 54, PALETTE.pink);
    for (const [c, kind] of howCanvases) {
      c.width = 72 * d;
      c.height = 72 * d;
      const h = c.getContext('2d');
      h.scale(d, d);
      drawNoteSample(h, kind, 72, 72, d);
    }
  }

  // ---------------------------------------------------------------- screens
  function setPhaseClass() {
    root.classList.toggle('c9-hz--ready', phase === 'ready' || phase === 'calib');
    root.classList.toggle('c9-hz--play', phase === 'starting' || phase === 'play' || phase === 'finale');
    root.classList.toggle('c9-hz--judges', phase === 'judges');
  }

  function soundLabel() {
    const on = audio ? audio.enabled !== false : source.soundWanted;
    soundBtn.textContent = on ? 'Sound: on' : 'Sound: off';
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function refreshReady() {
    const best = readBest();
    lvlBtns.forEach((b, i) => {
      const L = LEVELS[i];
      const on = L.id === level.id;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('c9-on', on);
      const bb = best[L.id];
      b.querySelector('.c9-hz-lvl-best').textContent = bb ? (bb.hitZero ? '\u2605 ' : 'Best ') + fmtScore(bb.score) : '';
    });
    const ms = readLatency();
    blurbEl.textContent = level.blurb;
    calibBtn.textContent = ms ? 'Timing check (' + (ms > 0 ? '+' : '') + ms + ' ms)' : 'Timing check';
    soundLabel();
  }

  function showReady() {
    phase = 'ready';
    setPhaseClass();
    ready.hidden = false;
    results.hidden = true;
    root.classList.remove('c9-hz--zero');
    refreshReady();
    callEl.classList.remove('c9-in');
    setPose('ready', 0);
    if (finePointer) goBtn.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- the routine
  function resetRun() {
    fx.clear();
    skyFx.clear();
    run = null;
    chart = null;
    sectionIdx = -1;
    lastBeatInt = null;
    firstDraw = 0;
    shownScore = -1;
    songBeat = -99;
    bot.next = 0;
    bot.down = [false, false, false];
    scoreEl.textContent = '0';
    spiritFill.style.transform = 'scaleX(0)';
    spiritEl.classList.remove('c9-full');
    secEl.textContent = '';
    cells.forEach((c) => c.classList.remove('c9-on', 'c9-past'));
    motions = MOTION_SETS.intro.slice();
  }

  async function start(levelId) {
    if (destroyed || phase === 'starting' || phase === 'play' || phase === 'finale' || calib) return;
    if (levelId !== undefined && levelId !== null) level = levelInfo(levelId);
    const token = ++runToken;
    resetRun();
    phase = 'starting';
    setPhaseClass();
    ready.hidden = true;
    results.hidden = true;
    root.classList.remove('c9-hz--zero');
    levelChip.textContent = level.name.toUpperCase();
    call('GET READY!', 'ready');
    sfx('whistle', { volume: 0.45 });
    // the first await below happens after the audio module has been unlocked by this tap
    const info = await source.start({ track: 'routine', latencyMs: 0 });
    if (token !== runToken || destroyed || phase !== 'starting') return;
    // the latency offset is for sound: with no sound there is nothing to line up with
    source.clock.setLatency(source.audible ? readLatency() : 0);
    chart = buildChart({ level: level.id, structure: info.structure, bpm: info.bpm, seed });
    run = createRun(chart);
    motions = chart.sections[0].motions.slice();
    phase = 'play';
    setPhaseClass();
  }

  function quit() {
    runToken++;
    source.stop();
    music(null, { fade: 0.5 });
    releaseAll();
    resetRun();
    showReady();
  }

  function toFinale() {
    phase = 'finale';
    finaleAt = t;
    call('FINAL POSE!', 'full');
    setPose('touchdown', 99);
    move('touchdown');
    sfx('crowd', { volume: 0.8 });
  }

  // ---------------------------------------------------------------- input
  function inputTime(e) {
    source.sample();
    const nowP = performance.now();
    let ts = e && typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : nowP;
    if (!(ts <= nowP + 1 && nowP - ts < 150)) ts = nowP;
    return source.songAt(ts);
  }

  function pressLane(lane, e) {
    lanePress[lane]++;
    glow[lane] = 1;
    if (phase !== 'play' || !run) return;
    handle(run.press(lane, inputTime(e)));
  }

  function releaseLane(lane, e) {
    lanePress[lane] = Math.max(0, lanePress[lane] - 1);
    if (lanePress[lane] > 0 || phase !== 'play' || !run) return;
    handle(run.release(lane, inputTime(e)));
  }

  function releaseAll() {
    pointerLane.clear();
    keyLane.clear();
    for (let l = 0; l < 3; l++) {
      if (lanePress[l] > 0) {
        lanePress[l] = 1;
        releaseLane(l, null);
      }
    }
  }

  const playing = () => phase === 'starting' || phase === 'play' || phase === 'finale';

  pad.addEventListener('pointerdown', (e) => {
    if (!playing()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (e.pointerType === 'touch') keyHints = null;
    const lane = laneAt(field.layout, e.clientX - rootLeft);
    pointerLane.set(e.pointerId, lane);
    try {
      pad.setPointerCapture(e.pointerId);
    } catch (err) { /* fine */ }
    pressLane(lane, e);
  });
  const pointerEnd = (e) => {
    const lane = pointerLane.get(e.pointerId);
    if (lane === undefined) return;
    pointerLane.delete(e.pointerId);
    releaseLane(lane, e);
  };
  pad.addEventListener('pointerup', pointerEnd);
  pad.addEventListener('pointercancel', pointerEnd);
  pad.addEventListener('lostpointercapture', pointerEnd);
  for (const type of ['touchstart', 'touchmove', 'contextmenu', 'dblclick']) {
    pad.addEventListener(type, (e) => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  }

  function onKeyDown(e) {
    if (destroyed || calib) return;
    const lane = KEY_LANES[e.code];
    if (playing()) {
      if (lane !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat || keyLane.has(e.code)) return;
        keyLane.set(e.code, lane);
        if (keyHints || finePointer) keyHints = /^Arrow/.test(e.code) ? ['←', '↓', '→'] : ['A', 'S', 'D'];
        pressLane(lane, e);
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        quit();
        return;
      }
    } else if (phase === 'ready') {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const i = LEVELS.findIndex((L) => L.id === level.id);
        level = LEVELS[(i + (e.code === 'ArrowRight' ? 1 : LEVELS.length - 1)) % LEVELS.length];
        refreshReady();
      } else if ((e.code === 'Enter' || e.code === 'Space') && !(document.activeElement && document.activeElement.tagName === 'BUTTON' && root.contains(document.activeElement))) {
        e.preventDefault();
        start();
      }
    } else if (phase === 'judges') {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (resultStep < REVEAL.length && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        skipReveal();
      }
    }
    if (WORLD_KEYS.has(e.code)) e.stopPropagation();
  }
  function onKeyUp(e) {
    const lane = keyLane.get(e.code);
    if (WORLD_KEYS.has(e.code) && !calib) e.stopPropagation();
    if (lane === undefined) return;
    keyLane.delete(e.code);
    e.preventDefault();
    releaseLane(lane, e);
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', releaseAll);

  // ---------------------------------------------------------------- events from the run
  const L = () => field.layout;
  const words = new Map();

  // tell the app which move the performer just hit (Contract 3 animation names)
  function move(name) {
    if (!onMove) return;
    try {
      onMove(name);
    } catch (err) {
      console.error('[c9] Hit Zero onMove failed', err);
    }
  }

  // a word over the lanes it is about; a newer word in the same spot replaces the old one
  function say(lanes, text, color, size, lift = 0) {
    if (!text) return;
    const lay = L();
    let x = lanes.reduce((a, l) => a + field.hitPoint(l).x, 0) / lanes.length;
    const half = (size * 0.64 * text.length) / 2 + 6;
    x = Math.max(half, Math.min(W - half, x));
    const key = lanes.join('');
    for (const [k, h] of words) if (k === key || (key.length > 1 && key.includes(k)) || (k.length > 1 && k.includes(key))) fx.retire(h);
    words.set(key, fx.word(x, lay.hitY - lay.targetR - 22 - lift, text, { color, size, life: 0.55, rise: 30 }));
  }

  function handle(ev) {
    if (!ev) return;
    const lay = L();
    if (ev.type === 'hit') {
      const n = ev.note;
      for (const lane of n.lanes) {
        const p = field.hitPoint(lane);
        fx.ring(p.x, p.y, { color: LANE_COLORS[lane], r0: lay.targetR * 0.9, r1: lay.targetR * (ev.verdict === 'perfect' ? 1.9 : 1.5), life: 0.32, width: 5 });
        fx.burst(p.x, p.y, { count: ev.verdict === 'perfect' ? 12 : 6, speed: 260, size: 7, life: 0.55 });
      }
      say(n.lanes, verdictWord(ev), VERDICT_COLORS[ev.verdict], n.lanes.length > 1 ? 26 : 21);
      setPose(n.motion, n.len > 0 ? n.len * chart.spb + 0.15 : 0.42);
      move(n.motion);
      if (n.lanes.length > 1) sfx('poms', { volume: 0.5 });
      else sfx('tap', { volume: 0.2, pitch: 1 + n.lanes[0] * 0.08 });
    } else if (ev.type === 'half') {
      const p = field.hitPoint(ev.lane);
      fx.ring(p.x, p.y, { color: LANE_COLORS[ev.lane], r0: lay.targetR * 0.8, r1: lay.targetR * 1.3, life: 0.22, width: 3 });
    } else if (ev.type === 'miss' || ev.type === 'drop') {
      say(ev.note.lanes, verdictWord(ev), VERDICT_COLORS.miss, 20);
      if (ev.broke >= 10) call(shakeItOff(), 'shake');
    } else if (ev.type === 'done') {
      for (const lane of ev.lanes) {
        const p = field.hitPoint(lane);
        fx.burst(p.x, p.y - 10, { count: 16, speed: 300, size: 8, life: 0.7, colors: [PALETTE.gold, PALETTE.rhinestoneSilver, LANE_COLORS[lane]] });
      }
      say(ev.lanes, verdictWord(ev), PALETTE.gold, 23, 26);
      sfx('sparkle', { volume: 0.4 });
    } else if (ev.type === 'combo') {
      call(comboCall(ev.combo), 'combo');
      sfx('crowd', { volume: Math.min(1, 0.3 + ev.combo / 110) });
      if (ev.combo >= 25) sfx('cheer', { volume: 0.5 });
    } else if (ev.type === 'fullOut') {
      call('FULL OUT!', 'full');
      spiritEl.classList.add('c9-full');
      setPose('cheer', 0.6);
      move('cheer');
      sfx('crowd', { volume: 1 });
      sfx('whoosh', { volume: 0.5 });
      if (!calm) {
        for (const sx of [0, W]) skyFx.burst(sx, H * 0.45, { kind: 'bow', count: 8, speed: 520, size: 9, life: 1.4, gravity: 420, angle: sx ? -2.2 : -0.95, spread: 0.8, colors: [PALETTE.pink, PALETTE.rhinestonePurple, PALETTE.black] });
      }
    } else if (ev.type === 'fullOutEnd') {
      spiritEl.classList.remove('c9-full');
    }
    if (ev.extra) for (const e of ev.extra) handle(e);
  }

  // ---------------------------------------------------------------- calls, ticker, sections
  let callTimer = 0;
  function call(text, kind) {
    callEl.textContent = text;
    callEl.dataset.kind = kind;
    callEl.classList.remove('c9-in');
    void callEl.offsetWidth;
    callEl.classList.add('c9-in');
    clearTimeout(callTimer);
    callTimer = setTimeout(() => callEl.classList.remove('c9-in'), kind === 'count' ? 420 : 1200);
  }

  function sectionAt(beat) {
    let si = 0;
    for (let i = 0; i < chart.sections.length; i++) if (chart.sections[i].startBeat <= beat) si = i;
    return si;
  }

  function onBeat(b) {
    const count = (((b % 8) + 8) % 8) + 1;
    cells.forEach((c, i) => {
      c.classList.toggle('c9-on', i === count - 1);
      c.classList.toggle('c9-past', i < count - 1);
    });
    if (b >= chart.countInBeat && b < chart.countInBeat + 8) {
      const c = countInCall(count);
      if (c) {
        call(c, count >= 5 ? 'count' : 'ready');
        if (count >= 5 && count < 8) sfx('count', { volume: 0.5 });
        if (count === 8) sfx('go', { volume: 0.6 });
      }
    }
    const si = sectionAt(b);
    if (si !== sectionIdx) {
      const first = sectionIdx === -1;
      sectionIdx = si;
      const sec = chart.sections[si];
      secEl.textContent = sec.label.toUpperCase();
      if (sec.motions.join() !== motions.join()) {
        motions = sec.motions.slice();
        flipAt = t;
      }
      if (!first && sec.notes) {
        call(sectionCall(sec.label), 'section');
        sfx('whoosh', { volume: 0.3 });
      }
    }
    // a little bounce on the beat when nothing else is going on
    if ((poseTo === 'ready' || poseTo === 'sway') && (count === 1 || count === 5)) setPose(count === 1 ? 'ready' : 'sway', 0);
  }

  // ---------------------------------------------------------------- the performer
  function setPose(name, hold) {
    poseFrom = blendSkeleton(figure, figure, 0, poseFrom === figure ? {} : poseFrom);
    poseTo = name;
    poseAt = t;
    poseHold = hold;
  }

  function updatePose() {
    const k = Math.min(1, (t - poseAt) / (calm ? 0.01 : 0.085));
    blendSkeleton(poseFrom, poseSkeleton(poseTo), 1 - (1 - k) * (1 - k), figure);
    if (poseHold > 0 && t - poseAt > poseHold && poseTo !== 'ready' && poseTo !== 'sway') setPose('ready', 0);
  }

  // ---------------------------------------------------------------- the perfect bot (?autoplay=1)
  function botStep(now) {
    const notes = run.notes;
    while (bot.next < notes.length && notes[bot.next].t <= now) {
      const n = notes[bot.next++];
      if (botSkill < 1 && Math.random() > 0.55 + 0.45 * botSkill) continue; // a sloppy bot lets some go
      const off = botSkill < 1 ? (Math.random() - 0.5) * (1 - botSkill) * 0.22 : 0;
      for (const lane of n.lanes) {
        bot.down[lane] = true;
        bot.until[lane] = Math.max(n.end - (botSkill < 1 && Math.random() > botSkill ? 0.3 : 0), n.t) + 0.08;
        glow[lane] = 1;
        handle(run.press(lane, n.t + off));
      }
    }
    for (let l = 0; l < 3; l++) {
      if (bot.down[l] && now >= bot.until[l]) {
        bot.down[l] = false;
        handle(run.release(l, now));
      }
    }
  }

  // ---------------------------------------------------------------- results
  function showResults() {
    phase = 'judges';
    setPhaseClass();
    const s = run.summary();
    const judges = JUDGES.map((j, i) => ({ id: j.id, name: j.name, category: j.category, card: s.cards[i].card, line: judgeLine(j.id, s.cards[i].card, s) }));
    const title = resultTitle(s);
    let sub = title.sub;
    if (hypeFn) {
      try {
        const h = hypeFn(s.hitZero ? 'routineZero' : 'routineGood', { level: level.name, score: s.score, name: null }, Math.random);
        if (typeof h === 'string' && h.length > 3 && h.length <= 90 && !s.hitZero) sub = h;
      } catch (err) { /* our own line is fine */ }
    }
    const best = readBest();
    const prev = best[level.id];
    const newBest = !prev || s.score > prev.score || (s.hitZero && !prev.hitZero);
    if (newBest) {
      best[level.id] = { score: Math.max(s.score, prev ? prev.score : 0), hitZero: s.hitZero || !!(prev && prev.hitZero) };
      safeStorageSet(BEST_KEY, JSON.stringify(best));
    }
    result = { ...s, level: level.name, title: title.big, sub, newBest, judges };
    lastResult = result;
    if (onResult) {
      try {
        onResult(result);
      } catch (err) { /* the app's problem */ }
    }
    music('victory', { fade: 0.8 });
    // set the stage; the reveal runs in the frame loop
    bigEl.textContent = title.big;
    bigEl.classList.toggle('c9-long', title.big.length > 10);
    subEl.textContent = sub;
    results.classList.remove('c9-show-total', 'c9-zero');
    root.classList.toggle('c9-hz--zero', s.hitZero);
    quoteEls.forEach((q, i) => {
      q.li.classList.remove('c9-in');
      q.card.textContent = judges[i].card === 10 ? '10' : judges[i].card.toFixed(1);
      q.text.textContent = judges[i].line;
    });
    totalNum.textContent = '0';
    bestTag.hidden = !newBest;
    stats.replaceChildren();
    const rowA = el('div', 'c9-hz-statrow');
    const rowB = el('div', 'c9-hz-statrow');
    stats.append(rowA, rowB);
    const chips = [['Perfect', s.perfect], ['Good', s.good], ['Oops', s.miss]];
    if (s.drop) chips.push(['Wobbles', s.drop]);
    chips.push(['Best streak', s.maxCombo], ['Accuracy', Math.round(s.accuracy * 100) + '%']);
    for (const [k, v] of chips) {
      const c = el('span', 'c9-hz-chipstat');
      c.append(el('small', null, k), el('b', null, String(v)));
      (rowA.children.length < (s.drop ? 4 : 3) ? rowA : rowB).appendChild(c);
    }
    panel.setCards(s.cards.map((c) => c.card));
    panel.reveal(0, t);
    panel.talking(-1);
    resultsAt = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resultStep = 0;
    ready.hidden = true;
    results.hidden = false;
    results.scrollTop = 0;
    sizePanel();
    source.stop();
    releaseAll();
  }

  function revealStep(i) {
    if (i < 3) {
      panel.reveal(i + 1, t);
      panel.talking(i);
      quoteEls[i].li.classList.add('c9-in');
      sfx('pop', { volume: 0.6 });
      sfx('chime', { volume: 0.5, pitch: 0.8 + result.cards[i].card / 25 });
    } else {
      panel.talking(-1);
      results.classList.add('c9-show-total');
      if (result.hitZero) {
        results.classList.add('c9-zero');
        celebrate.until = t + (calm ? 0.6 : 2.6);
        celebrate.next = t;
        sfx('tada');
        sfx('firework', { volume: 0.8 });
        sfx('crowd', { volume: 1 });
        sfx('cheer', { volume: 0.8 });
      } else {
        celebrate.until = t + 0.4;
        celebrate.next = t;
        sfx('clap', { volume: 0.7 });
        sfx('crowd', { volume: 0.6 });
      }
      if (finePointer) againBtn.focus({ preventScroll: true });
    }
  }

  function skipReveal() {
    while (resultStep < REVEAL.length) revealStep(resultStep++);
    resultsAt = t - REVEAL[REVEAL.length - 1] - 1.2;
  }

  function tickResults() {
    const since = t - resultsAt;
    while (resultStep < REVEAL.length && since >= REVEAL[resultStep]) revealStep(resultStep++);
    if (resultStep >= REVEAL.length) {
      const k = Math.min(1, (since - REVEAL[REVEAL.length - 1]) / 1.1);
      totalNum.textContent = fmtScore(result.score * (1 - (1 - k) * (1 - k) * (1 - k)));
    }
    // sparkle bursts all over for a hit zero, a few for everyone else
    if (t < celebrate.until && t >= celebrate.next) {
      const zero = result.hitZero;
      celebrate.next = t + (zero ? 0.28 : 0.2);
      const x = W * (0.15 + Math.random() * 0.7);
      const y = H * (0.12 + Math.random() * 0.35);
      skyFx.burst(x, y, { count: zero ? 26 : 14, speed: zero ? 420 : 300, size: zero ? 10 : 8, life: 1.1, gravity: 200, drag: 1.2 });
      if (zero) skyFx.burst(x, y, { kind: 'confetti', count: 18, speed: 380, size: 10, life: 1.8, gravity: 320, colors: [PALETTE.pink, PALETTE.rhinestonePurple, PALETTE.gold, PALETTE.babyBlue, PALETTE.mint] });
    }
    // draw the panel
    const b = panelCanvas.width / dpr;
    const h = panelCanvas.height / dpr;
    panelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    panelCtx.clearRect(0, 0, b, h);
    panel.draw(panelCtx, 0, 0, b, h, t, { cheering: result.hitZero && resultStep >= REVEAL.length, calm });
  }

  // ---------------------------------------------------------------- frame
  let skyDirty = false;
  let frameMs = 0;
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const now0 = performance.now();
    const dt = lastFrame ? Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)) : 1 / 60;
    lastFrame = now;
    t += dt;
    if ((phase === 'play' || phase === 'finale') && chart) {
      source.sample();
      song = source.songAt(now);
      songBeat = song / chart.spb;
      if (phase === 'play') {
        if (autoplay) botStep(song);
        for (const ev of run.update(song)) handle(ev);
        if (run.score !== shownScore) {
          shownScore = run.score;
          scoreEl.textContent = fmtScore(shownScore);
        }
        spiritFill.style.transform = 'scaleX(' + run.spirit.toFixed(3) + ')';
        if (run.finished && songBeat >= chart.lastBeat + 0.25) toFinale();
      } else if (t - finaleAt > 1.9) {
        showResults();
      }
      const b = Math.floor(songBeat);
      if (b !== lastBeatInt && b >= 0) {
        lastBeatInt = b;
        onBeat(b);
      }
      while (firstDraw < run.notes.length && run.notes[firstDraw].end < song - 1 && run.notes[firstDraw].state !== 'pending' && run.notes[firstDraw].state !== 'holding') firstDraw++;
    } else {
      // ready and waiting: the mat keeps time at 144 for the look of it
      song = t;
      songBeat = t / (60 / 144);
      const b = Math.floor(songBeat);
      if (b !== lastBeatInt && phase !== 'judges') {
        lastBeatInt = b;
        if ((poseTo === 'ready' || poseTo === 'sway') && b % 4 === 0) setPose(b % 8 ? 'sway' : 'ready', 0);
      }
    }
    for (let l = 0; l < 3; l++) {
      const down = lanePress[l] > 0 || bot.down[l];
      glow[l] = down ? 1 : glow[l] * Math.exp(-dt * 10);
    }
    for (let l = 0; l < 3; l++) {
      const k = Math.min(1, Math.max(0, (t - flipAt - l * 0.07) / 0.32));
      flip[l] = k >= 1 ? 1 : 0.4 + 0.6 * (1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2));
    }
    updatePose();
    fx.update(dt);
    skyFx.update(dt);

    if (phase !== 'judges') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const active = (phase === 'play' || phase === 'finale') && run;
      field.draw(ctx, {
        song, songBeat, spb: chart ? chart.spb : 60 / 144, approach: level.approach,
        notes: active ? run.notes : null, first: firstDraw, glow, motions, flip,
        fullOut: active ? run.fullOut : false, combo: active ? run.combo : 0,
        figure, t, dt, keys: keyHints, look,
        // she bobs on every beat
        bob: calm ? 0 : -Math.abs(Math.sin(Math.PI * (songBeat - Math.floor(songBeat)))) * field.layout.perf.size * 0.025,
      });
      fx.draw(ctx);
    } else {
      tickResults();
    }
    // the celebration layer only costs anything while something is flying
    if (skyFx.count || skyDirty) {
      skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      skyCtx.clearRect(0, 0, W, H);
      skyFx.draw(skyCtx);
      skyDirty = skyFx.count > 0;
    }
    frameMs = frameMs * 0.95 + (performance.now() - now0) * 0.05;
  }

  // ---------------------------------------------------------------- buttons
  onTap(goBtn, () => start());
  onTap(closeBtn, () => {
    if (playing()) quit();
    else close();
  });
  onTap(againBtn, () => start());
  onTap(levelsBtn, () => {
    sfx('tap', { volume: 0.4 });
    showReady();
  });
  onTap(doneBtn, () => close());
  results.addEventListener('pointerdown', (e) => {
    if (resultStep < REVEAL.length && !e.target.closest('button')) skipReveal();
  });
  onTap(soundBtn, () => {
    if (audio) {
      try {
        const on = audio.enabled === false;
        if (on && typeof audio.unlock === 'function') quiet(audio.unlock());
        quiet(audio.setEnabled(on));
      } catch (err) { /* fine */ }
    } else {
      source.setSound(!source.soundWanted);
      if (source.soundWanted) source.unlock();
    }
    soundLabel();
    sfx('tap', { volume: 0.4 });
  });
  onTap(calibBtn, () => {
    if (calib) return;
    phase = 'calib';
    setPhaseClass();
    ready.hidden = true;
    source.unlock();
    calib = openCalibration({
      parent: root, audio, source, tap: onTap, sfx,
      onClose: () => {
        calib = null;
        if (!destroyed) showReady();
      },
    });
  });

  // ---------------------------------------------------------------- open and close
  function close() {
    if (destroyed) return;
    teardown();
    if (onDone) {
      try {
        onDone(lastResult);
      } catch (err) {
        console.error('[c9] Hit Zero onDone failed', err);
      }
    }
  }

  function teardown() {
    destroyed = true;
    phase = 'closed';
    runToken++;
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    if (calib) calib.close();
    source.dispose();
    if (ro) ro.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', releaseAll);
    root.remove();
  }

  ensureCss().then(() => {
    if (destroyed) return;
    root.style.visibility = '';
    resize();
    drawStatic();
    refreshReady();
    if (autostart) start();
    else showReady();
    sfx('open', { volume: 0.5 });
  });
  raf = requestAnimationFrame(frame);

  return {
    el: root,
    start: (lv) => start(lv),
    close,
    destroy: teardown,
    get phase() { return phase; },
    // tests: the chart being played, song time now, and where each lane's tap zone is
    get _test() {
      return {
        notes: chart ? chart.notes.map((n) => ({ t: n.t, end: n.end, lanes: n.lanes.slice(), len: n.len })) : [],
        songNow: () => source.songNow(),
        laneX: (lane) => field.hitPoint(lane).x + rootLeft,
        zoneY: () => rootTop + (field.layout.zoneTop + field.layout.h) / 2,
        audible: source.audible,
        frameMs: () => frameMs,
        judged: () => (run ? run.notes.map((n) => ({ state: n.state, verdict: n.verdict, dt: n.dt, hits: { ...n.hits } })) : []),
      };
    },
    get state() {
      return {
        phase, level: level.id, songBeat, score: run ? run.score : 0, combo: run ? run.combo : 0, maxCombo: run ? run.maxCombo : 0,
        counts: run ? run.counts : null, spirit: run ? run.spirit : 0, fullOut: run ? run.fullOut : false,
        finished: run ? run.finished : false, notes: chart ? chart.notes.length : 0, source: source.kind, result,
      };
    },
  };
}
