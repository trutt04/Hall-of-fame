// End-to-end tests for scripts/sync-espn.mjs against a local mock of ESPN.
// Every way ESPN can fail is rehearsed here, and each time the saved data must survive
// untouched. Nothing here touches the real ESPN or the real world/data folder.
// Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { nextStatus, parseArgs, statusWriteReason } from '../sync-espn.mjs';
import { validate, validateHistory } from '../lib/normalize.mjs';
import { startMockEspn } from '../testing/mock-espn.mjs';
import {
  LEAGUE_ID, NOW, PAST_YEARS, SCRIPTS_DIR, later, readData, seedSample, settleStatus, snapshot, strayFiles, sync, tempDataDir,
} from '../testing/helpers.mjs';

const GUID_PATTERN = /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/;
const INSIDE_WINDOW = new Date('2026-11-17T01:30:00Z'); // Monday night, 15 minutes after kickoff
const OUTSIDE_WINDOW = NOW; // Monday 10am Eastern

/** A mock ESPN plus a scratch data folder holding the placeholder files. */
async function setup(t, { seeded = true } = {}) {
  const mock = await startMockEspn();
  t.after(() => mock.close());
  const dir = tempDataDir(t);
  if (seeded) await seedSample(dir);
  return { mock, dir };
}

function failEverything(mock, mode) {
  Object.assign(mock.behavior, { league: mode, history: mode, proSchedule: mode, players: mode });
}

// ---------------------------------------------------------------------------------------
// Failure modes: the saved data must stay byte-for-byte identical and the exit code 0
// ---------------------------------------------------------------------------------------

const FAILURE_MODES = [
  ['private', 'league_private'],
  ['notfound', 'not_found'],
  ['notfound-html', 'not_found'],
  ['forbidden-html', 'endpoint_moved'],
  ['error', 'server_error'],
  ['ratelimit', 'rate_limited'],
  ['html', 'endpoint_moved'],
  ['empty', 'endpoint_moved'],
  ['redirect-login', 'endpoint_moved'],
  ['truncated', 'bad_shape'],
  ['wrong-shape', 'bad_shape'],
  ['hang', 'network'],
  ['drop', 'network'],
];

for (const [mode, reason] of FAILURE_MODES) {
  test(`failure "${mode}": data untouched, exit 0, status says ${reason}`, async (t) => {
    const { mock, dir } = await setup(t);
    const before = snapshot(dir);
    failEverything(mock, mode);

    const result = await sync(mock, dir, { now: later(1) });

    assert.equal(result.exitCode, 0);
    const after = snapshot(dir);
    assert.equal(after['league.json'], before['league.json'], 'league.json must be byte-identical');
    assert.equal(after['history.json'], before['history.json'], 'history.json must be byte-identical');
    assert.deepEqual(result.wrote, { league: false, history: false, status: true });
    assert.deepEqual(strayFiles(dir), []);

    const status = readData(dir, 'status.json');
    assert.deepEqual(Object.keys(status), ['schema', 'ok', 'reason', 'detail', 'lastAttempt', 'lastSuccess', 'consecutiveFailures', 'internal']);
    assert.equal(status.schema, 1);
    assert.equal(status.ok, false);
    assert.equal(status.reason, reason);
    assert.equal(typeof status.detail, 'string');
    assert.ok(status.detail.length > 0 && status.detail.length <= 300);
    assert.equal(status.lastAttempt, '2026-11-16T16:00:00Z');
    assert.equal(status.lastSuccess, null);
    assert.equal(status.consecutiveFailures, 1);
    assert.equal(readData(dir, 'league.json').source, 'placeholder');
    assert.ok(mock.requests.length >= 1);
  });
}

const BAD_ANSWERS = [
  ['no teams', (raw) => ({ ...raw, teams: [] }), /at least 2 teams/],
  ['one team', (raw) => ({ ...raw, teams: raw.teams.slice(0, 1) }), /at least 2 teams/],
  ['records missing', (raw) => ({ ...raw, teams: raw.teams.map(({ record, ...t }) => t) }), /wins must be a whole number/],
  ['no status block', ({ status, ...raw }) => raw, /currentWeek/],
  ['no settings block', ({ settings, ...raw }) => raw, /league\.name/],
  ['a different league', (raw) => ({ ...raw, id: 123 }), /expected 70578866/],
  ['a different season', (raw) => ({ ...raw, seasonId: 2020 }), /expected 2026/],
  ['week 99', (raw) => ({ ...raw, status: { ...raw.status, currentMatchupPeriod: 99 } }), /currentWeek/],
  ['results but no schedule', ({ schedule, ...raw }) => raw, /schedule is empty/],
];

