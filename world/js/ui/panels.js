// Full-screen panels: Standings, Map, Newspaper and Menu. Opened with hud.openPanel.
//
//   const panels = createPanels(ctx, { teamId, openHome(teamId), goHome(teamId), goPlace(id), switchTeam(), toggleSound() })
//   panels.standings({ matchups }) / panels.map() / panels.newspaper() / panels.menu()

import { PAPER_NAME } from '../model/roasts.js';
import { el, button, svg, hex, inkOn, tierName, teamName, rankBig, weekLabel, hallOfFameUrl, TIER_CSS } from './dom.js';
import { modelOf, currentZone, zoneLine, ZONE_IDS } from './seam.js';
import { buildStandings, buildMatchups, buildPaper } from './lists.js';

// Tiny line drawings, one per neighborhood, for the map.
const ZONE_ART = {
  hill: 'M4 22h24M5 19l2-11 5 6 4-9 4 9 5-6 2 11z',
  heights: 'M4 16 16 6l12 10M7 14v11h18V14M14 25v-6h4v6',
  plaza: 'M6 26h20M9 26v-5h14v5M13 21v-7h6v7M16 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
  bubble: 'M5 17 13 10l8 7M7 16v9h12v-9M24 25V14M21 14h7v5h-7',
  park: 'M3 21V12a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v9zM7 13h5v4H7zM16 13h3v8M9 24a2 2 0 1 0 .1 0M22 24a2 2 0 1 0 .1 0',
  dump: 'M4 27 14 13l10 14zM14 13v14M19 7a3 3 0 0 1 5-2 3 3 0 0 1 4 3h-11a2 2 0 0 1 2-1M21 11v2M25 11v2',
};

function row(title, sub, tag, onClick) {
  const b = onClick ? button('lw-row', null, onClick) : el('a', 'lw-row');
  const main = el('span', 'lw-row-main');
  const s = el('span', 'lw-row-sub', sub);
  main.append(el('span', 'lw-row-title', title), s);
  b.appendChild(main);
  const t = el('span', 'lw-row-tag', tag || '');
  b.appendChild(t);
  b.lwSub = s;
  b.lwTag = t;
  return b;
}

function relativeTime(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'at an unknown time';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return mins + ' minutes ago';
  const hours = Math.round(mins / 60);
  if (hours < 36) return hours === 1 ? 'an hour ago' : hours + ' hours ago';
  const days = Math.round(hours / 24);
  return days + ' days ago';
}

function freshness(model, status) {
  const when = 'The data was last saved ' + relativeTime(model.meta.generatedAt) + '.';
  if (model.meta.isSample) return when + ' The league is still private on ESPN, so this is sample data for now.';
  if (!status || status.ok) return when + ' The last check with ESPN went fine.';
  return when + ' The last check with ESPN did not go through, so this is the most recent good copy.';
}

