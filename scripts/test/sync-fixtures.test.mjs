// Tests for the placeholder fixtures (scripts/make-fixture.mjs and scripts/fixtures/).
// Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildFixtures, fixtureText, FIXTURE_DIR, REAL_TEAMS } from '../make-fixture.mjs';
import { DEFAULT_DATA_DIR } from '../sync-espn.mjs';
import { buildHistory, normalizeLeague, normalizeSeason } from '../lib/normalize.mjs';
import { sameIgnoringStamp, prettyJson, stableStringify } from '../lib/io.mjs';
import { NOW, PAST_YEARS, loadFixture, rawSeason } from '../testing/helpers.mjs';

const built = buildFixtures();

test('fixtures: the generator is deterministic and the files on disk are what it produces', () => {
  const again = buildFixtures();
  const names = Object.keys(built.files).sort();
  assert.deepEqual(names, [
    'espn-2019.json', 'espn-2020.json', 'espn-2021.json', 'espn-2022.json', 'espn-2023.json', 'espn-2024.json', 'espn-2025.json',
    'espn-2026-draft.json', 'espn-2026-players.json', 'espn-2026-week9-lineups.json', 'espn-2026.json', 'pro-schedule-2026.json',
  ]);
  assert.deepEqual(fs.readdirSync(FIXTURE_DIR).sort(), names, 'no stray files in scripts/fixtures');
  for (const name of names) {
    const text = fixtureText(built.files[name]);
    assert.equal(fixtureText(again.files[name]), text, `${name} is the same on every run`);
    assert.equal(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'), text, `${name} is stale: run node scripts/make-fixture.mjs`);
  }
});

test('fixtures: the 2026 record fields are exactly the real standings', () => {
  const raw = built.files['espn-2026.json'];
  assert.equal(raw.id, 70578866);
  assert.equal(raw.seasonId, 2026);
  assert.equal(raw.settings.name, "Dan's Real Cool League");
  assert.equal(raw.settings.isPublic, false);
  assert.equal(raw.settings.scheduleSettings.matchupPeriodCount, 14);
  assert.equal(raw.settings.scheduleSettings.playoffTeamCount, 6);
  assert.equal(raw.status.currentMatchupPeriod, 10);
  assert.deepEqual(raw.teams.map((t) => t.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const real of REAL_TEAMS) {
    const t = raw.teams.find((x) => x.id === real.id);
    const o = t.record.overall;
    assert.deepEqual(
      [t.name, t.abbrev, t.playoffSeed, o.wins, o.losses, o.pointsFor, o.pointsAgainst, o.streakType, o.streakLength],
      [real.name, real.abbrev, real.seed, real.wins, real.losses, real.pf, real.pa, real.streak[0], real.streak[1]],
    );
  }
  // Only three first names are known. The others are deliberately blank, not invented.
  const firstNames = Object.fromEntries(raw.teams.map((t) => [t.id, raw.members.find((m) => m.id === t.primaryOwner).firstName]));
  assert.deepEqual(firstNames, { 1: 'Dan', 2: '', 3: '', 4: '', 5: 'Shane', 6: '', 7: '', 8: '', 9: '', 10: '', 11: '', 12: 'Tim' });
  assert.equal(new Set(raw.members.map((m) => m.id)).size, 12);
});

test('fixtures: generated scores fit the real points (for: exact, against: within a cent)', () => {
  assert.equal(built.notes.maxPointsForError, 0);
  assert.ok(built.notes.maxPointsAgainstError <= 0.01 + 1e-9);
  const raw = built.files['espn-2026.json'];
  const totals = new Map(raw.teams.map((t) => [t.id, { pf: 0, pa: 0 }]));
  for (const m of raw.schedule.filter((x) => x.winner !== 'UNDECIDED')) {
    totals.get(m.home.teamId).pf += Math.round(m.home.totalPoints * 100);
    totals.get(m.home.teamId).pa += Math.round(m.away.totalPoints * 100);
    totals.get(m.away.teamId).pf += Math.round(m.away.totalPoints * 100);
    totals.get(m.away.teamId).pa += Math.round(m.home.totalPoints * 100);
  }
  for (const real of REAL_TEAMS) {
    const sum = totals.get(real.id);
    assert.equal(sum.pf, Math.round(real.pf * 100), `points for, team ${real.id}`);
    assert.ok(Math.abs(sum.pa - Math.round(real.pa * 100)) <= 1, `points against, team ${real.id}`);
  }
  const scores = raw.schedule.filter((x) => x.winner !== 'UNDECIDED').flatMap((m) => [m.home.totalPoints, m.away.totalPoints]);
  assert.equal(scores.length, 108);
  assert.ok(Math.min(...scores) >= 60 && Math.max(...scores) <= 190, 'realistic range');
  assert.ok(built.notes.tierMoves.length >= 2);
});

test('fixtures: raw shapes look like ESPN (the things the normalizer must cope with)', () => {
  const raw = rawSeason();
  const team = raw.main.teams[0];
  assert.match(team.primaryOwner, /^\{[0-9A-F-]{36}\}$/);
  assert.ok('logo' in team && 'transactionCounter' in team && Array.isArray(team.roster.entries));
  const entry = team.roster.entries[0];
  assert.deepEqual(Object.keys(entry.playerPoolEntry.player).sort(), ['defaultPositionId', 'fullName', 'id', 'injured', 'injuryStatus', 'proTeamId', 'stats']);
  assert.ok(entry.playerPoolEntry.player.stats.some((s) => s.statSplitTypeId === 0), 'a season-total line the normalizer must ignore');
  // A defense has no injury fields.
  const defense = team.roster.entries.find((e) => e.playerPoolEntry.player.defaultPositionId === 16);
  assert.ok(!('injuryStatus' in defense.playerPoolEntry.player));
  // Draft picks carry ids only: names come from the player list.
  const pick = raw.draft.draftDetail.picks[0];
  assert.ok(!('fullName' in pick) && Number.isInteger(pick.playerId));
  assert.ok(raw.players.some((p) => p.id === pick.playerId));
  // The live week has live fields, finished weeks do not.
  const live = raw.main.schedule.find((m) => m.matchupPeriodId === 10);
  const done = raw.main.schedule.find((m) => m.matchupPeriodId === 9);
  assert.ok('totalPointsLive' in live.home && 'totalProjectedPointsLive' in live.home && 'rosterForCurrentScoringPeriod' in live.home);
  assert.ok(!('totalPointsLive' in done.home));
  // Older seasons use location + nickname instead of name.
  assert.ok('location' in loadFixture('espn-2019.json').teams[0] && !('name' in loadFixture('espn-2019.json').teams[0]));
  assert.ok('name' in loadFixture('espn-2025.json').teams[0]);
  // The made-up pro schedule includes ESPN's "free agent" team 0 and one bye per team in weeks 5-14.
  const pro = raw.proSchedule.settings.proTeams;
  assert.equal(pro.length, 33);
  assert.equal(pro[0].id, 0);
  assert.ok(pro.slice(1).every((p) => p.byeWeek >= 5 && p.byeWeek <= 14 && !(String(p.byeWeek) in p.proGamesByScoringPeriod) && Object.keys(p.proGamesByScoringPeriod).length === 17));
});

test('world/data: the placeholder files are exactly what the fixtures normalize to', (t) => {
  const leagueFile = path.join(DEFAULT_DATA_DIR, 'league.json');
  const historyFile = path.join(DEFAULT_DATA_DIR, 'history.json');
  if (!fs.existsSync(leagueFile)) return t.skip('world/data/league.json does not exist yet (run npm run sample)');
  const saved = JSON.parse(fs.readFileSync(leagueFile, 'utf8'));
  if (saved.source !== 'placeholder') return t.skip('world/data/league.json holds the real ESPN league now');
  const league = normalizeLeague(rawSeason(), { source: 'placeholder', generatedAt: NOW });
  // The NFL kickoff list is public, so the sync replaces it with the real one long before the
  // league itself is readable. Compare everything else.
  const { nfl: _savedNfl, ...savedRest } = saved;
  const { nfl: _freshNfl, ...freshRest } = league;
  assert.ok(sameIgnoringStamp(savedRest, freshRest), 'world/data/league.json is stale: run npm run sample');
  if (saved.nfl?.source === 'placeholder') assert.ok(sameIgnoringStamp(saved, league), 'world/data/league.json kickoffs are stale: run npm run sample');
  const savedHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  if (savedHistory.source !== 'placeholder') return undefined;
  const history = buildHistory(PAST_YEARS.map((y) => normalizeSeason(loadFixture(`espn-${y}.json`))), { source: 'placeholder', generatedAt: NOW });
  assert.ok(sameIgnoringStamp(savedHistory, history), 'world/data/history.json is stale: run npm run sample');
  return undefined;
});

test('io: the JSON layout is valid, stable and readable', () => {
  const value = { a: 1, list: [1, 2, 3], nested: { text: 'emoji 🔥 "quotes" \\ slash', none: null, deep: [{ x: 1 }, { y: [true, false] }] }, empty: {}, none: [] };
  const text = prettyJson(value);
  assert.deepEqual(JSON.parse(text), value);
  assert.ok(text.endsWith('}\n'));
  assert.equal(prettyJson(value), text);
  assert.ok(text.includes('"list": [1, 2, 3]'), 'short lists stay on one line');
  const long = prettyJson({ rows: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `row ${i}` })) });
  assert.ok(long.split('\n').length > 40, 'long lists get one item per line');
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.ok(sameIgnoringStamp({ generatedAt: 'x', v: 1 }, { v: 1, generatedAt: 'y' }));
  assert.ok(!sameIgnoringStamp({ generatedAt: 'x', v: 1 }, { generatedAt: 'x', v: 2 }));
  assert.ok(!sameIgnoringStamp(null, { v: 1 }));
});
