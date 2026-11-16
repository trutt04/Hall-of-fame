import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../world/js/model/derive.js';
import { buildPlayoffs, buildGraveyard } from '../../world/js/model/extras.js';
import { makeLeague, makeHistory } from './model-fixtures/make-league.mjs';

const NOW = new Date('2026-11-16T12:00:00Z');
const seeds = (round) => round.games.map((g) => [g.a ? g.a.seed : null, g.b ? g.b.seed : null]);

function checkBracket(p, model) {
  assert.ok(['projected', 'live', 'final'].includes(p.state));
  assert.equal(typeof p.title, 'string');
  assert.equal(p.teams, model.cutLine);
  assert.equal(p.rounds.length, Math.ceil(Math.log2(p.teams)));
  assert.equal(p.rounds[p.rounds.length - 1].name, 'Championship');
  assert.equal(p.rounds[p.rounds.length - 1].games.length, 1);
  const field = new Set(model.order.slice(0, 0)); // filled below from seeds
  for (const round of p.rounds) {
    assert.equal(typeof round.name, 'string');
    for (const g of round.games) {
      for (const s of [g.a, g.b]) {
        if (s === null) continue;
        assert.ok(model.teams[s.teamId], 'a bracket side is a real team');
        assert.ok(s.seed >= 1 && s.seed <= p.teams, 'only playoff seeds are in the bracket');
        field.add(s.teamId);
      }
      assert.ok(['projected', 'pre', 'live', 'final'].includes(g.status));
      if (g.winnerId != null) assert.ok(g.a && g.b && (g.winnerId === g.a.teamId || g.winnerId === g.b.teamId));
      if (g.a && g.b) assert.ok(g.a.seed < g.b.seed, 'the better seed is listed first');
    }
    for (const b of round.byes) assert.ok(model.teams[b.teamId]);
  }
  // Nobody plays twice in a round.
  for (const round of p.rounds) {
    const ids = round.games.flatMap((g) => [g.a, g.b]).filter(Boolean).map((s) => s.teamId).concat(round.byes.map((b) => b.teamId));
    assert.equal(new Set(ids).size, ids.length, `${round.name}: a team appears once`);
  }
}

test('playoffs, regular season: "if the season ended today" from the current seeds', () => {
  const model = derive(makeLeague({ seed: 3, currentWeek: 10 }), makeHistory({ seed: 2 }), { now: NOW });
  const p = model.playoffs;
  checkBracket(p, model);
  assert.equal(p.state, 'projected');
  assert.equal(p.title, 'If the season ended today');
  assert.deepEqual(p.rounds.map((r) => r.name), ['Round 1', 'Semifinals', 'Championship']);
  assert.deepEqual(p.rounds.map((r) => r.week), [15, 16, 17]);
  assert.deepEqual(seeds(p.rounds[0]), [[3, 6], [4, 5]]);
  assert.deepEqual(p.rounds[0].byes.map((b) => b.seed), [1, 2]);
  assert.deepEqual(p.rounds[0].byes.map((b) => b.teamId), model.order.slice(0, 2));
  // The two rested teams are certain to be in the semifinals. Nothing else is guessed.
  assert.deepEqual(seeds(p.rounds[1]), [[1, null], [2, null]]);
  assert.deepEqual(seeds(p.rounds[2]), [[null, null]]);
  assert.ok(p.rounds.every((r) => r.games.every((g) => g.status === 'projected' && g.winnerId === null)));
  assert.equal(p.championId, null);
  assert.equal(p.bubble.lastIn, model.order[5]);
  assert.equal(p.bubble.firstOut, model.order[6]);
  assert.match(p.bubble.text, /^6th /);
  assert.ok(!p.bubble.text.includes('—'));
});

test('playoffs: other league shapes', () => {
  const shape = (teamCount, playoffTeamCount) => derive(makeLeague({ seed: 9, teamCount, playoffTeamCount, currentWeek: 8 }), null, { now: NOW });
  let m = shape(8, 4);
  checkBracket(m.playoffs, m);
  assert.deepEqual(m.playoffs.rounds.map((r) => r.name), ['Semifinals', 'Championship']);
  assert.deepEqual(seeds(m.playoffs.rounds[0]), [[1, 4], [2, 3]]);
  assert.deepEqual(m.playoffs.rounds[0].byes, []);
  m = shape(10, 4);
  checkBracket(m.playoffs, m);
  m = shape(14, 7);
  checkBracket(m.playoffs, m);
  assert.deepEqual(seeds(m.playoffs.rounds[0]), [[2, 7], [3, 6], [4, 5]]);
  assert.deepEqual(m.playoffs.rounds[0].byes.map((b) => b.seed), [1]);
  assert.deepEqual(seeds(m.playoffs.rounds[1]), [[null, null], [null, null]], 'one rested team, two games: nothing is certain');
  m = shape(12, 8);
  checkBracket(m.playoffs, m);
  assert.deepEqual(seeds(m.playoffs.rounds[0]), [[1, 8], [2, 7], [3, 6], [4, 5]]);
  m = shape(4, 2);
  checkBracket(m.playoffs, m);
  assert.deepEqual(m.playoffs.rounds.map((r) => r.name), ['Championship']);
  assert.deepEqual(seeds(m.playoffs.rounds[0]), [[1, 2]]);
  // Everyone makes it: there is no bubble to talk about.
  m = derive(makeLeague({ seed: 9, teamCount: 4, playoffTeamCount: 4, currentWeek: 8 }), null, { now: NOW });
  assert.equal(m.playoffs.bubble, null);
});

