// Tests for the league brain: world/js/model/derive.js and world/js/model/roasts.js.
// Run with `npm test` (node --test scripts/test/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { derive, tierForRank } from '../../world/js/model/derive.js';
import { ordinal, tierWelcome, snapshot, recapChanges, COPY_LIMITS } from '../../world/js/model/roasts.js';
import { TEAM_COLORS, TIER_ORDER } from '../../world/js/config.js';
import { makeLeague, makeHistory, REAL_NAMES, rng32 } from './model-fixtures/make-league.mjs';

const NOW = new Date('2026-11-12T12:00:00Z');
const EM_DASH = String.fromCharCode(0x2014);
const ELLIPSIS = String.fromCharCode(0x2026);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------------------------
// Independent re-implementations of the rules, so the tests do not just echo the code.
// ---------------------------------------------------------------------------------------------

function regularGames(league, throughWeek = Infinity) {
  return league.matchups.filter((m) => !m.playoff && m.away && m.winner !== 'undecided' && m.week <= throughWeek);
}

function standings(league, throughWeek) {
  const rows = Object.fromEntries(league.teams.map((t) => [t.id, { id: t.id, w: 0, l: 0, t: 0, pf: 0 }]));
  for (const m of regularGames(league, throughWeek)) {
    const h = rows[m.home.teamId];
    const a = rows[m.away.teamId];
    h.pf += m.home.points;
    a.pf += m.away.points;
    if (m.winner === 'home') { h.w++; a.l++; } else if (m.winner === 'away') { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  return rows;
}

function orderOf(rows) {
  const pct = (r) => (r.w + r.l + r.t ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0);
  return Object.values(rows).sort((a, b) => pct(b) - pct(a) || b.pf - a.pf || a.id - b.id).map((r) => r.id);
}

function lastCompletedWeek(league) {
  const byWeek = {};
  for (const m of league.matchups) {
    if (!m.away) continue;
    byWeek[m.week] = (byWeek[m.week] ?? true) && m.winner !== 'undecided';
  }
  const done = Object.keys(byWeek).map(Number).filter((w) => byWeek[w] && w <= league.league.currentWeek);
  return done.length ? Math.max(...done) : null;
}

/** Every piece of generated copy in a model, with the limit that applies to it. */
function allCopy(model) {
  const out = [];
  for (const id of model.order) {
    const r = model.teams[id].roast;
    out.push({ where: `arrival ${id}`, text: r.arrival, limit: COPY_LIMITS.arrival });
    out.push({ where: `sign ${id}`, text: r.sign, limit: COPY_LIMITS.sign });
    r.mailbox.forEach((line, i) => out.push({ where: `mailbox ${id}.${i}`, text: line, limit: COPY_LIMITS.mailboxLine }));
  }
  for (const h of model.headlines) {
    out.push({ where: `headline ${h.id}`, text: h.headline, limit: COPY_LIMITS.headline });
    out.push({ where: `body ${h.id}`, text: h.body, limit: COPY_LIMITS.body });
  }
  out.push({ where: 'blimp', text: model.blimp, limit: COPY_LIMITS.blimp });
  return out;
}

function labelsOf(model) {
  const counts = {};
  for (const id of model.order) {
    const o = model.teams[id].owner.toLowerCase();
    if (o) counts[o] = (counts[o] || 0) + 1;
  }
  return model.order.map((id) => {
    const t = model.teams[id];
    return t.owner && counts[t.owner.toLowerCase()] === 1 ? t.owner : t.name;
  });
}

function sentenceCount(text, labels) {
  let s = text;
  for (const label of labels.slice().sort((a, b) => b.length - a.length)) s = s.split(label).join('Name');
  const hits = s.match(/[.!?]["')]?(?=\s+["(]?[A-Z0-9]|$)/g);
  return hits ? hits.length : 0;
}

function checkCopy(model, context) {
  const labels = labelsOf(model);
  for (const { where, text, limit } of allCopy(model)) {
    const at = `${context} / ${where}: ${JSON.stringify(text)}`;
    assert.equal(typeof text, 'string', at);
    assert.ok(text.length > 0, `empty copy at ${at}`);
    assert.ok(text.length <= limit, `over ${limit} chars (${text.length}) at ${at}`);
    assert.ok(!text.includes(EM_DASH), `em-dash at ${at}`);
    for (const bad of ['undefined', 'NaN', 'null', 'Infinity', '[object']) assert.ok(!text.includes(bad), `"${bad}" at ${at}`);
    assert.equal(text, text.trim(), `untrimmed at ${at}`);
    assert.ok(!/ {2}/.test(text), `double space at ${at}`);
    for (const label of labels) {
      assert.ok(!text.includes(`${label}'s`), `possessive on a name at ${at}`);
      assert.ok(!text.includes(`${label}.`), `period against a name at ${at}`);
    }
  }
  for (const id of model.order) {
    const lines = model.teams[id].roast.mailbox;
    assert.ok(lines.length >= COPY_LIMITS.mailboxMin && lines.length <= COPY_LIMITS.mailboxMax, `${context}: mailbox has ${lines.length} lines`);
    assert.equal(new Set(lines).size, lines.length, `${context}: repeated mailbox line`);
  }
  assert.equal(model.blimp, model.blimp.toUpperCase(), `${context}: blimp is not all caps`);
  const ids = model.headlines.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length, `${context}: duplicate headline ids`);
  for (const h of model.headlines) {
    assert.ok(typeof h.kind === 'string' && h.kind, `${context}: headline kind`);
    assert.ok(Array.isArray(h.teamIds), `${context}: headline teamIds`);
    for (const id of h.teamIds) assert.ok(model.teams[id], `${context}: headline points at unknown team ${id}`);
    const n = sentenceCount(h.body, labels);
    assert.ok(n >= 1 && n <= 2, `${context}: body should be 1 to 2 sentences, got ${n}: ${h.body}`);
  }
}

const TEAM_FIELDS = [
  'id', 'name', 'abbrev', 'owner', 'ownerKey', 'color', 'rank', 'prevRank', 'rankDelta', 'tier', 'prevTier', 'tierMove', 'slot',
  'record', 'pointsFor', 'pointsAgainst', 'streak', 'inPlayoffSpot', 'onCutLine', 'clinched', 'eliminated', 'trashBags',
  'flamingos', 'ir', 'goalposts', 'lineupNotes', 'thisWeek', 'lastWeek', 'beatLastWeek', 'luck', 'luckTag', 'trophy', 'history', 'roast',
];
const META_FIELDS = [
  'leagueName', 'season', 'week', 'regularSeasonWeeks', 'playoffTeamCount', 'teamCount', 'phase', 'isSample', 'historyIsSample',
  'generatedAt', 'weekStatus', 'nflLive', 'nextKickoff',
];

function checkShape(model) {
  for (const key of ['meta', 'cutLine', 'order', 'tiers', 'teams', 'matchups', 'lastWeek', 'headlines', 'blimp', 'history']) {
    assert.ok(key in model, `model.${key} missing`);
  }
  for (const key of META_FIELDS) assert.ok(key in model.meta, `meta.${key} missing`);
  assert.deepEqual(Object.keys(model.tiers), TIER_ORDER);
  assert.equal(model.order.length, model.meta.teamCount);
  assert.equal(Object.keys(model.teams).length, model.meta.teamCount);
  const tiered = TIER_ORDER.flatMap((t) => model.tiers[t]);
  assert.deepEqual(tiered, model.order, 'tiers, read best to worst, are the order');
  model.order.forEach((id, i) => {
    const t = model.teams[id];
    for (const key of TEAM_FIELDS) assert.ok(key in t, `team.${key} missing`);
    assert.equal(t.rank, i + 1);
    assert.equal(t.tier, tierForRank(t.rank, model.meta.teamCount, model.cutLine));
    assert.equal(model.tiers[t.tier][t.slot], id);
    assert.equal(t.inPlayoffSpot, t.rank <= model.cutLine);
    assert.equal(t.onCutLine, t.rank === model.cutLine || t.rank === model.cutLine + 1);
    assert.ok(t.trashBags >= 0 && t.trashBags <= 12);
    assert.ok(t.flamingos >= 0 && t.flamingos <= 6);
    assert.ok(['up', 'crooked', 'down'].includes(t.goalposts));
    assert.ok(TEAM_COLORS.includes(t.color));
    assert.equal(t.rankDelta, t.prevRank == null ? 0 : t.prevRank - t.rank);
  });
}

// ---------------------------------------------------------------------------------------------
// Rank and tiers
// ---------------------------------------------------------------------------------------------

test('tier sizes come from team count and playoff team count', () => {
  const layout = (n, p) => {
    const out = { hill: [], heights: [], bubble: [], park: [], dump: [] };
    for (let r = 1; r <= n; r++) out[tierForRank(r, n, p)].push(r);
    return out;
  };
  assert.deepEqual(layout(12, 6), { hill: [1], heights: [2, 3, 4], bubble: [5, 6, 7, 8], park: [9, 10, 11], dump: [12] });
  assert.deepEqual(layout(10, 4), { hill: [1], heights: [2], bubble: [3, 4, 5, 6], park: [7, 8, 9], dump: [10] });
  assert.deepEqual(layout(8, 4), { hill: [1], heights: [2], bubble: [3, 4, 5, 6], park: [7], dump: [8] });
  assert.deepEqual(layout(14, 7), { hill: [1], heights: [2, 3, 4, 5], bubble: [6, 7, 8, 9], park: [10, 11, 12, 13], dump: [14] });
  assert.deepEqual(layout(2, 1), { hill: [1], heights: [], bubble: [], park: [], dump: [2] });
  assert.deepEqual(layout(4, 2), { hill: [1], heights: [], bubble: [2, 3], park: [], dump: [4] });
});

test('derive lays out 12, 10, 8 and 14 team leagues', () => {
  for (const [n, p, sizes] of [[12, 6, [1, 3, 4, 3, 1]], [10, 4, [1, 1, 4, 3, 1]], [8, 4, [1, 1, 4, 1, 1]], [14, 7, [1, 4, 4, 4, 1]]]) {
    const league = makeLeague({ seed: n, teamCount: n, playoffTeamCount: p, currentWeek: 8 });
    const model = derive(league, null, { now: NOW });
    checkShape(model);
    assert.deepEqual(TIER_ORDER.map((t) => model.tiers[t].length), sizes, `${n} teams, ${p} playoff spots`);
    assert.equal(model.cutLine, p);
    checkCopy(model, `${n}-team league`);
  }
});

test('rank is the ESPN seed when seeds are present and unique', () => {
  const league = makeLeague({ seed: 5 });
  // Scramble the seeds so they cannot be mistaken for a record sort.
  const scrambled = clone(league);
  scrambled.teams.forEach((t, i) => { t.seed = ((i * 5) % 12) + 1; });
  const model = derive(scrambled, null, { now: NOW });
  for (const t of scrambled.teams) assert.equal(model.teams[t.id].rank, t.seed);
});

test('rank falls back to win percentage then points for when seeds are missing or duplicated', () => {
  for (const seeds of ['missing', 'duplicate']) {
    const league = makeLeague({ seed: 6, seeds });
    const model = derive(league, null, { now: NOW });
    const rows = Object.fromEntries(league.teams.map((t) => [t.id, { id: t.id, w: t.wins, l: t.losses, t: t.ties, pf: t.pointsFor }]));
    assert.deepEqual(model.order, orderOf(rows), seeds);
    checkShape(model);
  }
});

test('finalRank wins once the season is over', () => {
  const league = makeLeague({ seed: 9, seasonComplete: true });
  const model = derive(league, null, { now: NOW });
  assert.equal(model.meta.phase, 'complete');
  for (const t of league.teams) assert.equal(model.teams[t.id].rank, t.finalRank);
  // prevRank is the seeding the playoffs started from.
  for (const t of league.teams) assert.equal(model.teams[t.id].prevRank, t.seed);
  for (const t of league.teams) {
    const m = model.teams[t.id];
    assert.equal(m.clinched, m.inPlayoffSpot);
    assert.equal(m.eliminated, !m.inPlayoffSpot);
  }
  checkCopy(model, 'complete season');
});

// ---------------------------------------------------------------------------------------------
// Previous week
// ---------------------------------------------------------------------------------------------

test('prevRank is the standings one completed week earlier', () => {
  let moved = 0;
  for (const weekState of ['pre', 'live', 'final']) {
    const league = makeLeague({ seed: 12, currentWeek: 10, weekState });
    const L = lastCompletedWeek(league);
    assert.equal(L, weekState === 'final' ? 10 : 9);
    const model = derive(league, null, { now: NOW });
    const before = orderOf(standings(league, L - 1));
    before.forEach((id, i) => {
      const t = model.teams[id];
      assert.equal(t.prevRank, i + 1, `${weekState}: team ${id}`);
      assert.equal(t.prevTier, tierForRank(i + 1, 12, 6));
      const want = t.prevTier === t.tier ? null : TIER_ORDER.indexOf(t.tier) < TIER_ORDER.indexOf(t.prevTier) ? 'up' : 'down';
      assert.equal(t.tierMove, want);
      if (t.rankDelta !== 0) moved++;
    });
  }
  assert.ok(moved > 0, 'somebody should have moved in a week');
});

test('prevRank is null when there is not enough history', () => {
  for (const [currentWeek, weekState] of [[1, 'pre'], [1, 'live'], [1, 'final'], [2, 'pre']]) {
    const model = derive(makeLeague({ seed: 2, currentWeek, weekState }), null, { now: NOW });
    for (const id of model.order) {
      const t = model.teams[id];
      assert.equal(t.prevRank, null, `week ${currentWeek} ${weekState}`);
      assert.equal(t.prevTier, null);
      assert.equal(t.tierMove, null);
      assert.equal(t.rankDelta, 0);
    }
  }
  const model = derive(makeLeague({ seed: 2, currentWeek: 2, weekState: 'final' }), null, { now: NOW });
  assert.ok(model.order.every((id) => model.teams[id].prevRank != null));
});

test('the regular-season table is frozen during the playoffs', () => {
  const model = derive(makeLeague({ seed: 3, currentWeek: 16, weekState: 'pre' }), null, { now: NOW });
  assert.equal(model.meta.phase, 'playoffs');
  for (const id of model.order) {
    const t = model.teams[id];
    assert.equal(t.prevRank, t.rank);
    assert.equal(t.tierMove, null);
    assert.equal(t.clinched, t.inPlayoffSpot);
    assert.equal(t.eliminated, !t.inPlayoffSpot);
  }
  checkCopy(model, 'playoffs');
});

// ---------------------------------------------------------------------------------------------
// Week status and the clock
// ---------------------------------------------------------------------------------------------

test('matchup status is final, live or pre', () => {
  const pre = derive(makeLeague({ seed: 4, weekState: 'pre', kickoffs: false }), null, { now: NOW });
  assert.equal(pre.meta.weekStatus, 'pre');
  assert.equal(pre.matchups.length, 6);
  for (const m of pre.matchups) {
    assert.equal(m.status, 'pre');
    assert.equal(m.winnerId, null);
    assert.equal(m.week, 10);
  }
  for (const id of pre.order) {
    assert.equal(pre.teams[id].thisWeek.status, 'pre');
    assert.equal(pre.teams[id].thisWeek.winning, null);
  }

  const live = derive(makeLeague({ seed: 4, weekState: 'live' }), null, { now: NOW });
  assert.equal(live.meta.weekStatus, 'live');
  for (const m of live.matchups) {
    assert.equal(m.status, 'live');
    assert.equal(m.winnerId, null);
    assert.equal(m.margin, Math.round(Math.abs(m.homePts - m.awayPts) * 100) / 100);
    const home = live.teams[m.homeId].thisWeek;
    assert.equal(home.oppId, m.awayId);
    assert.equal(home.winning, m.homePts > m.awayPts ? true : m.homePts < m.awayPts ? false : null);
  }

  const done = derive(makeLeague({ seed: 4, weekState: 'final' }), null, { now: NOW });
  assert.equal(done.meta.weekStatus, 'final');
  for (const m of done.matchups) {
    assert.equal(m.status, 'final');
    assert.ok(m.winnerId === m.homeId || m.winnerId === m.awayId);
    assert.equal(done.teams[m.winnerId].thisWeek.winning, true);
  }
  assert.equal(done.lastWeek.week, 10);
});

test('an undecided matchup with no points is live while a real NFL game is on', () => {
  const league = makeLeague({ seed: 4, weekState: 'pre' });
  const kick = Date.parse(league.nfl.kickoffs[0]);
  const during = derive(league, null, { now: new Date(kick + 60 * 60 * 1000) });
  assert.equal(during.meta.nflLive, true);
  assert.ok(during.matchups.every((m) => m.status === 'live'));
  assert.equal(during.meta.weekStatus, 'live');
  assert.equal(during.meta.nextKickoff, league.nfl.kickoffs[1]);

  const edge = derive(league, null, { now: new Date(kick + 3.5 * 60 * 60 * 1000) });
  assert.equal(edge.meta.nflLive, true);
  const after = derive(league, null, { now: new Date(kick + 3.5 * 60 * 60 * 1000 + 1) });
  assert.equal(after.meta.nflLive, false);
  assert.ok(after.matchups.every((m) => m.status === 'pre'));

  const before = derive(league, null, { now: new Date(kick - 1000).toISOString() });
  assert.equal(before.meta.nflLive, false);
  assert.equal(before.meta.nextKickoff, league.nfl.kickoffs[0]);

  const afterSeason = derive(league, null, { now: new Date('2030-01-01T00:00:00Z') });
  assert.equal(afterSeason.meta.nextKickoff, null);
  const noClock = derive(league, null);
  assert.equal(noClock.meta.nflLive, false);
  assert.equal(noClock.meta.nextKickoff, null);
});

// ---------------------------------------------------------------------------------------------
// Trash bags, streaks, flamingos
// ---------------------------------------------------------------------------------------------

function walkBags(league, id) {
  let bags = 0;
  for (const m of regularGames(league).sort((a, b) => a.week - b.week)) {
    const home = m.home.teamId === id;
    if (!home && m.away.teamId !== id) continue;
    if (m.winner === 'tie') continue;
    const won = (m.winner === 'home') === home;
    bags = won ? Math.max(0, bags - 1) : Math.min(12, bags + 1);
  }
  return bags;
}

test('trash bags: loss +1, win -1, never below 0', () => {
  // Team 1 loses weeks 1-5, wins 6-7, loses 8-9: 5 - 2 + 2 = 5 bags.
  const league = makeLeague({
    seed: 7,
    currentWeek: 10,
    scoreFor: (week, id, base) => (id !== 1 ? base : week === 6 || week === 7 ? 500 : 1),
  });
  const model = derive(league, null, { now: NOW });
  assert.equal(model.teams[1].trashBags, 5);
  assert.deepEqual(model.teams[1].streak, { type: 'L', length: 2 });
  assert.equal(model.teams[1].flamingos, 0);
  for (const t of league.teams) assert.equal(model.teams[t.id].trashBags, walkBags(league, t.id), `team ${t.id}`);
});

test('trash bags are capped at 12 and flamingos at 6', () => {
  const league = makeLeague({ seed: 7, currentWeek: 14, scoreFor: (week, id, base) => (id === 1 ? 1 : id === 2 ? 600 : base) });
  const model = derive(league, null, { now: NOW });
  assert.equal(model.teams[1].record.text, '0-13');
  assert.equal(model.teams[1].trashBags, 12);
  assert.equal(model.teams[2].trashBags, 0);
  assert.deepEqual(model.teams[2].streak, { type: 'W', length: 13 });
  assert.equal(model.teams[2].flamingos, 6);
  checkCopy(model, 'winless and unbeaten');
});

test('trash bags fall back to the losing streak when matchups are missing', () => {
  const league = makeLeague({ seed: 7, currentWeek: 8 });
  league.matchups = [];
  league.teams[0].streakType = 'LOSS';
  league.teams[0].streakLength = 4;
  league.teams[1].streakType = 'WIN';
  league.teams[1].streakLength = 3;
  const model = derive(league, null, { now: NOW });
  assert.equal(model.teams[league.teams[0].id].trashBags, 4);
  assert.equal(model.teams[league.teams[1].id].trashBags, 0);
  assert.equal(model.teams[league.teams[1].id].flamingos, 3);
  assert.deepEqual(model.matchups, []);
  assert.equal(model.lastWeek, null);
  checkShape(model);
  checkCopy(model, 'no matchups');
});

// ---------------------------------------------------------------------------------------------
// Luck
// ---------------------------------------------------------------------------------------------

test('luck is the all-play record against the actual record', () => {
  const league = makeLeague({ seed: 15, currentWeek: 10 });
  const model = derive(league, null, { now: NOW });
  const rows = Object.fromEntries(league.teams.map((t) => [t.id, { apw: 0, apl: 0, games: 0, wins: 0 }]));
  for (let week = 1; week <= 9; week++) {
    const scores = [];
    for (const m of regularGames(league).filter((g) => g.week === week)) {
      scores.push([m.home.teamId, m.home.points], [m.away.teamId, m.away.points]);
      rows[m.home.teamId].games++;
      rows[m.away.teamId].games++;
      rows[m.winner === 'home' ? m.home.teamId : m.away.teamId].wins++;
    }
    for (const [id, pts] of scores) {
      for (const [other, otherPts] of scores) {
        if (other === id) continue;
        if (pts > otherPts) rows[id].apw++;
        if (pts < otherPts) rows[id].apl++;
      }
    }
  }
  const deltas = {};
  for (const t of league.teams) {
    const r = rows[t.id];
    const expected = (r.apw / (r.apw + r.apl)) * r.games;
    const luck = model.teams[t.id].luck;
    assert.equal(luck.allPlayWins, r.apw);
    assert.equal(luck.allPlayLosses, r.apl);
    assert.equal(r.apw + r.apl, 9 * 11);
    assert.ok(Math.abs(luck.expectedWins - expected) < 0.006);
    assert.ok(Math.abs(luck.delta - (r.wins - expected)) < 0.006);
    deltas[t.id] = luck.delta;
  }
  const tags = model.order.map((id) => model.teams[id].luckTag);
  assert.equal(tags.filter((t) => t === 'luckiest').length, 1);
  assert.equal(tags.filter((t) => t === 'unluckiest').length, 1);
  const lucky = model.order.find((id) => model.teams[id].luckTag === 'luckiest');
  const unlucky = model.order.find((id) => model.teams[id].luckTag === 'unluckiest');
  assert.equal(deltas[lucky], Math.max(...Object.values(deltas)));
  assert.equal(deltas[unlucky], Math.min(...Object.values(deltas)));
});

test('luck tags wait for three completed weeks and break ties by team id', () => {
  const two = derive(makeLeague({ seed: 15, currentWeek: 3, weekState: 'pre' }), null, { now: NOW });
  assert.ok(two.order.every((id) => two.teams[id].luckTag === null));
  const three = derive(makeLeague({ seed: 15, currentWeek: 3, weekState: 'final' }), null, { now: NOW });
  assert.equal(three.order.filter((id) => three.teams[id].luckTag).length, 2);

  // Every game a tie on identical scores: all deltas are equal, lowest ids take the tags.
  const flat = derive(makeLeague({ seed: 15, currentWeek: 5, scoreFor: () => 100 }), null, { now: NOW });
  assert.equal(flat.teams[1].luckTag, 'luckiest');
  assert.equal(flat.teams[2].luckTag, 'unluckiest');
  assert.equal(flat.order.filter((id) => flat.teams[id].luckTag).length, 2);
  assert.equal(flat.teams[1].record.text, '0-0-4');
  checkCopy(flat, 'all ties');
});

// ---------------------------------------------------------------------------------------------
// Clinched and eliminated
// ---------------------------------------------------------------------------------------------

test('clinched and eliminated are conservative and certain', () => {
  const league = makeLeague({
    seed: 20,
    teamCount: 4,
    playoffTeamCount: 2,
    regularSeasonWeeks: 6,
    currentWeek: 6,
    weekState: 'pre',
    scoreFor: (week, id, base) => (id === 1 ? 300 : id === 4 ? 1 : base),
  });
  const model = derive(league, null, { now: NOW });
  assert.equal(model.teams[1].record.text, '5-0');
  assert.equal(model.teams[4].record.text, '0-5');
  assert.equal(model.teams[1].clinched, true);
  assert.equal(model.teams[1].eliminated, false);
  assert.equal(model.teams[4].eliminated, true);
  assert.equal(model.teams[4].clinched, false);

  // Same rule, written again.
  const rows = league.teams.map((t) => ({ id: t.id, value: t.wins + t.ties / 2, max: t.wins + t.ties / 2 + 1 }));
  for (const me of rows) {
    const others = rows.filter((r) => r.id !== me.id);
    assert.equal(model.teams[me.id].clinched, others.filter((r) => r.max >= me.value).length < 2, `clinched ${me.id}`);
    assert.equal(model.teams[me.id].eliminated, others.filter((r) => r.value > me.max).length >= 2, `eliminated ${me.id}`);
  }
  checkCopy(model, '4-team league');
});

test('nobody is clinched or eliminated early', () => {
  for (const [currentWeek, weekState] of [[1, 'pre'], [3, 'pre'], [6, 'live']]) {
    const model = derive(makeLeague({ seed: 21, currentWeek, weekState }), null, { now: NOW });
    for (const id of model.order) {
      assert.equal(model.teams[id].clinched, false);
      assert.equal(model.teams[id].eliminated, false);
    }
  }
});

test('after the regular season the playoff line decides', () => {
  const model = derive(makeLeague({ seed: 21, currentWeek: 14, weekState: 'final' }), null, { now: NOW });
  assert.equal(model.meta.phase, 'regular');
  for (const id of model.order) {
    const t = model.teams[id];
    assert.equal(t.clinched, t.inPlayoffSpot);
    assert.equal(t.eliminated, !t.inPlayoffSpot);
  }
  checkCopy(model, 'regular season just ended');
});

// ---------------------------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------------------------

test('goalposts and lineup notes follow the roster', () => {
  const league = makeLeague({
    seed: 30,
    crimes: {
      1: { empty: ['FLEX'], bad: [{ name: 'Some Player', why: 'OUT' }] },
      2: { bad: [{ name: 'Bye Guy', why: 'BYE' }], ir: ['Hurt One', 'Hurt Two'] },
      3: { empty: ['RB', 'RB'] },
    },
  });
  league.teams.find((t) => t.id === 4).roster = null;
  const model = derive(league, null, { now: NOW });

  assert.equal(model.teams[1].goalposts, 'down');
  assert.deepEqual(model.teams[1].lineupNotes, ['FLEX is empty', 'Starting Some Player (OUT)']);
  assert.equal(model.teams[2].goalposts, 'crooked');
  assert.deepEqual(model.teams[2].lineupNotes, ['Starting Bye Guy (BYE)']);
  assert.deepEqual(model.teams[2].ir, { count: 2, names: ['Hurt One', 'Hurt Two'] });
  assert.equal(model.teams[3].goalposts, 'down');
  assert.deepEqual(model.teams[3].lineupNotes, ['2 RB slots are empty']);
  assert.equal(model.teams[4].goalposts, 'up');
  assert.deepEqual(model.teams[4].lineupNotes, []);
  assert.deepEqual(model.teams[4].ir, { count: 0, names: [] });
  assert.equal(model.teams[5].goalposts, 'up');
  assert.deepEqual(model.teams[5].lineupNotes, []);

  // The lineup crime shows up in the copy for that home.
  assert.ok(model.teams[1].roast.mailbox.some((line) => line.includes('FLEX')));
  assert.ok(model.teams[2].roast.mailbox.some((line) => line.includes('Bye Guy')));
  checkCopy(model, 'lineup crimes');
});

// ---------------------------------------------------------------------------------------------
// This week, last week, trophies
// ---------------------------------------------------------------------------------------------

test('last week, the toilet and the spotlight come from the last completed week', () => {
  const league = makeLeague({ seed: 33, currentWeek: 10, weekState: 'live' });
  const model = derive(league, null, { now: NOW });
  assert.equal(model.lastWeek.week, 9);
  assert.equal(model.lastWeek.results.length, 6);
  const scores = [];
  for (const r of model.lastWeek.results) {
    assert.equal(r.status, 'final');
    assert.equal(r.week, 9);
    scores.push([r.homeId, r.homePts], [r.awayId, r.awayPts]);
    const loser = r.winnerId === r.homeId ? r.awayId : r.homeId;
    const w = model.teams[r.winnerId];
    const l = model.teams[loser];
    assert.deepEqual(w.lastWeek, { oppId: loser, pts: Math.max(r.homePts, r.awayPts), oppPts: Math.min(r.homePts, r.awayPts), won: true, margin: r.margin });
    assert.equal(l.lastWeek.won, false);
    assert.equal(w.beatLastWeek, loser);
    assert.equal(l.beatLastWeek, null);
  }
  scores.sort((a, b) => a[1] - b[1]);
  assert.equal(model.lastWeek.lowScoreId, scores[0][0]);
  assert.equal(model.lastWeek.highScoreId, scores[scores.length - 1][0]);
  for (const id of model.order) {
    assert.equal(model.teams[id].trophy.toilet, id === model.lastWeek.lowScoreId);
    assert.equal(model.teams[id].trophy.spotlight, id === model.lastWeek.highScoreId);
  }
});

test('a bye is not a matchup: odd team counts work', () => {
  const league = makeLeague({ seed: 34, teamCount: 11, playoffTeamCount: 6, currentWeek: 7, weekState: 'live' });
  assert.ok(league.matchups.some((m) => m.away === null));
  const model = derive(league, null, { now: NOW });
  checkShape(model);
  assert.equal(model.matchups.length, 5);
  assert.ok(model.matchups.every((m) => m.awayId != null));
  assert.equal(model.order.filter((id) => model.teams[id].thisWeek === null).length, 1);
  assert.equal(model.lastWeek.results.length, 5);
  assert.equal(model.order.filter((id) => model.teams[id].lastWeek === null).length, 1);
  checkCopy(model, '11-team league');
});

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

function handHistory() {
  const team = (id, key, owner, name, finalRank, wins, losses, pointsFor) => ({
    id, name, owner, ownerKey: key, seed: finalRank, finalRank, wins, losses, ties: 0, pointsFor, pointsAgainst: 1000,
  });
  return {
    schema: 1,
    source: 'placeholder',
    generatedAt: '2026-11-16T03:10:00Z',
    seasons: [
      {
        season: 2024,
        regularSeasonWeeks: 5,
        playoffTeamCount: 2,
        teams: [
          team(1, 'A', 'Ann', 'Old A', 1, 10, 4, 1500), team(2, 'B', 'Bob', 'Old B', 2, 7, 7, 1400),
          team(3, 'C', 'Cy', 'Old C', 3, 6, 8, 1300), team(4, 'D', 'Di', 'Old D', 4, 2, 12, 1100.5),
        ],
        games: [
          [1, 1, 100, 2, 90, 0], [2, 1, 110, 2, 80, 0], [3, 3, 95, 4, 70, 0], [4, 2, 120, 1, 60, 0], [5, 3, 150.5, 1, 100, 0],
          [6, 1, 105, 3, 99, 1], [6, 2, 30.5, 4, 20.25, 2], [6, 4, 77, null, null, 1],
        ],
      },
      {
        season: 2025,
        regularSeasonWeeks: 2,
        playoffTeamCount: 2,
        teams: [
          team(1, 'A', 'Ann', 'Mid A', 2, 9, 5, 1450), team(2, 'B', 'Bob', 'Mid B', 3, 8, 6, 1620.4),
          team(3, 'C', 'Cy', 'Mid C', 4, 3, 11, 1200), team(4, 'D', 'Di', 'Mid D', 1, 12, 2, 1600),
        ],
        games: [[1, 1, 88, 2, 77, 0], [2, 4, 101, 3, 45.5, 0], [3, 4, 130, 1, 129, 1]],
      },
    ],
  };
}

function handLeague(seeds = { 11: 2, 12: 4, 13: 3, 14: 1 }) {
  const team = (id, key, owner, name, wins, losses, pf) => ({
    id, name, abbrev: owner.toUpperCase(), owner, ownerKey: key, seed: seeds[id], finalRank: 0, wins, losses, ties: 0,
    pointsFor: pf, pointsAgainst: 100, streakType: wins ? 'WIN' : 'LOSS', streakLength: 1,
    moves: { acquisitions: 0, drops: 0, trades: 0 }, roster: null,
  });
  const game = (week, home, hp, away, ap, winner) => ({
    week, playoff: false, bracket: 'NONE', home: { teamId: home, points: hp, projected: null }, away: { teamId: away, points: ap, projected: null }, winner,
  });
  return {
    schema: 1,
    source: 'espn',
    generatedAt: '2026-09-20T03:10:00Z',
    league: {
      id: 1, name: 'Hand League', season: 2026, isPublic: true, teamCount: 4, regularSeasonWeeks: 6, playoffTeamCount: 2,
      currentWeek: 2, scoringPeriod: 2, finalScoringPeriod: 8, seasonComplete: false, scoringType: 'PPR', starterSlots: {},
    },
    teams: [team(11, 'A', 'Ann', 'New A', 1, 0, 100), team(12, 'B', 'Bob', 'New B', 0, 1, 99), team(13, 'C', 'Cy', 'New C', 0, 1, 80), team(14, 'D', 'Di', 'New D', 1, 0, 120)],
    matchups: [game(1, 11, 100, 12, 99, 'home'), game(1, 13, 80, 14, 120, 'away'), game(2, 11, 0, 13, 0, 'undecided'), game(2, 12, 0, 14, 0, 'undecided')],
    lastWeekLineups: null,
    draft: [],
    nfl: { kickoffs: [] },
  };
}

test('history is matched by ownerKey across renames and new team ids', () => {
  const model = derive(handLeague(), handHistory(), { now: NOW });
  const [ann, bob, cy, di] = [11, 12, 13, 14].map((id) => model.teams[id].history);

  assert.deepEqual(ann.titles, [2024]);
  assert.deepEqual(di.titles, [2025]);
  assert.deepEqual(bob.titles, []);
  assert.deepEqual(di.lastPlaces, [2024]);
  assert.deepEqual(cy.lastPlaces, [2025]);
  for (const h of [ann, bob, cy, di]) assert.equal(h.seasonsPlayed, 2);
  assert.equal(ann.seasonsSinceTitle, 1);
  assert.equal(di.seasonsSinceTitle, 0);
  assert.equal(bob.seasonsSinceTitle, null);
  assert.equal(cy.seasonsSinceTitle, null);

  // Regular season plus winners bracket, plus this season's finished games. Consolation and byes do not count.
  assert.deepEqual(ann.allTime, { wins: 5, losses: 3, ties: 0, text: '5-3' });
  assert.deepEqual(bob.allTime, { wins: 1, losses: 4, ties: 0, text: '1-4' });
  assert.deepEqual(cy.allTime, { wins: 2, losses: 3, ties: 0, text: '2-3' });
  assert.deepEqual(di.allTime, { wins: 3, losses: 1, ties: 0, text: '3-1' });

  // Rivalries need three meetings.
  assert.deepEqual(bob.nemesis, { ownerKey: 'A', owner: 'Ann', teamName: 'New A', teamId: 11, wins: 1, losses: 4 });
  assert.equal(bob.victim, null);
  assert.deepEqual(ann.victim, { ownerKey: 'B', owner: 'Bob', teamName: 'New B', teamId: 12, wins: 4, losses: 1 });
  assert.equal(ann.nemesis, null, 'Ann has met Cy twice and Di once: not enough to call it');
  assert.deepEqual(cy.nemesis, { ownerKey: 'D', owner: 'Di', teamName: 'New D', teamId: 14, wins: 1, losses: 2 });
  assert.deepEqual(di.victim, { ownerKey: 'C', owner: 'Cy', teamName: 'New C', teamId: 13, wins: 2, losses: 1 });
  assert.equal(di.nemesis, null);
  assert.equal(cy.victim, null);
  assert.ok(model.teams[12].roast.mailbox.some((line) => line.includes('Ann') && line.includes('1-4')), model.teams[12].roast.mailbox.join(' | '));
});

test('the record book, champions and last places', () => {
  const model = derive(handLeague(), handHistory(), { now: NOW });
  const h = model.history;
  assert.deepEqual(h.champions, [
    { season: 2025, teamName: 'New D', owner: 'Di', ownerKey: 'D', teamId: 14, record: '12-2' },
    { season: 2024, teamName: 'New A', owner: 'Ann', ownerKey: 'A', teamId: 11, record: '10-4' },
  ]);
  assert.deepEqual(h.lastPlaces.map((e) => [e.season, e.owner, e.teamId]), [[2025, 'Cy', 13], [2024, 'Di', 14]]);

  const byId = Object.fromEntries(h.records.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId), ['highWeek', 'lowWeek', 'blowout', 'bestRecord', 'worstRecord', 'mostPoints']);
  for (const r of h.records) {
    for (const key of ['id', 'label', 'value', 'text', 'ownerKey', 'teamId']) assert.ok(key in r, `record.${key}`);
    assert.equal(typeof r.value, 'string');
    assert.ok(r.label.length > 0);
  }
  assert.equal(byId.highWeek.value, '150.5');
  assert.equal(byId.highWeek.text, 'Cy, Week 5, 2024');
  assert.equal(byId.highWeek.teamId, 13);
  assert.equal(byId.lowWeek.value, '45.5');
  assert.equal(byId.lowWeek.text, 'Cy, Week 2, 2025');
  assert.equal(byId.blowout.value, '60.0');
  assert.equal(byId.blowout.text, 'Bob over Ann, Week 4, 2024');
  assert.equal(byId.blowout.ownerKey, 'B');
  assert.equal(byId.bestRecord.value, '12-2');
  assert.equal(byId.bestRecord.text, 'Di, 2025');
  assert.equal(byId.worstRecord.value, '2-12');
  assert.equal(byId.worstRecord.text, 'Di, 2024');
  assert.equal(byId.mostPoints.value, '1,620.4');
  assert.equal(byId.mostPoints.text, 'Bob, 2025');
});

