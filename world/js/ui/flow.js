// The visitor experience: team picker -> arrival -> recap -> free roam, plus the HUD wiring.
// This is the flow half of Contract 7. The world half (main.js) builds the town and calls
//
//   await startFlow(ctx)      once, after the model exists and town.apply(model) has run.
//                             Resolves as soon as the first screen (picker or arrival) is up.
//                             Rejects, after cleaning up after itself, if it cannot get that far.
//   stopFlow()                tears everything down: listeners off, the flow's DOM removed
//   renderFallback(el, data)  instead of all this, when WebGL is not available
//
// Everything the flow adds to the page lives under one element: #hud > .lwf-root. The state
// classes it puts on #hud all start with "lwf-" and are stripped on teardown.
//
// URL: ?team=<id> picks a team (read by the store), ?nointro=1 skips straight to free roam.

import { openTeamPicker } from './teampick.js';
import { runArrival } from './arrival.js';
import { createCards } from './cards.js';
import { createPanels } from './panels.js';
import { createPostcard } from './postcard.js';
import { readLastSeen, saveLastSeen, showRecap } from './recap.js';
import { renderFallback } from './fallback.js';
import {
  wait, rankBig, tierName, teamName, ordinal, matchupParts, weekLabel, idleWeekText, reducedMotion, coarsePointer, loadFlag, saveFlag,
  flowRoot, ROOT_CLASS, HINT_KEY,
} from './dom.js';
import { modelOf, idleCamera, travelToHome, travelToPlace } from './seam.js';
import { startLine, settleLabel } from './vandal.js';

export { renderFallback };

const HINT_TOUCH = 'Drag left side to walk. Drag right side to look. Tap anything.';
const HINT_KEYS = 'WASD to walk, drag to look, click anything. E to use.';
const VISITOR_KEY = 'lw.visitor'; // '1' when the visitor chose "Just looking" last time
const START_TIMEOUT_MS = 12000;
const NARROW_TIER = { park: 'Trailer Park' }; // tier names that do not fit the chip on a 360 px phone

let active = null;
let starting = null;
const announced = new Set(); // teams told about their score to settle, once per visit

export function startFlow(ctx) {
  if (active) return Promise.resolve(active);
  if (starting) return starting;
  const attempt = new Promise((resolve, reject) => {
    let settled = false;
    let teardown = null;
    const fail = (err) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      try {
        if (teardown) teardown();
      } catch (e) { /* nothing more to undo */ }
      reject(err instanceof Error ? err : new Error(String(err)));
      return true;
    };
    const ok = (api) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active = api;
      try {
        window.__lwFlow = api;
      } catch (e) { /* no window, no debug handle */ }
      resolve(api);
    };
    // never leave the caller hanging behind the loading veil
    const timer = setTimeout(() => fail(new Error('the flow did not start in time')), START_TIMEOUT_MS);
    try {
      teardown = build(ctx, ok, fail);
    } catch (err) {
      fail(err);
    }
  });
  // The first screen can come up (or fail) before the promise above even exists, so the
  // "starting" marker is cleared here, once it has settled either way.
  starting = attempt;
  const clear = () => {
    if (starting === attempt) starting = null;
  };
  attempt.then(clear, clear);
  return attempt;
}

export function stopFlow() {
  if (active) active.stop();
}

