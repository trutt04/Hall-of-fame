#!/usr/bin/env node
/**
 * sync-espn.mjs
 *
 * Fetches the league from ESPN's unofficial fantasy API and saves what the 3D world reads:
 *
 *   world/data/league.json    current season   (Contract 1 in world/ARCHITECTURE.md)
 *   world/data/history.json   past seasons     (Contract 2)
 *   world/data/status.json    sync health      (Contract 3)
 *
 * Run by .github/workflows/espn-sync.yml on a schedule. The browser never calls ESPN.
 *
 *   node scripts/sync-espn.mjs                fetch now
 *   node scripts/sync-espn.mjs --window-only  fetch only if an NFL game is on (the 10 minute job)
 *   node scripts/sync-espn.mjs --full         fetch now and re-fetch the pieces that are normally reused
 *   node scripts/sync-espn.mjs --dry-run      fetch, print what would change, write nothing
 *   node scripts/sync-espn.mjs --sample       rebuild the placeholder files from scripts/fixtures/
 *                                             (refuses to replace real ESPN data unless --force)
 *
 * The rules this script lives by:
 *   - ESPN is fetched, normalized, validated, and only then compared with the saved file.
 *     A file is written ONLY when something real changed (the generatedAt stamp is ignored).
 *   - On ANY failure league.json and history.json are left byte-for-byte untouched and the
 *     process exits 0. A private league (HTTP 401) is an expected state, not an error.
 *   - It exits non-zero only for a genuine bug, and exactly ONCE when ESPN looks moved or
 *     changed (endpoint_moved / not_found / bad_shape) for 24 hours straight, so that GitHub
 *     emails the repo owner. After that it goes back to exiting 0 until things recover.
 *   - status.json is rewritten only when the state changes, when data was written, or once a
 *     day (that daily write also keeps GitHub from switching the schedule off after 60 quiet
 *     days). Because of that, status.json's lastAttempt and consecutiveFailures describe the
 *     last RECORDED run, not every run.
 *   - No cookies, tokens or passwords in this repo. A PUBLIC league needs no login at all,
 *     and that is the default path. For a PRIVATE league the owner's two ESPN cookies are
 *     read from the environment (GitHub Actions Secrets), sent only to ESPN, and scrubbed out
 *     of every line this script prints or writes. See scripts/lib/espn-login.mjs.
 *
 * Environment variables (all optional):
 *   ESPN_BASE_URLS   comma separated API roots to try in order (a one-line fix if ESPN moves)
 *   ESPN_LEAGUE_ID   default 70578866
 *   ESPN_SEASON      default: automatic (Aug to Dec = this year, Jan to Jul = last year)
 *   ESPN_S2          the espn_s2 browser cookie, for a PRIVATE league (a GitHub secret)
 *   ESPN_SWID        the SWID browser cookie, for a PRIVATE league (a GitHub secret)
 *                    Both are needed, or neither. They are never written or printed.
 * For rehearsals only (see scripts/testing/mock-espn.mjs):
 *   LEAGUE_WORLD_DATA_DIR   write somewhere other than world/data
 *   LEAGUE_WORLD_NOW        pretend it is this ISO time
 *   ESPN_TIMEOUT_MS, ESPN_RETRIES, ESPN_BACKOFF_MS
 *
 * Exit codes: 0 normal (including every ESPN failure), 1 a bug / the one-time alert /
 * --sample refusing to replace real data, 2 an unknown command line option.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createClient, readConfig, FIRST_MODERN_SEASON } from './lib/espn-client.mjs';
import { readLogin } from './lib/espn-login.mjs';
import {
  buildHistory, isoNoMs, isSeasonComplete, lineupRequestFor, normalizeKickoffs, normalizeLeague,
  normalizeSeason, validate, validateHistory, validateSeason,
} from './lib/normalize.mjs';
import { inGameWindow } from './lib/windows.mjs';
import { changedSections, prettyJson, readJson, sameIgnoringStamp, writeFileAtomic } from './lib/io.mjs';
import { shapeReport } from './lib/shape-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = path.resolve(HERE, '..', 'world', 'data');
export const DEFAULT_FIXTURE_DIR = path.join(HERE, 'fixtures');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Failures that suggest ESPN moved or changed, as opposed to a blip or a private league. */
const MOVED_LIKE = new Set(['endpoint_moved', 'not_found', 'bad_shape']);
/** Failures that prove ESPN itself answered sensibly, so the "it moved" clock stays at zero. */
const ANSWERED = new Set(['league_private', 'login_expired']);
const ALERT_AFTER_MS = DAY;
const STATUS_HEARTBEAT_MS = DAY;
const HISTORY_RETRY_MS = DAY; // while past seasons are still missing
const HISTORY_REFRESH_MS = 7 * DAY; // once we have them all
const FIRST_HISTORY_SEASON = 2019;