test('playoffs, under way: the listed games are the truth and winners move on', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    // Round 1 finished, semifinals in progress.
    const league = makeLeague({ seed, currentWeek: 16, weekState: 'live' });
    const model = derive(league, null, { now: NOW });
    const p = model.playoffs;
    checkBracket(p, model);
    assert.equal(model.meta.phase, 'playoffs');
    assert.equal(p.state, 'live');
    assert.equal(p.title, 'Playoffs');
    assert.equal(p.bubble, null);
    assert.equal(p.rounds[0].games.length, 2);
    assert.ok(p.rounds[0].games.every((g) => g.status === 'final' && g.winnerId != null));
    assert.equal(p.rounds[0].byes.length, 2);
    // The semifinals are the four teams still alive, exactly as the data lists them.
    const semi = p.rounds[1];
    assert.equal(semi.games.length, 2);
    const semiTeams = semi.games.flatMap((g) => [g.a.teamId, g.b.teamId]).sort();
    const expected = p.rounds[0].byes.map((b) => b.teamId).concat(p.rounds[0].games.map((g) => g.winnerId)).sort();
    assert.deepEqual(semiTeams, expected);
    const listed = league.matchups.filter((m) => m.week === 16 && m.bracket === 'WINNERS' && m.away);
    for (const g of semi.games) {
      const m = listed.find((x) => [x.home.teamId, x.away.teamId].includes(g.a.teamId) && [x.home.teamId, x.away.teamId].includes(g.b.teamId));
      assert.ok(m, 'each semifinal is a game ESPN lists');
      assert.equal(g.aPts, m.home.teamId === g.a.teamId ? m.home.points : m.away.points);
    }
    assert.deepEqual(seeds(p.rounds[2]), [[null, null]]);
    assert.equal(p.championId, null);
  }
});

test('playoffs, finished: a champion, and it matches the final standings', () => {
  for (const seed of [1, 2, 3]) {
    const model = derive(makeLeague({ seed, seasonComplete: true }), null, { now: NOW });
    const p = model.playoffs;
    checkBracket(p, model);
    assert.equal(p.state, 'final');
    assert.ok(p.rounds.every((r) => r.games.every((g) => g.status === 'final' && g.winnerId != null)));
    assert.equal(p.championId, p.rounds[2].games[0].winnerId);
    assert.equal(p.championId, model.order[0], 'the bracket winner is the team ranked first');
  }
});

test('playoffs: consolation games and games without a bracket tag never leak in', () => {
  const league = makeLeague({ seed: 4, currentWeek: 15, weekState: 'final' });
  // Some ESPN responses carry no bracket type. Normalizing then calls every playoff game WINNERS.
  for (const m of league.matchups) if (m.playoff) m.bracket = 'WINNERS';
  const model = derive(league, null, { now: NOW });
  const p = model.playoffs;
  checkBracket(p, model);
  assert.equal(p.rounds[0].games.length, 2, 'only games between playoff teams count');
});

test('playoffs: missing or broken input gives null, never an error', () => {
  assert.equal(buildPlayoffs({}), null);
  assert.equal(buildPlayoffs({ seeding: [1], P: 1 }), null);
  assert.equal(buildPlayoffs({ seeding: [1, 2, 3], P: 1 }), null);
  const p = buildPlayoffs({ seeding: [1, 2, 3, 4], P: 4, games: null, teams: null, phase: 'regular' });
  assert.equal(p.rounds.length, 2);
  assert.equal(derive({}, null, { now: NOW }).playoffs, null);
  assert.deepEqual(derive({}, null, { now: NOW }).graveyard, []);
});

function leagueWithDraft() {
  const league = makeLeague({ seed: 6, currentWeek: 10 });
  const [a, b, c] = league.teams;
  a.roster.starters = [{ name: 'Alive Starter', pos: 'QB', slot: 'QB', points: 10, projected: 12 }];
  a.roster.bench = [{ name: 'Alive Bench', pos: 'WR', slot: 'BE', points: 3, projected: 8 }];
  a.roster.ir = [{ name: 'Hurt Early', pos: 'RB' }];
  b.roster.starters = [{ name: 'Still Here', pos: 'RB', slot: 'RB', points: 9, projected: 11 }];
  b.roster.bench = [];
  b.roster.ir = [];
  c.roster = null; // roster view unavailable: say nothing about this team
  league.draft = [
    { round: 1, pick: 1, overall: 1, teamId: a.id, name: 'Alive Starter', pos: 'QB' },
    { round: 1, pick: 2, overall: 2, teamId: b.id, name: 'Dropped Early', pos: 'WR' },
    { round: 1, pick: 3, overall: 3, teamId: c.id, name: 'Unknown Fate', pos: 'RB' },
    { round: 2, pick: 1, overall: 13, teamId: a.id, name: 'hurt early', pos: 'RB' }, // case differs on purpose
    { round: 2, pick: 2, overall: 14, teamId: b.id, name: 'Still Here', pos: 'RB' },
    { round: 3, pick: 1, overall: 25, teamId: a.id, name: 'Alive Bench', pos: 'WR' },
    { round: 4, pick: 2, overall: 38, teamId: b.id, name: 'Dropped Later', pos: 'TE' },
    { round: 5, pick: 2, overall: 50, teamId: b.id, name: 'Dropped Third', pos: 'K' },
    { round: 16, pick: 1, overall: 181, teamId: a.id, name: 'Late Flier', pos: 'K' },
  ];
  return { league, a, b, c };
}