for (const [label, bend, detail] of BAD_ANSWERS) {
  test(`bad answer "${label}": treated as bad_shape, data untouched, exit 0`, async (t) => {
    const { mock, dir } = await setup(t);
    const before = snapshot(dir);
    mock.behavior.transform = (kind, raw) => (kind === 'current' ? bend(raw) : raw);

    const result = await sync(mock, dir, { now: later(1) });

    assert.equal(result.exitCode, 0);
    assert.equal(result.outcome.reason, 'bad_shape');
    assert.match(result.outcome.detail, detail);
    const after = snapshot(dir);
    assert.equal(after['league.json'], before['league.json']);
    assert.equal(after['history.json'], before['history.json']);
    assert.equal(readData(dir, 'status.json').reason, 'bad_shape');
    assert.equal(mock.count('history'), 0, 'past seasons are not fetched when the current season is unusable');
    // The shape report is still printed: it is the best clue to what changed at ESPN.
    assert.ok(result.log.some((l) => l.startsWith('Shape report')));
  });
}

test('failure with no saved files at all: nothing is created except status.json', async (t) => {
  const { mock, dir } = await setup(t, { seeded: false });
  failEverything(mock, 'private');
  const result = await sync(mock, dir);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
  assert.equal(readData(dir, 'status.json').reason, 'league_private');
});

test('failure with a corrupt league.json: the file is left exactly as it was', async (t) => {
  const { mock, dir } = await setup(t);
  fs.writeFileSync(path.join(dir, 'league.json'), '{"schema":1,"teams":[{"id":1,"na');
  const before = snapshot(dir);
  failEverything(mock, 'error');
  const result = await sync(mock, dir);
  assert.equal(result.exitCode, 0);
  assert.equal(snapshot(dir)['league.json'], before['league.json']);

  // ...and the next good fetch repairs it.
  mock.reset();
  const fixed = await sync(mock, dir, { now: later(1) });
  assert.equal(fixed.wrote.league, true);
  assert.deepEqual(validate(readData(dir, 'league.json')), []);
});

// ---------------------------------------------------------------------------------------
// Private today, public tomorrow: it starts working by itself
// ---------------------------------------------------------------------------------------

test('private to public: run 1 gets 401, run 2 gets data, files flip to source "espn" with no code change', async (t) => {
  const { mock, dir } = await setup(t);
  const placeholder = snapshot(dir);

  failEverything(mock, 'private');
  const run1 = await sync(mock, dir, { now: later(1) });
  assert.equal(run1.exitCode, 0);
  assert.equal(run1.outcome.reason, 'league_private');
  assert.match(run1.outcome.detail, /^HTTP 401 from 127\.0\.0\.1:\d+ \(AUTH_LEAGUE_NOT_VISIBLE\)$/);
  assert.equal(snapshot(dir)['league.json'], placeholder['league.json']);
  assert.equal(snapshot(dir)['history.json'], placeholder['history.json']);
  assert.equal(run1.commitMessage, 'Sync status: league_private');
  assert.equal(mock.count('history'), 0);
  assert.ok(run1.log.some((l) => l.includes('the league is private')));

  // The league manager flips the league to public. Same code, same command.
  mock.reset();
  const run2 = await sync(mock, dir, { now: later(2) });
  assert.equal(run2.exitCode, 0);
  assert.deepEqual(run2.outcome, { ok: true, reason: 'ok', detail: 'Synced season 2026, week 10' });
  assert.deepEqual(run2.wrote, { league: true, history: true, status: true });
  assert.equal(run2.commitMessage, 'Sync league data (week 10)');
  assert.deepEqual(strayFiles(dir), []);

  const league = readData(dir, 'league.json');
  assert.equal(league.source, 'espn');
  assert.equal(league.generatedAt, '2026-11-16T17:00:00Z');
  assert.equal(league.league.id, LEAGUE_ID);
  assert.equal(league.teams.length, 12);
  assert.equal(league.nfl.source, 'espn');
  assert.equal(league.draft.length, 192);
  assert.equal(league.lastWeekLineups.week, 9);
  assert.deepEqual(validate(league, { leagueId: LEAGUE_ID, season: 2026 }), []);

  const history = readData(dir, 'history.json');
  assert.equal(history.source, 'espn');
  assert.deepEqual(history.seasons.map((s) => s.season), PAST_YEARS);
  assert.deepEqual(validateHistory(history), []);

  const status = readData(dir, 'status.json');
  assert.deepEqual(
    [status.ok, status.reason, status.lastAttempt, status.lastSuccess, status.consecutiveFailures],
    [true, 'ok', '2026-11-16T17:00:00Z', '2026-11-16T17:00:00Z', 0],
  );
  assert.equal(status.internal.fromSample, undefined);

  // Apart from the source stamps, real data built from the same answers equals the placeholder.
  const sample = JSON.parse(Buffer.from(placeholder['league.json'], 'base64').toString('utf8'));
  for (const key of ['league', 'teams', 'matchups', 'lastWeekLineups', 'draft']) assert.deepEqual(league[key], sample[key]);

  // One combined request for the season, the optional extras, then each past season once.
  assert.deepEqual(mock.requests.map((r) => r.kind), ['current', 'proSchedule', 'lineups', 'draft', 'players', ...PAST_YEARS.map(() => 'history')]);
});