/** What the run log says about the login. Never a value, a length or a prefix. */
const LOGIN_STATE_TEXT = Object.freeze({
  none: 'none set, asking ESPN as the public would (a private league answers 401)',
  ready: 'using the two saved secrets',
  partial: 'INCOMPLETE, so this run has no login',
  unusable: 'UNUSABLE, so this run has no login',
});

const FLAGS = {
  '--sample': 'sample',
  '--force': 'force',
  '--dry-run': 'dryRun',
  '--window-only': 'windowOnly',
  '--full': 'full',
  '--help': 'help',
  '-h': 'help',
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function parseArgs(argv) {
  const flags = { sample: false, force: false, dryRun: false, windowOnly: false, full: false, help: false };
  const env = {};
  const unknown = [];
  for (const arg of argv) {
    if (FLAGS[arg]) flags[FLAGS[arg]] = true;
    else if (/^--season=\d{4}$/.test(arg)) env.ESPN_SEASON = arg.split('=')[1];
    else if (/^--league=\d+$/.test(arg)) env.ESPN_LEAGUE_ID = arg.split('=')[1];
    else unknown.push(arg);
  }
  return { flags, env, unknown };
}

const USAGE = `Usage: node scripts/sync-espn.mjs [--window-only] [--full] [--dry-run] [--sample [--force]] [--season=YYYY] [--league=ID]`;

// ---------------------------------------------------------------------------------------
// status.json
// ---------------------------------------------------------------------------------------

function usableStatus(raw) {
  return isObj(raw) && raw.schema === 1 && typeof raw.ok === 'boolean' && typeof raw.reason === 'string' ? raw : null;
}

const validIso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/**
 * The status to record for this run, and whether this is the run that should raise the
 * one-time "ESPN probably moved" alarm.
 */
export function nextStatus(prevRaw, outcome, now, { historyCheckedAt = null } = {}) {
  const prev = usableStatus(prevRaw);
  const prevInternal = isObj(prev?.internal) ? prev.internal : {};
  const nowIso = isoNoMs(now);

  const alive = outcome.ok || ANSWERED.has(outcome.reason); // ESPN answered sensibly
  const movedLike = !outcome.ok && MOVED_LIKE.has(outcome.reason);
  const failingSince = alive ? null : validIso(prevInternal.failingSince) ?? (movedLike ? nowIso : null);
  let alertSent = alive ? false : prevInternal.alertSent === true;
  const alertNow = movedLike && !alertSent && failingSince !== null && now.getTime() - Date.parse(failingSince) >= ALERT_AFTER_MS;
  if (alertNow) alertSent = true;

  const previousFailures = prev && !prev.ok && Number.isInteger(prev.consecutiveFailures) ? Math.max(0, prev.consecutiveFailures) : 0;
  return {
    alertNow,
    status: {
      schema: 1,
      ok: outcome.ok,
      reason: outcome.ok ? 'ok' : outcome.reason,
      detail: String(outcome.detail ?? '').slice(0, 300),
      lastAttempt: nowIso,
      lastSuccess: outcome.ok ? nowIso : validIso(prev?.lastSuccess),
      consecutiveFailures: outcome.ok ? 0 : previousFailures + 1,
      internal: {
        failingSince,
        alertSent,
        historyCheckedAt: historyCheckedAt ?? validIso(prevInternal.historyCheckedAt),
      },
    },
  };
}

/** Why status.json should be rewritten this run, or null to leave it alone (no commit). */
export function statusWriteReason(prevRaw, next, now, { dataWritten = false, historyChecked = false, alertNow = false } = {}) {
  const prev = usableStatus(prevRaw);
  if (!prev) return 'there was no usable status file';
  if (prev.internal?.fromSample === true) return 'first real attempt after the placeholder';
  if (prev.ok !== next.ok || prev.reason !== next.reason) return `state changed from ${prev.reason} to ${next.reason}`;
  if (alertNow) return 'the one-time alert was raised';
  if (dataWritten) return 'data was written';
  if (historyChecked) return 'past seasons were checked';
  const age = now.getTime() - Date.parse(prev.lastAttempt);
  if (!Number.isFinite(age) || age > STATUS_HEARTBEAT_MS) return 'daily heartbeat';
  return null;
}

// ---------------------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------------------

function makeContext(options) {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? env.LEAGUE_WORLD_DATA_DIR ?? DEFAULT_DATA_DIR;
  const lines = [];
  const print = options.log ?? ((line) => console.log(line));
  // The login is read once, here, so that ctx.scrub guards every line of the run including
  // the ones written before the first request.
  const login = readLogin(env);
  return {
    env,
    login,
    scrub: login.scrub,
    flags: { sample: false, force: false, dryRun: false, windowOnly: false, full: false, ...options.flags },
    now: options.now ?? (validIso(env.LEAGUE_WORLD_NOW) ? new Date(env.LEAGUE_WORLD_NOW) : new Date()),
    paths: {
      league: path.join(dataDir, 'league.json'),
      history: path.join(dataDir, 'history.json'),
      status: path.join(dataDir, 'status.json'),
    },
    fixtureDir: options.fixtureDir ?? DEFAULT_FIXTURE_DIR,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    clientOptions: options.clientOptions ?? {},
    lines,
    log: (line = '') => {
      // Last line of defence: no secret value can reach stdout, the Actions log, the run
      // log this function returns, or an annotation, whatever built the string.
      const safe = login.scrub(String(line));
      lines.push(safe);
      print(safe);
    },
  };
}

function save(ctx, file, value, what) {
  if (ctx.flags.dryRun) {
    ctx.log(`  DRY RUN: would write ${what}`);
    return false;
  }
  // Every one of these files is committed to a PUBLIC repo and served from the public site,
  // so the bytes go through the scrubber on the way out as well. With no login configured
  // the scrubber is the identity function and the bytes are exactly what they always were.
  writeFileAtomic(file, ctx.scrub(prettyJson(value)));
  return true;
}

function leagueSummary(league) {
  const withRoster = league.teams.filter((t) => t.roster).length;
  const lw = league.lastWeekLineups;
  return [
    `${league.league.teamCount} teams`,
    `season ${league.league.season}`,
    `week ${league.league.currentWeek}`,
    `${league.matchups.length} matchups`,
    `rosters for ${withRoster} teams`,
    lw ? `lineups for week ${lw.week} (${Object.keys(lw.teams).length} teams)` : 'no last-week lineups',
    `${league.draft.length} draft picks`,
    `${league.nfl.kickoffs.length} kickoffs`,
  ].join(', ');
}

/** Tell the GitHub Actions run page what happened (no-ops everywhere else). */
function reportToGitHub(ctx, { commitMessage, level, title, message, summary }) {
  const { env, scrub } = ctx;
  // GitHub masks the exact value of a secret, but not a sliced, flattened or url-encoded one,
  // so these three sinks are scrubbed by us before GitHub ever sees them.
  if (env.GITHUB_ACTIONS === 'true' && message) ctx.log(`::${level} title=${title}::${scrub(message).replace(/\r?\n/g, ' ')}`);
  if (ctx.flags.dryRun) return;
  try {
    if (env.GITHUB_OUTPUT && commitMessage) fs.appendFileSync(env.GITHUB_OUTPUT, `commit_message=${scrub(commitMessage)}\n`);
    if (env.GITHUB_STEP_SUMMARY && summary) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${scrub(summary)}\n`);
  } catch {
    /* the summary is a nicety, never a reason to fail */
  }
}

// ---------------------------------------------------------------------------------------
// --sample
// ---------------------------------------------------------------------------------------

function loadFixture(ctx, name, required = true) {
  const file = path.join(ctx.fixtureDir, name);
  const data = readJson(file);
  if (data === null && required) throw new Error(`Fixture ${name} is missing or unreadable. Run: node scripts/make-fixture.mjs`);
  return data;
}

function runSample(ctx) {
  const { log, flags, now, paths } = ctx;
  log('League World sync: building the PLACEHOLDER files from scripts/fixtures/');

  const seasonFiles = fs.readdirSync(ctx.fixtureDir).filter((f) => /^espn-\d{4}\.json$/.test(f)).sort();
  if (seasonFiles.length === 0) throw new Error('No fixtures found. Run: node scripts/make-fixture.mjs');
  const currentFile = seasonFiles[seasonFiles.length - 1];
  const season = Number(currentFile.match(/\d{4}/)[0]);
  const main = loadFixture(ctx, currentFile);
  const request = lineupRequestFor(main);

  // The same normalize path the live sync uses, fed from files instead of the network.
  const league = normalizeLeague(
    {
      main,
      lineups: request ? loadFixture(ctx, `espn-${season}-week${request.week}-lineups.json`, false) : null,
      draft: loadFixture(ctx, `espn-${season}-draft.json`, false),
      players: loadFixture(ctx, `espn-${season}-players.json`, false),
      proSchedule: loadFixture(ctx, `pro-schedule-${season}.json`, false),
    },
    { source: 'placeholder', generatedAt: now },
  );
  const problems = validate(league);
  if (problems.length) throw new Error(`The placeholder league failed validation:\n  ${problems.join('\n  ')}`);

  const seasons = [];
  for (const file of seasonFiles.slice(0, -1)) {
    const raw = loadFixture(ctx, file);
    const s = normalizeSeason(raw);
    if (!s || !isSeasonComplete(raw)) throw new Error(`Fixture ${file} is not a finished season`);
    seasons.push(s);
  }
  const history = buildHistory(seasons, { source: 'placeholder', generatedAt: now });
  const historyProblems = validateHistory(history);
  if (historyProblems.length) throw new Error(`The placeholder history failed validation:\n  ${historyProblems.join('\n  ')}`);

  const existing = { league: readJson(paths.league), history: readJson(paths.history), status: readJson(paths.status) };
  const real = [['league.json', existing.league], ['history.json', existing.history]].filter(([, v]) => v?.source === 'espn');
  if (real.length && !flags.force) {
    log(`REFUSED: ${real.map(([n]) => n).join(' and ')} hold real ESPN data. Not replacing them with the placeholder.`);
    log('If you really mean it, run again with --force.');
    return { exitCode: 1, wrote: { league: false, history: false, status: false } };
  }

  const wrote = { league: false, history: false, status: false };
  log(`  league.json: ${leagueSummary(league)}`);
  if (sameIgnoringStamp(existing.league, league)) log('  league.json: already up to date');
  else {
    wrote.league = save(ctx, paths.league, league, 'league.json');
    if (wrote.league) log('  league.json: written');
  }
  log(`  history.json: ${history.seasons.length} seasons (${history.seasons.map((s) => s.season).join(', ')})`);
  if (sameIgnoringStamp(existing.history, history)) log('  history.json: already up to date');
  else {
    wrote.history = save(ctx, paths.history, history, 'history.json');
    if (wrote.history) log('  history.json: written');
  }
  if (!usableStatus(existing.status) || flags.force) {
    const status = {
      schema: 1,
      ok: false,
      reason: 'league_private',
      detail: 'Placeholder data. The league is private, so nothing has come from ESPN yet.',
      lastAttempt: isoNoMs(now),
      lastSuccess: null,
      consecutiveFailures: 0,
      internal: { failingSince: null, alertSent: false, historyCheckedAt: null, fromSample: true },
    };
    wrote.status = save(ctx, paths.status, status, 'status.json');
    if (wrote.status) log('  status.json: written (ok: false, reason: league_private)');
  } else {
    log('  status.json: left as it is');
  }
  return { exitCode: 0, wrote, league, history };
}

// ---------------------------------------------------------------------------------------
// Past seasons
// ---------------------------------------------------------------------------------------

function pastSeasonsOf(main, season) {
  const listed = (Array.isArray(main?.status?.previousSeasons) ? main.status.previousSeasons : [])
    .filter((y) => Number.isInteger(y) && y >= FIRST_MODERN_SEASON && y < season);
  if (listed.length) return [...new Set(listed)].sort((a, b) => a - b);
  const range = [];
  for (let y = FIRST_HISTORY_SEASON; y < season; y++) range.push(y);
  return range;
}

async function syncHistory(ctx, { client, main, season, existing, prevStatus, light }) {
  const { log, flags, now } = ctx;
  const wanted = pastSeasonsOf(main, season);
  const haveReal = existing?.source === 'espn' && Array.isArray(existing.seasons);
  const have = new Map(haveReal ? existing.seasons.filter((s) => Number.isInteger(s?.season)).map((s) => [s.season, s]) : []);
  const missing = wanted.filter((y) => !have.has(y));
  const lastCheck = Date.parse(usableStatus(prevStatus)?.internal?.historyCheckedAt ?? '');
  const sinceCheck = Number.isFinite(lastCheck) ? now.getTime() - lastCheck : Infinity;

  let toFetch = [];
  let why = '';
  if (flags.full) [toFetch, why] = [wanted, 'full run'];
  else if (!haveReal) {
    if (sinceCheck >= HISTORY_RETRY_MS) [toFetch, why] = [wanted, 'no real past seasons saved yet'];
    else why = 'no real past seasons yet, but they were tried less than a day ago';
  } else if (missing.length) {
    if (light) why = `${missing.length} season(s) still missing, left for the hourly run`;
    else if (sinceCheck >= HISTORY_RETRY_MS) [toFetch, why] = [missing, `still missing ${missing.join(', ')}`];
    else why = `${missing.length} season(s) still missing, retried once a day`;
  } else if (!light && sinceCheck >= HISTORY_REFRESH_MS) [toFetch, why] = [wanted, 'weekly refresh'];
  else why = 'all past seasons saved, refreshed weekly';

  log(`Past seasons: want ${wanted.join(', ') || '(none)'}; ${toFetch.length ? `fetching ${toFetch.join(', ')} (${why})` : `not fetching (${why})`}`);

  const fresh = new Map();
  let sampleRaw = null;
  let sampleYear = null;
  for (const year of toFetch) {
    if (client.timeLeft() < 20000) {
      log('  stopping early: this run is almost out of time');
      break;
    }
    const res = await client.fetchPastSeason(year);
    if (!res.ok) {
      if (['rate_limited', 'network', 'server_error'].includes(res.reason)) {
        log('  stopping past seasons for this run: ESPN is not answering well');
        break;
      }
      continue;
    }
    let s = null;
    try {
      s = normalizeSeason(res.data);
    } catch (err) {
      log(`  ${year}: could not be read (${err.message})`);
      continue;
    }
    if (!s || s.season !== year) log(`  ${year}: the answer was not that season, skipped`);
    else if (!isSeasonComplete(res.data)) log(`  ${year}: season is not finished, skipped`);
    else {
      const problems = validateSeason(s);
      if (problems.length) log(`  ${year}: failed checks, skipped (${problems.slice(0, 2).join('; ')})`);
      else {
        fresh.set(year, s);
        sampleRaw = res.data;
        sampleYear = year;
        log(`  ${year}: ${s.teams.length} teams, ${s.games.length} games`);
      }
    }
  }

  const merged = new Map([...have, ...fresh]);
  const history = buildHistory([...merged.values()], { source: 'espn', generatedAt: now });
  const changed = !haveReal || !sameIgnoringStamp(existing, history);
  return { history, changed, attempted: toFetch.length > 0, sampleRaw, sampleYear, saved: merged.size, wanted: wanted.length };
}

// ---------------------------------------------------------------------------------------
// The live sync
// ---------------------------------------------------------------------------------------

async function runLive(ctx) {
  const { log, flags, now, paths, env, login } = ctx;
  const config = { ...readConfig(env, now), ...ctx.clientOptions };
  const wrote = { league: false, history: false, status: false };

  const existing = { league: readJson(paths.league), history: readJson(paths.history), status: readJson(paths.status) };
  const prevLeague = isObj(existing.league) && isObj(existing.league.league) && Array.isArray(existing.league.teams) ? existing.league : null;
  const prevKickoffs = Array.isArray(prevLeague?.nfl?.kickoffs) ? prevLeague.nfl.kickoffs : [];

  log(`League World sync, ${isoNoMs(now)}`);
  log(`  league ${config.leagueId}, season ${config.season}${config.seasonIsExplicit ? ' (set by hand)' : ' (automatic)'}`);
  log(`  addresses to try: ${config.baseUrls.map((b) => new URL(b).host).join(', ')}`);
  log(`  mode: ${[flags.windowOnly && 'window-only', flags.full && 'full', flags.dryRun && 'dry-run'].filter(Boolean).join(', ') || 'normal'}`);
  log(`  saved data: ${prevLeague ? `${prevLeague.source}, season ${prevLeague.league.season}, generated ${prevLeague.generatedAt}` : 'none'}`);
  log(`  ESPN login: ${LOGIN_STATE_TEXT[login.state]}`);
  if (login.note) {
    log(`  ${login.note}`);
    // A misconfigured login is worth an annotation on the run page. The note names no value.
    if (env.GITHUB_ACTIONS === 'true') log(`::warning title=ESPN login::${login.note}`);
  }

  if (flags.windowOnly) {
    const w = inGameWindow(now, prevKickoffs);
    log(`Game window (${w.basis}): ${w.inWindow ? 'INSIDE' : 'outside'}, ${w.detail}`);
    if (!w.inWindow) {
      log('Nothing to do. The hourly run fetches regardless of game windows.');
      return { exitCode: 0, skipped: 'outside-window', wrote, requests: 0 };
    }
  }

  // The cookie is handed to the client directly, not through `config`, so it never travels
  // with the object whose fields are logged above.
  const client = createClient({ ...config, cookie: login.cookie, fetchImpl: ctx.fetchImpl, log });
  const light = flags.windowOnly && !flags.full; // the frequent run reuses things that rarely change

  log('Fetching');
  const current = await client.fetchCurrentSeason({ season: config.season, explicit: config.seasonIsExplicit });
  const season = current.ok ? current.season : config.season;

  // The NFL schedule is not league-specific, so it may answer even while the league is private.
  let pro = null;
  const savedRealKickoffs = prevLeague?.nfl?.source === 'espn' && prevKickoffs.length > 0 && prevLeague.league.season === season;
  if (light && savedRealKickoffs) log('  NFL schedule: reusing the saved kickoff times (frequent run)');
  else if (!current.ok && ['network', 'rate_limited', 'server_error'].includes(current.reason)) log('  NFL schedule: skipped, ESPN is not answering');
  else pro = await client.fetchProSchedule(season);
  const freshKickoffs = pro?.ok ? normalizeKickoffs(pro.data) : [];

  const shapes = [];
  const addShape = (label, raw, kind) => shapes.push(shapeReport(label, raw, kind));

  let outcome = current.ok ? null : { ok: false, reason: current.reason, detail: current.detail };
  let league = null;
  let historyResult = null;
  let reusable = false;

  if (current.ok) {
    const main = current.data;
    reusable = prevLeague?.source === 'espn' && prevLeague.league.id === config.leagueId && prevLeague.league.season === season;

    // Optional pieces. None of these can fail the run.
    let lineups = null;
    let draft = null;
    let players = null;
    let request = null;
    try {
      request = lineupRequestFor(main);
    } catch {
      request = null;
    }
    if (!request) log('  lineups: no finished week yet');
    else if (light && reusable && prevLeague.lastWeekLineups?.week === request.week) log(`  lineups: reusing saved week ${request.week} (frequent run)`);
    else {
      const res = await client.fetchLineups(season, request.scoringPeriod);
      if (res.ok) lineups = res.data;
    }
    if (reusable && !flags.full && Array.isArray(prevLeague.draft) && prevLeague.draft.length > 0) log('  draft: reusing the saved draft (it does not change)');
    else {
      const res = await client.fetchDraft(season);
      if (res.ok) {
        draft = res.data;
        if (Array.isArray(draft?.draftDetail?.picks) && draft.draftDetail.picks.length > 0) {
          const names = await client.fetchPlayers(season); // draft picks only carry player ids
          if (names.ok) players = names.data;
        }
      }
    }

    addShape('current season (mTeam mSettings mStandings mStatus mRoster mMatchup mMatchupScore mScoreboard)', main, 'current');
    if (request) addShape(`lineups for week ${request.week} (mMatchup mMatchupScore, scoringPeriodId=${request.scoringPeriod})`, lineups, 'lineups');
    addShape('draft (mDraftDetail)', draft, 'draft');
    if (draft) addShape('player names (players_wl)', players, 'players');
    addShape('NFL schedule (proTeamSchedules_wl)', pro?.ok ? pro.data : null, 'proSchedule');

    try {
      league = normalizeLeague({ main, lineups, draft, players, proSchedule: pro?.ok ? pro.data : null }, { source: 'espn', generatedAt: now });
      // Keep the last good optional pieces when this run could not refresh them.
      if (reusable) {
        if (!league.lastWeekLineups && request && prevLeague.lastWeekLineups?.week === request.week) league.lastWeekLineups = prevLeague.lastWeekLineups;
        if (league.draft.length === 0 && Array.isArray(prevLeague.draft) && prevLeague.draft.length > 0) league.draft = prevLeague.draft;
      }
      if (league.nfl.kickoffs.length === 0 && savedRealKickoffs) league.nfl = { kickoffs: prevKickoffs, source: 'espn' };
      const problems = validate(league, { leagueId: config.leagueId, season });
      if (problems.length) {
        outcome = { ok: false, reason: 'bad_shape', detail: `ESPN answered but ${problems.length} check(s) failed: ${problems.slice(0, 3).join('; ')}` };
        log(`ESPN answered, but the data failed ${problems.length} check(s):`);
        problems.slice(0, 12).forEach((p) => log(`  - ${p}`));
        league = null;
      }
    } catch (err) {
      outcome = { ok: false, reason: 'bad_shape', detail: `ESPN answered but it could not be read: ${String(err?.message ?? err).slice(0, 160)}` };
      log(`ESPN answered, but normalizing it failed: ${err?.stack ?? err}`);
      league = null;
    }

    if (league) {
      historyResult = await syncHistory(ctx, { client, main, season, existing: existing.history, prevStatus: existing.status, light });
      if (historyResult.sampleRaw) addShape(`past season ${historyResult.sampleYear} (mTeam mSettings mStandings mMatchupScore mStatus)`, historyResult.sampleRaw, 'history');
      outcome = { ok: true, reason: 'ok', detail: `Synced season ${season}, week ${league.league.currentWeek}` };
    }
  }

  // ---- Write what changed -------------------------------------------------------------
  // One place where every detail string is cleaned, before it reaches the log, status.json,
  // the commit message, the annotation or the step summary.
  outcome = { ...outcome, detail: ctx.scrub(String(outcome.detail ?? '')) };
  log('Result');
  log(`  ESPN: ${outcome.ok ? 'OK' : outcome.reason}, ${outcome.detail}`);
  let commitMessage = null;

  if (league) {
    log(`  league.json: ${leagueSummary(league)}`);
    if (sameIgnoringStamp(existing.league, league)) log('  league.json: nothing changed, not rewritten');
    else {
      log(`  league.json: changed (${changedSections(existing.league, league).join(', ')})`);
      wrote.league = save(ctx, paths.league, league, 'league.json');
      if (prevLeague?.source === 'placeholder') log('  league.json: the placeholder has been replaced by real ESPN data');
    }
    if (!historyResult.changed) log(`  history.json: nothing changed, not rewritten (${historyResult.saved} of ${historyResult.wanted} past seasons saved)`);
    else {
      log(`  history.json: changed, ${historyResult.saved} of ${historyResult.wanted} past seasons saved`);
      wrote.history = save(ctx, paths.history, historyResult.history, 'history.json');
    }
    if (wrote.league || wrote.history) commitMessage = `Sync league data (week ${league.league.currentWeek})`;
  } else {
    log(`  league.json: left untouched${prevLeague ? ` (${prevLeague.source}, generated ${prevLeague.generatedAt})` : ' (there is none yet)'}`);
    log('  history.json: left untouched');
    // The one thing a failed league fetch may still improve: real kickoff times.
    const sameSeason = prevLeague?.league.season === season;
    if (prevLeague && sameSeason && freshKickoffs.length > 0 && JSON.stringify(freshKickoffs) !== JSON.stringify(prevKickoffs)) {
      const patched = { ...prevLeague, nfl: { ...prevLeague.nfl, kickoffs: freshKickoffs, source: 'espn' } };
      log(`  league.json: saving ${freshKickoffs.length} real NFL kickoff times into nfl.kickoffs (nothing else is touched)`);
      wrote.league = save(ctx, paths.league, patched, 'league.json (kickoff times only)');
      commitMessage = 'Sync NFL kickoff times';
    }
  }

  // ---- status.json --------------------------------------------------------------------
  const historyChecked = Boolean(historyResult?.attempted);
  const { status, alertNow } = nextStatus(existing.status, outcome, now, { historyCheckedAt: historyChecked ? isoNoMs(now) : null });
  const dataWritten = wrote.league || wrote.history;
  const writeWhy = statusWriteReason(existing.status, status, now, { dataWritten, historyChecked, alertNow });
  if (writeWhy) {
    log(`  status.json: ${status.ok ? 'ok' : status.reason} (${writeWhy})`);
    wrote.status = save(ctx, paths.status, status, 'status.json');
  } else {
    const prev = usableStatus(existing.status);
    log(`  status.json: still ${prev.reason}, not rewritten (it is rewritten on a change or once a day; last recorded ${prev.lastAttempt})`);
  }
  if (!commitMessage && wrote.status) commitMessage = `Sync status: ${status.reason}`;
  log(`  requests made: ${client.requests}`);

  // ---- Shape report -------------------------------------------------------------------
  if (shapes.length) {
    log('Shape report: which of the ESPN fields we rely on came back (names and counts only)');
    const missing = [];
    for (const s of shapes) {
      s.lines.forEach((l) => log(l));
      missing.push(...s.missing);
    }
    log(missing.length ? `  ${missing.length} expected field(s) did not come back: ${missing.join(', ')}` : '  every required field came back');
  }

  // ---- Explain the state in plain words -----------------------------------------------
  let level = 'notice';
  let message = outcome.detail;
  if (outcome.ok) {
    message = `${outcome.detail}. ${dataWritten ? 'New data saved.' : 'No changes.'}`;
  } else if (outcome.reason === 'league_private') {
    // With a usable login this reason means the login was never sent, because the address in
    // use is not an https ESPN one. A login that WAS sent and refused is login_expired below.
    message = login.state === 'ready'
      ? 'The league is still private (ESPN answered 401), and the saved login was not sent because the address in use is not an https ESPN address. Saved data was kept.'
      : 'The league is still private (ESPN answered 401). Saved data was kept. This starts working by itself once the league is made public, or once the two login secrets are set.';
    log('What this means: the league is private. Nothing is broken. Either make the league viewable to the public, or set the ESPN_S2 and ESPN_SWID secrets (see world/README.md).');
  } else if (outcome.reason === 'login_expired') {
    level = 'warning';
    message = 'The saved ESPN login no longer works, and the league is not public. Saved data was kept. Fix: copy espn_s2 and SWID from your browser again and update the ESPN_S2 and ESPN_SWID secrets.';
    log('What this means: the ESPN login stored in the GitHub secrets has expired or was replaced.');
    log('  Nothing is broken and no data was lost. The world keeps showing the last data it got.');
    log('  Fix: copy the espn_s2 and SWID cookies from your browser again and update the two secrets (see world/README.md, "When the login stops working").');
  } else {
    level = 'warning';
    message = `ESPN fetch failed (${outcome.reason}): ${outcome.detail}. Saved data was kept.`;
    log('What this means: the fetch failed, the saved data was kept, and the next run will try again.');
  }

  let exitCode = 0;
  if (alertNow && !flags.dryRun) {
    exitCode = 1;
    level = 'error';
    message = `ESPN has not answered properly for 24+ hours (${outcome.reason}: ${outcome.detail}). The unofficial API has probably moved or changed. ` +
      'Fix: update DEFAULT_BASE_URLS in scripts/lib/espn-client.mjs or set ESPN_BASE_URLS. This run fails ONCE on purpose so GitHub notifies you; later runs stay green.';
    log('');
    log('ALERT: ESPN has looked moved or changed for more than 24 hours.');
    log('  This run exits with an error ONE time so that GitHub sends a notification.');
    log('  The saved data is untouched and the world keeps working from it.');
    log('  Likely fix: a new address in DEFAULT_BASE_URLS (scripts/lib/espn-client.mjs) or the ESPN_BASE_URLS variable.');
  } else if (alertNow) {
    log('  DRY RUN: this run would have raised the one-time 24 hour alert');
  }

  reportToGitHub(ctx, {
    commitMessage,
    level,
    title: 'League sync',
    message,
    summary: `### League sync\n\n- Result: **${outcome.ok ? 'ok' : outcome.reason}**\n- ${outcome.detail}\n- Files written: ${Object.entries(wrote).filter(([, v]) => v).map(([k]) => `${k}.json`).join(', ') || 'none'}\n`,
  });

  return { exitCode, outcome, wrote, status, alertNow, commitMessage, requests: client.requests, league, history: historyResult?.history ?? null };
}

