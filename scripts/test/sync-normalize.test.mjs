// Tests for scripts/lib/normalize.mjs: raw ESPN JSON in, league.json / history.json shapes out.
// Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHistory, byeTeamsForPeriod, cleanText, findLeaks, firstNameOnly, lastCompletedWeek, lineupRequestFor,
  normalizeKickoffs, normalizeLeague, normalizeSeason, isSeasonComplete, ownerKeyFor, round2, statFor,
  validate, validateHistory, validateSeason,
} from '../lib/normalize.mjs';
import { REAL_TEAMS } from '../make-fixture.mjs';
import { LEAGUE_ID, NOW, PAST_YEARS, SEASON, loadFixture, rawSeason } from '../testing/helpers.mjs';

const GUID_PATTERN = /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/;

const league = normalizeLeague(rawSeason(), { source: 'placeholder', generatedAt: NOW });
const history = buildHistory(PAST_YEARS.map((y) => normalizeSeason(loadFixture(`espn-${y}.json`))), { source: 'placeholder', generatedAt: NOW });
const teamById = new Map(league.teams.map((t) => [t.id, t]));

/** Records recomputed from the matchups, so the tests do not just echo the team fields. */
function standingsFromMatchups(lg, throughWeek = Infinity) {
  const rows = new Map(lg.teams.map((t) => [t.id, { id: t.id, wins: 0, losses: 0, pf: 0, pa: 0, results: [] }]));
  for (const m of lg.matchups) {
    if (!m.away || m.winner === 'undecided' || m.week > throughWeek) continue;
    const home = rows.get(m.home.teamId);
    const away = rows.get(m.away.teamId);
    home.pf += m.home.points;
    home.pa += m.away.points;
    away.pf += m.away.points;
    away.pa += m.home.points;
    const homeWon = m.winner === 'home';
    (homeWon ? home : away).wins++;
    (homeWon ? away : home).losses++;
    home.results.push(homeWon ? 'W' : 'L');
    away.results.push(homeWon ? 'L' : 'W');
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

const tierOf = (rank) => (rank === 1 ? 'hill' : rank <= 4 ? 'heights' : rank <= 8 ? 'bubble' : rank <= 11 ? 'park' : 'dump');

// ---------------------------------------------------------------------------------------
// The placeholder fixture through the real normalize path
// ---------------------------------------------------------------------------------------

test('fixture: top level follows Contract 1', () => {
  assert.deepEqual(Object.keys(league), ['schema', 'source', 'generatedAt', 'league', 'teams', 'matchups', 'lastWeekLineups', 'draft', 'nfl']);
  assert.equal(league.schema, 1);
  assert.equal(league.source, 'placeholder');
  assert.equal(league.generatedAt, '2026-11-16T15:00:00Z');
  assert.deepEqual(league.league, {
    id: LEAGUE_ID,
    name: "Dan's Real Cool League",
    season: SEASON,
    isPublic: false,
    teamCount: 12,
    regularSeasonWeeks: 14,
    playoffTeamCount: 6,
    currentWeek: 10,
    scoringPeriod: 10,
    finalScoringPeriod: 17,
    seasonComplete: false,
    scoringType: 'PPR',
    starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, 'D/ST': 1, K: 1 },
  });
  assert.deepEqual(validate(league, { leagueId: LEAGUE_ID, season: SEASON }), []);
});

test('fixture: every team has exactly the contract fields with the right types', () => {
  const keys = ['id', 'name', 'abbrev', 'owner', 'ownerKey', 'seed', 'finalRank', 'wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst', 'streakType', 'streakLength', 'moves', 'roster'];
  assert.equal(league.teams.length, 12);
  for (const t of league.teams) {
    assert.deepEqual(Object.keys(t), keys);
    assert.ok(Number.isInteger(t.id));
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.abbrev, 'string');
    assert.match(t.ownerKey, /^o_[0-9a-f]{8}$/);
    assert.deepEqual(Object.keys(t.moves), ['acquisitions', 'drops', 'trades']);
    assert.deepEqual(Object.keys(t.roster), ['ir', 'emptyStarters', 'badStarters', 'starters', 'bench']);
    for (const p of [...t.roster.starters, ...t.roster.bench]) {
      assert.deepEqual(Object.keys(p), ['name', 'pos', 'slot', 'points', 'projected']);
      assert.equal(typeof p.points, 'number');
    }
  }
  assert.equal(new Set(league.teams.map((t) => t.ownerKey)).size, 12);
});