test('unchanged data produces no write at all', async (t) => {
  const { mock, dir } = await setup(t);
  await sync(mock, dir, { now: later(1) });
  const before = snapshot(dir);
  const stamps = ['league.json', 'history.json', 'status.json'].map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
  mock.requests.length = 0;

  const again = await sync(mock, dir, { now: later(2) });

  assert.equal(again.exitCode, 0);
  assert.equal(again.outcome.ok, true);
  assert.deepEqual(again.wrote, { league: false, history: false, status: false });
  assert.equal(again.commitMessage, null);
  assert.deepEqual(snapshot(dir), before, 'all three files byte-identical');
  assert.deepEqual(['league.json', 'history.json', 'status.json'].map((f) => fs.statSync(path.join(dir, f)).mtimeMs), stamps);
  assert.equal(readData(dir, 'league.json').generatedAt, '2026-11-16T16:00:00Z', 'generatedAt only moves when data changes');
  // The draft never changes, so it is not fetched again. Past seasons are refreshed weekly.
  assert.deepEqual(mock.requests.map((r) => r.kind), ['current', 'proSchedule', 'lineups']);
  assert.ok(again.log.some((l) => l.includes('league.json: nothing changed')));
});

test('a real change is written, and only then does generatedAt move', async (t) => {
  const { mock, dir } = await setup(t);
  await sync(mock, dir, { now: later(1) });
  mock.behavior.transform = (kind, raw) => {
    if (kind !== 'current') return raw;
    const live = raw.schedule.find((m) => m.matchupPeriodId === 10);
    live.home.totalPointsLive += 6.5; // a Monday night touchdown
    return raw;
  };
  const result = await sync(mock, dir, { now: later(2) });
  assert.deepEqual(result.wrote, { league: true, history: false, status: true });
  assert.ok(result.log.some((l) => l.includes('league.json: changed (matchups)')));
  const league = readData(dir, 'league.json');
  assert.equal(league.generatedAt, '2026-11-16T17:00:00Z');
  assert.equal(readData(dir, 'status.json').lastSuccess, '2026-11-16T17:00:00Z');
});

test('season is automatic: next August, before the league is renewed, last season is still served', async (t) => {
  const { mock, dir } = await setup(t);
  const august = new Date('2027-08-20T12:00:00Z');
  const result = await sync(mock, dir, { now: august });
  assert.equal(result.outcome.ok, true);
  assert.deepEqual(mock.requests.slice(0, 2).map((r) => r.season), [2027, 2026]);
  assert.equal(readData(dir, 'league.json').league.season, 2026);
  assert.ok(result.log.some((l) => l.includes('season 2027 was not found, trying 2026')));

  // A season set by hand is not second-guessed.
  const explicit = await sync(mock, dir, { now: august, env: { ESPN_SEASON: '2027' } });
  assert.equal(explicit.outcome.reason, 'not_found');
  assert.equal(explicit.exitCode, 0);
});

// ---------------------------------------------------------------------------------------
// Optional pieces never fail the run
// ---------------------------------------------------------------------------------------

test('optional requests can all fail and the league still syncs', async (t) => {
  const { mock, dir } = await setup(t);
  Object.assign(mock.behavior, { history: 'error', proSchedule: 'error', players: 'error', byKind: { lineups: 'error', draft: 'notfound' } });

  const result = await sync(mock, dir, { now: later(1) });

  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome.ok, true);
  const league = readData(dir, 'league.json');
  assert.equal(league.source, 'espn');
  assert.equal(league.teams.length, 12);
  assert.equal(league.matchups.length, 84);
  assert.equal(league.lastWeekLineups, null);
  assert.deepEqual(league.draft, []);
  assert.deepEqual(league.nfl, { kickoffs: [], source: null }, 'placeholder kickoffs are not carried into real data');
  assert.deepEqual(validate(league), []);
  // Fake history must not sit next to real league data.
  const history = readData(dir, 'history.json');
  assert.equal(history.source, 'espn');
  assert.deepEqual(history.seasons, []);
});