test('a record set this season makes the record book and the front page', () => {
  const league = handLeague();
  league.matchups[1] = { ...league.matchups[1], away: { teamId: 14, points: 199.9, projected: null } };
  const model = derive(league, handHistory(), { now: NOW });
  const high = model.history.records.find((r) => r.id === 'highWeek');
  assert.equal(high.value, '199.9');
  assert.equal(high.text, 'Di, Week 1, 2026');
  assert.equal(model.headlines[0].kind, 'record');
  assert.ok(model.headlines[0].headline.includes('199.9'));
  assert.ok(model.blimp.includes('199.9'));
});

test('the defending champion statue: shiny, pigeons or cone', () => {
  const at = (seeds) => derive(handLeague(seeds), handHistory(), { now: NOW }).history.defendingChamp;
  assert.deepEqual(at({ 11: 2, 12: 4, 13: 3, 14: 1 }), { season: 2025, owner: 'Di', ownerKey: 'D', teamName: 'New D', teamId: 14, rank: 1, condition: 'shiny' });
  assert.equal(at({ 11: 1, 12: 4, 13: 3, 14: 2 }).condition, 'pigeons');
  assert.equal(at({ 11: 1, 12: 3, 13: 2, 14: 4 }).condition, 'cone');

  // 12 teams: top quarter is 1-3, bottom third is 9-12.
  const history = makeHistory({ seed: 5 });
  const champKey = history.seasons.at(-1).teams.find((t) => t.finalRank === 1).ownerKey;
  for (const [rank, condition] of [[1, 'shiny'], [3, 'shiny'], [4, 'pigeons'], [8, 'pigeons'], [9, 'cone'], [12, 'cone']]) {
    const league = makeLeague({ seed: 40 });
    const champ = league.teams.find((t) => t.ownerKey === champKey);
    const holder = league.teams.find((t) => t.seed === rank);
    [champ.seed, holder.seed] = [holder.seed, champ.seed];
    const dc = derive(league, history, { now: NOW }).history.defendingChamp;
    assert.equal(dc.rank, rank);
    assert.equal(dc.condition, condition, `rank ${rank}`);
  }
});

