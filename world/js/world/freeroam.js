// Free roam without the UI flow. Used when ui/flow.js is missing or fails, and with ?noflow=1.
// It wires just enough HUD for the world to be usable (and testable) on its own: the status chip,
// fast travel, a plain standings list, sound, and small cards for whatever the visitor uses.
// The real experience (team picker, arrival, recap, cards, panels) lives in ui/flow.js.

import { TIERS, PATHS } from '../config.js';
import { safeStorageGet, safeStorageSet } from '../core/util.js';
import { hex, ordinal } from './signs.js';

const HINT_KEY = 'lw.hinted';

function row(title, sub, tag, color, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lw-row';
  if (color) b.style.setProperty('--accent', color);
  const main = document.createElement('span');
  main.className = 'lw-row-main';
  const t = document.createElement('span');
  t.className = 'lw-row-title';
  t.textContent = title;
  const s = document.createElement('span');
  s.className = 'lw-row-sub';
  s.textContent = sub;
  main.append(t, s);
  b.appendChild(main);
  if (tag) {
    const g = document.createElement('span');
    g.className = 'lw-row-tag';
    g.textContent = tag;
    b.appendChild(g);
  }
  b.addEventListener('click', onClick);
  return b;
}

export function startFreeRoam(ctx) {
  const { store, hud, player, audio, world, town, input, engine } = ctx;
  const model = () => store.get('model');

  const id = store.get('teamId');
  world.setPlayerTeam(id !== null && id !== undefined && model().teams[id] ? id : null);

  function status() {
    const m = model();
    const t = m.teams[world.playerTeam];
    if (t) {
      hud.setStatus({ rankText: ordinal(t.rank), teamName: t.name, recordText: t.record.text, tierName: TIERS[t.tier].name, color: t.color });
    } else {
      hud.setStatus({ rankText: '', teamName: m.meta.leagueName, recordText: 'Week ' + m.meta.week, tierName: 'Visitor' });
    }
    hud.setRibbon(m.meta.isSample ? 'Sample data' : null);
  }
  status();
  store.on('model', status);
  store.on('playerTeam', status);

  hud.onButton('status', () => {
    if (world.playerTeam !== null) store.emit('use', { kind: 'home', teamId: world.playerTeam });
  });

  hud.onButton('map', openMap);
  input.on('map', openMap);
  function openMap() {
    if (hud.panelOpen) {
      hud.closePanel();
      return;
    }
    const box = document.createElement('div');
    const note = document.createElement('p');
    note.className = 'lw-note';
    note.textContent = 'Top of the hill is first place. Bottom is the dump. Tap a place to go there.';
    const list = document.createElement('div');
    list.className = 'lw-list';
    for (const p of world.places()) {
      list.appendChild(row(p.name, p.kind === 'board' ? 'On the plaza' : p.blurb || '', '', p.color || null, () => {
        hud.closePanel();
        world.travelTo(p);
      }));
    }
    box.append(note, list);
    hud.openPanel({ title: 'Map', contentEl: box });
  }

  hud.onButton('standings', () => {
    const m = model();
    const box = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'lw-list';
    for (const tid of m.order) {
      const t = m.teams[tid];
      list.appendChild(row(t.name, t.record.text + ' · ' + TIERS[t.tier].name, ordinal(t.rank), hex(t.color), () => {
        hud.closePanel();
        const h = town.getHome(tid);
        if (h) player.teleport(h.street.x, h.street.z, h.street.facing);
      }));
    }
    box.appendChild(list);
    hud.openPanel({ title: 'Standings · Week ' + m.meta.week, contentEl: box });
  });

  const syncSound = () => hud.setButton('sound', { pressed: audio.enabled, label: audio.enabled ? 'Sound on' : 'Sound off' });
  audio.on('change', syncSound);
  syncSound();
  hud.onButton('sound', () => {
    const on = audio.toggle();
    if (on) audio.sfx('pop');
    hud.toast(on ? 'Sound on' : 'Sound off', { ms: 1200 });
  });

  hud.onButton('menu', () => {
    const m = model();
    const box = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'lw-list';
    list.appendChild(row('Graphics', engine.quality === 'low' ? 'Battery saver. Tap for automatic.' : 'Automatic. Tap for battery saver.', engine.quality === 'low' ? 'LOW' : 'AUTO', null, () => {
      engine.setQuality(engine.quality === 'low' ? 'auto' : 'low');
      hud.closePanel();
    }));
    list.appendChild(row('Visit as nobody', 'Walk around as a neutral visitor.', '', null, () => {
      hud.closePanel();
      world.setPlayerTeam(null);
    }));
    const hof = document.createElement('a');
    hof.className = 'lw-row';
    hof.href = PATHS.hallOfFame;
    hof.style.textDecoration = 'none';
    const hm = document.createElement('span');
    hm.className = 'lw-row-main';
    const ht = document.createElement('span');
    ht.className = 'lw-row-title';
    ht.textContent = 'Hall of Fame';
    hm.appendChild(ht);
    hof.appendChild(hm);
    list.appendChild(hof);
    const who = document.createElement('h3');
    who.className = 'lw-h3';
    who.textContent = 'Walk around as';
    const teams = document.createElement('div');
    teams.className = 'lw-list';
    for (const tid of m.order) {
      const t = m.teams[tid];
      teams.appendChild(row(t.name, ordinal(t.rank) + ' · ' + t.record.text, '', hex(t.color), () => {
        hud.closePanel();
        store.setTeam(tid);
        world.setPlayerTeam(tid);
        const h = town.getHome(tid);
        if (h) player.teleport(h.street.x, h.street.z, h.street.facing);
      }));
    }
    box.append(list, who, teams);
    hud.openPanel({ title: 'Menu', contentEl: box });
  });

  // Small stand-in cards for the things the visitor uses.
  store.on('use', (e) => {
    const m = model();
    if (e.kind === 'home' || e.kind === 'plaque') {
      const t = m.teams[e.teamId];
      if (!t) return;
      audio.sfx('tick');
      const n = t.history && t.history.nemesis;
      hud.openCard({
        kicker: ordinal(t.rank) + ' place · ' + TIERS[t.tier].name,
        title: t.name,
        stats: [['Record', t.record.text], ['Points for', String(t.pointsFor)], t.streak && t.streak.type ? ['Streak', t.streak.type + t.streak.length] : null],
        lines: e.kind === 'plaque' && n ? ['Owned by ' + n.teamName + ', ' + n.wins + '-' + n.losses + ' all time.'] : t.roast.mailbox,
        accentColor: t.color,
        actions: [{ label: 'Close' }],
      });
    } else if (e.kind === 'throne') {
      if (!e.allowed) hud.toast('The throne is for first place only.');
    } else if (e.kind === 'telescope' || e.kind === 'periscope') {
      /* the world side runs the camera shot */
    } else if (e.kind === 'newspaper') {
      const h = m.headlines[0];
      hud.openCard({ kicker: 'The paper', title: h ? h.headline : 'No news', lines: h ? [h.body] : [], actions: [{ label: 'Close' }] });
    } else {
      const names = { standings: 'Standings board', matchups: 'Matchup board', statue: 'The statue', building: 'Building', outhouse: 'Outhouse Row' };
      hud.openCard({ kicker: 'You used', title: (names[e.kind] || e.kind) + (e.which ? ': ' + e.which : '') + (e.season ? ' ' + e.season : ''), actions: [{ label: 'Close' }] });
    }
  });

  // one-time controls hint
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (safeStorageGet(HINT_KEY) !== '1' && !input.hasMoved) {
    hud.showHint(coarse ? 'Drag left side to walk. Drag right side to look. Tap anything.' : 'WASD to walk, drag to look, click anything. E to use.');
  }
  input.on('firstmove', () => {
    hud.hideHint();
    safeStorageSet(HINT_KEY, '1');
  });
}