test('draft names: without the player list, picks are named from rosters and the rest are left out', async (t) => {
  const { mock, dir } = await setup(t);
  mock.behavior.players = 'error';
  await sync(mock, dir, { now: later(1) });
  const draft = readData(dir, 'league.json').draft;
  assert.ok(draft.length > 150 && draft.length < 192);
  assert.ok(draft.every((p) => typeof p.name === 'string' && p.name.length > 0));
});

test('last good optional pieces are kept when a later run cannot refresh them', async (t) => {
  const { mock, dir } = await setup(t);
  await sync(mock, dir, { now: later(1) });
  const before = snapshot(dir);
  Object.assign(mock.behavior, { proSchedule: 'error', byKind: { lineups: 'error' } });

  const result = await sync(mock, dir, { now: later(2) });

  assert.equal(result.outcome.ok, true);
  assert.deepEqual(result.wrote, { league: false, history: false, status: false });
  assert.deepEqual(snapshot(dir), before);
  const league = readData(dir, 'league.json');
  assert.equal(league.lastWeekLineups.week, 9);
  assert.equal(league.nfl.kickoffs.length, 110);
});

test('past seasons: a missing one is retried once a day, and everything is refreshed weekly', async (t) => {
  const { mock, dir } = await setup(t);
  mock.behavior.missingSeasons.add(2019);
  await sync(mock, dir, { now: later(1) });
  assert.deepEqual(readData(dir, 'history.json').seasons.map((s) => s.season), [2020, 2021, 2022, 2023, 2024, 2025]);
  assert.equal(readData(dir, 'status.json').internal.historyCheckedAt, '2026-11-16T16:00:00Z');

  mock.behavior.missingSeasons.clear();
  mock.requests.length = 0;
  await sync(mock, dir, { now: later(3) });
  assert.equal(mock.count('history'), 0, 'not retried within a day');

  const nextDay = await sync(mock, dir, { now: later(26) });
  assert.deepEqual(mock.requests.filter((r) => r.kind === 'history').map((r) => r.season), [2019], 'only the missing season is fetched');
  assert.equal(nextDay.wrote.history, true);
  assert.deepEqual(readData(dir, 'history.json').seasons.map((s) => s.season), PAST_YEARS);

  mock.requests.length = 0;
  await sync(mock, dir, { now: later(50) });
  assert.equal(mock.count('history'), 0, 'complete history is left alone');

  const historyBytes = snapshot(dir)['history.json'];
  const weekly = await sync(mock, dir, { now: later(26 + 7 * 24 + 1) });
  assert.equal(mock.count('history'), 7, 'weekly refresh');
  assert.equal(weekly.wrote.history, false);
  assert.equal(snapshot(dir)['history.json'], historyBytes, 'unchanged history is not rewritten');

  // An unfinished "past" season is skipped rather than saved.
  mock.requests.length = 0;
  mock.behavior.transform = (kind, raw, season) => {
    if (kind !== 'history' || season !== 2025) return raw;
    return { ...raw, status: { ...raw.status, isActive: true }, teams: raw.teams.map((team) => ({ ...team, rankCalculatedFinal: 0 })) };
  };
  const full = await sync(mock, dir, { now: later(300), flags: { full: true } });
  assert.equal(mock.count('history'), 7, '--full refetches everything');
  assert.ok(full.log.some((l) => l.includes('2025: season is not finished, skipped')));
  assert.equal(readData(dir, 'history.json').seasons.length, 7, 'the saved copy of 2025 is kept');
});

// ---------------------------------------------------------------------------------------
// Kickoff times can be saved even while the league is private
// ---------------------------------------------------------------------------------------

test('private league, working NFL schedule: only nfl.kickoffs changes in league.json', async (t) => {
  const { mock, dir } = await setup(t);
  const before = readData(dir, 'league.json');
  mock.behavior.league = 'private';
  mock.behavior.history = 'private';
  mock.behavior.transform = (kind, raw) => {
    if (kind !== 'proSchedule') return raw;
    for (const team of raw.settings.proTeams) {
      for (const games of Object.values(team.proGamesByScoringPeriod ?? {})) for (const g of games) g.date += 5 * 60 * 1000; // flexed by five minutes
    }
    return raw;
  };

  const result = await sync(mock, dir, { now: later(1) });

  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome.reason, 'league_private');
  assert.deepEqual(result.wrote, { league: true, history: false, status: true });
  assert.equal(result.commitMessage, 'Sync NFL kickoff times');
  const after = readData(dir, 'league.json');
  assert.equal(after.source, 'placeholder');
  assert.equal(after.generatedAt, before.generatedAt);
  assert.equal(after.nfl.source, 'espn');
  assert.equal(after.nfl.kickoffs.length, before.nfl.kickoffs.length);
  assert.equal(after.nfl.kickoffs[0], '2026-09-11T00:20:00Z');
  assert.deepEqual({ ...after, nfl: null }, { ...before, nfl: null }, 'nothing else is touched');
  assert.equal(readData(dir, 'status.json').ok, false);

  // The same answer again changes nothing.
  const bytes = snapshot(dir)['league.json'];
  const again = await sync(mock, dir, { now: later(2) });
  assert.equal(again.wrote.league, false);
  assert.equal(snapshot(dir)['league.json'], bytes);
});

