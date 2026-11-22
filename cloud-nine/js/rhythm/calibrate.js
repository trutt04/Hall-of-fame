// "Tap to the beat": Hit Zero's timing check. The beat plays (the routine track, or the practice
// beat), the player taps the big pom-pom on every beat they hear, and the median of where the
// taps land becomes the latency offset, saved under STORAGE_KEYS.rhythmLatency. This is what
// keeps Bluetooth headphones playable. The screen never shows the beat: it would tempt the eye
// to tap to the picture instead of the sound.
//
//   const cal = openCalibration({ parent, audio, source, onClose(savedMs | null), tap })
//     parent  the overlay root;  source  a createSource();  tap  hud-style onTap(el, fn)
//   cal.close()
//   cal.tapNow()                   a tap, for tests

import { PALETTE, STORAGE_KEYS } from '../config.js';
import { safeStorageGet, safeStorageSet } from '../core/util.js';
import { tapOffset, calibrate, cleanLatency, LATENCY_RANGE } from './clock.js';
import { CALIBRATE, latencyText } from './lines.js';
import { drawPom } from './figure.js';

const TAPS = 14; // two warm-up taps, then twelve that count
const LISTEN_BEATS = 4;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

// the audio module may answer with a promise: a rejected one is no reason to shout
const quiet = (p) => {
  if (p && typeof p.catch === 'function') p.catch(() => {});
};

export function readLatency() {
  return cleanLatency(safeStorageGet(STORAGE_KEYS.rhythmLatency));
}