test('a champion who left the league keeps their old name and has no team id', () => {
  const league = handLeague();
  league.teams.find((t) => t.id === 14).ownerKey = 'Z';
  const model = derive(league, handHistory(), { now: NOW });
  assert.deepEqual(model.history.champions[0], { season: 2025, teamName: 'Mid D', owner: 'Di', ownerKey: 'D', teamId: null, record: '12-2' });
  assert.deepEqual(model.history.defendingChamp, { season: 2025, owner: 'Di', ownerKey: 'D', teamName: 'Mid D', teamId: null, rank: null, condition: 'pigeons' });
  assert.equal(model.teams[14].history, null, 'a new owner has no history');
  checkCopy(model, 'departed champion');
});

test('history may be null, empty or malformed', () => {
  const league = makeLeague({ seed: 41 });
  for (const history of [null, undefined, {}, { seasons: [] }, { seasons: [null, 7, { season: 2020 }, { season: 2021, teams: 'no' }] }, 'nope', []]) {
    const model = derive(league, history, { now: NOW });
    assert.equal(model.history, null);
    assert.ok(model.order.every((id) => model.teams[id].history === null));
    checkShape(model);
    checkCopy(model, 'no history');
  }
});

test('meta.isSample and meta.historyIsSample', () => {
  const sample = makeLeague({ seed: 1 });
  const real = makeLeague({ seed: 1, source: 'espn' });
  assert.equal(derive(sample, null, { now: NOW }).meta.isSample, true);
  assert.equal(derive(real, null, { now: NOW }).meta.isSample, false);
  assert.equal(derive(real, null, { now: NOW }).meta.historyIsSample, false);
  assert.equal(derive(real, makeHistory({ seed: 1 }), { now: NOW }).meta.historyIsSample, true);
  assert.equal(derive(real, makeHistory({ seed: 1, source: 'espn' }), { now: NOW }).meta.historyIsSample, false);
  assert.equal(derive(real, { schema: 1, seasons: [] }, { now: NOW }).meta.historyIsSample, true);
  // Sample data reads exactly like real data.
  const a = derive(sample, null, { now: NOW });
  const b = derive(real, null, { now: NOW });
  assert.deepEqual(a.order.map((id) => a.teams[id].roast), b.order.map((id) => b.teams[id].roast));
});