// ---------------------------------------------------------------------------------------
// status.json: rewritten only on a change, on written data, or once a day
// ---------------------------------------------------------------------------------------

test('status.json is not rewritten every run, only on a change or after 24 hours', async (t) => {
  const { mock, dir } = await setup(t);
  failEverything(mock, 'private');
  settleStatus(dir, { consecutiveFailures: 4 });
  const settled = snapshot(dir)['status.json'];

  const soon = await sync(mock, dir, { now: later(23) });
  assert.equal(soon.wrote.status, false);
  assert.equal(snapshot(dir)['status.json'], settled);
  assert.ok(soon.log.some((l) => l.includes('status.json: still league_private, not rewritten')));

  const heartbeat = await sync(mock, dir, { now: later(24.5) });
  assert.equal(heartbeat.wrote.status, true);
  assert.equal(heartbeat.commitMessage, 'Sync status: league_private');
  const status = readData(dir, 'status.json');
  assert.equal(status.lastAttempt, '2026-11-17T15:30:00Z');
  assert.equal(status.consecutiveFailures, 5);
  assert.equal(status.lastSuccess, null);

  // A different failure is a change and is recorded at once.
  failEverything(mock, 'error');
  const changed = await sync(mock, dir, { now: later(25) });
  assert.equal(changed.wrote.status, true);
  assert.equal(readData(dir, 'status.json').reason, 'server_error');
  assert.equal(readData(dir, 'status.json').consecutiveFailures, 6);
});

test('status rules as plain functions', () => {
  const prev = { schema: 1, ok: false, reason: 'league_private', detail: 'x', lastAttempt: '2026-11-16T15:00:00Z', lastSuccess: '2026-11-01T00:00:00Z', consecutiveFailures: 2, internal: {} };
  const fail = { ok: false, reason: 'league_private', detail: 'HTTP 401' };
  const { status } = nextStatus(prev, fail, later(1));
  assert.equal(status.lastSuccess, '2026-11-01T00:00:00Z', 'the last success is remembered through failures');
  assert.equal(status.consecutiveFailures, 3);
  assert.equal(statusWriteReason(prev, status, later(1)), null);
  assert.equal(statusWriteReason(prev, status, later(1), { dataWritten: true }), 'data was written');
  assert.equal(statusWriteReason(prev, status, later(25)), 'daily heartbeat');
  assert.match(statusWriteReason(null, status, later(1)), /no usable status/);
  assert.match(statusWriteReason({ junk: true }, status, later(1)), /no usable status/);
  const good = nextStatus(prev, { ok: true, reason: 'ok', detail: 'Synced' }, later(2)).status;
  assert.deepEqual([good.ok, good.reason, good.consecutiveFailures, good.lastSuccess], [true, 'ok', 0, '2026-11-16T17:00:00Z']);
  assert.match(statusWriteReason(prev, good, later(2)), /state changed from league_private to ok/);
});

// ---------------------------------------------------------------------------------------
// The one-time alarm when ESPN looks moved for 24 hours
// ---------------------------------------------------------------------------------------