export function openCalibration({ parent, audio = null, source, onClose = null, tap = null, sfx = () => {} }) {
  const onTap = tap || ((n, fn) => n.addEventListener('click', fn));
  const root = el('section', 'c9-hz-calib c9-hz-card');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', CALIBRATE.title);
  const title = el('h2', 'c9-hz-h2', CALIBRATE.title);
  const intro = el('p', 'c9-hz-p', CALIBRATE.intro);
  const pomBtn = el('button', 'c9-hz-pom');
  pomBtn.type = 'button';
  pomBtn.setAttribute('aria-label', 'Tap on the beat');
  const pomCanvas = el('canvas');
  pomBtn.appendChild(pomCanvas);
  const dots = el('div', 'c9-hz-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < TAPS - 2; i++) dots.appendChild(el('i'));
  const status = el('p', 'c9-hz-status', CALIBRATE.listen);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const nudge = el('div', 'c9-hz-nudge');
  const minus = el('button', 'c9-hz-btn c9-hz-btn-small', '-10 ms');
  const value = el('b', 'c9-hz-nudge-val', '');
  const plus = el('button', 'c9-hz-btn c9-hz-btn-small', '+10 ms');
  minus.type = 'button';
  plus.type = 'button';
  nudge.append(minus, value, plus);
  nudge.hidden = true;
  const actions = el('div', 'c9-hz-actions');
  const save = el('button', 'c9-hz-btn c9-hz-btn-primary', 'Save');
  const again = el('button', 'c9-hz-btn', 'Try again');
  const reset = el('button', 'c9-hz-btn', 'Reset to 0');
  const back = el('button', 'c9-hz-btn', 'Back');
  for (const b of [save, again, reset, back]) b.type = 'button';
  save.hidden = true;
  again.hidden = true;
  actions.append(save, again, reset, back);
  root.append(title, intro, pomBtn, dots, status, nudge, actions);
  parent.appendChild(root);

  // the pom-pom picture
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const size = 150;
  pomCanvas.width = size * dpr;
  pomCanvas.height = size * dpr;
  pomCanvas.style.width = size + 'px';
  pomCanvas.style.height = size + 'px';
  const g = pomCanvas.getContext('2d');
  g.scale(dpr, dpr);
  g.lineCap = 'round';
  drawPom(g, size / 2, size / 2, size * 0.44, PALETTE.pink, PALETTE.rhinestoneSilver, 0.7, 2, { strands: 46, thick: 0.13 });

  const st = { offsets: [], result: null, ms: readLatency(), ready: false, closed: false, origin: 0, spb: 60 / 144, listenUntil: 0 };
  const saved = readLatency();
  value.textContent = fmt(st.ms);

  function fmt(ms) {
    return (ms > 0 ? '+' : '') + ms + ' ms';
  }

  function setDots() {
    const n = Math.max(0, st.offsets.length - 2);
    [...dots.children].forEach((d, i) => d.classList.toggle('c9-on', i < n));
  }

  async function begin() {
    st.offsets = [];
    st.result = null;
    st.ready = false;
    save.hidden = true;
    again.hidden = true;
    nudge.hidden = true;
    setDots();
    status.textContent = CALIBRATE.listen;
    let info = null;
    try {
      info = await source.start({ track: 'routine', latencyMs: 0 });
    } catch (err) {
      info = null;
    }
    if (st.closed) return;
    if (!info || !source.audible) {
      status.textContent = CALIBRATE.needSound;
      source.stop();
      again.hidden = false;
      return;
    }
    st.origin = source.clock.origin;
    st.spb = source.clock.spb;
    // listen for a few beats first
    st.listenUntil = st.origin + LISTEN_BEATS * st.spb;
    st.ready = true;
    waitListen();
  }

  function waitListen() {
    if (st.closed) return;
    source.sample();
    if (source.musicAt(performance.now()) >= st.listenUntil) {
      status.textContent = CALIBRATE.go;
      return;
    }
    setTimeout(waitListen, 60);
  }

  function onPom(e) {
    if (!st.ready || st.result) return;
    source.sample();
    const nowP = performance.now();
    let ts = e && typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : nowP;
    if (!(ts <= nowP && nowP - ts < 120)) ts = nowP;
    const t = source.musicAt(ts);
    if (t < st.listenUntil - st.spb * 0.5) return;
    pomBtn.classList.remove('c9-squish');
    void pomBtn.offsetWidth;
    pomBtn.classList.add('c9-squish');
    st.offsets.push(tapOffset(t, st.origin, st.spb));
    setDots();
    if (st.offsets.length >= 3) status.textContent = CALIBRATE.keep + ' ' + (TAPS - st.offsets.length) + ' more';
    if (st.offsets.length >= TAPS) finish();
  }

  function finish() {
    const r = calibrate(st.offsets, { skip: 2 });
    st.result = r || { ms: 0, spread: 999, n: 0 };
    source.stop();
    try {
      if (audio && audio.music) quiet(audio.music(null, { fade: 0.6 }));
    } catch (err) { /* fine */ }
    if (!r || r.spread > 70) {
      status.textContent = CALIBRATE.messy;
      again.hidden = false;
      return;
    }
    st.ms = r.ms;
    value.textContent = fmt(st.ms);
    status.textContent = CALIBRATE.done + ' ' + latencyText(st.ms);
    sfx('chime');
    save.hidden = false;
    again.hidden = false;
    nudge.hidden = false;
    save.focus();
  }

  function close(ms) {
    if (st.closed) return;
    st.closed = true;
    source.stop();
    try {
      if (audio && audio.music) quiet(audio.music(null, { fade: 0.6 }));
    } catch (err) { /* fine */ }
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(ms);
  }

  function onKey(e) {
    if (st.closed) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (document.activeElement && document.activeElement !== pomBtn && document.activeElement.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) onPom(e);
    } else if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(null);
    }
  }
  window.addEventListener('keydown', onKey, true);

  pomBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onPom(e);
  });
  onTap(save, () => {
    safeStorageSet(STORAGE_KEYS.rhythmLatency, String(st.ms));
    close(st.ms);
  });
  onTap(again, () => begin());
  onTap(reset, () => {
    st.ms = 0;
    value.textContent = fmt(0);
    safeStorageSet(STORAGE_KEYS.rhythmLatency, '0');
    status.textContent = 'Timing reset to 0 ms.';
    if (saved !== 0) sfx('tap');
  });
  onTap(back, () => close(null));
  onTap(minus, () => {
    st.ms = cleanLatency(st.ms - 10);
    value.textContent = fmt(st.ms);
  });
  onTap(plus, () => {
    st.ms = Math.min(LATENCY_RANGE.max, cleanLatency(st.ms + 10));
    value.textContent = fmt(st.ms);
  });

  begin();
  return {
    el: root,
    close: () => close(null),
    tapNow: () => onPom(null),
    get state() {
      return { taps: st.offsets.length, result: st.result, ms: st.ms, ready: st.ready };
    },
  };
}