function build(ctx, started, failed) {
  const { store, hud, audio, camera } = ctx;
  const input = ctx.input || (ctx.world && ctx.world.input) || null;
  const model = () => modelOf(ctx);
  if (!model() || !model().teams) throw new Error('the flow needs a model');

  let teamId = null; // who the visitor is playing as. null is a visitor.
  let phase = 'boot'; // 'boot' | 'pick' | 'arrival' | 'roam' | 'stopped'
  let arrival = null;
  let lastRank = null;
  let run = 0; // bumps on every team switch so a stale async chain can tell it is stale
  let offs = []; // everything wire() registered, dropped again by unwire()
  let hintOffs = [];
  let lastModalClose = -1000;

  const api = {
    teamId: () => teamId,
    openHome: (id) => cards.home(id, { go: true }),
    goHome: (id) => travelToHome(ctx, id),
    goPlace: (id) => travelToPlace(ctx, id),
    switchTeam,
    toggleSound,
  };
  const postcard = createPostcard(ctx, api);
  api.postcard = (id) => postcard.open({ teamId: id });
  const cards = createCards(ctx, api);
  const panels = createPanels(ctx, api);
  flowRoot(hud);

  // ---------------------------------------------------------------- status chip and ribbon
  function paintStatus() {
    const m = model();
    if (!m) return;
    const t = teamId !== null ? m.teams[teamId] : null;
    const narrow = window.innerWidth < 600;
    if (t) {
      const mp = matchupParts(m, t);
      // one line where there is room, two on a phone so the score is never cut off
      hud.setStatus({
        rankText: rankBig(t.rank), teamName: teamName(t), recordText: t.record.text,
        tierName: (narrow && NARROW_TIER[t.tier]) || tierName(t.tier), color: t.color,
        line2: mp ? mp.opponent + (narrow ? '\n' : ' ') + mp.score : idleWeekText(m.meta),
      });
    } else {
      hud.setStatus({ rankText: '', teamName: 'Visitor', recordText: weekLabel(m.meta), tierName: 'Just looking', line2: m.meta.leagueName });
    }
    hud.setRibbon(m.meta.isSample ? 'SAMPLE DATA' : null);
  }

  function onModel() {
    const m = model();
    if (!m) return;
    const t = teamId !== null ? m.teams[teamId] : null;
    if (t && lastRank !== null && t.rank !== lastRank && phase === 'roam') {
      hud.toast(t.rank < lastRank ? 'You just moved up to ' + ordinal(t.rank) + '.' : 'You just dropped to ' + ordinal(t.rank) + '.', { ms: 5200 });
      try {
        audio.sfx(t.rank < lastRank ? 'coin' : 'pop');
      } catch (err) { /* sound is optional */ }
    }
    if (t) lastRank = t.rank;
    paintStatus();
  }

  // ---------------------------------------------------------------- sound
  let lastAudioChange = -1000;
  const syncSound = () => hud.setButton('sound', { pressed: audio.enabled, label: audio.enabled ? 'Sound on' : 'Sound off' });
  function toggleSound() {
    const on = audio.toggle();
    if (on) audio.sfx('pop');
    hud.toast(on ? 'Sound on' : 'Sound off', { ms: 1200 });
    return on;
  }
  // Sound was on last time: browsers only let it start from a gesture, so the first tap starts it.
  function armSound() {
    if (!audio.wanted || audio.enabled) return;
    let tries = 0;
    const types = ['pointerdown', 'pointerup', 'keydown'];
    const stop = () => types.forEach((t) => window.removeEventListener(t, arm, true));
    function arm() {
      if (!audio.wanted) return stop();
      if (!audio.enabled || audio.state !== 'running') audio.enable();
      if (audio.state === 'running' || ++tries >= 3) stop();
    }
    types.forEach((t) => window.addEventListener(t, arm, true));
    offs.push(stop);
  }

  // ---------------------------------------------------------------- the avatar holds still behind cards and panels
  function freezePlayer() {
    try {
      if (ctx.player && typeof ctx.player.cancelWalk === 'function') ctx.player.cancelWalk();
    } catch (err) { /* nothing to cancel */ }
    const w = ctx.world;
    if (!w || typeof w.freezePlayer !== 'function') return () => {};
    try {
      const r = w.freezePlayer(true);
      // either shape of the world's freezePlayer: one that hands back a release, or an on/off switch
      return typeof r === 'function' ? r : () => {
        try {
          w.freezePlayer(false);
        } catch (err) { /* already released */ }
      };
    } catch (err) {
      return () => {};
    }
  }

  // ---------------------------------------------------------------- HUD wiring
  function wire() {
    const toggle = (open) => () => {
      if (phase !== 'roam') return;
      if (hud.panelOpen) hud.closePanel();
      else open();
    };
    offs.push(hud.onButton('map', toggle(panels.map)));
    offs.push(hud.onButton('standings', toggle(panels.standings)));
    offs.push(hud.onButton('menu', toggle(panels.menu)));
    offs.push(hud.onButton('postcard', () => {
      if (phase === 'roam' && !hud.isModalOpen()) postcard.open({});
    }));
    hud.setButton('postcard', { hidden: false });
    offs.push(() => hud.setButton('postcard', { hidden: true }));
    offs.push(hud.onButton('status', () => {
      if (phase !== 'roam') return;
      if (teamId !== null) cards.home(teamId);
      else cards.visitor();
    }));
    offs.push(hud.onButton('sound', () => {
      // if the world side already flipped it on this same tap, do not flip it back
      if (performance.now() - lastAudioChange < 60) return;
      toggleSound();
    }));
    offs.push(audio.on('change', () => {
      lastAudioChange = performance.now();
      syncSound();
    }));
    syncSound();

    // Anything modal (card, panel, stamp) stops the avatar and holds it until it closes.
    let release = null;
    offs.push(hud.on('modal', (open) => {
      if (open) {
        if (!release) release = freezePlayer();
      } else {
        lastModalClose = performance.now();
        if (release) release();
        release = null;
      }
    }));
    offs.push(() => {
      if (release) release();
      release = null;
    });

    // M opens the map (the input module reports it), and M closes it again. World input is
    // suspended while a panel is open, so the closing half is listened for here.
    if (input && typeof input.on === 'function') {
      offs.push(input.on('map', () => {
        if (phase !== 'roam' || performance.now() - lastModalClose < 120) return;
        if (!hud.isModalOpen()) panels.map();
      }));
    }
    const onKey = (e) => {
      if (e.key === 'Escape' && hud.cardOpen && hud.panelOpen) {
        // a card opened from a panel sits on top of it, so Escape closes the card first
        e.stopImmediatePropagation();
        hud.closeCard();
        return;
      }
      if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || phase !== 'roam') return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
      if (hud.panelOpen && !hud.cardOpen) {
        e.stopImmediatePropagation();
        hud.closePanel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    offs.push(() => window.removeEventListener('keydown', onKey, true));

    offs.push(store.on('model', onModel));
    offs.push(store.on('use', (e) => {
      if (phase !== 'roam' || !e) return;
      if (cards.use(e)) return;
      if (e.kind === 'newspaper') panels.newspaper();
      else if (e.kind === 'standings') panels.standings();
      else if (e.kind === 'matchups') panels.standings({ matchups: true });
    }));

    // the SAMPLE DATA ribbon explains itself when tapped
    const ribbon = hud.el.querySelector('.lw-ribbon');
    if (ribbon) {
      const explain = (e) => {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        if (phase === 'roam') cards.sample();
      };
      ribbon.setAttribute('role', 'button');
      ribbon.tabIndex = 0;
      ribbon.classList.add('lwf-tap');
      ribbon.addEventListener('click', explain);
      ribbon.addEventListener('keydown', explain);
      offs.push(() => {
        ribbon.removeEventListener('click', explain);
        ribbon.removeEventListener('keydown', explain);
        ribbon.classList.remove('lwf-tap');
        ribbon.removeAttribute('role');
        ribbon.removeAttribute('tabindex');
      });
    }

    const onResize = () => paintStatus();
    window.addEventListener('resize', onResize);
    offs.push(() => window.removeEventListener('resize', onResize));
    armSound();
  }

  function unwire() {
    for (const off of offs.concat(hintOffs)) {
      try {
        if (typeof off === 'function') off();
      } catch (err) { /* already gone */ }
    }
    offs = [];
    hintOffs = [];
  }

  // ---------------------------------------------------------------- one-time controls hint
  // Shown once control is in the visitor's hands. Only their own input puts it away: a drag or a
  // tap on the 3D view, or a movement key. The avatar walking out of its own front door does not.
  function showHint() {
    if (loadFlag(HINT_KEY) === '1' || (input && input.hasMoved)) return false;
    hud.showHint(coarsePointer() ? HINT_TOUCH : HINT_KEYS);
    const shownAt = performance.now();
    const canvas = (ctx.engine && ctx.engine.renderer && ctx.engine.renderer.domElement) || document.getElementById('scene');
    let done = false;
    let used = false;
    let down = null;
    const timers = [];
    const hide = (remember) => {
      if (done) return;
      done = true;
      hud.hideHint();
      if (remember) saveFlag(HINT_KEY, '1');
      for (const off of hintOffs) off();
      hintOffs = [];
    };
    const realInput = () => {
      if (used || done) return;
      used = true;
      // leave it up long enough to be read, then put it away for good
      timers.push(setTimeout(() => hide(true), Math.max(1500, 4000 - (performance.now() - shownAt))));
    };
    const onDown = (e) => {
      if (e.target === canvas) down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) realInput();
    };
    const onUp = () => {
      if (down) realInput(); // a tap on the ground is input too
      down = null;
    };
    const onKeyDown = (e) => {
      if (/^(Key[WASD]|Arrow)/.test(e.code || '') && !hud.isModalOpen()) realInput();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    timers.push(setTimeout(() => hide(false), 30000)); // nobody touched anything: show it again next time
    // A ride, a game, a scope or a card taking over means the walking advice is in the way.
    // Put it away for now without remembering it, so it comes back on the next visit.
    const rig = ctx.camera || (ctx.world && ctx.world.rig);
    const watch = setInterval(() => {
      if ((rig && rig.isCinematic) || hud.isModalOpen()) hide(false);
    }, 300);
    timers.push(watch);
    hintOffs.push(
      () => window.removeEventListener('pointerdown', onDown, true),
      () => window.removeEventListener('pointermove', onMove, true),
      () => window.removeEventListener('pointerup', onUp, true),
      () => window.removeEventListener('keydown', onKeyDown, true),
      () => timers.forEach(clearTimeout),
      () => {
        if (!done) {
          done = true;
          hud.hideHint();
        }
      },
    );
    return true;
  }

  // ---------------------------------------------------------------- a score to settle
  // A team that won last week hears whose home is fair game: one toast, once per visit, after the
  // recap card has closed and after the controls hint has had the screen to itself for a moment.
  async function announceRight(mine, hinted) {
    if (teamId === null || announced.has(teamId)) return;
    const text = startLine(ctx, teamId);
    if (!text) return;
    await wait(hinted ? 2200 : 900);
    while (mine === run && (phase !== 'roam' || hud.isModalOpen())) await wait(400);
    if (mine !== run || announced.has(teamId)) return;
    announced.add(teamId);
    hud.toast(text, { kicker: settleLabel(ctx), ms: Math.min(9500, Math.max(4500, 2600 + text.length * 55)) });
  }

  // ---------------------------------------------------------------- the sequence
  async function begin(o = {}) {
    const mine = ++run;
    const m = model();
    if (!m || !m.teams) throw new Error('the flow needs a model');
    const nointro = !!(store.params && store.params.get('nointro') === '1');
    let id = store.get('teamId');
    const known = id !== null && id !== undefined && !!m.teams[id];
    const wasVisitor = !known && loadFlag(VISITOR_KEY) === '1'; // chose "Just looking" last time
    let picked = false;

    if (o.fromSwitch || (!known && !nointro && !wasVisitor)) {
      phase = 'pick';
      idleCamera(ctx, true);
      const choosing = openTeamPicker(ctx, { canCancel: !!o.fromSwitch });
      started(handle);
      const choice = await choosing;
      if (mine !== run) return;
      if (choice.cancelled) {
        idleCamera(ctx, false);
        wire();
        phase = 'roam';
        return;
      }
      await hud.fade(true, 240);
      idleCamera(ctx, false);
      id = choice.teamId;
      store.setTeam(id);
      saveFlag(VISITOR_KEY, id === null ? '1' : '0');
      picked = true;
      if (o.fromSwitch) wire();
    } else if (!nointro) {
      await hud.fade(true, 120);
    }
    if (mine !== run) return;

    teamId = id !== null && id !== undefined && m.teams[id] ? id : null;
    lastRank = teamId !== null ? m.teams[teamId].rank : null;
    paintStatus();

    const prev = readLastSeen();
    const sameTeam = !!prev && teamId !== null && prev.teamId === teamId;
    const sameWeek = sameTeam && prev.season === m.meta.season && prev.week === m.meta.week;
    const returning = sameWeek && !picked;
    const kind = nointro ? 'none' : reducedMotion() ? 'calm' : returning ? 'short' : 'full';
    const prevRank = returning && prev.teams[teamId] ? prev.teams[teamId].rank : undefined;

    phase = 'arrival';
    arrival = runArrival(ctx, { teamId, kind, prevRank, title: !(teamId === null && wasVisitor && !picked) });
    started(handle);
    const result = await arrival.done;
    if (mine !== run || result.cancelled) return;
    arrival = null;
    phase = 'roam';
    paintStatus();

    if (teamId !== null) {
      const now = model() || m;
      if (sameTeam && !nointro) {
        await wait(result.skipped || kind !== 'full' ? 900 : 1700);
        if (mine !== run) return;
        if (!hud.isModalOpen()) showRecap(ctx, now, teamId, prev);
      }
      saveLastSeen(now, teamId);
    } else if (wasVisitor && !picked && !nointro) {
      hud.toast('Still just looking. Tap Visitor up top to pick your team.', { ms: 5200 });
    }
    if (mine === run) announceRight(mine, showHint());
  }

  function recover(err) {
    // Something broke after the first screen was up: the visitor still gets a working world.
    console.error('[lw] flow failed, carrying on in free roam', err);
    phase = 'roam';
    cleanDom();
    hud.fade(false, 200);
    try {
      idleCamera(ctx, false);
      if (camera.isCinematic) camera.skip();
    } catch (e) { /* nothing playing */ }
    if (!offs.length) wire();
    paintStatus();
  }

  function go(o) {
    begin(o).catch((err) => {
      if (!failed(err)) recover(err);
    });
  }

  function switchTeam() {
    hud.closeAll();
    if (arrival) {
      arrival.cancel();
      arrival = null;
    }
    unwire();
    go({ fromSwitch: true });
  }

  // remove everything the flow put on the page
  function cleanDom() {
    const root = hud.el.querySelector(':scope > .' + ROOT_CLASS);
    if (root) root.replaceChildren();
    for (const c of [...hud.el.classList]) if (c.startsWith('lwf-')) hud.el.classList.remove(c);
  }

  function stop() {
    if (phase === 'stopped') return;
    phase = 'stopped';
    run++;
    try {
      if (arrival) arrival.cancel();
    } catch (err) { /* already over */ }
    arrival = null;
    unwire();
    cleanDom();
    const root = hud.el.querySelector(':scope > .' + ROOT_CLASS);
    if (root) root.remove();
    try {
      idleCamera(ctx, false);
      if (camera.isCinematic) camera.skip();
      hud.fade(false, 0);
    } catch (err) { /* the world may already be gone */ }
    if (active === handle) active = null;
  }

  const handle = {
    switchTeam,
    stop,
    panels,
    cards,
    rootClass: ROOT_CLASS,
    get teamId() { return teamId; },
    get phase() { return phase; },
  };

  wire();
  go();
  return stop;
}