test('alert: exits non-zero exactly once after 24 hours of "moved", then goes quiet until it recovers', async (t) => {
  const { mock, dir } = await setup(t);
  settleStatus(dir);
  const dataBefore = snapshot(dir);
  const run = async (hours, mode) => {
    failEverything(mock, mode);
    return sync(mock, dir, { now: later(hours) });
  };

  const start = await run(1, 'html');
  assert.deepEqual([start.exitCode, start.outcome.reason, start.wrote.status], [0, 'endpoint_moved', true]);
  assert.equal(readData(dir, 'status.json').internal.failingSince, '2026-11-16T16:00:00Z');

  assert.equal((await run(13, 'html')).exitCode, 0, 'not yet 24 hours');
  const blip = await run(20, 'drop');
  assert.deepEqual([blip.exitCode, blip.outcome.reason], [0, 'network']);
  assert.equal(readData(dir, 'status.json').internal.failingSince, '2026-11-16T16:00:00Z', 'a network blip does not restart the clock');

  const alarm = await run(26, 'html');
  assert.equal(alarm.exitCode, 1, 'the one failing run');
  assert.equal(alarm.alertNow, true);
  assert.equal(alarm.wrote.status, true, 'the alert must be recorded so it is not repeated');
  assert.equal(readData(dir, 'status.json').internal.alertSent, true);
  assert.ok(alarm.log.some((l) => l.startsWith('ALERT: ESPN has looked moved or changed')));
  assert.ok(alarm.log.some((l) => l.includes('DEFAULT_BASE_URLS')));

  for (const hours of [27, 28, 60, 200]) assert.equal((await run(hours, 'html')).exitCode, 0, `quiet at +${hours}h`);
  assert.equal((await run(201, 'notfound')).exitCode, 0, 'a different "moved" reason in the same episode stays quiet');

  // Through all of that the data was never touched.
  assert.equal(snapshot(dir)['league.json'], dataBefore['league.json']);
  assert.equal(snapshot(dir)['history.json'], dataBefore['history.json']);

  // ESPN answers sensibly again (even "private" proves the address is alive): the alarm re-arms.
  const alive = await run(202, 'private');
  assert.equal(alive.exitCode, 0);
  assert.deepEqual(readData(dir, 'status.json').internal.failingSince, null);
  assert.equal(readData(dir, 'status.json').internal.alertSent, false);
  assert.equal((await run(203, 'truncated')).exitCode, 0);
  assert.equal((await run(226, 'truncated')).exitCode, 0, '23 hours into the new episode');
  assert.equal((await run(228, 'truncated')).exitCode, 1, 'a new episode alerts once again');
  assert.equal((await run(229, 'truncated')).exitCode, 0);
});

test('alert: a private league or a flaky network never raises it, and --dry-run never does', async (t) => {
  const { mock, dir } = await setup(t);
  settleStatus(dir);
  for (const mode of ['private', 'error', 'drop', 'ratelimit']) {
    failEverything(mock, mode);
    for (const hours of [1, 30, 100, 500]) assert.equal((await sync(mock, dir, { now: later(hours) })).exitCode, 0, `${mode} at +${hours}h`);
  }
  settleStatus(dir, { reason: 'not_found', internal: { failingSince: NOW.toISOString(), alertSent: false, historyCheckedAt: null } });
  failEverything(mock, 'notfound');
  const before = snapshot(dir);
  const dry = await sync(mock, dir, { now: later(30), flags: { dryRun: true } });
  assert.equal(dry.exitCode, 0);
  assert.deepEqual(snapshot(dir), before);
  assert.equal((await sync(mock, dir, { now: later(30) })).exitCode, 1, 'the real run still alerts');
});

// ---------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------

