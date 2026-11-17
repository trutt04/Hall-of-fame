// Cards (bottom sheets) for the things a visitor can use in the world: homes, the throne, the
// statue, outhouses, plaques, the plaza buildings, the telescope and the periscope.
//
//   const cards = createCards(ctx, { teamId: () => id | null, goHome(teamId), switchTeam() })
//   cards.home(teamId, { go: true })     go: always offer "Go to their house"
//   cards.use(event)                     one 'use' event from Contract 7 (panels are handled by the flow)
//   cards.sample() / cards.visitor()

import {
  el, button, rankBig, tierName, teamName, firstTeam, lastTeam, streakLong, matchupParts, idleWeekText, ordinal, hallOfFameUrl, sampleTag,
} from './dom.js';
import { modelOf, getHome } from './seam.js';
import { pts1 } from './lists.js';

// "You are N places short", by how far away the throne is.
function throneLine(n) {
  const short = 'You are ' + n + (n === 1 ? ' place' : ' places') + ' short. ';
  if (n <= 1) return short + 'Close enough to smell the velvet.';
  if (n <= 3) return short + 'The rope stays up.';
  if (n <= 6) return short + 'That is not a rounding error.';
  if (n <= 10) return short + 'The guard did not even stand up.';
  return short + 'You can see your tent from here. That is as close as it gets.';
}

const CONDITION_LINE = {
  shiny: 'this year, so the statue gets polished every morning.',
  pigeons: 'this year. The pigeons have noticed.',
  cone: 'this year. Somebody put a traffic cone on its head and nobody has taken it off.',
};