// ---------------------------------------------------------------------------------------------
// Garbage in, smaller model out
// ---------------------------------------------------------------------------------------------

test('derive never throws on missing or broken data', () => {
  const inputs = [
    null, undefined, {}, [], 'x', 42, { league: null, teams: null }, { league: {}, teams: [] },
    { league: { teamCount: 12 }, teams: [null, 3, {}, { id: null }, { id: 1 }, { id: 1 }, { id: 2, name: 7, roster: 'no', wins: 'x' }] },
    { teams: [{ id: 1 }, { id: 2 }], matchups: [null, {}, { week: 1 }, { week: 1, home: { teamId: 99 }, away: { teamId: 1 } }, { week: 'x', home: { teamId: 1 }, away: { teamId: 2 } }] },
    { teams: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], matchups: [{ week: 1, home: { teamId: 'a', points: 10 }, away: { teamId: 'b', points: 5 }, winner: 'HOME' }] },
    { teams: [{ id: 1 }], lastWeekLineups: { week: 1, teams: null }, nfl: { kickoffs: ['nope', null, 5] }, draft: null },
  ];
  for (const input of inputs) {
    for (const history of [null, {}, { seasons: [{ season: 2020, teams: [{ id: 1 }], games: [[1], null, [1, 1, 'x', 2, 3, 0]] }] }]) {
      const model = derive(input, history, { now: NOW });
      checkShape(model);
      for (const { text } of allCopy(model)) if (model.order.length) assert.equal(typeof text, 'string');
    }
  }
  const empty = derive(null, null);
  assert.deepEqual(empty.order, []);
  assert.deepEqual(empty.teams, {});
  assert.deepEqual(empty.headlines, []);
  assert.equal(empty.lastWeek, null);
  assert.equal(empty.history, null);
});