test('--window-only: outside a game window it makes no request and writes nothing', async (t) => {
  const { mock, dir } = await setup(t);
  const before = snapshot(dir);
  const result = await sync(mock, dir, { now: OUTSIDE_WINDOW, flags: { windowOnly: true } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.skipped, 'outside-window');
  assert.equal(mock.requests.length, 0);
  assert.deepEqual(snapshot(dir), before);
  assert.ok(result.log.some((l) => /Game window \(kickoffs\): outside/.test(l)));
});

test('--window-only: inside a game window it fetches, reusing what rarely changes', async (t) => {
  const { mock, dir } = await setup(t);
  // First contact happens during a game: everything is fetched, past seasons included.
  const first = await sync(mock, dir, { now: INSIDE_WINDOW, flags: { windowOnly: true } });
  assert.equal(first.outcome.ok, true);
  assert.deepEqual(first.wrote, { league: true, history: true, status: true });
  assert.equal(mock.count('history'), 7);
  assert.ok(first.log.some((l) => /Game window \(kickoffs\): INSIDE/.test(l)));

  // Ten minutes later: one request, nothing new, nothing written.
  mock.requests.length = 0;
  const before = snapshot(dir);
  const second = await sync(mock, dir, { now: new Date(INSIDE_WINDOW.getTime() + 10 * 60 * 1000), flags: { windowOnly: true } });
  assert.deepEqual(mock.requests.map((r) => r.kind), ['current']);
  assert.deepEqual(second.wrote, { league: false, history: false, status: false });
  assert.deepEqual(snapshot(dir), before);
  const league = readData(dir, 'league.json');
  assert.equal(league.lastWeekLineups.week, 9);
  assert.equal(league.draft.length, 192);
  assert.equal(league.nfl.kickoffs.length, 110);
});

test('--window-only with no saved kickoffs falls back to the Eastern clock rules', async (t) => {
  const { mock, dir } = await setup(t, { seeded: false });
  failEverything(mock, 'private');
  const sundayAfternoon = await sync(mock, dir, { now: new Date('2026-11-15T19:00:00Z'), flags: { windowOnly: true } });
  assert.ok(sundayAfternoon.log.some((l) => /Game window \(clock-rules\): INSIDE/.test(l)));
  assert.ok(mock.requests.length > 0);
  mock.requests.length = 0;
  const wednesday = await sync(mock, dir, { now: new Date('2026-11-18T19:00:00Z'), flags: { windowOnly: true } });
  assert.equal(wednesday.skipped, 'outside-window');
  assert.equal(mock.requests.length, 0);
});

test('--dry-run fetches and reports but writes nothing', async (t) => {
  const { mock, dir } = await setup(t);
  const before = snapshot(dir);
  const result = await sync(mock, dir, { now: later(1), flags: { dryRun: true } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome.ok, true);
  assert.deepEqual(result.wrote, { league: false, history: false, status: false });
  assert.deepEqual(snapshot(dir), before);
  assert.deepEqual(strayFiles(dir), []);
  assert.ok(result.log.some((l) => l.includes('DRY RUN: would write league.json')));
  assert.ok(result.log.some((l) => l.includes('league.json: changed (source, nfl)')));
});

test('--sample builds valid placeholder files, is repeatable, and refuses to replace real data', async (t) => {
  const { mock, dir } = await setup(t, { seeded: false });
  const first = await seedSample(dir);
  assert.deepEqual(first.wrote, { league: true, history: true, status: true });
  const league = readData(dir, 'league.json');
  const history = readData(dir, 'history.json');
  const status = readData(dir, 'status.json');
  assert.equal(league.source, 'placeholder');
  assert.equal(history.source, 'placeholder');
  assert.deepEqual(validate(league), []);
  assert.deepEqual(validateHistory(history), []);
  assert.deepEqual([status.schema, status.ok, status.reason, status.lastSuccess, status.consecutiveFailures], [1, false, 'league_private', null, 0]);

  const before = snapshot(dir);
  const repeat = await seedSample(dir, later(5));
  assert.deepEqual(repeat.wrote, { league: false, history: false, status: false });
  assert.deepEqual(snapshot(dir), before, 'running it again changes nothing');

  // Once real data is saved, --sample must not clobber it.
  await sync(mock, dir, { now: later(6) });
  const real = snapshot(dir);
  const refused = await sync(null, dir, { flags: { sample: true } });
  assert.equal(refused.exitCode, 1);
  assert.ok(refused.log.some((l) => l.startsWith('REFUSED')));
  assert.deepEqual(snapshot(dir), real);

  const forced = await sync(null, dir, { flags: { sample: true, force: true } });
  assert.equal(forced.exitCode, 0);
  assert.equal(readData(dir, 'league.json').source, 'placeholder');
  assert.equal(readData(dir, 'history.json').source, 'placeholder');
  assert.equal(readData(dir, 'status.json').reason, 'league_private');
});

test('command line flags', () => {
  assert.deepEqual(parseArgs([]).flags, { sample: false, force: false, dryRun: false, windowOnly: false, full: false, help: false });
  const parsed = parseArgs(['--window-only', '--dry-run', '--season=2025', '--league=42', '--full']);
  assert.deepEqual(parsed.flags, { sample: false, force: false, dryRun: true, windowOnly: true, full: true, help: false });
  assert.deepEqual(parsed.env, { ESPN_SEASON: '2025', ESPN_LEAGUE_ID: '42' });
  assert.deepEqual(parseArgs(['--sample', '--force', '--nope', 'extra']).unknown, ['--nope', 'extra']);
});

// ---------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------

test('logs: a shape report on success, and never a response body, name list or member id', async (t) => {
  const { mock, dir } = await setup(t);
  const good = await sync(mock, dir, { now: later(1) });
  const text = good.log.join('\n');
  assert.match(text, /Shape report: which of the ESPN fields we rely on came back/);
  assert.match(text, /12\/12 +teams\[\]\.record\.overall\.wins/);
  assert.match(text, /6\/84 +schedule\[\]\.home\.totalPointsLive/);
  assert.match(text, /192\/192 +draftDetail\.picks\[\]\.playerId/);
  assert.match(text, /every required field came back/);
  assert.match(text, /requests made: 12/);
  assert.doesNotMatch(text, GUID_PATTERN);
  assert.doesNotMatch(text, /Placeholder|placeholder_member|Commish|Scoregasms|Thackeray/);
  assert.doesNotMatch(text, /"teams"|"members"/);

  // When ESPN drops a field we rely on, the report says exactly which.
  mock.behavior.transform = (kind, raw) => {
    if (kind !== 'current') return raw;
    for (const team of raw.teams) delete team.playoffSeed;
    delete raw.settings.rosterSettings;
    return raw;
  };
  const partial = await sync(mock, dir, { now: later(2) });
  assert.equal(partial.outcome.ok, true, 'optional-ish fields going missing does not break the sync');
  const report = partial.log.join('\n');
  assert.match(report, /MISSING +settings\.rosterSettings\.lineupSlotCounts/);
  assert.match(report, /0\/12 +teams\[\]\.playoffSeed/);
  assert.match(report, /2 expected field\(s\) did not come back: settings\.rosterSettings\.lineupSlotCounts, teams\[\]\.playoffSeed/);
  const league = readData(dir, 'league.json');
  assert.ok(league.teams.every((team) => team.seed === 0));
  assert.deepEqual(league.league.starterSlots, {});
});

// ---------------------------------------------------------------------------------------
// The real command, as the workflow runs it
// ---------------------------------------------------------------------------------------

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(SCRIPTS_DIR, 'sync-espn.mjs'), ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 30000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

test('command line: a private league exits 0 and tells GitHub what to commit', async (t) => {
  const { mock, dir } = await setup(t);
  failEverything(mock, 'private');
  const outputFile = path.join(dir, 'github-output.txt');
  const summaryFile = path.join(dir, 'github-summary.md');
  const env = {
    ESPN_BASE_URLS: mock.url, LEAGUE_WORLD_DATA_DIR: dir, LEAGUE_WORLD_NOW: later(1).toISOString(),
    ESPN_TIMEOUT_MS: '2000', ESPN_BACKOFF_MS: '1', GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile,
  };
  const before = snapshot(dir);

  const result = await runCli([], env);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ESPN: league_private, HTTP 401 from 127\.0\.0\.1:\d+ \(AUTH_LEAGUE_NOT_VISIBLE\)/);
  assert.match(result.stdout, /::notice title=League sync::The league is still private/);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'commit_message=Sync status: league_private\n');
  assert.match(fs.readFileSync(summaryFile, 'utf8'), /Result: \*\*league_private\*\*/);
  assert.equal(snapshot(dir)['league.json'], before['league.json']);
  assert.equal(readData(dir, 'status.json').reason, 'league_private');

  // Public: same command, real data, commit message names the week.
  mock.reset();
  fs.rmSync(outputFile);
  const good = await runCli([], { ...env, LEAGUE_WORLD_NOW: later(2).toISOString() });
  assert.equal(good.code, 0, good.stderr);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'commit_message=Sync league data (week 10)\n');
  assert.equal(readData(dir, 'league.json').source, 'espn');
  assert.match(good.stdout, /every required field came back/);

  // Outside a game window the frequent job does nothing and says nothing to commit.
  fs.rmSync(outputFile);
  const idle = await runCli(['--window-only'], { ...env, LEAGUE_WORLD_NOW: later(3).toISOString() });
  assert.equal(idle.code, 0);
  assert.equal(fs.existsSync(outputFile), false);
  assert.match(idle.stdout, /Nothing to do/);
});