test('fixture: the real standings come through exactly (names, abbrevs, seeds, records, streaks)', () => {
  assert.deepEqual(league.teams.map((t) => t.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const real of REAL_TEAMS) {
    const t = teamById.get(real.id);
    assert.equal(t.name, real.name);
    assert.equal(t.abbrev, real.abbrev);
    assert.equal(t.seed, real.seed);
    assert.equal(t.wins, real.wins);
    assert.equal(t.losses, real.losses);
    assert.equal(t.ties, 0);
    assert.equal(t.pointsFor, real.pf);
    assert.equal(t.pointsAgainst, real.pa);
    assert.equal(t.streakType, real.streak[0]);
    assert.equal(t.streakLength, real.streak[1]);
    assert.equal(t.finalRank, 0);
  }
  // Spot checks typed by hand from the owner's table, independent of the generator's constants.
  assert.deepEqual(
    [10, 6, 5, 2, 9, 11, 1, 3, 12, 4, 7, 8].map((id) => teamById.get(id).seed),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(teamById.get(10).pointsFor, 1344.5);
  assert.equal(teamById.get(7).pointsAgainst, 1316.7);
  assert.equal(teamById.get(4).streakLength, 7);
});

test('fixture: odd names and abbreviations survive untouched (emoji, symbols, "1", "Bye")', () => {
  assert.equal(teamById.get(11).name, '🔥Stafford_Pukas_Lounge🔥');
  assert.equal(teamById.get(1).name, 'The REAL Commish***');
  assert.equal(teamById.get(2).name, "zach's Honorable Team");
  assert.equal(teamById.get(10).abbrev, '1');
  assert.equal(teamById.get(8).abbrev, 'Bye');
  assert.equal(teamById.get(12).abbrev, 'Haha');
});

test('fixture: owner is a first name only, and empty when ESPN gave none', () => {
  assert.equal(teamById.get(1).owner, 'Dan');
  assert.equal(teamById.get(5).owner, 'Shane');
  assert.equal(teamById.get(12).owner, 'Tim');
  for (const id of [2, 3, 4, 6, 7, 8, 9, 10, 11]) assert.equal(teamById.get(id).owner, '');
  for (const t of league.teams) assert.doesNotMatch(t.owner, /\s/);
});

test('fixture: nothing private or logo-like leaks into league.json or history.json', () => {
  // The raw fixture really does contain these, so this proves they are stripped.
  const rawText = JSON.stringify(rawSeason().main);
  assert.match(rawText, /"logo"/);
  assert.match(rawText, /lastName/);
  assert.match(rawText, GUID_PATTERN);
  assert.match(rawText, /placeholder_member_01/);

  for (const text of [JSON.stringify(league), JSON.stringify(history)]) {
    assert.doesNotMatch(text, /logo/i);
    assert.doesNotMatch(text, /lastName/i);
    assert.doesNotMatch(text, /displayName/i);
    assert.doesNotMatch(text, GUID_PATTERN);
    assert.doesNotMatch(text, /\{[0-9A-F]{8}-/);
    assert.doesNotMatch(text, /Placeholder/); // the fake last name every fixture member has
    assert.doesNotMatch(text, /placeholder_member/);
    assert.doesNotMatch(text, /example\.invalid|espncdn|https?:/);
    assert.doesNotMatch(text, /primaryOwner|memberId|"owners"/);
  }
  assert.deepEqual(findLeaks(league), []);
  assert.deepEqual(findLeaks(history), []);
});

test('fixture: records, streaks and seeds are consistent with the generated games', () => {
  const table = standingsFromMatchups(league);
  table.forEach((row, i) => {
    const t = teamById.get(row.id);
    assert.equal(row.wins, t.wins, `wins for team ${row.id}`);
    assert.equal(row.losses, t.losses, `losses for team ${row.id}`);
    assert.equal(t.seed, i + 1, `seed for team ${row.id} (wins, then points for)`);
    assert.equal(round2(row.pf), t.pointsFor, `points for, team ${row.id}`);
    assert.ok(Math.abs(row.pa - t.pointsAgainst) <= 0.0101, `points against within a cent, team ${row.id}`);
    const last = row.results.at(-1);
    let run = 0;
    for (let k = row.results.length - 1; k >= 0 && row.results[k] === last; k--) run++;
    assert.equal(last === 'W' ? 'WIN' : 'LOSS', t.streakType);
    assert.equal(run, t.streakLength, `streak for team ${row.id}`);
  });
});

test('fixture: matchups cover the season, weeks 1-9 final, week 10 live, the rest unplayed', () => {
  assert.equal(league.matchups.length, 14 * 6);
  for (const m of league.matchups) {
    assert.deepEqual(Object.keys(m), ['week', 'playoff', 'bracket', 'home', 'away', 'winner']);
    assert.equal(m.playoff, false);
    assert.equal(m.bracket, 'NONE');
    if (m.week <= 9) {
      assert.ok(m.winner === 'home' || m.winner === 'away');
      assert.equal(m.home.projected, null);
      assert.ok(m.home.points >= 60 && m.home.points <= 190 && m.away.points >= 60 && m.away.points <= 190);
      assert.equal(m.winner === 'home', m.home.points > m.away.points);
    } else {
      assert.equal(m.winner, 'undecided');
    }
    if (m.week === 10) {
      assert.ok(m.home.points > 0 && m.away.points > 0);
      assert.ok(m.home.projected >= m.home.points && m.away.projected >= m.away.points);
    }
    if (m.week > 10) assert.deepEqual([m.home.points, m.away.points, m.home.projected], [0, 0, null]);
  }
  // Each week every team plays exactly once, and weeks 1-11 are a full round robin.
  const seen = new Set();
  for (let week = 1; week <= 14; week++) {
    const ids = league.matchups.filter((m) => m.week === week).flatMap((m) => [m.home.teamId, m.away.teamId]);
    assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  }
  for (const m of league.matchups.filter((x) => x.week <= 11)) seen.add([m.home.teamId, m.away.teamId].sort((a, b) => a - b).join('-'));
  assert.equal(seen.size, 66);
  assert.equal(lastCompletedWeek(league.matchups), 9);
  // Live points are the sum of the starters who have played.
  for (const m of league.matchups.filter((x) => x.week === 10)) {
    for (const side of [m.home, m.away]) {
      const starters = teamById.get(side.teamId).roster.starters;
      assert.equal(round2(starters.reduce((s, p) => s + p.points, 0)), side.points);
    }
  }
});

test('fixture: week 9 has a blowout, a nail-biter, and a loser who benched 30+', () => {
  const week9 = league.matchups.filter((m) => m.week === 9);
  const margins = week9.map((m) => Math.abs(m.home.points - m.away.points));
  assert.ok(Math.max(...margins) >= 50, 'a 50+ blowout');
  const close = week9.filter((m) => Math.abs(m.home.points - m.away.points) < 2);
  assert.ok(close.length >= 1, 'a game decided by under 2');
  const benchedBig = close.some((m) => {
    const loser = m.winner === 'home' ? m.away : m.home;
    return league.lastWeekLineups.teams[String(loser.teamId)].benchTop.points >= 30;
  });
  assert.ok(benchedBig, 'a nail-biter loser left 30+ on the bench');
});

test('fixture: at least two teams change tier between the week 8 and week 9 standings', () => {
  const before = standingsFromMatchups(league, 8).map((r) => r.id);
  const after = standingsFromMatchups(league, 9).map((r) => r.id);
  const moved = after.filter((id, i) => tierOf(i + 1) !== tierOf(before.indexOf(id) + 1));
  assert.ok(moved.length >= 2, `tier changes: ${moved.join(', ')}`);
});

test('fixture: roster storylines (IR, empty FLEX, a starter who is OUT)', () => {
  assert.equal(teamById.get(4).roster.ir.length, 2);
  assert.equal(teamById.get(6).roster.ir.length, 1);
  assert.deepEqual(teamById.get(8).roster.emptyStarters, ['FLEX']);
  assert.equal(teamById.get(8).roster.starters.length, 8);
  const bad = teamById.get(7).roster.badStarters;
  assert.equal(bad.length, 1);
  assert.equal(bad[0].why, 'OUT');
  assert.deepEqual(Object.keys(bad[0]), ['name', 'pos', 'slot', 'why']);
  assert.ok(teamById.get(7).roster.starters.some((p) => p.name === bad[0].name && p.points === 0));
  for (const t of league.teams) {
    if (t.id !== 4 && t.id !== 6) assert.equal(t.roster.ir.length, 0);
    if (t.id !== 8) assert.deepEqual(t.roster.emptyStarters, []);
    if (t.id !== 7) assert.deepEqual(t.roster.badStarters, []);
    assert.equal(t.roster.bench.length, 7);
    assert.deepEqual(t.roster.starters.map((p) => p.slot), t.id === 8 ? ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'D/ST', 'K'] : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'D/ST', 'K']);
    assert.ok(t.roster.bench.every((p) => p.slot === 'BE'));
  }
  // Monday night players have not scored yet but carry a projection.
  const waiting = league.teams.flatMap((t) => t.roster.starters).filter((p) => p.points === 0 && p.projected > 0);
  assert.ok(waiting.length >= 5);
});

test('fixture: last week lineups, draft and kickoffs', () => {
  const lw = league.lastWeekLineups;
  assert.equal(lw.week, 9);
  assert.equal(Object.keys(lw.teams).length, 12);
  for (const row of Object.values(lw.teams)) {
    assert.deepEqual(Object.keys(row), ['benchTop', 'starterLow', 'benchTotal']);
    assert.deepEqual(Object.keys(row.benchTop), ['name', 'pos', 'points']);
    assert.ok(row.benchTotal >= row.benchTop.points);
  }
  // Week 9 starters add up to the week 9 score.
  const raw = rawSeason().lineups;
  for (const m of raw.schedule.filter((x) => x.matchupPeriodId === 9)) {
    for (const side of [m.home, m.away]) {
      const starters = side.rosterForCurrentScoringPeriod.entries.filter((e) => e.lineupSlotId !== 20 && e.lineupSlotId !== 21);
      const sum = starters.reduce((s, e) => s + statFor(e.playerPoolEntry.player, 9, 0), 0);
      assert.equal(round2(sum), side.totalPoints);
    }
  }

  assert.equal(league.draft.length, 16 * 12);
  assert.deepEqual(Object.keys(league.draft[0]), ['round', 'pick', 'overall', 'teamId', 'name', 'pos']);
  assert.deepEqual(league.draft.map((p) => p.overall), Array.from({ length: 192 }, (_, i) => i + 1));
  for (const t of league.teams) assert.equal(league.draft.filter((p) => p.teamId === t.id).length, 16);
  assert.ok(league.draft.every((p) => p.name && ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].includes(p.pos)));

  const k = league.nfl.kickoffs;
  assert.equal(league.nfl.source, 'placeholder');
  assert.deepEqual(k, [...new Set(k)].sort());
  assert.ok(k.every((s) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)));
  assert.equal(k[0], '2026-09-11T00:15:00Z'); // Thursday Sept 10, 8:15pm Eastern (daylight time)
  assert.ok(k.includes('2026-11-13T01:15:00Z')); // Thursday Nov 12, 8:15pm Eastern (standard time)
  assert.ok(k.includes('2026-11-17T01:15:00Z')); // the pending Monday night game
  for (const thanksgiving of ['2026-11-26T17:30:00Z', '2026-11-26T21:30:00Z', '2026-11-27T01:20:00Z']) assert.ok(k.includes(thanksgiving));
});

