/**
 * espn-client.mjs
 *
 * Talks to ESPN's UNOFFICIAL fantasy football API. There is no official public API and the
 * address has moved before, so everything here is built to fail gracefully:
 *
 *   - an ordered list of base URLs is tried (override with env ESPN_BASE_URLS, comma separated)
 *   - every request has a 15 second timeout and at most 2 retries (network / 5xx / 429 only)
 *   - every failure is classified into one of the `reason` values of Contract 3 (status.json)
 *   - nothing here ever throws for a network or HTTP problem: callers get { ok: false, ... }
 *
 * A PUBLIC league needs no login and that stays the default: with no login configured this
 * client sends no cookies at all, and a private league's 401 is reported as "league_private".
 *
 * A PRIVATE league needs the owner's two ESPN browser cookies. They arrive here as ONE ready
 * made header string in the `cookie` option (built by lib/espn-login.mjs from GitHub Actions
 * Secrets) and they are handled like the login they are:
 *
 *   - sent only on league-scoped requests, never on the public NFL schedule or player list,
 *     so an expired login can never break the parts that work without one
 *   - sent only over https to an espn.com address (loopback is allowed so the tests can use
 *     the local mock), because ESPN_BASE_URLS is operator-supplied: the address the login is
 *     offered to is checked here rather than trusted
 *   - never interpolated into a detail, a log line or an error: headers are not printed here,
 *     and describeFetchError deliberately tests the fetch error message without echoing it
 *   - when ESPN answers 401 to a signed-in request, the same request is retried WITHOUT the
 *     login (a league that has since been made public still works) and otherwise reported as
 *     "login_expired", whose detail is a fixed sentence holding no value of any kind
 *
 * IF ESPN MOVES AGAIN: add the new address at the top of DEFAULT_BASE_URLS below, or set the
 * ESPN_BASE_URLS variable in the workflow. Nothing else should need to change.
 */

import { LOGIN_EXPIRED_DETAIL } from './espn-login.mjs';

export const DEFAULT_BASE_URLS = Object.freeze([
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl', // works as of November 2026
  'https://fantasy.espn.com/apis/v3/games/ffl', // the older address, kept as a fallback
]);

export const DEFAULT_LEAGUE_ID = 70578866;

/** Generic on purpose: no names, emails or repo addresses. */
export const USER_AGENT = 'league-world-sync/1.0';

/** Seasons before this one live at a different ESPN address that this client does not use. */
export const FIRST_MODERN_SEASON = 2018;

export const REASONS = Object.freeze([
  'ok', 'league_private', 'login_expired', 'not_found', 'endpoint_moved', 'rate_limited', 'server_error', 'network', 'bad_shape',
]);

/** The `?view=` sets for each kind of request. ESPN lets several views share one call. */
export const VIEWS = Object.freeze({
  current: ['mTeam', 'mSettings', 'mStandings', 'mStatus', 'mRoster', 'mMatchup', 'mMatchupScore', 'mScoreboard'],
  lineups: ['mMatchup', 'mMatchupScore'],
  draft: ['mDraftDetail'],
  history: ['mTeam', 'mSettings', 'mStandings', 'mMatchupScore', 'mStatus'],
  proSchedule: ['proTeamSchedules_wl'],
  players: ['players_wl'],
});

/**
 * The fantasy season for a date, so nobody has to edit a year by hand:
 * August to December is the current year, January to July is the previous year.
 */
export function autoSeason(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= 8 ? year : year - 1;
}

