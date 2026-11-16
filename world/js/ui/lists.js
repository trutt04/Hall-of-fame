// Plain DOM builders shared by the standings panel, the newspaper panel and the no-WebGL fallback.
// No 3D, no HUD: each takes the model and returns an element. All league text is textContent.

import { PAPER_NAME } from '../model/roasts.js';
import { el, hex, tierName, teamName, streakShort, statusWord, fmtPts, TIER_CSS } from './dom.js';

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
  head.append(el('span', null, '#'), el('span'), el('span', null, 'Team'), el('span', null, 'W-L'), el('span', null, 'PF'), el('span', null, 'Strk'));
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
      row.append(el('span', 'lwf-s-rank', t.rank), el('span', 'lwf-s-chip'), name, el('span', 'lwf-s-rec', t.record.text), el('span', 'lwf-s-pf', pts1(t.pointsFor)), strk);
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

const KIND_LABEL = {
  heartbreaker: 'Heartbreak', bench: 'Lineup crimes', blowout: 'Blowout', streak: 'Streak watch', move: 'Real estate',
  forecast: 'Forecast', history: 'From the archives', luck: 'Luck report', toilet: 'Awards', record: 'Record book',
};

function story(h, lead) {
  const a = el('article', lead ? 'lwf-lead' : 'lwf-story');
  const kind = KIND_LABEL[h.kind] || (h.kind ? String(h.kind).replace(/[-_]/g, ' ') : 'News');
  a.append(el('p', 'lwf-story-kind', kind), el(lead ? 'h2' : 'h3', 'lwf-story-head', h.headline || ''), el('p', 'lwf-story-body', h.body || ''));
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
  date.append(el('span', null, 'Week ' + (meta.week || 1) + ' edition'), el('span', null, meta.leagueName || ''), el('span', null, 'All the news that hurts'));
  head.append(ears, el('h1', 'lwf-paper-name', PAPER_NAME), date);
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
  if (model.blimp) {
    const wire = el('p', 'lwf-paper-wire');
    wire.append(el('b', null, 'Seen on the blimp'), el('span', null, model.blimp));
    paper.appendChild(wire);
  }
  return paper;
}