/**
 * Run the sync. Never throws for network or ESPN problems.
 * options: { flags, env, now, dataDir, fixtureDir, fetchImpl, clientOptions, log }
 * Returns { exitCode, outcome, wrote: { league, history, status }, ... }.
 */
export async function runSync(options = {}) {
  const ctx = makeContext(options);
  const result = ctx.flags.sample ? runSample(ctx) : await runLive(ctx);
  return { ...result, log: ctx.lines };
}

async function main() {
  const { flags, env, unknown } = parseArgs(process.argv.slice(2));
  // Nothing should ever pass a secret on the command line, but an echoed argv is a leak path
  // like any other, so it is scrubbed too.
  const scrub = readLogin(process.env).scrub;
  if (flags.help || unknown.length) {
    if (unknown.length) console.error(`Unknown option: ${scrub(unknown.join(' '))}`);
    console.log(USAGE);
    return unknown.length ? 2 : 0;
  }
  const result = await runSync({ flags, env: { ...process.env, ...env } });
  return result.exitCode;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // A genuine bug. Data files are only ever replaced atomically, so they are still intact.
      // The stack is scrubbed: a thrown Error is the one place a raw value could show up.
      const scrub = readLogin(process.env).scrub;
      console.error('The sync crashed (this is a bug, not an ESPN problem):');
      console.error(scrub(String(err?.stack ?? err)));
      process.exit(1);
    },
  );
}
