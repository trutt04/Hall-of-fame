// The visitor experience: team picker -> arrival -> recap -> free roam, plus the HUD wiring.
// This is the flow half of Contract 7. The world half (main.js) builds the town and calls
//
//   startFlow(ctx)            once, after the model exists and town.apply(model) has run
//   renderFallback(el, data)  instead, when WebGL is not available
//
// URL: ?team=<id> picks a team (read by the store), ?nointro=1 skips straight to free roam.

import { STORAGE_KEYS } from '../config.js';
import { openTeamPicker } from './teampick.js';
import { runArrival } from './arrival.js';
import { createCards } from './cards.js';
import { createPanels } from './panels.js';
import { readLastSeen, saveLastSeen, showRecap } from './recap.js';
import { renderFallback } from './fallback.js';
import {
  wait, rankBig, tierName, teamName, ordinal, matchupParts, reducedMotion, coarsePointer, loadFlag, saveFlag, HINT_KEY,
} from './dom.js';
import { modelOf, idleCamera, travelToHome, travelToPlace } from './seam.js';

export { renderFallback };

const HINT_TOUCH = 'Drag left side to walk. Drag right side to look. Tap anything.';
const HINT_KEYS = 'WASD to walk, drag to look, click anything. E to use.';

let active = null;

export function startFlow(ctx) {
  if (active) return active;
  const { store, hud, audio, camera } = ctx;
  const input = ctx.input || (ctx.world && ctx.world.input) || null;
  const model = () => modelOf(ctx);

  let teamId = null; // who the visitor is playing as. null is a visitor.
  let phase = 'boot'; // 'boot' | 'pick' | 'arrival' | 'roam'
  let arrival = null;
  let lastRank = null;
  let run = 0; // bumps on every team switch so a stale async chain can tell it is stale
  let offs = []; // everything wire() registered, dropped again by unwire()
  let hintOffs = [];

  const api = {
    teamId: () => teamId,
    openHome: (id) => cards.home(id, { go: true }),
    goHome: (id) => travelToHome(ctx, id),
    goPlace: (id) => travelToPlace(ctx, id),
    switchTeam,
    toggleSound,
  };
  const cards = createCards(ctx, api);
  const panels = createPanels(ctx, api);

  // ---------------------------------------------------------------- status chip and ribbon
  function paintStatus() {
    const m = model();
    if (!m) return;
    const t = teamId !== null ? m.teams[teamId] : null;
    if (t) {
      const mp = matchupParts(m, t);
      // one line where there is room, two on a phone so the score is never cut off
      const join = window.innerWidth < 600 ? '\n' : ' ';
      hud.setStatus({
        rankText: rankBig(t.rank), teamName: teamName(t), recordText: t.record.text, tierName: tierName(t.tier), color: t.color,
        line2: mp ? mp.opponent + join + mp.score : 'Bye week',
      });
    } else {
      hud.setStatus({ rankText: '', teamName: 'Visitor', recordText: 'Week ' + m.meta.week, tierName: 'Just looking', line2: m.meta.leagueName });
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
    if (input && typeof input.on === 'function') offs.push(input.on('map', toggle(panels.map)));

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
        cards.sample();
      };
      ribbon.setAttribute('role', 'button');
      ribbon.tabIndex = 0;
      ribbon.classList.add('lwf-tap');
      ribbon.addEventListener('click', explain);
      ribbon.addEventListener('keydown', explain);
      offs.push(() => {
        ribbon.removeEventListener('click', explain);
        ribbon.removeEventListener('keydown', explain);
      });
    }

    // a card opened from a panel sits on top of it, so Escape closes the card first
    const onEscape = (e) => {
      if (e.key === 'Escape' && hud.cardOpen && hud.panelOpen) {
        e.stopImmediatePropagation();
        hud.closeCard();
      }
    };
    window.addEventListener('keydown', onEscape, true);
    offs.push(() => window.removeEventListener('keydown', onEscape, true));
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
  function showHint() {
    if (loadFlag(HINT_KEY) === '1' || (input && input.hasMoved)) return;
    hud.showHint(coarsePointer() ? HINT_TOUCH : HINT_KEYS);
    const base = { x: ctx.player.position.x, z: ctx.player.position.z };
    let done = false;
    const hide = (remember) => {
      if (done) return;
      done = true;
      hud.hideHint();
      if (remember) saveFlag(HINT_KEY, '1');
    };
    const timer = setTimeout(() => hide(false), 16000);
    hintOffs.push(() => clearTimeout(timer), () => hide(false));
    if (input && typeof input.on === 'function') hintOffs.push(input.on('firstmove', () => hide(true)));
    hintOffs.push(store.on('player', (s) => {
      if (s && Math.hypot(s.x - base.x, s.z - base.z) > 2.5) hide(true);
    }));
  }

  // ---------------------------------------------------------------- the sequence
  async function begin(o = {}) {
    const mine = ++run;
    const m = model();
    if (!m || !m.teams) return;
    const nointro = !!(store.params && store.params.get('nointro') === '1');
    let id = store.get('teamId');
    const known = id !== null && id !== undefined && !!m.teams[id];
    let picked = false;

    if (o.fromSwitch || (!known && !nointro)) {
      phase = 'pick';
      idleCamera(ctx, true);
      const choice = await openTeamPicker(ctx, { canCancel: !!o.fromSwitch });
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
    arrival = runArrival(ctx, { teamId, kind, prevRank });
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
    }
    if (mine === run) showHint();
  }

  function switchTeam() {
    hud.closeAll();
    if (arrival) {
      arrival.cancel();
      arrival = null;
    }
    unwire();
    begin({ fromSwitch: true });
  }

  wire();
  begin().catch((err) => {
    // Whatever went wrong, the visitor still gets a working world.
    console.error('[lw] flow failed, falling back to free roam', err);
    phase = 'roam';
    hud.el.classList.remove('lwf-cine', 'lwf-picking');
    hud.fade(false, 200);
    try {
      if (camera.isCinematic) camera.skip();
    } catch (e) { /* nothing playing */ }
    paintStatus();
  });

  active = {
    switchTeam,
    panels,
    cards,
    get teamId() { return teamId; },
    get phase() { return phase; },
    keys: STORAGE_KEYS,
  };
  try {
    window.__lwFlow = active;
  } catch (err) { /* no window, no debug handle */ }
  return active;
}
