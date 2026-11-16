/**
 * helpers.mjs: shared bits for the sync tests (scripts/test/sync-*.test.mjs).
 * Lives outside scripts/test/ so the test runner never mistakes it for a test file.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSync } from '../sync-espn.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.resolve(HERE, '..');
export const FIXTURE_DIR = path.join(SCRIPTS_DIR, 'fixtures');
export const SEASON = 2026;
export const LEAGUE_ID = 70578866;

/** The fixture's "now": Monday Nov 16 2026, 10am Eastern, before the Monday night game. */
export const NOW = new Date('2026-11-16T15:00:00Z');
export const HOUR = 60 * 60 * 1000;
export const later = (hours, from = NOW) => new Date(from.getTime() + hours * HOUR);

/** Short timeouts and no real waiting so the failure rehearsals run fast. */
export const FAST = Object.freeze({ timeoutMs: 400, retries: 2, backoffMs: 1 });

export function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

/** Everything normalizeLeague wants, straight from the fixtures. */
export function rawSeason() {
  return {
    main: loadFixture(`espn-${SEASON}.json`),
    lineups: loadFixture(`espn-${SEASON}-week9-lineups.json`),
    draft: loadFixture(`espn-${SEASON}-draft.json`),
    players: loadFixture(`espn-${SEASON}-players.json`),
    proSchedule: loadFixture(`pro-schedule-${SEASON}.json`),
  };
}

export const PAST_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

/** A scratch world/data folder that is removed when the test ends. */
export function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'league-world-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const FILES = ['league.json', 'history.json', 'status.json'];

/** The exact bytes of the three data files (null when a file does not exist). */
export function snapshot(dir) {
  const out = {};
  for (const name of FILES) {
    const file = path.join(dir, name);
    out[name] = fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null;
  }
  return out;
}

export function readData(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

export function writeData(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

/** Leftover temp files would mean a write was not atomic or not cleaned up. */
export function strayFiles(dir) {
  return fs.readdirSync(dir).filter((name) => !FILES.includes(name));
}

/** Run the sync quietly against a mock server. */
export function sync(mock, dir, { flags = {}, now = NOW, env = {}, clientOptions = {} } = {}) {
  return runSync({
    flags,
    now,
    dataDir: dir,
    env: { ESPN_BASE_URLS: mock ? mock.url : 'http://127.0.0.1:9/unused', ...env },
    clientOptions: { ...FAST, ...clientOptions },
    log: () => {},
  });
}

/** Put the placeholder files in a scratch folder, exactly as `npm run sample` would. */
export async function seedSample(dir, now = NOW) {
  const result = await runSync({ flags: { sample: true }, now, dataDir: dir, log: () => {} });
  if (result.exitCode !== 0) throw new Error('could not seed the placeholder data');
  return result;
}

/**
 * Make the saved status look like an ordinary earlier run (the placeholder status is
 * always replaced on the first real attempt, which would hide the "no rewrite" rules).
 */
export function settleStatus(dir, patch = {}, now = NOW) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeData(dir, 'status.json', {
    schema: 1,
    ok: false,
    reason: 'league_private',
    detail: 'HTTP 401 from an earlier run',
    lastAttempt: stamp,
    lastSuccess: null,
    consecutiveFailures: 1,
    internal: { failingSince: null, alertSent: false, historyCheckedAt: null },
    ...patch,
  });
}
