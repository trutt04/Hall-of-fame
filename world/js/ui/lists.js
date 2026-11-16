// Plain DOM builders shared by the standings panel, the newspaper panel and the no-WebGL fallback.
// No 3D, no HUD: each takes the model and returns an element. All league text is textContent.

import { PAPER_NAME } from '../model/roasts.js';
import { el, hex, tierName, teamName, streakShort, statusWord, weekLabel, fmtPts, TIER_CSS } from './dom.js';

const TIER_KEYS = ['hill', 'heights', 'bubble', 'park', 'dump'];

/** 1344.5 -> "1,344.5" */
export function pts1(v) {
  const n = Number(v) || 0;
  const [whole, frac] = Math.abs(n).toFixed(1).split('.');
  return (n < 0 ? '-' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + frac;
}

/**
 * The standings: tier headers, one row per team, and the dashed playoff line after rank cutLine.
 * opts.teamId highlights a row. opts.onPick(teamId) turns rows into buttons.
 */
export function buildStandings(model, opts = {}) {
  const box = el('div', 'lwf-standings');
  const head = el('div', 'lwf-shead');
  head.setAttribute('aria-hidden', 'true');
  head.append(el('span', null, '#'), el('span'), el('span', null, 'Team'), el('span', null, 'W-L'), el('span', null, 'PF'));
  box.appendChild(head);
  const order = model.order || [];
  for (const tier of TIER_KEYS) {
    const ids = (model.tiers && model.tiers[tier]) || [];
    if (!ids.length) continue;
    const th = el('h3', 'lwf-tier', tierName(tier));
    th.style.setProperty('--tier', TIER_CSS[tier]);
    box.appendChild(th);
    for (const id of ids) {
      const t = model.teams[id];
      if (!t) continue;
      const row = el(opts.onPick ? 'button' : 'div', 'lwf-srow');
      if (opts.onPick) {
        row.type = 'button';
        row.addEventListener('click', () => opts.onPick(t.id));
      }
      row.style.setProperty('--team', hex(t.color));
      const you = opts.teamId === t.id;
      if (you) row.classList.add('lwf-you');
      const name = el('span', 'lwf-s-name');
      name.appendChild(el('span', 'lwf-s-team', teamName(t)));
      const sub = [you ? 'You' : '', t.owner].filter(Boolean).join(' · ');
      if (sub) name.appendChild(el('span', 'lwf-s-owner', sub));
      const strk = el('span', 'lwf-s-strk', streakShort(t.streak));
      if (t.streak && t.streak.type) strk.classList.add('lwf-' + t.streak.type);
      const wl = el('span', 'lwf-s-wl');
      wl.append(el('span', 'lwf-s-rec', t.record.text), strk);
      row.append(el('span', 'lwf-s-rank', t.rank), el('span', 'lwf-s-chip'), name, wl, el('span', 'lwf-s-pf', pts1(t.pointsFor)));
      box.appendChild(row);
      if (t.rank === model.cutLine && order.length > model.cutLine) {
        const cut = el('div', 'lwf-cut');
        cut.appendChild(el('span', null, 'Playoff line'));
        box.appendChild(cut);
      }
    }
  }
  return box;
}

/** This week's games with scores and status. */
export function buildMatchups(model, opts = {}) {
  const box = el('div', 'lwf-matches');
  const list = model.matchups || [];
  if (!list.length) {
    box.appendChild(el('p', 'lw-note', 'No games on the board this week.'));
    return box;
  }
  for (const m of list) {
    const card = el('div', 'lwf-match');
    const live = m.status !== 'pre';
    const sides = [[m.homeId, m.homePts, m.awayPts], [m.awayId, m.awayPts, m.homePts]];
    for (const [id, pts, other] of sides) {
      const t = model.teams[id];
      if (!t) continue;
      const side = el('div', 'lwf-m-side');
      side.style.setProperty('--team', hex(t.color));
      if (live && pts > other) side.classList.add('lwf-ahead');
      if (opts.teamId === id) card.classList.add('lwf-you');
      side.append(el('span', 'lwf-s-chip'), el('span', 'lwf-m-name', teamName(t)), el('span', 'lwf-m-pts', live ? fmtPts(pts) : t.record.text));
      card.appendChild(side);
    }
    const st = el('div', 'lwf-m-status lwf-m-' + m.status, statusWord(m.status, model));
    card.appendChild(st);
    box.appendChild(card);
  }
  return box;
}

const PO_STATUS = { live: 'Live', final: 'Final', pre: 'Up next', projected: '' };

/**
 * The playoff picture: the bracket as a compact list by round, byes, and the bubble line.
 * Returns null when the model has no playoffs yet. opts as for buildStandings.
 */
export function buildPlayoffs(model, opts = {}) {
  const po = model && model.playoffs;
  const rounds = po && Array.isArray(po.rounds) ? po.rounds.filter((r) => r && ((r.games && r.games.length) || (r.byes && r.byes.length))) : [];
  if (!rounds.length) return null;
  const box = el('section', 'lwf-po lwf-po-' + (po.state || 'projected'));
  box.appendChild(el('h3', 'lw-h3', 'Playoff picture'));
  const title = po.title || (po.state === 'projected' ? 'If the season ended today' : '');
  if (title) box.appendChild(el('p', 'lwf-po-title', title));

  // one side of a game, or a bye
  const side = (s, pts, o = {}) => {
    const t = s && s.teamId !== undefined && s.teamId !== null ? model.teams[s.teamId] : null;
    const row = el(t && opts.onPick ? 'button' : 'div', 'lwf-po-side');
    if (!t) {
      row.classList.add('lwf-po-tbd');
      row.append(el('span', 'lwf-po-seed', s && s.seed ? s.seed : ''), el('span', 'lwf-s-chip'), el('span', 'lwf-po-name', 'To be decided'), el('span', 'lwf-po-pts', ''));
      return row;
    }
    if (opts.onPick) {
      row.type = 'button';
      row.addEventListener('click', () => opts.onPick(t.id));
    }
    row.style.setProperty('--team', hex(t.color));
    if (opts.teamId === t.id) row.classList.add('lwf-you');
    if (o.won) row.classList.add('lwf-won');
    if (o.lost) row.classList.add('lwf-lost');
    const name = el('span', 'lwf-po-name', teamName(t));
    if (opts.teamId === t.id) name.appendChild(el('span', 'lwf-po-you', 'You'));
    const score = o.bye ? 'Bye' : typeof pts === 'number' && o.scored ? fmtPts(pts) : '';
    row.append(el('span', 'lwf-po-seed', s.seed || ''), el('span', 'lwf-s-chip'), name, el('span', 'lwf-po-pts', score));
    return row;
  };

  for (const r of rounds) {
    const head = el('h4', 'lwf-po-round');
    head.append(el('span', null, r.name || 'Round'), el('span', 'lwf-po-week', r.week ? 'Week ' + r.week : ''));
    box.appendChild(head);
    for (const gm of r.games || []) {
      if (!gm) continue;
      const scored = gm.status === 'live' || gm.status === 'final';
      const decided = gm.winnerId !== undefined && gm.winnerId !== null;
      const game = el('div', 'lwf-po-game');
      for (const [s, pts] of [[gm.a, gm.aPts], [gm.b, gm.bPts]]) {
        const id = s ? s.teamId : null;
        game.appendChild(side(s, pts, { scored, won: decided && id === gm.winnerId, lost: decided && id !== null && id !== gm.winnerId }));
      }
      const word = PO_STATUS[gm.status] || '';
      if (word) game.appendChild(el('span', 'lwf-po-status lwf-m-' + gm.status, word));
      box.appendChild(game);
    }
    if (r.byes && r.byes.length) {
      const byes = el('div', 'lwf-po-game lwf-po-byes');
      for (const b of r.byes) byes.appendChild(side(b, null, { bye: true }));
      box.appendChild(byes);
    }
  }
  const champ = po.championId !== undefined && po.championId !== null ? model.teams[po.championId] : null;
  if (champ) box.appendChild(el('p', 'lwf-po-champ', 'Champion: ' + teamName(champ)));
  if (po.bubble && po.bubble.text) box.appendChild(el('p', 'lwf-po-bubble', po.bubble.text));
  return box;
}

/** One line of the playoff picture for the paper, or '' when there is nothing to say. */
export function playoffLine(model) {
  const po = model && model.playoffs;
  if (!po) return '';
  const champ = po.championId !== undefined && po.championId !== null ? model.teams[po.championId] : null;
  if (champ) return 'Champion: ' + teamName(champ) + '.';
  return (po.bubble && po.bubble.text) || '';
}

const KIND_LABEL = {
  heartbreaker: 'Heartbreak', bench: 'Lineup crimes', blowout: 'Blowout', streak: 'Streak watch', move: 'Real estate',
  forecast: 'Forecast', history: 'From the archives', luck: 'Luck report', toilet: 'Awards', record: 'Record book',
};

// let long_underscored_names wrap inside a narrow newspaper column
const soft = (text) => String(text || '').replace(/([_/])(?=\S)/g, '$1\u200b');

function story(h, lead) {
  const a = el('article', lead ? 'lwf-lead' : 'lwf-story');
  const kind = KIND_LABEL[h.kind] || (h.kind ? String(h.kind).replace(/[-_]/g, ' ') : 'News');
  a.append(el('p', 'lwf-story-kind', kind), el(lead ? 'h2' : 'h3', 'lwf-story-head', soft(h.headline)), el('p', 'lwf-story-body', soft(h.body)));
  return a;
}

/** The weekly paper as a front page. */
export function buildPaper(model) {
  const meta = model.meta || {};
  const paper = el('article', 'lwf-paper');
  const head = el('header', 'lwf-paper-head');
  const ears = el('div', 'lwf-paper-ears');
  ears.append(el('span', null, 'Vol. ' + (meta.season || '') + ', No. ' + (meta.week || 1)), el('span', null, 'Price: your dignity'));
  const date = el('div', 'lwf-paper-date');
  date.append(el('span', null, weekLabel(meta) + ' edition'), el('span', null, meta.leagueName || ''));
  head.append(ears, el('h1', 'lwf-paper-name', PAPER_NAME), el('p', 'lwf-paper-motto', 'All the news that hurts'), date);
  paper.appendChild(head);
  if (meta.isSample) paper.appendChild(el('p', 'lwf-paper-sample', 'Sample edition. These scores and stories are placeholders until the league goes public on ESPN.'));
  const stories = model.headlines || [];
  if (!stories.length) {
    paper.appendChild(el('p', 'lwf-story-body', 'Nothing happened this week. The staff is as surprised as you are.'));
    return paper;
  }
  paper.appendChild(story(stories[0], true));
  if (stories.length > 1) {
    const cols = el('div', 'lwf-paper-cols');
    for (const h of stories.slice(1)) cols.appendChild(story(h, false));
    paper.appendChild(cols);
  }
  const race = playoffLine(model);
  if (race) {
    const line = el('p', 'lwf-paper-wire');
    line.append(el('b', null, 'Playoff picture'), el('span', null, race));
    paper.appendChild(line);
  }
  if (model.blimp) {
    const wire = el('p', 'lwf-paper-wire');
    wire.append(el('b', null, 'Seen on the blimp'), el('span', null, model.blimp));
    paper.appendChild(wire);
  }
  return paper;
}