export function createCards(ctx, api) {
  const { hud, player, audio } = ctx;
  const model = () => modelOf(ctx);
  const tick = () => {
    try {
      audio.sfx('tick');
    } catch (err) { /* sound is optional */ }
  };
  // history records carry raw names: give long_underscored ones somewhere to wrap
  const soft = (text) => String(text || '').replace(/([_./-])(?=\S)/g, '$1\u200b');
  const label = (rec) => (rec ? rec.owner || soft(rec.teamName) || 'Somebody' : 'Somebody');

  function statList(rows) {
    const dl = el('dl', 'lw-stats');
    for (const r of rows) {
      if (!r) continue;
      const dd = el('dd', null, r[1]);
      if (r[2]) dd.append(' ', sampleTag());
      dl.append(el('dt', null, r[0]), dd);
    }
    return dl;
  }

  function home(teamId, o = {}) {
    const m = model();
    const t = m && m.teams ? m.teams[teamId] : null;
    if (!t) return;
    const mine = api.teamId() === t.id;
    const hs = !!m.meta.historyIsSample;
    const rows = [];
    if (t.owner) rows.push(['Owner', t.owner]);
    const streak = streakLong(t.streak);
    rows.push(['Record', t.record.text + (streak ? ' · ' + streak : '')]);
    rows.push(['Points', pts1(t.pointsFor) + ' for · ' + pts1(t.pointsAgainst) + ' against']);
    const mp = matchupParts(m, t);
    if (mp) rows.push(['This week', mp.opponent], ['', mp.score]);
    else rows.push(['This week', idleWeekText(m.meta)]);
    if (t.luck && (t.luck.allPlayWins || t.luck.allPlayLosses)) {
      const tag = t.luckTag === 'luckiest' ? ' · luckiest in the league' : t.luckTag === 'unluckiest' ? ' · unluckiest in the league' : '';
      rows.push(['All-play', t.luck.allPlayWins + '-' + t.luck.allPlayLosses + ' vs everyone' + tag]);
    }
    if (t.history) {
      const titles = t.history.titles || [];
      if (titles.length) rows.push(['Titles', titles.length + ' (' + titles.join(', ') + ')', hs]);
      else rows.push(['Titles', 'None in ' + (t.history.seasonsPlayed || 0) + (t.history.seasonsPlayed === 1 ? ' season' : ' seasons'), hs]);
      const n = t.history.nemesis;
      if (n) rows.push(['Owned by', label(n) + ' · ' + n.wins + '-' + n.losses + ' all time', hs]);
    }
    if (t.ir && t.ir.count) rows.push(['On IR', (t.ir.names && t.ir.names.length ? t.ir.names.join(', ') : String(t.ir.count))]);
    if (t.lineupNotes && t.lineupNotes.length) rows.push(['Lineup', t.lineupNotes.join('. ')]);

    const body = el('div', 'lwf-home');
    // offer the trip when asked, or when the visitor is nowhere near this house. It sits at the
    // top so it is in reach on a small phone without scrolling the card.
    let far = !!o.go;
    const h = getHome(ctx, t.id);
    if (!far && h) far = Math.hypot(player.position.x - h.street.x, player.position.z - h.street.z) > 32;
    const acts = el('div', 'lwf-card-acts');
    if (far && h) {
      acts.appendChild(button('lw-btn lw-btn-primary lwf-go', mine ? 'Go home' : 'Go to their house', () => {
        hud.closeCard();
        api.goHome(t.id);
      }));
    }
    if (typeof api.postcard === 'function') acts.appendChild(button('lw-btn lwf-pc', 'Postcard', () => api.postcard(t.id)));
    if (acts.firstChild) body.appendChild(acts);
    body.appendChild(statList(rows));
    const lines = (t.roast && t.roast.mailbox) || [];
    lines.forEach((line, i) => body.appendChild(el('p', i === lines.length - 1 ? 'lw-jab' : 'lw-line', line)));
    hud.openCard({
      kicker: rankBig(t.rank) + ' · ' + tierName(t.tier) + (mine ? ' · Your house' : ''),
      title: teamName(t),
      contentEl: body,
      accentColor: t.color,
    });
  }

  function throne(e) {
    if (e.allowed) return; // the world handles sitting
    const m = model();
    const first = firstTeam(m);
    const me = m.teams[api.teamId()];
    hud.openCard({
      kicker: 'The throne',
      title: 'Reserved for first place',
      stats: first ? [['Sitting here', teamName(first)]] : [],
      lines: [me ? throneLine(Math.max(1, me.rank - 1)) : 'Visitors may look. Looking is free.'],
      actions: [{ label: 'Fine' }],
    });
  }

  function statue() {
    const m = model();
    const hist = m.history;
    const body = el('div', 'lwf-champs');
    const champs = (hist && hist.champions) || [];
    if (champs.length) {
      const h = el('h3', 'lw-h3', 'Champions');
      if (m.meta.historyIsSample) h.append(' ', sampleTag());
      body.appendChild(h);
      const list = el('ol', 'lwf-years');
      for (const c of champs) {
        const li = el('li');
        li.append(el('b', null, c.season), el('span', null, soft(c.teamName) || label(c)), el('i', null, c.record || ''));
        list.appendChild(li);
      }
      body.appendChild(list);
    }
    const dc = hist ? hist.defendingChamp : null;
    hud.openCard({
      kicker: 'The statue',
      title: dc ? soft(dc.teamName) || label(dc) : 'No champion yet',
      lines: [dc
        ? 'Defending champion, ' + dc.season + '. Currently ' + ordinal(dc.rank) + ' ' + (CONDITION_LINE[dc.condition] || CONDITION_LINE.pigeons)
        : 'The pedestal is empty until somebody wins this thing.'],
      contentEl: body,
      actions: [{ label: 'Close' }],
    });
  }

  function outhouse(e) {
    const m = model();
    const list = (m.history && m.history.lastPlaces) || [];
    const rec = list.find((r) => r.season === e.season) || (e.season === undefined ? list[0] : null);
    if (!rec) {
      hud.openCard({ kicker: 'Outhouse Row', title: 'Vacant', lines: ['Nobody has finished last in this one yet. It is waiting.'], actions: [{ label: 'Close' }] });
      return;
    }
    const body = statList([['Finished', 'Last place', !!m.meta.historyIsSample], rec.record ? ['Record', rec.record] : null, rec.owner ? ['Owner', rec.owner] : null]);
    hud.openCard({
      kicker: 'Outhouse Row · ' + rec.season,
      title: soft(rec.teamName) || label(rec),
      contentEl: body,
      jab: 'One outhouse per last place finish. The door still sticks.',
      actions: [{ label: 'Close' }],
    });
  }

  function plaque(e) {
    const m = model();
    const t = m.teams[e.teamId];
    if (!t) return;
    const n = t.history ? t.history.nemesis : null;
    if (!n) {
      hud.openCard({ kicker: 'The plaque', title: teamName(t), lines: ['No nemesis on record yet. Give it a few seasons.'], accentColor: t.color, actions: [{ label: 'Close' }] });
      return;
    }
    const games = n.wins + n.losses;
    hud.openCard({
      kicker: 'The plaque by the door',
      title: 'Owned by ' + label(n),
      contentEl: statList([['This house', teamName(t)], ['Against ' + label(n), n.wins + '-' + n.losses + ' all time', !!m.meta.historyIsSample]]),
      lines: [games + ' meetings, ' + n.losses + ' losses. Nobody beats this team more often, so the plaque went up.'],
      jab: 'It was not the homeowner who ordered it.',
      accentColor: t.color,
      actions: [{ label: 'Close' }],
    });
  }

  const BUILDINGS = {
    // [title, blurb, button label, the place on the Hall of Fame page that the button opens]
    hof: ['Hall of Fame', 'The picks that carried a team, cast in gold. It has its own page, and its own soundtrack.', 'Visit the Hall of Fame', 'hall'],
    graveyard: ['The Graveyard', 'Here lie the picks, not the men. Flowers are welcome. Trash talk is expected.', 'Visit the Graveyard', 'grave'],
    office: ['League Office', 'The original standings podium. Complaints are read aloud for fun and then filed in the bin.', 'Visit the League Office', 'league'],
  };
  function building(e) {
    const b = BUILDINGS[e.which] || BUILDINGS.hof;
    hud.openCard({
      kicker: 'On the plaza',
      title: b[0],
      lines: [b[1]],
      actions: [{ label: b[2], href: hallOfFameUrl(b[3]), newTab: true }, { label: 'Close', primary: false }],
    });
  }

  // A draft pick that did not work out. Here lie the picks, not the men.
  function headstone(e) {
    const m = model();
    const list = (m && m.graveyard) || [];
    const g = list[e.index];
    if (!g) {
      hud.openCard({ kicker: 'Draft Day Memorial Gardens', title: 'An empty plot', lines: ['Nobody is buried here yet. The draft will fix that.'], actions: [{ label: 'Close' }] });
      return;
    }
    const t = m.teams[g.teamId];
    const drafted = (typeof g.drafted === 'string' && g.drafted) || (g.round ? 'Round ' + g.round + (g.pick ? ', pick ' + g.pick : '') : '');
    const body = el('div', 'lwf-grave');
    body.appendChild(statList([
      drafted ? ['Drafted', drafted] : null,
      g.overall ? ['Overall', ordinal(g.overall) + ' pick'] : null,
      g.cause === 'ir' ? ['Status', 'On injured reserve'] : g.cause === 'gone' ? ['Status', 'Off the roster'] : null,
    ]));
    if (g.epitaph) body.appendChild(el('p', 'lw-jab lwf-epitaph', g.epitaph));
    if (t) {
      const by = button('lw-row lwf-grave-team', null, () => home(t.id, { go: true }));
      by.style.setProperty('--accent', '#' + (t.color & 0xffffff).toString(16).padStart(6, '0'));
      const main = el('span', 'lw-row-main');
      main.append(el('span', 'lw-row-sub', 'Drafted by'), el('span', 'lw-row-title', teamName(t)));
      by.append(main, el('span', 'lw-row-tag', rankBig(t.rank)));
      by.setAttribute('aria-label', 'Drafted by ' + teamName(t) + '. See their house.');
      body.appendChild(by);
    }
    hud.openCard({
      kicker: 'Draft Day Memorial Gardens',
      title: [g.name || 'Unknown pick', g.pos].filter(Boolean).join(', '),
      contentEl: body,
      accentColor: t ? t.color : undefined,
      actions: [{ label: 'Visit the Graveyard', href: hallOfFameUrl('grave'), newTab: true }, { label: 'Close', primary: false }],
    });
  }

  // ---- the regime: monument, busts, portraits and the sign at his gate ------------------------
  const REGIME_RED = 0xc4122e;
  const regimeOf = () => {
    const m = model();
    return m && m.regime ? m.regime : null;
  };
  // a row that opens a home's card, like the one on a headstone
  function homeRow(t, sub) {
    const by = button('lw-row lwf-grave-team', null, () => home(t.id, { go: true }));
    by.style.setProperty('--accent', '#' + (t.color & 0xffffff).toString(16).padStart(6, '0'));
    const main = el('span', 'lw-row-main');
    main.append(el('span', 'lw-row-sub', sub), el('span', 'lw-row-title', teamName(t)));
    by.append(main, el('span', 'lw-row-tag', rankBig(t.rank)));
    by.setAttribute('aria-label', sub + ' ' + teamName(t) + '. See their house.');
    return by;
  }

  function monument() {
    const R = regimeOf();
    if (!R) return;
    const mo = R.monument || {};
    hud.openCard({
      kicker: mo.plaque || R.title,
      title: mo.title || 'The Monument',
      lines: (mo.lines || []).slice(0, 3),
      accentColor: REGIME_RED,
      actions: [{ label: 'Salute and leave' }],
    });
  }

  function bust(e) {
    const R = regimeOf();
    if (!R) return;
    const line = (R.busts && R.busts[e.zone]) || '';
    hud.openCard({
      kicker: tierName(e.zone) || 'League World',
      title: 'Bust of the ' + (R.title || 'Commissioner'),
      lines: line ? [line] : [],
      accentColor: REGIME_RED,
      actions: [{ label: 'Close' }],
    });
  }

  let sloganTurn = 0;
  function portrait(e) {
    const R = regimeOf();
    if (!R) return;
    const m = model();
    const t = e.official || e.teamId === undefined || e.teamId === null ? null : m.teams[e.teamId];
    if (!t) {
      const p = R.portrait || {};
      const slogans = (R.slogans || []).filter(Boolean);
      const body = el('div', 'lwf-regime');
      if (slogans.length) body.appendChild(el('p', 'lwf-slogan', String(slogans[sloganTurn++ % slogans.length])));
      hud.openCard({
        kicker: 'League Office',
        title: p.title || 'Official Portrait',
        lines: p.caption ? [p.caption] : [],
        contentEl: body,
        accentColor: REGIME_RED,
        actions: [{ label: 'Close' }],
      });
      return;
    }
    const doors = R.doors || {};
    const line = doors[t.id] || doors[String(t.id)] || '';
    const body = el('div', 'lwf-regime');
    body.appendChild(homeRow(t, 'Posted outside'));
    hud.openCard({
      kicker: tierName(t.tier),
      title: 'Mandatory portrait',
      lines: line ? [line] : [],
      contentEl: body,
      accentColor: REGIME_RED,
      actions: [{ label: 'Close', primary: false }],
    });
  }

  function residence() {
    const R = regimeOf();
    if (!R) return;
    const m = model();
    const t = m.teams[R.teamId];
    const body = el('div', 'lwf-regime');
    if (t) body.appendChild(homeRow(t, 'Resident'));
    hud.openCard({
      kicker: t ? tierName(t.tier) : 'League World',
      title: 'Home of the ' + (R.title || 'Commissioner'),
      lines: R.residence ? [R.residence] : [],
      contentEl: body,
      accentColor: REGIME_RED,
      actions: [{ label: 'Close', primary: false }],
    });
  }

  return {
    home,
    sample() {
      hud.openCard({
        kicker: 'Sample data',
        title: 'This is a preview',
        lines: [
          'The league is still private on ESPN, so the scores, lineups and history shown here are placeholders.',
          'Once the league is made public, the real data replaces them automatically. Nobody has to do anything.',
        ],
        actions: [{ label: 'Got it' }],
      });
    },
    visitor() {
      hud.openCard({
        kicker: 'Visitor',
        title: 'Just looking',
        lines: ['You are walking around without a team. Pick yours to get a house, a rank and the neighbors you deserve.'],
        actions: [{ label: 'Pick a team', onClick: () => api.switchTeam() }, { label: 'Close', primary: false }],
      });
    },
    /** Returns true when the event was a card or a toast. */
    use(e) {
      if (!e || !e.kind) return false;
      const m = model();
      if (!m) return false;
      switch (e.kind) {
        case 'home': tick(); home(e.teamId); return true;
        case 'throne': if (!e.allowed) tick(); throne(e); return true;
        case 'statue': tick(); statue(); return true;
        case 'outhouse': tick(); outhouse(e); return true;
        case 'plaque': tick(); plaque(e); return true;
        case 'building': tick(); building(e); return true;
        case 'headstone': tick(); headstone(e); return true;
        case 'monument': if (!m.regime) return false; tick(); monument(); return true;
        case 'bust': if (!m.regime) return false; tick(); bust(e); return true;
        case 'portrait': if (!m.regime) return false; tick(); portrait(e); return true;
        case 'residence': if (!m.regime) return false; tick(); residence(); return true;
        case 'telescope': {
          const t = lastTeam(m);
          if (t) hud.toast('Down at the Dump: ' + teamName(t) + ', in a tent.', { ms: 4200 });
          return true;
        }
        case 'periscope': {
          const t = firstTeam(m);
          if (t) hud.toast('Up on the Hill: ' + teamName(t) + ', behind a gold gate.', { ms: 4200 });
          return true;
        }
        default: return false;
      }
    },
  };
}