test('fixture: no real NFL team names in the made-up player pool', () => {
  const real = /\b(Bears|Lions|Packers|Vikings|Cowboys|Giants|Eagles|Commanders|Falcons|Panthers|Saints|Buccaneers|Cardinals|Rams|49ers|Seahawks|Bills|Dolphins|Patriots|Jets|Ravens|Bengals|Browns|Steelers|Texans|Colts|Jaguars|Titans|Broncos|Chiefs|Raiders|Chargers) D\/ST/;
  const names = [...league.teams.flatMap((t) => [...t.roster.starters, ...t.roster.bench, ...t.roster.ir]), ...league.draft].map((p) => p.name);
  for (const name of names) assert.doesNotMatch(name, real);
});

// ---------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------

test('history: seven finished seasons in Contract 2 shape', () => {
  assert.deepEqual(Object.keys(history), ['schema', 'source', 'generatedAt', 'seasons']);
  assert.deepEqual(history.seasons.map((s) => s.season), PAST_YEARS);
  assert.deepEqual(validateHistory(history), []);
  for (const s of history.seasons) {
    assert.deepEqual(Object.keys(s), ['season', 'regularSeasonWeeks', 'playoffTeamCount', 'teams', 'games']);
    assert.equal(s.regularSeasonWeeks, s.season <= 2020 ? 13 : 14); // nothing assumes 14
    assert.equal(s.playoffTeamCount, 6);
    assert.equal(s.teams.length, 12);
    assert.deepEqual(Object.keys(s.teams[0]), ['id', 'name', 'owner', 'ownerKey', 'seed', 'finalRank', 'wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst']);
    assert.deepEqual(s.teams.map((t) => t.finalRank).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(s.teams.map((t) => t.seed).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const g of s.games) {
      assert.equal(g.length, 6);
      assert.ok([0, 1, 2].includes(g[5]));
      assert.equal(g[5] === 0, g[0] <= s.regularSeasonWeeks);
    }
    // Two first-round byes: away fields are null.
    const byes = s.games.filter((g) => g[3] === null);
    assert.equal(byes.length, 2);
    assert.ok(byes.every((g) => g[4] === null && g[5] === 1));
    // Regular-season records agree with the games.
    for (const t of s.teams) {
      const mine = s.games.filter((g) => g[5] === 0 && (g[1] === t.id || g[3] === t.id));
      const wins = mine.filter((g) => (g[1] === t.id ? g[2] > g[4] : g[4] > g[2])).length;
      assert.equal(wins, t.wins);
      assert.equal(mine.length - wins, t.losses);
    }
  }
});

test('history: managers keep one ownerKey across every season and into this one', () => {
  for (const s of history.seasons) {
    for (const t of s.teams) {
      assert.equal(t.ownerKey, teamById.get(t.id).ownerKey);
      assert.equal(t.owner, teamById.get(t.id).owner);
    }
  }
  // People rename their teams, including the older location + nickname style.
  const namesOfTeam1 = new Set(history.seasons.map((s) => s.teams.find((t) => t.id === 1).name));
  assert.deepEqual([...namesOfTeam1], ['The Commish', 'The REAL Commish', 'The REAL Commish***']);
  assert.equal(history.seasons[0].teams.find((t) => t.id === 4).name, 'DIGGS IN THE DIRT');
});

test('history: the storylines are there (titles, last places, records, a lopsided rivalry)', () => {
  const titles = new Map();
  const lasts = new Map();
  for (const s of history.seasons) {
    const champ = s.teams.find((t) => t.finalRank === 1).id;
    const last = s.teams.find((t) => t.finalRank === 12).id;
    titles.set(champ, (titles.get(champ) ?? 0) + 1);
    lasts.set(last, (lasts.get(last) ?? 0) + 1);
  }
  assert.ok([...titles.values()].includes(2), 'someone has two titles');
  assert.equal(titles.get(10) ?? 0, 0, "the current first-place manager has never won it");
  assert.ok([...lasts.values()].includes(3), 'someone finished last three times');

  const scores = history.seasons.flatMap((s) => s.games.flatMap((g) => [g[2], g[4]])).filter((v) => v !== null);
  assert.ok(Math.max(...scores) >= 190, 'an all-time high week of 190+');
  assert.ok(Math.min(...scores) < 50, 'an all-time low week under 50');
  assert.equal(scores.filter((v) => v >= 190).length, 1);
  assert.equal(scores.filter((v) => v < 50).length, 1);

  const pairs = new Map();
  for (const s of history.seasons) {
    for (const [, home, homePts, away, awayPts] of s.games) {
      if (away === null) continue;
      const [winner, loser] = homePts > awayPts ? [home, away] : [away, home];
      const key = `${winner}>${loser}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  const lopsided = [...pairs].some(([key, wins]) => {
    const [a, b] = key.split('>');
    return wins >= 11 && (pairs.get(`${b}>${a}`) ?? 0) <= 3;
  });
  assert.ok(lopsided, 'one manager owns another (11+ wins to 3 or fewer)');
  assert.deepEqual([pairs.get('1>10'), pairs.get('10>1')], [11, 2]);
});

test('history: an unfinished or unusable season is recognised', () => {
  const current = rawSeason().main;
  assert.equal(isSeasonComplete(current), false);
  assert.equal(isSeasonComplete(loadFixture('espn-2025.json')), true);
  assert.equal(isSeasonComplete(null), false);
  assert.equal(normalizeSeason(null), null);
  assert.equal(normalizeSeason({ seasonId: 2020, teams: [{ id: 1 }] }), null);
  assert.notDeepEqual(validateSeason({ season: 2020, regularSeasonWeeks: 13, playoffTeamCount: 6, teams: [], games: [] }), []);
});

// ---------------------------------------------------------------------------------------
// A small hand-made league with gaps in the team ids and every awkward case at once
// ---------------------------------------------------------------------------------------

const guid = (n) => `{0000000${n}-AAAA-4BBB-8CCC-DDDDDDDDDDDD}`;
const player = (id, fullName, defaultPositionId, extra = {}) => ({ id, fullName, defaultPositionId, proTeamId: 1, ...extra });
const entry = (lineupSlotId, p, appliedStatTotal) => ({ lineupSlotId, playerId: p.id, playerPoolEntry: { id: p.id, appliedStatTotal, player: p } });
const line = (scoringPeriodId, statSourceId, appliedTotal, statSplitTypeId = 1) => ({ scoringPeriodId, statSourceId, statSplitTypeId, appliedTotal });

function gappedLeague() {
  const overall = (wins, losses, extra = {}) => ({ wins, losses, ties: 0, pointsFor: 500, pointsAgainst: 480, streakType: 'WIN', streakLength: 1, ...extra });
  const benchGuy = player(907, 'Ben Chwarmer', 3); // no stats list at all
  return {
    main: {
      id: 4242,
      seasonId: 2031,
      scoringPeriodId: 6,
      status: { currentMatchupPeriod: 6, finalScoringPeriod: 16, isActive: true, previousSeasons: [2029, 2030] },
      settings: {
        name: '  Gap \n League ',
        isPublic: true,
        size: 4,
        scheduleSettings: { matchupPeriodCount: 13, playoffTeamCount: 2 },
        scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }, { statId: 25, points: 6 }] },
        rosterSettings: { lineupSlotCounts: { 0: 1, 1: 0, 2: 1, 7: 1, 17: 1, 20: 2, 21: 1, 23: 1, 24: 1 } },
      },
      members: [
        { id: guid(1), firstName: ' dan  smith ', lastName: 'Secretlast', displayName: 'danny_espn_handle' },
        { id: guid(2), firstName: 'MARIA', lastName: 'Hidden' },
        { id: guid(3), firstName: 'someone@example.com', lastName: 'Nope' },
        { id: guid(4), firstName: 'Lee', lastName: 'Coowner' },
      ],
      teams: [
        {
          id: 2, abbrev: 'GAP', location: 'Gap', nickname: 'Fillers 🦷', primaryOwner: guid(1), owners: [guid(4), guid(1)], playoffSeed: 1,
          logo: 'https://g.espncdn.com/some-logo.png',
          record: { overall: overall(4, 1, { pointsFor: 601.555, pointsAgainst: 500.004, streakLength: 3 }) },
          transactionCounter: { acquisitions: 3, drops: 2, trades: 1 },
          roster: {
            entries: [
              entry(0, player(901, 'Quinn Able', 1, { stats: [line(6, 0, 21.456), line(6, 1, 18.2), line(0, 0, 150, 0), line(5, 0, 9)] }), 150),
              entry(2, player(902, 'Bye Guy', 2, { proTeamId: 3, stats: [line(6, 1, 0)] }), 80),
              entry(7, player(903, 'Sus Pended', 3, { injuryStatus: 'SUSPENSION', stats: [] }), 60),
              entry(24, player(904, 'Odd Slot', 4, { injuryStatus: 'INJURY_RESERVE', stats: [] }), 0),
              entry(20, benchGuy, 44),
              entry(21, player(906, 'Ira Reserve', 2, { injuryStatus: 'INJURY_RESERVE' }), 12),
              { lineupSlotId: 20, playerPoolEntry: {} }, // a bench entry with no player at all
              null,
            ],
          },
        },
        { id: 5, abbrev: 7, name: 'Numbers', owners: [guid(2)], playoffSeed: 2, record: { overall: overall(3, 2, { streakLength: 0 }) }, roster: { entries: [] } },
        { id: 9, abbrev: 'NINE', name: 'Nine Lives', primaryOwner: guid(3), playoffSeed: 3, record: { overall: overall(2, 3, { streakType: 'LOSS', streakLength: 2 }) } },
        { id: 14, name: '   ', playoffSeed: 4, record: { overall: { wins: 0, losses: 5, pointsFor: 0, pointsAgainst: 612.3 } } },
        { id: 14, name: 'Duplicate id, must be ignored' },
        { name: 'No id, must be ignored' },
      ],
      schedule: [
        { matchupPeriodId: 5, home: { teamId: 2, totalPoints: 120.004 }, away: { teamId: 5, totalPoints: 99.5 }, winner: 'HOME', playoffTierType: 'NONE' },
        { matchupPeriodId: 5, home: { teamId: 9, totalPoints: 80 }, away: { teamId: 14, totalPoints: 81 }, winner: 'AWAY', playoffTierType: 'NONE' },
        {
          matchupPeriodId: 6, winner: 'UNDECIDED', playoffTierType: 'NONE',
          home: { teamId: 2, totalPoints: 10, totalPointsLive: 55.5, totalProjectedPointsLive: 101.25, rosterForCurrentScoringPeriod: { appliedStatTotal: 55.5, entries: [entry(20, benchGuy, 7.7)] } },
          away: { teamId: 9, totalPoints: 0, rosterForCurrentScoringPeriod: { appliedStatTotal: 33.3, entries: [entry(0, player(950, 'Nina Starter', 1, { stats: [line(6, 0, 33.3)] }), 33.3)] } },
        },
        { matchupPeriodId: 6, home: { teamId: 5, totalPoints: 12 }, winner: 'UNDECIDED', playoffTierType: 'NONE' }, // a bye
        { matchupPeriodId: 6, away: { teamId: 14, totalPoints: 0 }, winner: 'UNDECIDED' }, // a bye recorded on the away side
        { matchupPeriodId: 14, home: { teamId: 2, totalPoints: 0 }, away: { teamId: 5, totalPoints: 0 }, winner: 'UNDECIDED', playoffTierType: 'WINNERS_BRACKET' },
        { matchupPeriodId: 14, home: { teamId: 9, totalPoints: 0 }, away: { teamId: 14, totalPoints: 0 }, winner: 'UNDECIDED', playoffTierType: 'LOSERS_CONSOLATION_LADDER' },
        { matchupPeriodId: 7, home: { teamId: 999, totalPoints: 1 }, away: { teamId: 998, totalPoints: 2 }, winner: 'HOME' }, // strangers
        { matchupPeriodId: 'x', home: { teamId: 2 } },
        null,
      ],
    },
    proSchedule: {
      settings: {
        proTeams: [
          { id: 0, byeWeek: 0 },
          { id: 1, byeWeek: 9, proGamesByScoringPeriod: { 6: [{ date: Date.UTC(2031, 9, 12, 17) }], 5: [{ date: Date.UTC(2031, 9, 5, 17) }] } },
          { id: 3, byeWeek: 6, proGamesByScoringPeriod: { 5: [{ date: Date.UTC(2031, 9, 5, 17) }, { date: 'junk' }] } },
        ],
      },
    },
  };
}

test('gapped ids: nothing assumes team ids run 1..N', () => {
  const lg = normalizeLeague(gappedLeague(), { source: 'espn', generatedAt: NOW });
  assert.deepEqual(validate(lg, { leagueId: 4242, season: 2031 }), []);
  assert.deepEqual(lg.teams.map((t) => t.id), [2, 5, 9, 14]);
  assert.equal(lg.league.teamCount, 4);
  assert.equal(lg.league.name, 'Gap League');
  assert.equal(lg.league.isPublic, true);
  assert.equal(lg.league.regularSeasonWeeks, 13);
  assert.equal(lg.league.playoffTeamCount, 2);
  assert.equal(lg.league.scoringType, 'HALF_PPR');
  assert.deepEqual(lg.league.starterSlots, { QB: 1, RB: 1, FLEX: 2, OP: 1, K: 1 }); // the unknown slot 24 counts as a FLEX
  assert.deepEqual(lg.draft, []);
  assert.equal(lg.lastWeekLineups, null);
  assert.deepEqual(lg.nfl, { kickoffs: ['2031-10-05T17:00:00Z', '2031-10-12T17:00:00Z'], source: 'espn' });
});

test('gapped ids: names, owners and owner keys', () => {
  const lg = normalizeLeague(gappedLeague(), { source: 'espn', generatedAt: NOW });
  const [gap, numbers, nine, fourteen] = lg.teams;
  assert.equal(gap.name, 'Gap Fillers 🦷'); // older seasons: location + nickname
  assert.equal(gap.owner, 'Dan'); // primary owner wins over the co-owner, first word only, tidied
  assert.equal(gap.ownerKey, ownerKeyFor(guid(1), 2));
  assert.equal(gap.pointsFor, 601.56);
  assert.equal(gap.pointsAgainst, 500);
  assert.deepEqual(gap.moves, { acquisitions: 3, drops: 2, trades: 1 });
  assert.equal(numbers.abbrev, '7'); // a numeric abbreviation becomes text
  assert.equal(numbers.owner, 'Maria');
  assert.deepEqual([numbers.streakType, numbers.streakLength], ['NONE', 0]);
  assert.deepEqual(numbers.moves, { acquisitions: 0, drops: 0, trades: 0 });
  assert.equal(nine.owner, ''); // an email is not a first name
  assert.match(nine.ownerKey, /^o_[0-9a-f]{8}$/);
  assert.equal(fourteen.name, 'Team 14');
  assert.equal(fourteen.abbrev, '');
  assert.equal(fourteen.ownerKey, 't_14');
  assert.deepEqual([fourteen.wins, fourteen.losses, fourteen.ties, fourteen.pointsFor, fourteen.streakType], [0, 5, 0, 0, 'NONE']);
  assert.equal(fourteen.roster, null); // no roster anywhere for this team
  const text = JSON.stringify(lg);
  for (const secret of ['Secretlast', 'danny_espn_handle', 'smith', 'example.com', 'espncdn', 'Coowner', 'AAAA-4BBB']) assert.ok(!text.includes(secret), secret);
});

test('gapped ids: rosters flag empty slots, byes, suspensions and IR starters', () => {
  const lg = normalizeLeague(gappedLeague(), { source: 'espn', generatedAt: NOW });
  const roster = lg.teams[0].roster;
  assert.deepEqual(roster.starters, [
    { name: 'Quinn Able', pos: 'QB', slot: 'QB', points: 21.46, projected: 18.2 }, // week 6 line, not the season total
    { name: 'Bye Guy', pos: 'RB', slot: 'RB', points: 0, projected: 0 },
    { name: 'Sus Pended', pos: 'WR', slot: 'OP', points: 0, projected: null },
    { name: 'Odd Slot', pos: 'TE', slot: 'FLEX', points: 0, projected: null },
  ]);
  assert.deepEqual(roster.badStarters, [
    { name: 'Bye Guy', pos: 'RB', slot: 'RB', why: 'BYE' },
    { name: 'Sus Pended', pos: 'WR', slot: 'OP', why: 'SUSPENDED' },
    { name: 'Odd Slot', pos: 'TE', slot: 'FLEX', why: 'IR' },
  ]);
  assert.deepEqual(roster.emptyStarters, ['FLEX', 'K']);
  assert.deepEqual(roster.ir, [{ name: 'Ira Reserve', pos: 'RB' }]);
  assert.deepEqual(roster.bench, [
    { name: 'Ben Chwarmer', pos: 'WR', slot: 'BE', points: 7.7, projected: null }, // points borrowed from the live matchup roster
    { name: 'Unknown player', pos: '?', slot: 'BE', points: null, projected: null },
  ]);
  // No roster view for team 9, so the live matchup roster stands in.
  assert.deepEqual(lg.teams[2].roster.starters, [{ name: 'Nina Starter', pos: 'QB', slot: 'QB', points: 33.3, projected: null }]);
  // An empty roster lists every starting slot as empty.
  assert.deepEqual(lg.teams[1].roster.emptyStarters, ['QB', 'RB', 'FLEX', 'OP', 'K', 'FLEX']);
});

test('gapped ids: matchups handle live points, byes, playoffs and junk rows', () => {
  const lg = normalizeLeague(gappedLeague(), { source: 'espn', generatedAt: NOW });
  assert.deepEqual(lg.matchups, [
    { week: 5, playoff: false, bracket: 'NONE', home: { teamId: 2, points: 120, projected: null }, away: { teamId: 5, points: 99.5, projected: null }, winner: 'home' },
    { week: 5, playoff: false, bracket: 'NONE', home: { teamId: 9, points: 80, projected: null }, away: { teamId: 14, points: 81, projected: null }, winner: 'away' },
    // totalPointsLive beats a stale totalPoints; with neither, the live roster total is used.
    { week: 6, playoff: false, bracket: 'NONE', home: { teamId: 2, points: 55.5, projected: 101.25 }, away: { teamId: 9, points: 33.3, projected: null }, winner: 'undecided' },
    { week: 6, playoff: false, bracket: 'NONE', home: { teamId: 5, points: 12, projected: null }, away: null, winner: 'undecided' },
    { week: 6, playoff: false, bracket: 'NONE', home: { teamId: 14, points: 0, projected: null }, away: null, winner: 'undecided' },
    { week: 14, playoff: true, bracket: 'WINNERS', home: { teamId: 2, points: 0, projected: null }, away: { teamId: 5, points: 0, projected: null }, winner: 'undecided' },
    { week: 14, playoff: true, bracket: 'CONSOLATION', home: { teamId: 9, points: 0, projected: null }, away: { teamId: 14, points: 0, projected: null }, winner: 'undecided' },
  ]);
  assert.equal(lastCompletedWeek(lg.matchups), 5);
  assert.deepEqual(lineupRequestFor(gappedLeague().main), { week: 5, scoringPeriod: 5 });
});

// ---------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------

test('helpers: rounding, text cleaning, first names, owner keys', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-0.001), 0);
  assert.equal(round2('12'), 0);
  assert.equal(cleanText('  a\tb\n c  '), 'a b c');
  assert.equal(cleanText(`x${String.fromCharCode(0)}y${String.fromCharCode(0x2028)}z`), 'x y z');
  assert.equal(cleanText('👨‍👩‍👧 Family 🔥'), '👨‍👩‍👧 Family 🔥'); // joined emoji stay joined
  assert.equal(cleanText(42), '');
  assert.equal(cleanText('abcdef', 3), 'abc');
  assert.equal(firstNameOnly({ firstName: 'Mary Jane', lastName: 'Watson' }), 'Mary');
  assert.equal(firstNameOnly({ firstName: 'McKenzie' }), 'McKenzie');
  assert.equal(firstNameOnly({ firstName: 'tim' }), 'Tim');
  assert.equal(firstNameOnly({ firstName: '{ABC}' }), '');
  assert.equal(firstNameOnly({ displayName: 'only_a_handle' }), '');
  assert.equal(firstNameOnly(null), '');
  assert.equal(ownerKeyFor('{ABCDEF12-0000-4000-8000-000000000001}', 3), ownerKeyFor('abcdef12-0000-4000-8000-000000000001', 9));
  assert.notEqual(ownerKeyFor(guid(1), 1), ownerKeyFor(guid(2), 1));
  assert.equal(ownerKeyFor('', 13), 't_13');
  assert.equal(ownerKeyFor(undefined, 4), 't_4');
});

test('helpers: stat lines, bye weeks, kickoffs, scoring type', () => {
  const p = { stats: [line(0, 0, 200, 0), line(9, 0, 12.345), line(9, 1, 10), { scoringPeriodId: 9, statSourceId: 0, appliedTotal: 'x' }] };
  assert.equal(statFor(p, 9, 0), 12.35);
  assert.equal(statFor(p, 9, 1), 10);
  assert.equal(statFor(p, 0, 0), null); // a season total is not a week
  assert.equal(statFor(p, 10, 0), null);
  assert.equal(statFor(null, 9, 0), null);

  const pro = gappedLeague().proSchedule;
  assert.deepEqual([...byeTeamsForPeriod(pro, 6)], [3]);
  assert.deepEqual([...byeTeamsForPeriod(pro, 9)], [1]);
  assert.equal(byeTeamsForPeriod(null, 6), null);
  assert.equal(byeTeamsForPeriod({ settings: { proTeams: [{ id: 1 }] } }, 6), null);
  // No byeWeek field: fall back to "no game listed that week".
  const noByeField = { settings: { proTeams: [{ id: 1, proGamesByScoringPeriod: { 1: [{}], 3: [{}] } }, { id: 2, proGamesByScoringPeriod: { 1: [{}], 2: [{}], 3: [{}] } }] } };
  assert.deepEqual([...byeTeamsForPeriod(noByeField, 2)], [1]);
  assert.deepEqual([...byeTeamsForPeriod(noByeField, 9)], []); // past the end of the schedule nobody is "on bye"

  assert.deepEqual(normalizeKickoffs(null), []);
  assert.deepEqual(normalizeKickoffs({ settings: { proTeams: 'nope' } }), []);
  assert.deepEqual(normalizeKickoffs({ settings: { proTeams: [{ proGamesByScoringPeriod: { 1: [{ date: 0 }, { date: Date.UTC(2026, 10, 13, 1, 15) }, { date: Date.UTC(2026, 10, 13, 1, 15) }] } }] } }), ['2026-11-13T01:15:00Z']);

  const withReceptions = (points) => normalizeLeague({ main: { settings: { scoringSettings: { scoringItems: points === null ? [] : [{ statId: 53, points }] } } } }).league.scoringType;
  assert.equal(withReceptions(1), 'PPR');
  assert.equal(withReceptions(0.5), 'HALF_PPR');
  assert.equal(withReceptions(null), 'STANDARD');
  assert.equal(normalizeLeague({ main: {} }).league.scoringType, null);
});

test('a response without the records is refused instead of being published as 0-0', () => {
  const raw = rawSeason();
  for (const t of raw.main.teams) delete t.record;
  const out = normalizeLeague(raw, { source: 'espn', generatedAt: NOW });
  assert.equal(out.teams[0].wins, null);
  const problems = validate(out);
  assert.ok(problems.some((p) => p.includes('wins must be a whole number')));
  assert.ok(problems.some((p) => p.includes('pointsAgainst must be a number')));

  const noSettings = rawSeason();
  delete noSettings.main.settings;
  const problems2 = validate(normalizeLeague(noSettings, { source: 'espn', generatedAt: NOW }));
  assert.ok(problems2.some((p) => p.includes('league.name')));
  assert.ok(problems2.some((p) => p.includes('regularSeasonWeeks')));
  assert.ok(problems2.some((p) => p.includes('playoffTeamCount')));

  const noStatus = rawSeason();
  delete noStatus.main.status;
  assert.ok(validate(normalizeLeague(noStatus, { source: 'espn', generatedAt: NOW })).some((p) => p.includes('currentWeek')));
});

test('garbage in never throws, and validate refuses it', () => {
  for (const junk of [undefined, null, {}, { main: null }, { main: 'text' }, { main: [] }, { main: { teams: 'x', schedule: 5, members: {}, settings: 3, status: [] } }, { main: { teams: [null, 4, {}] } }]) {
    const out = normalizeLeague(junk);
    assert.equal(out.schema, 1);
    assert.deepEqual(out.teams, []);
    assert.ok(validate(out).length > 0);
  }
  assert.deepEqual(validate(null), ['league: not an object']);
  assert.ok(validate('nope').length > 0);
});

test('validate: catches each kind of broken league', () => {
  const good = () => JSON.parse(JSON.stringify(league));
  const problemsAfter = (mutate, options) => {
    const copy = good();
    mutate(copy);
    return validate(copy, options);
  };
  assert.deepEqual(validate(good()), []);
  assert.ok(problemsAfter((l) => { l.teams = l.teams.slice(0, 1); }).some((p) => p.includes('at least 2 teams')));
  assert.ok(problemsAfter((l) => { l.teams[1].id = l.teams[0].id; }).some((p) => p.includes('duplicate id')));
  assert.ok(problemsAfter((l) => { l.teams[0].id = '1'; }).some((p) => p.includes('id must be a whole number')));
  assert.ok(problemsAfter((l) => { l.teams[2].wins = '5'; }).some((p) => p.includes('wins')));
  assert.ok(problemsAfter((l) => { l.teams[2].losses = null; }).some((p) => p.includes('losses')));
  assert.ok(problemsAfter((l) => { l.teams[2].pointsFor = NaN; }).some((p) => p.includes('pointsFor')));
  assert.ok(problemsAfter((l) => { l.teams[3].name = ''; }).some((p) => p.includes('name')));
  assert.ok(problemsAfter((l) => { l.teams[3].owner = 'Dan Smith'; }).some((p) => p.includes('first name only')));
  assert.ok(problemsAfter((l) => { l.teams[3].streakType = 'HOT'; }).some((p) => p.includes('streakType')));
  assert.ok(problemsAfter((l) => { l.league.currentWeek = 0; }).some((p) => p.includes('currentWeek')));
  assert.ok(problemsAfter((l) => { l.league.currentWeek = 99; }).some((p) => p.includes('currentWeek')));
  assert.ok(problemsAfter((l) => { l.league.season = 20266; }).some((p) => p.includes('season')));
  assert.ok(problemsAfter((l) => { l.league.playoffTeamCount = 40; }).some((p) => p.includes('playoffTeamCount')));
  assert.ok(problemsAfter((l) => { l.league.teamCount = 11; }).some((p) => p.includes('teamCount')));
  assert.ok(problemsAfter((l) => { l.league.name = ''; }).some((p) => p.includes('league.name')));
  assert.ok(problemsAfter((l) => { l.schema = 2; }).some((p) => p.includes('schema')));
  assert.ok(problemsAfter((l) => { l.source = 'guess'; }).some((p) => p.includes('source')));
  assert.ok(problemsAfter((l) => { l.matchups[0].home.teamId = 77; }).some((p) => p.includes('not a team in this league')));
  assert.ok(problemsAfter((l) => { l.matchups[0].winner = 'HOME'; }).some((p) => p.includes('winner')));
  assert.ok(problemsAfter((l) => { l.matchups = []; }).some((p) => p.includes('schedule is empty')));
  assert.ok(problemsAfter((l) => { l.nfl.kickoffs = ['not a date']; }).some((p) => p.includes('kickoffs')));
  assert.ok(problemsAfter((l) => { l.draft = null; }).some((p) => p.includes('draft')));
  assert.ok(problemsAfter((l) => { l.lastWeekLineups = 5; }).some((p) => p.includes('lastWeekLineups')));
  assert.ok(problemsAfter(() => {}, { leagueId: 1 }).some((p) => p.includes('expected 1')));
  assert.ok(problemsAfter(() => {}, { season: 2030 }).some((p) => p.includes('expected 2030')));
  // Things that must never be published.
  assert.ok(problemsAfter((l) => { l.teams[0].logo = 'x'; }).some((p) => p.includes('must never be stored')));
  assert.ok(problemsAfter((l) => { l.teams[0].lastName = 'x'; }).some((p) => p.includes('must never be stored')));
  assert.ok(problemsAfter((l) => { l.teams[0].name = `Team ${guid(5)}`; }).some((p) => p.includes('member GUID')));
  assert.ok(problemsAfter((l) => { l.teams[0].name = 'https://a.espncdn.com/i/x.png'; }).some((p) => p.includes('ESPN image URL')));
  // A preseason league (no games, week 1) is fine.
  assert.deepEqual(problemsAfter((l) => {
    l.matchups = [];
    l.league.currentWeek = 1;
    for (const t of l.teams) Object.assign(t, { wins: 0, losses: 0, streakType: 'NONE', streakLength: 0 });
  }), []);
});