export function parseBaseUrls(value) {
  const list = String(value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => {
      try {
        return /^https?:$/.test(new URL(s).protocol);
      } catch {
        return false;
      }
    });
  return list.length ? list : [...DEFAULT_BASE_URLS];
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Settings from environment variables, with safe defaults. */
export function readConfig(env = process.env, now = new Date()) {
  const explicitSeason = positiveInt(env.ESPN_SEASON);
  return {
    baseUrls: parseBaseUrls(env.ESPN_BASE_URLS),
    leagueId: positiveInt(env.ESPN_LEAGUE_ID) ?? DEFAULT_LEAGUE_ID,
    season: explicitSeason ?? autoSeason(now),
    seasonIsExplicit: explicitSeason !== null,
    timeoutMs: positiveInt(env.ESPN_TIMEOUT_MS) ?? 15000,
    retries: nonNegativeInt(env.ESPN_RETRIES) ?? 2,
    backoffMs: nonNegativeInt(env.ESPN_BACKOFF_MS) ?? 1500,
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}

/**
 * May the login be sent to this address? Only https ESPN addresses, plus loopback so the
 * tests can point the client at scripts/testing/mock-espn.mjs. Everything else gets the
 * ordinary public request: ESPN_BASE_URLS can be set by hand, so the address a login is
 * offered to is checked instead of trusted. (Node's fetch drops a manually set Cookie header
 * on a cross-origin redirect by itself, so this guards the address we choose, not the hops.)
 */
export function mayCarryLogin(url) {
  try {
    const { protocol, hostname } = new URL(url);
    const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
    if (loopback) return protocol === 'http:' || protocol === 'https:';
    return protocol === 'https:' && (hostname === 'espn.com' || hostname.endsWith('.espn.com'));
  } catch {
    return false;
  }
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Decide what an HTTP answer means. Pure, so it is easy to test.
 * Returns { ok: true, data } or { ok: false, reason, detail, retryable }.
 */
export function classifyResponse({ status, contentType = '', body = '', host, redirectedTo = null }) {
  const text = typeof body === 'string' ? (body.charCodeAt(0) === 0xfeff ? body.slice(1) : body).trim() : '';
  const looksJson = text.startsWith('{') || text.startsWith('[');
  const looksHtml = text.startsWith('<') || /text\/html/i.test(contentType);
  const parsed = looksJson ? tryParseJson(text) : { ok: false };
  const via = redirectedTo ? ` (redirected to ${redirectedTo})` : '';
  const from = `HTTP ${status} from ${host}${via}`;

  // ESPN describes errors as { messages: [...], details: [{ type, ... }] }.
  const espnError = parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) &&
    (Array.isArray(parsed.value.details) || Array.isArray(parsed.value.messages));
  const rawType = espnError ? parsed.value.details?.[0]?.type : null;
  const espnType = typeof rawType === 'string' && /^[A-Z0-9_]{3,60}$/.test(rawType) ? rawType : null;
  const tag = espnType ? ` (${espnType})` : '';
  const fail = (reason, detail, retryable = false) => ({ ok: false, reason, detail, retryable, status, host, espnType });

  if (status >= 200 && status < 300) {
    if (parsed.ok && parsed.value !== null && typeof parsed.value === 'object') {
      return { ok: true, data: parsed.value, status, host, redirectedTo };
    }
    if (looksJson) return fail('bad_shape', `${from} but the JSON was cut off or invalid`);
    return fail('endpoint_moved', `${from} but the body is ${looksHtml ? 'a web page' : text ? 'not JSON' : 'empty'}, not JSON`);
  }
  if (status >= 300 && status < 400) return fail('endpoint_moved', `${from}: a redirect that could not be followed`);
  if (status === 401) return fail('league_private', `${from}${tag}`);
  if (status === 403) {
    return espnError
      ? fail('league_private', `${from}${tag}`)
      : fail('endpoint_moved', `${from} with no ESPN error body (blocked, or the address moved)`);
  }
  if (status === 404 || status === 410) return fail('not_found', `${from}${tag}`);
  if (status === 429) return fail('rate_limited', from, true);
  if (status >= 500) return fail('server_error', from, true);
  return fail('endpoint_moved', `${from}${tag}: unexpected answer`);
}

function describeFetchError(err, host, timedOut, timeoutMs) {
  const base = { ok: false, status: null, host, espnType: null };
  if (timedOut || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return { ...base, reason: 'network', detail: `no answer from ${host} within ${Math.round(timeoutMs / 100) / 10}s`, retryable: true };
  }
  const message = String(err?.cause?.message ?? err?.message ?? '');
  if (/redirect/i.test(message)) {
    return { ...base, reason: 'endpoint_moved', detail: `${host} redirects in a loop`, retryable: false };
  }
  const rawCode = err?.cause?.code ?? err?.code;
  const code = typeof rawCode === 'string' && /^[A-Z0-9_]{3,40}$/.test(rawCode) ? ` (${rawCode})` : '';
  return { ...base, reason: 'network', detail: `could not reach ${host}${code}`, retryable: true };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a client.
 *   baseUrls    ordered list of API roots (each ending in /apis/v3/games/ffl)
 *   leagueId    ESPN league id
 *   cookie      the finished login header from lib/espn-login.mjs, or null for no login
 *   log         function(line) for the human-readable run log
 *   fetchImpl   fetch replacement (tests)
 */
export function createClient({
  baseUrls = DEFAULT_BASE_URLS,
  leagueId = DEFAULT_LEAGUE_ID,
  cookie = null,
  timeoutMs = 15000,
  retries = 2,
  backoffMs = 1500,
  budgetMs = 150000,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  log = () => {},
} = {}) {
  const bases = baseUrls.map((b) => String(b).replace(/\/+$/, ''));
  const login = typeof cookie === 'string' && cookie !== '' ? cookie : null;
  // anonymousRefused: a cookie-free league request has already been refused in this run, so
  // repeating it for every remaining season would only add 401s. Nothing about the league's
  // visibility changes inside one run.
  const state = { base: bases[0], requests: 0, started: Date.now(), anonymousRefused: false };

  const timeLeft = () => budgetMs - (Date.now() - state.started);

  async function attempt(url, headers) {
    const host = hostOf(url);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    state.requests++;
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        // No Authorization, ever. A Cookie is present only when the caller asked for the login
        // (league-scoped requests) and only for an address allowed by mayCarryLogin().
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = await res.text();
      const finalHost = res.url ? hostOf(res.url) : host;
      const redirectedTo = res.redirected && res.url ? `${finalHost}${new URL(res.url).pathname}`.slice(0, 120) : null;
      const result = classifyResponse({
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        body,
        host,
        redirectedTo,
      });
      result.bytes = body.length;
      if (!result.ok && result.reason === 'rate_limited') {
        const after = Number(res.headers.get('retry-after'));
        if (Number.isFinite(after) && after > 0) result.retryAfterMs = Math.min(after * 1000, 20000);
      }
      return result;
    } catch (err) {
      return describeFetchError(err, host, timedOut, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET a URL as JSON with the retry policy. Never throws. */
  async function getJson(url, { label = '', headers = {}, withLogin = false } = {}) {
    const host = hostOf(url);
    const sendLogin = withLogin && login !== null && mayCarryLogin(url);
    if (withLogin && login !== null && !sendLogin) {
      log(`  ${label || 'GET'} @ ${host} -> the saved ESPN login is NOT sent to this address (only https ESPN addresses get it)`);
    }
    // The header object is built here and nowhere else, and it is never logged or returned.
    const sent = sendLogin ? { ...headers, Cookie: login } : headers;
    let result = null;
    for (let i = 0; i <= retries; i++) {
      if (timeLeft() <= 0) {
        result = { ok: false, reason: 'network', detail: `skipped ${host}: this run's time budget was used up`, retryable: false, status: null, host };
        log(`  ${label || 'GET'} @ ${host} -> skipped (out of time)`);
        break;
      }
      const t0 = Date.now();
      result = await attempt(url, sent);
      const ms = Date.now() - t0;
      const what = result.ok
        ? `OK (HTTP ${result.status}, ${result.bytes} bytes${result.redirectedTo ? `, redirected to ${result.redirectedTo}` : ''})`
        : `${result.reason}: ${result.detail}`;
      log(`  ${label || 'GET'} @ ${host} -> ${what} [${ms} ms${i > 0 ? `, retry ${i}` : ''}]`);
      if (result.ok || !result.retryable || i === retries) break;
      const wait = Math.max(backoffMs * 2 ** i, result.retryAfterMs ?? 0);
      if (wait > 0) await sleep(wait);
    }
    // Whether the login actually went out, so the caller can tell "the login was refused" from
    // "there was no login on this request". Never the value, just the fact.
    result.loginSent = sendLogin;
    return result;
  }

  function buildUrl(base, path, views, params = {}) {
    const query = new URLSearchParams();
    for (const v of views) query.append('view', v);
    for (const [k, v] of Object.entries(params)) query.append(k, String(v));
    return `${base}${path}?${query.toString()}`;
  }

  function pickFailure(failures) {
    const primary = failures[0];
    if (failures.length === 1) return primary;
    // If the first address could not even be reached, an answer from another one tells us more.
    const chosen = primary.reason === 'network' ? failures.find((f) => f.reason !== 'network') ?? primary : primary;
    const others = failures.filter((f) => f !== chosen).map((f) => `${f.host}: ${f.reason}`);
    return { ...chosen, detail: `${chosen.detail}; also tried ${others.join(', ')}` };
  }

  /** Try the base that last answered first, then the others. */
  async function cascade(path, views, params, { label, headers, tryAllBases = true, withLogin = false }) {
    const order = [state.base, ...bases.filter((b) => b !== state.base)];
    const failures = [];
    for (const base of tryAllBases ? order : order.slice(0, 1)) {
      const result = await getJson(buildUrl(base, path, views, params), { label, headers, withLogin });
      if (result.ok || result.reason === 'league_private' || result.reason === 'rate_limited') {
        state.base = base; // ESPN answered here: this address is alive
        return result;
      }
      failures.push(result);
    }
    return pickFailure(failures);
  }

  /**
   * A league-specific request for one season: the only kind that needs the login.
   *
   * If a signed-in request is refused with a 401, the same request is tried once more WITHOUT
   * the login. That matters because ESPN answers the same 401 whether the login is dead, the
   * league is private, or both: the second try is what tells "the login expired" apart from
   * "the league was made public in the meantime" (it just works).
   *
   * The second try may only UPGRADE the verdict, never replace it. A 401 on the signed-in
   * request is the authoritative word on the login, and it also proves ESPN itself is alive
   * and answering at this address. If the cookie-free try answers anything else (an HTML
   * challenge page, a 404, a 429, a dropped connection) that answer must not be allowed to
   * blame the address instead: reporting endpoint_moved or not_found here would start the 24
   * hour "ESPN moved" clock, turn the job red, and tell the owner to edit DEFAULT_BASE_URLS
   * when the real fix is to copy two cookies again.
   *
   * The promotion is keyed on the HTTP status, not on the reason: classifyResponse also maps a
   * 403 with an ESPN error body to league_private, and a 403 is ESPN forbidding the request,
   * not a statement about the login. Those stay league_private.
   *
   * The cookie-free try is made at most once per run. A run asks for the current season and
   * then up to seven past ones, and ESPN answers 401 at one season and not another, so without
   * this a stale login would double every one of those requests and push the run towards a
   * rate limit. Once a cookie-free request has been refused, the answer is known.
   */
  async function fetchLeague(season, views, params = {}, { label = `league ${season}`, tryAllBases = true } = {}) {
    const leaguePath = `/seasons/${season}/segments/0/leagues/${leagueId}`;
    const signedIn = await cascade(leaguePath, views, params, { label, tryAllBases, withLogin: true });
    // Only a login that was really sent, and really answered with a 401, can be the thing
    // ESPN refused.
    if (!signedIn.loginSent || signedIn.status !== 401) return signedIn;
    // A fixed detail, because this one is published: no value, no length, not even a host.
    const expired = { ...signedIn, reason: 'login_expired', detail: LOGIN_EXPIRED_DETAIL, retryable: false };
    if (state.anonymousRefused) return expired;

    log('  ESPN refused the signed-in request. Trying again without the login, in case the league is public now.');
    const anonymous = await cascade(leaguePath, views, params, { label: `${label}, without the login`, tryAllBases, withLogin: false });
    if (anonymous.ok) {
      log('  it worked without the login: the league is public. The saved login is not needed but looks stale.');
      return anonymous;
    }
    state.anonymousRefused = true;
    log('  that was refused too, so the saved login is the thing that stopped working.');
    return expired;
  }

  /** A game-level request (not tied to the league), e.g. the NFL schedule. */
  function fetchGame(season, subPath, views, { label = `game ${season}`, headers = {}, tryAllBases = false } = {}) {
    return cascade(`/seasons/${season}${subPath}`, views, {}, { label, headers, tryAllBases });
  }

  /**
   * The current season, combined views. If the season was picked automatically and ESPN
   * says it does not exist (yet), fall back one year.
   */
  async function fetchCurrentSeason({ season, explicit = false }) {
    const seasonsTried = [];
    let result = null;
    for (const s of explicit ? [season] : [season, season - 1]) {
      result = await fetchLeague(s, VIEWS.current, {}, { label: `current season ${s}` });
      seasonsTried.push(s);
      if (result.ok || result.reason !== 'not_found') return { ...result, season: s, seasonsTried };
      if (!explicit && s === season) log(`  season ${s} was not found, trying ${s - 1}`);
    }
    return { ...result, season, seasonsTried };
  }

  return {
    leagueId,
    bases,
    hasLogin: login !== null,
    timeLeft,
    get requests() {
      return state.requests;
    },
    get activeBase() {
      return state.base;
    },
    getJson,
    fetchLeague,
    fetchGame,
    fetchCurrentSeason,
    fetchLineups: (season, scoringPeriod) =>
      fetchLeague(season, VIEWS.lineups, { scoringPeriodId: scoringPeriod }, { label: `lineups, scoring period ${scoringPeriod}`, tryAllBases: false }),
    fetchDraft: (season) => fetchLeague(season, VIEWS.draft, {}, { label: `draft ${season}`, tryAllBases: false }),
    fetchPastSeason: (season) => fetchLeague(season, VIEWS.history, {}, { label: `past season ${season}`, tryAllBases: false }),
    fetchProSchedule: (season) => fetchGame(season, '', VIEWS.proSchedule, { label: `NFL schedule ${season}` }),
    fetchPlayers: (season) =>
      fetchGame(season, '/players', VIEWS.players, {
        label: `player names ${season}`,
        // A filter, not a credential: asks for all active players instead of the default short page.
        headers: { 'X-Fantasy-Filter': JSON.stringify({ filterActive: { value: true } }) },
      }),
  };
}