export function createPanels(ctx, api) {
  const { hud, audio, engine } = ctx;
  const model = () => modelOf(ctx);

  function standings(o = {}) {
    const m = model();
    if (!m) return;
    const box = el('div');
    const playoffs = m.cutLine ? 'Top ' + m.cutLine + ' make the playoffs. ' : '';
    box.appendChild(el('p', 'lw-note', playoffs + 'Tap a team to see their house.'));
    box.appendChild(buildStandings(m, { teamId: api.teamId(), onPick: (id) => api.openHome(id) }));
    const h = el('h3', 'lw-h3', 'This week');
    box.append(h, buildMatchups(m, { teamId: api.teamId() }));
    hud.openPanel({ title: 'Standings · ' + weekLabel(m.meta), contentEl: box });
    if (o.matchups) setTimeout(() => h.scrollIntoView({ block: 'start' }), 60);
  }

  function map() {
    const m = model();
    if (!m) return;
    const me = api.teamId();
    const here = currentZone(ctx);
    const box = el('div', 'lwf-map');
    box.appendChild(el('p', 'lw-note', 'The top of the hill is first place. Tap a place or a team to go there.'));
    const hillside = el('div', 'lwf-hillside');
    for (const id of ZONE_IDS) {
      const ids = id === 'plaza' ? [] : (m.tiers && m.tiers[id]) || [];
      if (id !== 'plaza' && !ids.length) continue;
      const zone = el('section', 'lwf-zone lwf-zone-' + id);
      zone.style.setProperty('--tier', TIER_CSS[id]);
      const go = button('lwf-zone-go', null, () => api.goPlace(id));
      const art = svg('svg', { viewBox: '0 0 32 32', class: 'lwf-zone-art', 'aria-hidden': 'true' });
      art.appendChild(svg('path', { d: ZONE_ART[id] }));
      const text = el('span', 'lwf-zone-text');
      const name = el('span', 'lwf-zone-name', tierName(id));
      if (here === id) name.appendChild(el('span', 'lwf-here', 'You are here'));
      text.append(name, el('span', 'lwf-zone-line', zoneLine(id)));
      go.append(art, text);
      go.setAttribute('aria-label', 'Go to ' + tierName(id));
      zone.appendChild(go);
      if (ids.length) {
        const dots = el('div', 'lwf-dots');
        ids.forEach((tid, i) => {
          const t = m.teams[tid];
          if (!t) return;
          const dot = button('lwf-dot', t.rank, () => api.goHome(t.id));
          dot.style.setProperty('--team', hex(t.color));
          dot.style.color = inkOn(t.color);
          dot.title = teamName(t);
          dot.setAttribute('aria-label', 'Go to ' + rankBig(t.rank) + ' place, ' + teamName(t));
          if (t.id === me) {
            dot.classList.add('lwf-you');
            dot.appendChild(el('span', 'lwf-dot-you', 'You'));
          }
          dots.appendChild(dot);
          // the playoff line runs between two neighbors
          if (t.rank === m.cutLine && i < ids.length - 1) dots.appendChild(el('span', 'lwf-dot-cut', 'Playoff line'));
        });
        zone.appendChild(dots);
        const lastRank = m.teams[ids[ids.length - 1]] ? m.teams[ids[ids.length - 1]].rank : 0;
        if (lastRank === m.cutLine) zone.classList.add('lwf-zone-cut');
      }
      hillside.appendChild(zone);
    }
    box.appendChild(hillside);
    hud.openPanel({ title: 'Map', contentEl: box });
  }

  function newspaper() {
    const m = model();
    if (!m) return;
    const desk = el('div', 'lwf-desk');
    desk.appendChild(buildPaper(m));
    hud.openPanel({ title: PAPER_NAME, contentEl: desk });
  }

  function menu() {
    const m = model();
    if (!m) return;
    const box = el('div', 'lwf-menu');
    const list = el('div', 'lw-list');
    const me = m.teams[api.teamId()];
    list.appendChild(row(me ? 'Switch team' : 'Pick a team', me ? 'You are ' + teamName(me) + '.' : 'You are just looking. Tap to choose yours.', '', () => api.switchTeam()));
    const sound = row('Sound', '', '', () => {
      api.toggleSound();
      paintSound();
    });
    const paintSound = () => {
      sound.lwSub.textContent = audio.enabled ? 'On. Tap to turn it off.' : 'Off. Tap to turn it on.';
      sound.lwTag.textContent = audio.enabled ? 'ON' : 'OFF';
    };
    paintSound();
    list.appendChild(sound);
    if (engine && typeof engine.setQuality === 'function') {
      const gfx = row('Graphics', '', '', () => {
        engine.setQuality(engine.quality === 'low' ? 'auto' : 'low');
        paintGfx();
      });
      const paintGfx = () => {
        const low = engine.quality === 'low';
        gfx.lwSub.textContent = low ? 'Battery saver. Tap for automatic.' : 'Automatic. Tap for battery saver.';
        gfx.lwTag.textContent = low ? 'LOW' : 'AUTO';
      };
      paintGfx();
      list.appendChild(gfx);
    }
    const hof = row('Hall of Fame', 'The original page: champions, records and the archive.', '');
    hof.href = hallOfFameUrl();
    hof.target = '_blank';
    hof.rel = 'noopener';
    list.appendChild(hof);
    box.appendChild(list);

    box.append(
      el('h3', 'lw-h3', 'How to move'),
      el('p', 'lw-note', 'On a phone: drag the left side of the screen to walk and the right side to look around. Pinch to zoom. Tap the ground to walk there, or tap a mailbox, a sign or a person to use it.'),
      el('p', 'lw-note', 'On a keyboard: WASD or the arrow keys to walk, Shift to slow down, drag to look, scroll to zoom, E to use what is in front of you.'),
      el('h3', 'lw-h3', 'About'),
      el('p', 'lw-note', 'This world is built from the league\'s ESPN data and updates by itself. Nobody edits it by hand: win and you move up the hill, lose and the trash bags pile up. ' + freshness(m, ctx.store.get('status') || ctx.status)),
    );
    hud.openPanel({ title: 'Menu', contentEl: box });
  }

  return { standings, map, newspaper, menu };
}