test('graveyard: early picks that left the team or sit on its IR, earliest first', () => {
  const { league, a, b } = leagueWithDraft();
  const model = derive(league, null, { now: NOW });
  const g = model.graveyard;
  assert.deepEqual(g.map((x) => x.name), ['Dropped Early', 'hurt early', 'Dropped Later']);
  assert.deepEqual(g.map((x) => x.cause), ['gone', 'ir', 'gone']);
  assert.deepEqual(g.map((x) => x.teamId), [b.id, a.id, b.id]);
  assert.equal(g[0].drafted, 'Round 1, pick 2');
  assert.equal(g[0].overall, 2);
  for (const x of g) {
    assert.ok(x.epitaph.length > 10 && x.epitaph.length <= 84, x.epitaph);
    assert.ok(!/undefined|NaN|null|—/.test(x.epitaph), x.epitaph);
  }
  assert.equal(new Set(g.map((x) => x.epitaph)).size, g.length, 'no two stones say the same thing');
  // Same data, same stones.
  assert.deepEqual(derive(league, null, { now: NOW }).graveyard, g);
});

test('graveyard: limits, late rounds and missing data', () => {
  const { league, b } = leagueWithDraft();
  // No more than two stones for one team, and never more than eight in all.
  assert.ok(derive(league, null, { now: NOW }).graveyard.filter((x) => x.teamId === b.id).length <= 2);
  const many = makeLeague({ seed: 6, currentWeek: 10 });
  many.draft = [];
  let overall = 0;
  for (let round = 1; round <= 4; round++) {
    for (const t of many.teams) many.draft.push({ round, pick: (overall % 12) + 1, overall: ++overall, teamId: t.id, name: `Cut ${t.id}-${round}`, pos: 'RB' });
  }
  const full = derive(many, null, { now: NOW }).graveyard;
  assert.equal(full.length, 8);
  assert.deepEqual(full.map((x) => x.overall), [1, 2, 3, 4, 5, 6, 7, 8]);
  // A late-round flier that got cut is not a bust.
  const late = makeLeague({ seed: 6, currentWeek: 10 });
  late.draft = [{ round: 1, pick: 1, overall: 1, teamId: late.teams[0].id, name: 'x', pos: 'K' }];
  for (let round = 2; round <= 16; round++) late.draft.push({ round, pick: 1, overall: round * 12, teamId: late.teams[0].id, name: `Late ${round}`, pos: 'K' });
  assert.ok(derive(late, null, { now: NOW }).graveyard.every((x) => x.round <= 8));
  // No draft, no rosters, preseason, garbage.
  const none = makeLeague({ seed: 6, currentWeek: 10 });
  delete none.draft;
  assert.deepEqual(derive(none, null, { now: NOW }).graveyard, []);
  const noRosters = makeLeague({ seed: 6, currentWeek: 10, rosters: false });
  noRosters.draft = [{ round: 1, pick: 1, overall: 1, teamId: noRosters.teams[0].id, name: 'Somebody', pos: 'QB' }];
  assert.deepEqual(derive(noRosters, null, { now: NOW }).graveyard, []);
  assert.deepEqual(buildGraveyard(null, null), []);
  assert.deepEqual(buildGraveyard({ teams: 'x', draft: [null, 3, { round: 'a' }] }, { week: 3 }), []);
  const pre = makeLeague({ seed: 6, currentWeek: 1, weekState: 'pre' });
  pre.draft = [{ round: 1, pick: 1, overall: 1, teamId: pre.teams[0].id, name: 'Nobody Yet', pos: 'QB' }];
  assert.deepEqual(derive(pre, null, { now: new Date('2026-08-20T00:00:00Z') }).graveyard, []);
});

test('the saved sample data has a playoff picture and a few headstones', async () => {
  const fs = await import('node:fs');
  const league = JSON.parse(fs.readFileSync(new URL('../../world/data/league.json', import.meta.url), 'utf8'));
  const history = JSON.parse(fs.readFileSync(new URL('../../world/data/history.json', import.meta.url), 'utf8'));
  const model = derive(league, history, { now: NOW });
  assert.ok(model.playoffs && model.playoffs.rounds.length >= 1);
  assert.ok(Array.isArray(model.graveyard));
  if (league.source !== 'espn') assert.ok(model.graveyard.length >= 3, 'the sample graveyard is not empty');
});