test('randomly corrupted data never throws and never leaks a broken template', () => {
  const junk = [null, undefined, '', 'x', 0, -1, 1e21, NaN, Infinity, [], {}, true, '12', [null], { a: 1 }];
  const corrupt = (obj, rand) => {
    if (obj === null || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const r = rand();
      if (r < 0.04) obj[key] = junk[Math.floor(rand() * junk.length)];
      else if (r < 0.05) delete obj[key];
      else corrupt(obj[key], rand);
    }
  };
  const leagues = [
    makeLeague({ seed: 1 }),
    makeLeague({ seed: 2, currentWeek: 16, weekState: 'live' }),
    makeLeague({ seed: 3, seasonComplete: true }),
    makeLeague({ seed: 4, currentWeek: 1 }),
    makeLeague({ seed: 5, teamCount: 11, currentWeek: 7, weekState: 'final', crimes: { 2: { empty: ['K'], ir: ['A Guy'] } } }),
  ];
  const histories = [makeHistory({ seed: 1 }), makeHistory({ seed: 2, teamCount: 11 })];
  for (let i = 0; i < 800; i++) {
    const rand = rng32(i + 1);
    const league = clone(leagues[i % leagues.length]);
    const history = clone(histories[i % histories.length]);
    corrupt(league, rand);
    if (i % 2) corrupt(history, rand);
    const now = i % 9 === 0 ? junk[i % junk.length] : NOW;
    const model = derive(league, history, { now });
    assert.deepEqual(clone(model), JSON.parse(JSON.stringify(model)), 'model is JSON');
    for (const id of model.order) {
      const t = model.teams[id];
      const text = [t.roast.arrival, t.roast.sign, ...t.roast.mailbox].join(' | ');
      assert.ok(t.roast.arrival.length > 0 && t.roast.arrival.length <= COPY_LIMITS.arrival, `run ${i}: ${text}`);
      assert.ok(t.roast.sign.length > 0 && t.roast.sign.length <= COPY_LIMITS.sign, `run ${i}: ${text}`);
      assert.ok(t.roast.mailbox.length >= 2 && t.roast.mailbox.length <= 4, `run ${i}: ${text}`);
      assert.ok(!/undefined|NaN|Infinity|\[object/.test(text), `run ${i}: ${text}`);
      assert.ok(Number.isInteger(t.rank) && t.rank >= 1 && t.rank <= model.order.length);
      assert.ok(Array.isArray(recapChanges(snapshot(model), model, id)));
    }
    for (const h of model.headlines) {
      assert.ok(h.headline.length > 0 && h.headline.length <= COPY_LIMITS.headline && h.body.length <= COPY_LIMITS.body, `run ${i}: ${h.headline}`);
      assert.ok(!/undefined|NaN|Infinity|\[object/.test(`${h.headline} ${h.body}`), `run ${i}: ${h.headline} / ${h.body}`);
    }
    assert.ok(model.blimp.length <= COPY_LIMITS.blimp);
  }
});

test('preseason: nothing played, nothing thrown, everyone still gets copy', () => {
  for (const seeds of ['ok', 'missing']) {
    const league = makeLeague({ seed: 50, currentWeek: 1, weekState: 'pre', seeds });
    const model = derive(league, makeHistory({ seed: 5 }), { now: new Date('2026-08-01T00:00:00Z') });
    checkShape(model);
    assert.equal(model.meta.phase, 'preseason');
    assert.equal(model.meta.weekStatus, 'pre');
    assert.equal(model.lastWeek, null);
    for (const id of model.order) {
      const t = model.teams[id];
      assert.equal(t.record.text, '0-0');
      assert.equal(t.trashBags, 0);
      assert.equal(t.flamingos, 0);
      assert.deepEqual(t.streak, { type: null, length: 0 });
      assert.equal(t.lastWeek, null);
      assert.equal(t.beatLastWeek, null);
      assert.equal(t.luckTag, null);
      assert.deepEqual(t.luck, { allPlayWins: 0, allPlayLosses: 0, expectedWins: 0, delta: 0 });
      assert.deepEqual(t.trophy, { toilet: false, spotlight: false });
      assert.equal(t.clinched, false);
      assert.equal(t.eliminated, false);
    }
    assert.ok(model.headlines.length >= 1);
    checkCopy(model, 'preseason');
  }
  // With a past season on file, everyone keeps last season's address until a game is played.
  for (const seeds of ['ok', 'missing']) {
    const league = makeLeague({ seed: 50, currentWeek: 1, weekState: 'pre', seeds });
    const history = makeHistory({ seed: 5 });
    const last = history.seasons.slice().sort((a, b) => b.season - a.season)[0];
    const expected = last.teams.slice().sort((a, b) => a.finalRank - b.finalRank).map((t) => t.id);
    const model = derive(league, history, { now: new Date('2026-08-01T00:00:00Z') });
    assert.deepEqual(model.order, expected, 'preseason order follows last season');
    assert.equal(model.teams[expected[0]].tier, 'hill');
    assert.equal(model.teams[expected[expected.length - 1]].tier, 'dump');
    // A team that was not in the league last season goes to the back.
    const fresh = JSON.parse(JSON.stringify(history));
    const gone = fresh.seasons.find((s) => s.season === last.season).teams.find((t) => t.finalRank === 1).id;
    for (const s of fresh.seasons) s.teams = s.teams.filter((t) => t.id !== gone);
    const moved = derive(league, fresh, { now: new Date('2026-08-01T00:00:00Z') });
    assert.equal(moved.order[moved.order.length - 1], gone);
    checkShape(moved);
  }
  // Once a game has been played, last season stops mattering.
  {
    const league = makeLeague({ seed: 50, currentWeek: 2, weekState: 'pre' });
    const model = derive(league, makeHistory({ seed: 5 }), { now: NOW });
    assert.notEqual(model.meta.phase, 'preseason');
    const bySeed = league.teams.slice().sort((a, b) => a.seed - b.seed).map((t) => t.id);
    assert.deepEqual(model.order, bySeed);
  }
  // No matchups at all, as before the schedule exists.
  const bare = makeLeague({ seed: 50, currentWeek: 1, weekState: 'pre', seeds: 'missing', rosters: false, lineups: false, kickoffs: false });
  bare.matchups = [];
  const model = derive(bare, null, { now: NOW });
  assert.equal(model.meta.phase, 'preseason');
  assert.deepEqual(model.matchups, []);
  assert.ok(model.order.every((id) => model.teams[id].thisWeek === null));
  checkShape(model);
  checkCopy(model, 'bare preseason');
});

test('optional pieces can each be missing', () => {
  const league = makeLeague({ seed: 51, rosters: false, lineups: false, kickoffs: false, projections: false });
  delete league.draft;
  delete league.nfl;
  delete league.lastWeekLineups;
  const model = derive(league, null, { now: NOW });
  checkShape(model);
  assert.equal(model.meta.nflLive, false);
  assert.equal(model.meta.nextKickoff, null);
  assert.ok(model.order.every((id) => model.teams[id].goalposts === 'up' && model.teams[id].lineupNotes.length === 0));
  assert.ok(model.matchups.every((m) => m.homeProj === null && m.awayProj === null));
  assert.ok(!model.headlines.some((h) => h.kind === 'forecast' || h.kind === 'bench' || h.kind === 'history'));
  checkCopy(model, 'bare league');
});

test('ties are counted and shown in the record', () => {
  const league = makeLeague({ seed: 52, currentWeek: 6, scoreFor: (week, id, base) => (week === 2 && id <= 2 ? 111.1 : week === 4 ? 90 : base) });
  const model = derive(league, null, { now: NOW });
  checkShape(model);
  for (const t of league.teams) {
    assert.equal(model.teams[t.id].record.ties, t.ties);
    assert.equal(model.teams[t.id].record.text, t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`);
    assert.ok(t.ties >= 1);
  }
  checkCopy(model, 'ties');
  // A week that ends level everywhere: no winners, no beatLastWeek, still a toilet and a spotlight.
  const level = derive(makeLeague({ seed: 52, currentWeek: 2, scoreFor: () => 80 }), null, { now: NOW });
  assert.ok(level.lastWeek.results.every((r) => r.winnerId === null && r.margin === 0));
  assert.ok(level.order.every((id) => level.teams[id].beatLastWeek === null && level.teams[id].lastWeek.won === null));
  assert.notEqual(level.lastWeek.lowScoreId, level.lastWeek.highScoreId);
  checkCopy(level, 'level week');
});

test('team colors follow ascending team id, not rank', () => {
  const model = derive(makeLeague({ seed: 53 }), null, { now: NOW });
  const ids = model.order.slice().sort((a, b) => a - b);
  ids.forEach((id, i) => assert.equal(model.teams[id].color, TEAM_COLORS[i]));
});

// ---------------------------------------------------------------------------------------------
// Determinism and stability
// ---------------------------------------------------------------------------------------------

test('same inputs give the identical model and inputs are not modified', () => {
  const league = makeLeague({ seed: 60, weekState: 'live', crimes: { 3: { empty: ['K'] } } });
  const history = makeHistory({ seed: 6 });
  const leagueBefore = JSON.stringify(league);
  const historyBefore = JSON.stringify(history);
  const a = derive(league, history, { now: NOW });
  const b = derive(clone(league), clone(history), { now: new Date(NOW.getTime()) });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(league), leagueBefore);
  assert.equal(JSON.stringify(history), historyBefore);
  assert.deepEqual(clone(a), a, 'the model is plain JSON');
});

test('lines hold still all week', () => {
  const league = makeLeague({ seed: 61, weekState: 'pre' });
  const history = makeHistory({ seed: 6 });
  const monday = derive(league, history, { now: NOW });
  // Sunday afternoon: same week, games in progress.
  const sunday = clone(league);
  for (const m of sunday.matchups) {
    if (m.week !== 10) continue;
    m.home.points = 61.3 + m.home.teamId;
    m.away.points = 58.9 + m.away.teamId;
  }
  const later = derive(sunday, history, { now: new Date('2026-11-15T20:00:00Z') });
  assert.equal(later.meta.weekStatus, 'live');
  for (const id of monday.order) {
    assert.equal(later.teams[id].roast.arrival, monday.teams[id].roast.arrival);
    assert.equal(later.teams[id].roast.sign, monday.teams[id].roast.sign);
  }
  assert.deepEqual(later.headlines.filter((h) => h.kind !== 'forecast'), monday.headlines.filter((h) => h.kind !== 'forecast'));
  assert.equal(later.blimp, monday.blimp);
});

test('different weeks give different lines', () => {
  let changed = 0;
  let total = 0;
  for (const seed of [62, 63, 64]) {
    const a = derive(makeLeague({ seed, currentWeek: 9 }), null, { now: NOW });
    const b = derive(makeLeague({ seed, currentWeek: 10 }), null, { now: NOW });
    for (const id of a.order) {
      total++;
      if (a.teams[id].roast.arrival !== b.teams[id].roast.arrival) changed++;
    }
    assert.notEqual(a.blimp, b.blimp);
    assert.notDeepEqual(a.headlines.map((h) => h.headline), b.headlines.map((h) => h.headline));
  }
  assert.ok(changed / total > 0.8, `only ${changed} of ${total} arrival lines changed week to week`);

  // Same standings, different week number: the seed alone moves the generic lines.
  const league = makeLeague({ seed: 65, currentWeek: 1, weekState: 'pre' });
  const other = clone(league);
  other.league.season = 2027;
  const x = derive(league, null, { now: NOW });
  const y = derive(other, null, { now: NOW });
  assert.ok(x.order.filter((id) => x.teams[id].roast.arrival !== y.teams[id].roast.arrival).length >= 6);
});

test('no two teams are handed the same arrival line', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const currentWeek = 1 + (seed % 17);
    const league = makeLeague({ seed, currentWeek, weekState: ['pre', 'live', 'final'][seed % 3], seasonComplete: seed % 20 === 0 });
    const model = derive(league, seed % 2 ? makeHistory({ seed: 3 }) : null, { now: NOW });
    const lines = model.order.map((id) => model.teams[id].roast.arrival);
    assert.equal(new Set(lines).size, lines.length, `seed ${seed} week ${currentWeek}:\n${lines.join('\n')}`);
  }
});

// ---------------------------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------------------------

test('copy stays inside its limits and stays clean across a few hundred leagues', () => {
  const sizes = [[12, 6], [10, 4], [8, 4], [14, 7], [11, 6]];
  const histories = new Map();
  const historyFor = (teamCount, playoffTeamCount, names) => {
    const key = `${teamCount}:${names ? 'real' : 'plain'}`;
    if (!histories.has(key)) histories.set(key, makeHistory({ seed: 8, teamCount, playoffTeamCount, names }));
    return histories.get(key);
  };
  let count = 0;
  const kinds = new Set();
  for (let seed = 1; seed <= 320; seed++) {
    const [teamCount, playoffTeamCount] = sizes[seed % sizes.length];
    const names = seed % 2 && teamCount <= 12 ? REAL_NAMES : undefined;
    const opts = {
      seed,
      teamCount,
      playoffTeamCount,
      names,
      currentWeek: 1 + ((seed * 7) % 17),
      weekState: ['pre', 'live', 'final'][seed % 3],
      seasonComplete: seed % 23 === 0,
      seeds: seed % 11 === 0 ? 'missing' : 'ok',
      rosters: seed % 7 !== 0,
      projections: seed % 5 !== 0,
      lineups: seed % 6 !== 0,
      crimes: {
        [1 + (seed % teamCount)]: { empty: ['FLEX'] },
        [1 + ((seed * 3) % teamCount)]: { bad: [{ name: 'Amon-Ra St. Brown', why: ['OUT', 'IR', 'BYE', 'SUSPENDED'][seed % 4] }], ir: ['One Guy', 'Two Guy', 'Three Guy'] },
        [1 + ((seed * 5) % teamCount)]: { ir: ['Lonely Guy'] },
      },
    };
    const league = makeLeague(opts);
    const history = seed % 4 === 0 ? null : historyFor(teamCount, playoffTeamCount, names);
    const model = derive(league, history, { now: new Date(Date.parse('2026-09-01T00:00:00Z') + seed * 5 * 3600e3) });
    checkShape(model);
    checkCopy(model, `seed ${seed} ${JSON.stringify({ teamCount, week: opts.currentWeek, state: opts.weekState, phase: model.meta.phase })}`);
    for (const h of model.headlines) kinds.add(h.kind);
    count++;
  }
  assert.equal(count, 320);
  // The paper has range.
  for (const kind of ['blowout', 'heartbreaker', 'bench', 'streak', 'throne', 'move', 'toilet', 'spotlight', 'forecast', 'history', 'champion', 'playoff', 'opener']) {
    assert.ok(kinds.has(kind), `no "${kind}" story in 320 leagues`);
  }
});

test('the real team names read cleanly with no owner first names', () => {
  const exact = [
    'Your Commishness', 'Multiple Scoregasms', "zach's Honorable Team", '\u{1F525}Stafford_Pukas_Lounge\u{1F525}', 'The REAL Commish***',
    'ROME AND DIGGS IN MY FIELDS', '1ST n Goal', 'On C0k3r w Brown Nabers', 'Packer Cracker',
  ];
  assert.deepEqual(REAL_NAMES.slice(0, 9).map((n) => n.name), exact);
  assert.ok(REAL_NAMES.slice(0, 9).every((n) => n.owner === ''));
  assert.equal('ROME AND DIGGS IN MY FIELDS'.length, 27);

  const seen = Object.fromEntries(exact.map((n) => [n, { mailbox: 0, paper: 0, subject: 0 }]));
  const histories = [
    makeHistory({ seed: 9, names: REAL_NAMES }),
    makeHistory({ seed: 8, names: REAL_NAMES, seasons: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] }),
  ];
  for (let seed = 1; seed <= 400; seed++) {
    const history = histories[seed % 2];
    const league = makeLeague({
      seed,
      names: REAL_NAMES,
      currentWeek: 1 + ((seed * 5) % 17),
      weekState: ['pre', 'live', 'final'][seed % 3],
      seasonComplete: seed % 29 === 0,
      crimes: { [1 + (seed % 12)]: { empty: ['D/ST'] }, [1 + ((seed * 3) % 12)]: { bad: [{ name: 'Amon-Ra St. Brown', why: 'OUT' }], ir: ['One Guy', 'Two Guy', 'Three Guy'] } },
    });
    const model = derive(league, seed % 5 === 0 ? null : history, { now: NOW });
    checkCopy(model, `real names, seed ${seed}`);
    for (const { where, text } of allCopy(model)) {
      // A 27 character name always goes in whole: nothing is ever clipped to make a line fit.
      assert.ok(!text.includes(ELLIPSIS), `clipped name at ${where}: ${text}`);
      for (const name of exact) {
        if (!text.includes(name)) continue;
        if (where.startsWith('mailbox')) seen[name].mailbox++;
        if (where.startsWith('headline') || where.startsWith('body')) seen[name].paper++;
        if (text.startsWith(`${name} is `)) seen[name].subject++;
      }
      // Arrival lines are second person and never name the member they are talking to.
      if (where.startsWith('arrival')) {
        const id = Number(where.split(' ')[1]);
        assert.ok(!text.includes(model.teams[id].name), `arrival names its own team: ${text}`);
      }
      if (where.startsWith('sign')) for (const name of exact) assert.ok(!text.includes(name), `sign carries a team name: ${text}`);
    }
    // Team names are data: never upper-cased, trimmed or otherwise edited outside the blimp.
    for (const h of model.headlines) {
      for (const id of h.teamIds) {
        const t = model.teams[id];
        const label = t.owner || t.name;
        assert.ok(h.headline.includes(label) || h.body.includes(label), `story does not name team ${id}: ${h.headline} / ${h.body}`);
      }
    }
  }
  for (const name of exact) {
    assert.ok(seen[name].mailbox > 20, `${name} rarely shows up on mailbox cards (${seen[name].mailbox})`);
    assert.ok(seen[name].paper > 20, `${name} rarely makes the paper (${seen[name].paper})`);
    assert.ok(seen[name].subject > 0, `"${name} is ..." never appears`);
  }
});

test('long and hostile team names cannot break the limits', () => {
  const names = [
    { name: 'X'.repeat(60), owner: '' },
    { name: `Dash ${EM_DASH} Lovers`, owner: '' },
    { name: 'null undefined NaN', owner: '' },
    { name: ['\u{1F468}', '\u{1F469}', '\u{1F467}', '\u{1F466}'].join(String.fromCharCode(0x200d)).repeat(8), owner: '' },
    { name: '<script>alert(1)</script>', owner: '' },
    { name: '   ', owner: '   ' },
    { name: 'Same Name', owner: 'Chris' },
    { name: 'Same Name', owner: 'Chris' },
    { name: 'Line\nBreak\tTeam', owner: '' },
    { name: "It's Always Sunny's", owner: '' },
    { name: 'Ends With Period.', owner: '' },
    { name: '$& $1 \\ `${x}`', owner: '' },
  ];
  for (let seed = 1; seed <= 40; seed++) {
    const league = makeLeague({ seed, names, currentWeek: 2 + (seed % 15), weekState: ['pre', 'live', 'final'][seed % 3] });
    const model = derive(league, makeHistory({ seed: 2, names }), { now: NOW });
    checkShape(model);
    for (const { where, text, limit } of allCopy(model)) {
      assert.ok(text.length > 0 && text.length <= limit, `${where}: ${text.length} > ${limit}: ${text}`);
      assert.ok(!/[\n\t]/.test(text), `control character at ${where}`);
    }
    // Two owners called Chris: the copy falls back to team names so nobody is confused.
    assert.equal(model.teams[6].name, 'Team 6', 'a blank name gets a placeholder');
    assert.equal(model.teams[9].name, 'Line Break Team');
  }
});

test('arrival lines use real numbers from the data', () => {
  let withNumbers = 0;
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const model = derive(makeLeague({ seed, currentWeek: 4 + (seed % 10) }), makeHistory({ seed: 4 }), { now: NOW });
    for (const id of model.order) {
      total++;
      if (/\d/.test(model.teams[id].roast.arrival)) withNumbers++;
    }
  }
  assert.ok(withNumbers / total > 0.75, `only ${withNumbers} of ${total} arrival lines carry a number`);
});

test('special cases take priority when the data says something specific', () => {
  // First place by a mile, a long losing streak, and an empty starting slot.
  const league = makeLeague({
    seed: 70,
    currentWeek: 10,
    scoreFor: (week, id, base) => (id === 1 ? 400 : id === 2 ? 1 : base),
    crimes: { 5: { empty: ['QB'] } },
  });
  const model = derive(league, null, { now: NOW });
  assert.equal(model.teams[1].rank, 1);
  assert.equal(model.teams[2].rank, 12);
  assert.match(model.teams[1].roast.arrival, /9|games|flamingo|row|straight/);
  assert.match(model.teams[2].roast.arrival, /9|0-9|last|Last|toilet|losses|row/);
  assert.match(model.teams[5].roast.arrival, /QB/);
  assert.equal(model.teams[5].roast.mailbox.at(-1).includes('QB'), true);

  // The toilet holder hears about it somewhere on their card or their arrival.
  const holder = model.teams[model.lastWeek.lowScoreId];
  assert.ok([holder.roast.arrival, holder.roast.sign, ...holder.roast.mailbox].some((s) => /toilet|Toilet|lowest|Nobody scored less/.test(s)));
});

// ---------------------------------------------------------------------------------------------
// The paper
// ---------------------------------------------------------------------------------------------

function scripted(scores, extra = {}) {
  // Week 9 is the last completed week. `scores` maps team id to its Week 9 score.
  return makeLeague({
    seed: 80,
    currentWeek: 10,
    scoreFor: (week, id, base) => (week === 9 && id in scores ? scores[id] : week === 9 ? 100 + id : base),
    ...extra,
  });
}

test('the paper runs 4 to 6 stories from the last completed week, lead story first', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const model = derive(makeLeague({ seed, currentWeek: 3 + (seed % 12), weekState: ['pre', 'live', 'final'][seed % 3] }), null, { now: NOW });
    const stories = model.headlines.filter((h) => h.kind !== 'forecast' && h.kind !== 'history');
    assert.ok(stories.length >= 4 && stories.length <= 6, `seed ${seed}: ${stories.length} stories`);
    for (const h of model.headlines) {
      assert.deepEqual(Object.keys(h), ['id', 'kind', 'headline', 'body', 'teamIds']);
    }
  }
});

test('a one-point heartbreaker leads the paper', () => {
  const league = scripted({});
  const game = league.matchups.find((m) => m.week === 9);
  const [a, b] = [game.home.teamId, game.away.teamId];
  const model = derive(scripted({ [a]: 120.52, [b]: 120.1 }, { lineups: false }), null, { now: NOW });
  const lead = model.headlines[0];
  assert.equal(lead.kind, 'heartbreaker');
  assert.deepEqual(lead.teamIds.slice().sort(), [a, b].sort());
  assert.ok(lead.headline.includes('0.42') || lead.body.includes('0.42'), `${lead.headline} / ${lead.body}`);
  assert.ok(model.blimp.includes('0.42'), model.blimp);
});

test('a huge blowout leads the paper', () => {
  const league = scripted({});
  const game = league.matchups.find((m) => m.week === 9);
  const [a, b] = [game.home.teamId, game.away.teamId];
  const model = derive(scripted({ [a]: 190.3, [b]: 61.1 }, { lineups: false }), null, { now: NOW });
  const lead = model.headlines[0];
  assert.equal(lead.kind, 'blowout');
  assert.ok(lead.headline.includes('129.2') || lead.body.includes('129.2'), `${lead.headline} / ${lead.body}`);
  assert.equal(model.lastWeek.lowScoreId, b);
  assert.equal(model.lastWeek.highScoreId, a);
});

test('the bench blunder: a loser whose bench outscored the margin', () => {
  const league = scripted({});
  const game = league.matchups.find((m) => m.week === 9);
  const [a, b] = [game.home.teamId, game.away.teamId];
  const withBench = scripted({ [a]: 110, [b]: 104 });
  for (const id of Object.keys(withBench.lastWeekLineups.teams)) {
    withBench.lastWeekLineups.teams[id] = { benchTop: { name: 'Quiet Guy', pos: 'WR', points: 0.5 }, starterLow: { name: 'Fine Guy', pos: 'RB', points: 8 }, benchTotal: 10 };
  }
  withBench.lastWeekLineups.teams[b] = { benchTop: { name: 'Benched Star', pos: 'WR', points: 31.4 }, starterLow: { name: 'Sad Starter', pos: 'RB', points: 1.2 }, benchTotal: 64.3 };
  const model = derive(withBench, null, { now: NOW });
  const story = model.headlines.find((h) => h.kind === 'bench');
  assert.ok(story, model.headlines.map((h) => h.kind).join(','));
  assert.equal(story.teamIds[0], b);
  assert.ok(story.headline.includes('31.4') || story.body.includes('31.4'));
  assert.ok(story.body.includes('6.0'));
  assert.ok([model.teams[b].roast.arrival, ...model.teams[b].roast.mailbox].some((s) => s.includes('31.4')), 'the loser hears about it at home');

  // Bench points that would not have covered the gap are not a blunder.
  withBench.lastWeekLineups.teams[b].benchTop.points = 5.9;
  assert.ok(!derive(withBench, null, { now: NOW }).headlines.some((h) => h.kind === 'bench'));
  // Same position: the swap itself has to flip the result (12.0 for 9.0 gains 3, the gap was 6).
  withBench.lastWeekLineups.teams[b] = { benchTop: { name: 'Benched Star', pos: 'WR', points: 12 }, starterLow: { name: 'Sad Starter', pos: 'WR', points: 9 }, benchTotal: 20 };
  assert.ok(!derive(withBench, null, { now: NOW }).headlines.some((h) => h.kind === 'bench'));
  withBench.lastWeekLineups.teams[b].starterLow.points = 1.2;
  const swap = derive(withBench, null, { now: NOW });
  assert.ok(swap.headlines.some((h) => h.kind === 'bench'));
  assert.ok(swap.teams[b].roast.mailbox.filter((line) => /last week|Week 9/.test(line)).length <= 2);
  // Lineups for a different week are ignored.
  withBench.lastWeekLineups.teams[b].benchTop.points = 31.4;
  withBench.lastWeekLineups.week = 8;
  assert.ok(!derive(withBench, null, { now: NOW }).headlines.some((h) => h.kind === 'bench'));
});

test('first place changing hands and tier moves make the paper', () => {
  let throne = 0;
  let move = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const model = derive(makeLeague({ seed, currentWeek: 4 + (seed % 9) }), null, { now: NOW });
    const first = model.teams[model.order[0]];
    const story = model.headlines.find((h) => h.kind === 'throne');
    if (first.prevRank > 1) {
      throne++;
      assert.ok(story, `seed ${seed}: first place changed hands without a story`);
      assert.equal(story.teamIds[0], first.id);
    } else {
      assert.equal(story, undefined);
    }
    for (const h of model.headlines.filter((x) => x.kind === 'move')) {
      move++;
      assert.ok(model.teams[h.teamIds[0]].tierMove);
    }
  }
  assert.ok(throne > 3 && move > 10, `throne ${throne}, move ${move}`);
});

test('the forecast picks the closest projected matchup of the current week', () => {
  const league = makeLeague({ seed: 81, weekState: 'pre' });
  const model = derive(league, null, { now: NOW });
  const forecast = model.headlines.filter((h) => h.kind === 'forecast');
  assert.equal(forecast.length, 1);
  const closest = model.matchups.slice().sort((x, y) => Math.abs(x.homeProj - x.awayProj) - Math.abs(y.homeProj - y.awayProj))[0];
  assert.deepEqual(forecast[0].teamIds.slice().sort(), [closest.homeId, closest.awayId].sort());
  assert.equal(model.headlines.indexOf(forecast[0]) >= 4, true, 'the forecast runs after the stories');

  assert.ok(!derive(makeLeague({ seed: 81, projections: false }), null, { now: NOW }).headlines.some((h) => h.kind === 'forecast'));
  assert.ok(!derive(makeLeague({ seed: 81, weekState: 'final' }), null, { now: NOW }).headlines.some((h) => h.kind === 'forecast'));
});

test('on this week in league history appears when history has that week', () => {
  const history = makeHistory({ seed: 9 });
  const model = derive(makeLeague({ seed: 82, currentWeek: 10 }), history, { now: NOW });
  const item = model.headlines.find((h) => h.kind === 'history');
  assert.ok(item);
  assert.equal(item.headline, 'On This Week In League History');
  assert.match(item.body, /^Week 10, 20\d\d: /);
  assert.equal(model.headlines.at(-1), item);
  // A week number history never reached.
  const short = { ...history, seasons: history.seasons.map((s) => ({ ...s, games: s.games.filter((g) => g[0] !== 10) })) };
  assert.ok(!derive(makeLeague({ seed: 82, currentWeek: 10 }), short, { now: NOW }).headlines.some((h) => h.kind === 'history'));
});

test('the blimp is one short all-caps line', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const model = derive(makeLeague({ seed, names: REAL_NAMES, currentWeek: 1 + (seed % 17) }), null, { now: NOW });
    assert.ok(model.blimp.length > 0 && model.blimp.length <= 60, model.blimp);
    assert.equal(model.blimp, model.blimp.toUpperCase());
    assert.ok(!model.blimp.includes('\n'));
  }
});

// ---------------------------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------------------------

test('ordinal', () => {
  const want = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 9: '9th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 14: '14th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th', 112: '112th' };
  for (const [n, text] of Object.entries(want)) assert.equal(ordinal(Number(n)), text);
  assert.equal(ordinal('3'), '3rd');
  assert.equal(ordinal(undefined), '');
  assert.equal(ordinal(null), '');
  assert.equal(ordinal('x'), '');
});

test('tierWelcome has a line for every neighborhood', () => {
  const lines = TIER_ORDER.map((tier) => tierWelcome(tier));
  for (const line of lines) {
    assert.ok(line.length > 10 && line.length <= 90, line);
    assert.ok(!line.includes(EM_DASH));
  }
  assert.equal(new Set(lines).size, 5);
  assert.equal(tierWelcome('nowhere'), '');
  assert.equal(tierWelcome(undefined), '');
});

test('snapshot is small, JSON-safe and holds only what the recap needs', () => {
  const model = derive(makeLeague({ seed: 90 }), makeHistory({ seed: 9 }), { now: NOW });
  const snap = snapshot(model);
  assert.deepEqual(clone(snap), snap);
  assert.deepEqual(Object.keys(snap).sort(), ['generatedAt', 'season', 'teams', 'v', 'week']);
  assert.equal(snap.week, 10);
  assert.equal(snap.season, 2026);
  assert.equal(snap.generatedAt, model.meta.generatedAt);
  assert.equal(Object.keys(snap.teams).length, 12);
  for (const id of model.order) {
    const t = model.teams[id];
    assert.deepEqual(snap.teams[id], { rank: t.rank, tier: t.tier, record: t.record.text, trashBags: t.trashBags, toilet: t.trophy.toilet });
  }
  assert.ok(JSON.stringify(snap).length < 1500, 'a snapshot should be tiny');
  assert.deepEqual(snapshot(derive(null, null)).teams, {});
  assert.deepEqual(snapshot(null).teams, {});
});

test('recapChanges reports what changed for a member since their last visit', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const before = derive(makeLeague({ seed, currentWeek: 8 }), null, { now: NOW });
    const after = derive(makeLeague({ seed, currentWeek: 10 }), null, { now: NOW });
    const snap = clone(snapshot(before));
    for (const id of after.order) {
      const lines = recapChanges(snap, after, id);
      assert.ok(Array.isArray(lines) && lines.length <= 6);
      const text = lines.join(' ');
      const was = before.teams[id];
      const now = after.teams[id];
      for (const line of lines) {
        assert.ok(line.length > 0 && line.length <= 100, line);
        assert.ok(!line.includes(EM_DASH) && !/undefined|NaN|null/.test(line), line);
      }
      if (now.rank < was.rank) assert.ok(text.includes(`You climbed from ${ordinal(was.rank)} to ${ordinal(now.rank)}.`), text);
      if (now.rank > was.rank) assert.ok(text.includes(`You slid from ${ordinal(was.rank)} to ${ordinal(now.rank)}.`), text);
      if (now.tier !== was.tier) assert.match(text, /You moved up to|You have been relocated to/);
      assert.ok(text.includes(`Your record went from ${was.record.text} to ${now.record.text}.`), text);
      if (now.trophy.toilet && !was.trophy.toilet) assert.ok(text.includes('The golden toilet was delivered to your lawn.'), text);
      if (!now.trophy.toilet && was.trophy.toilet) assert.ok(text.includes('The golden toilet left your lawn.'), text);
      if (now.trashBags > was.trashBags) assert.match(text, /new trash bags? on your lawn/);
      if (now.trashBags < was.trashBags) assert.match(text, /garbage truck/);
    }
    // Nothing changed: nothing to say.
    for (const id of after.order) assert.deepEqual(recapChanges(snapshot(after), after, id), []);
  }
});

test('recapChanges mentions the neighbors and survives bad input', () => {
  const after = derive(makeLeague({ seed: 91, currentWeek: 10, names: REAL_NAMES }), null, { now: NOW });
  const snap = snapshot(after);
  const first = after.order[0];
  const last = after.order[11];
  const me = after.order[5];
  // Pretend the leader, the cellar and the toilet were all somewhere else last time.
  [snap.teams[first].rank, snap.teams[after.order[1]].rank] = [2, 1];
  snap.teams[last].tier = 'park';
  for (const id of after.order) snap.teams[id].toilet = false;
  const lines = recapChanges(snap, after, me);
  const label = (id) => after.teams[id].owner || after.teams[id].name;
  assert.ok(lines.includes(`${label(first)} took over the Hill.`), lines.join(' | '));
  assert.ok(lines.includes(`${label(last)} moved into the Dump.`), lines.join(' | '));
  const holder = after.lastWeek.lowScoreId;
  if (holder !== me) assert.ok(lines.includes(`${label(holder)} now has the golden toilet.`), lines.join(' | '));

  assert.deepEqual(recapChanges(null, after, me), []);
  assert.deepEqual(recapChanges({}, after, me), []);
  assert.deepEqual(recapChanges('junk', after, me), []);
  assert.deepEqual(recapChanges(snap, after, 999), []);
  assert.deepEqual(recapChanges(snap, null, me), []);
  assert.deepEqual(recapChanges({ v: 1, season: 2026, week: 9, teams: { [me]: {} } }, after, me).length >= 0, true);
  assert.deepEqual(recapChanges({ ...snap, season: 2025 }, after, me), ['New season. Last year has been forgiven. Not forgotten.']);
});

// ---------------------------------------------------------------------------------------------
// The data the sync job saved, when it is there
// ---------------------------------------------------------------------------------------------

test('the saved league data derives cleanly', (t) => {
  const leaguePath = fileURLToPath(new URL('../../world/data/league.json', import.meta.url));
  const historyPath = fileURLToPath(new URL('../../world/data/history.json', import.meta.url));
  if (!existsSync(leaguePath)) {
    t.skip('world/data/league.json does not exist yet');
    return;
  }
  const league = JSON.parse(readFileSync(leaguePath, 'utf8'));
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : null;
  const model = derive(league, history, { now: new Date(league.generatedAt || NOW) });
  checkShape(model);
  assert.equal(model.meta.teamCount, league.teams.length);
  assert.ok(model.meta.teamCount > 0);
  checkCopy(model, 'world/data');
  assert.deepEqual(derive(league, history, { now: new Date(league.generatedAt || NOW) }), model);
});