test('command line: the 24 hour alert exits 1, an unknown option exits 2, --help exits 0', async (t) => {
  const { mock, dir } = await setup(t);
  const env = { ESPN_BASE_URLS: mock.url, LEAGUE_WORLD_DATA_DIR: dir, ESPN_BACKOFF_MS: '1', GITHUB_ACTIONS: 'true' };
  settleStatus(dir, { reason: 'endpoint_moved', internal: { failingSince: NOW.toISOString(), alertSent: false, historyCheckedAt: null } });
  failEverything(mock, 'html');
  const before = snapshot(dir);

  const alarm = await runCli([], { ...env, LEAGUE_WORLD_NOW: later(25).toISOString() });
  assert.equal(alarm.code, 1);
  assert.match(alarm.stdout, /::error title=League sync::ESPN has not answered properly for 24\+ hours/);
  assert.equal(readData(dir, 'status.json').internal.alertSent, true);
  assert.equal(snapshot(dir)['league.json'], before['league.json']);
  const after = await runCli([], { ...env, LEAGUE_WORLD_NOW: later(26).toISOString() });
  assert.equal(after.code, 0);

  const bogus = await runCli(['--bogus'], env);
  assert.equal(bogus.code, 2);
  assert.match(bogus.stderr, /Unknown option: --bogus/);
  const help = await runCli(['--help'], env);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage:/);
});
