// Tests for scripts/lib/espn-client.mjs against a local mock of ESPN (scripts/testing/mock-espn.mjs).
// Nothing here touches the real ESPN. Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autoSeason, classifyResponse, createClient, mayCarryLogin, parseBaseUrls, readConfig,
  DEFAULT_BASE_URLS, DEFAULT_LEAGUE_ID, REASONS, USER_AGENT, VIEWS,
} from '../lib/espn-client.mjs';
import { readLogin } from '../lib/espn-login.mjs';
import { startMockEspn } from '../testing/mock-espn.mjs';
import { FAST } from '../testing/helpers.mjs';

const DEAD = 'http://127.0.0.1:1/apis/v3/games/ffl'; // nothing listens on port 1

async function withMock(t) {
  const mock = await startMockEspn();
  t.after(() => mock.close());
  return mock;
}

function clientFor(mock, extra = {}) {
  const lines = [];
  const client = createClient({ baseUrls: [mock.url], ...FAST, log: (l) => lines.push(l), ...extra });
  return { client, lines };
}

test('defaults: the confirmed address first, the old one as a fallback, league 70578866', () => {
  assert.deepEqual([...DEFAULT_BASE_URLS], [
    'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl',
    'https://fantasy.espn.com/apis/v3/games/ffl',
  ]);
  assert.equal(DEFAULT_LEAGUE_ID, 70578866);
  assert.deepEqual([...VIEWS.current], ['mTeam', 'mSettings', 'mStandings', 'mStatus', 'mRoster', 'mMatchup', 'mMatchupScore', 'mScoreboard']);
  assert.deepEqual([...VIEWS.history], ['mTeam', 'mSettings', 'mStandings', 'mMatchupScore', 'mStatus']);
  assert.doesNotMatch(USER_AGENT, /@|github\.com|http/i); // generic, nothing personal
});

test('season is automatic: August to December is this year, January to July is last year', () => {
  assert.equal(autoSeason(new Date('2026-08-01T00:00:00Z')), 2026);
  assert.equal(autoSeason(new Date('2026-11-16T12:00:00Z')), 2026);
  assert.equal(autoSeason(new Date('2026-12-31T23:59:59Z')), 2026);
  assert.equal(autoSeason(new Date('2027-01-01T00:00:00Z')), 2026);
  assert.equal(autoSeason(new Date('2027-07-31T23:59:59Z')), 2026);
  assert.equal(autoSeason(new Date('2027-08-01T00:00:00Z')), 2027);
});

test('configuration comes from the environment, with safe defaults', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const plain = readConfig({}, now);
  assert.deepEqual(plain.baseUrls, [...DEFAULT_BASE_URLS]);
  assert.deepEqual([plain.leagueId, plain.season, plain.seasonIsExplicit, plain.timeoutMs, plain.retries], [70578866, 2026, false, 15000, 2]);
  const custom = readConfig({ ESPN_BASE_URLS: ' https://new.example/apis/v3/games/ffl/ , http://127.0.0.1:8787/x ', ESPN_LEAGUE_ID: '123', ESPN_SEASON: '2024', ESPN_RETRIES: '0' }, now);
  assert.deepEqual(custom.baseUrls, ['https://new.example/apis/v3/games/ffl', 'http://127.0.0.1:8787/x']);
  assert.deepEqual([custom.leagueId, custom.season, custom.seasonIsExplicit, custom.retries], [123, 2024, true, 0]);
  // Nonsense falls back to the defaults instead of breaking the run.
  assert.deepEqual(parseBaseUrls('ftp://x, not a url, ,'), [...DEFAULT_BASE_URLS]);
  assert.deepEqual(parseBaseUrls(undefined), [...DEFAULT_BASE_URLS]);
  assert.equal(readConfig({ ESPN_LEAGUE_ID: 'abc', ESPN_SEASON: '-5' }, now).leagueId, 70578866);
});

test('classifyResponse: every answer maps to one of the status.json reasons', () => {
  const host = 'lm-api-reads.fantasy.espn.com';
  const privateBody = '{"messages":["You are not authorized to view this League."],"details":[{"type":"AUTH_LEAGUE_NOT_VISIBLE"}]}';
  const cases = [
    [{ status: 200, body: '{"teams":[]}' }, 'ok'],
    [{ status: 200, body: '[{"id":1}]' }, 'ok'],
    [{ status: 200, body: `${String.fromCharCode(0xfeff)}{"teams":[]}` }, 'ok'],
    [{ status: 401, body: privateBody }, 'league_private'],
    [{ status: 401, body: '' }, 'league_private'],
    [{ status: 403, body: privateBody }, 'league_private'],
    [{ status: 403, body: '<html>Access Denied</html>', contentType: 'text/html' }, 'endpoint_moved'],
    [{ status: 404, body: '{"messages":["Not Found"],"details":[{"type":"GENERAL_NOT_FOUND"}]}' }, 'not_found'],
    [{ status: 404, body: '<html>nope</html>' }, 'not_found'],
    [{ status: 410, body: '' }, 'not_found'],
    [{ status: 429, body: '' }, 'rate_limited'],
    [{ status: 500, body: 'oops' }, 'server_error'],
    [{ status: 503, body: '' }, 'server_error'],
    [{ status: 200, body: '<!DOCTYPE html><html></html>', contentType: 'text/html' }, 'endpoint_moved'],
    [{ status: 200, body: 'Service temporarily unavailable' }, 'endpoint_moved'],
    [{ status: 200, body: '' }, 'endpoint_moved'],
    [{ status: 200, body: '{"teams":[{"id":1,"na' }, 'bad_shape'],
    [{ status: 200, body: '"just a string"' }, 'endpoint_moved'],
    [{ status: 302, body: '' }, 'endpoint_moved'],
    [{ status: 400, body: '{"messages":["bad view"],"details":[{"type":"GENERAL_BAD_REQUEST"}]}' }, 'endpoint_moved'],
  ];
  for (const [input, expected] of cases) {
    const result = classifyResponse({ host, ...input });
    assert.equal(result.ok ? 'ok' : result.reason, expected, JSON.stringify(input));
    assert.ok(REASONS.includes(result.ok ? 'ok' : result.reason));
    if (!result.ok) assert.equal(typeof result.detail, 'string');
  }
  assert.equal(classifyResponse({ host, status: 401, body: privateBody }).detail, `HTTP 401 from ${host} (AUTH_LEAGUE_NOT_VISIBLE)`);
  // Only blips are worth retrying.
  const retryable = (status, body = '') => classifyResponse({ host, status, body }).retryable;
  assert.deepEqual([retryable(500), retryable(429), retryable(401), retryable(404), retryable(200, '<html>')], [true, true, false, false, false]);
  // An ESPN error type is echoed only when it looks like one (never free text from the body).
  const odd = classifyResponse({ host, status: 404, body: '{"details":[{"type":"<script>alert(1)</script>"}]}' });
  assert.equal(odd.detail, `HTTP 404 from ${host}`);
});

test('mock: a public league answers with the combined views in one request', async (t) => {
  const mock = await withMock(t);
  const { client, lines } = clientFor(mock);
  const res = await client.fetchCurrentSeason({ season: 2026 });
  assert.equal(res.ok, true);
  assert.equal(res.season, 2026);
  assert.equal(res.data.teams.length, 12);
  assert.equal(mock.requests.length, 1);
  const query = new URLSearchParams(mock.requests[0].query);
  assert.equal(mock.requests[0].path, '/apis/v3/games/ffl/seasons/2026/segments/0/leagues/70578866');
  assert.deepEqual(query.getAll('view'), [...VIEWS.current]);
  // The log names the request and the result, never the body.
  assert.equal(lines.length, 1);
  assert.match(lines[0], /current season 2026 @ 127\.0\.0\.1:\d+ -> OK \(HTTP 200, \d+ bytes\)/);
  assert.doesNotMatch(lines.join('\n'), /Commish|Placeholder|\{[0-9A-F]{8}-/);
});

test('mock: no cookies or auth headers are ever sent', async (t) => {
  const mock = await withMock(t);
  const { client } = clientFor(mock);
  await client.fetchCurrentSeason({ season: 2026 });
  await client.fetchLineups(2026, 9);
  await client.fetchDraft(2026);
  await client.fetchPlayers(2026);
  await client.fetchProSchedule(2026);
  await client.fetchPastSeason(2025);
  assert.deepEqual(mock.requests.map((r) => r.kind), ['current', 'lineups', 'draft', 'players', 'proSchedule', 'history']);
  for (const r of mock.requests) {
    assert.equal(r.headers.cookie, undefined);
    assert.equal(r.headers.authorization, undefined);
    assert.equal(r.headers['user-agent'], USER_AGENT);
    assert.equal(r.headers.accept, 'application/json');
    assert.ok(!Object.keys(r.headers).some((h) => /swid|espn_s2|token/i.test(h)));
  }
  const [, lineups, draft, players, pro, past] = mock.requests;
  assert.equal(new URLSearchParams(lineups.query).get('scoringPeriodId'), '9');
  assert.deepEqual(new URLSearchParams(lineups.query).getAll('view'), ['mMatchup', 'mMatchupScore']);
  assert.equal(draft.query, '?view=mDraftDetail');
  assert.equal(players.path, '/apis/v3/games/ffl/seasons/2026/players');
  assert.equal(players.headers['x-fantasy-filter'], '{"filterActive":{"value":true}}');
  assert.equal(pro.path, '/apis/v3/games/ffl/seasons/2026');
  assert.equal(pro.query, '?view=proTeamSchedules_wl');
  assert.equal(past.path, '/apis/v3/games/ffl/seasons/2025/segments/0/leagues/70578866');
  assert.deepEqual(new URLSearchParams(past.query).getAll('view'), [...VIEWS.history]);
});

const FAILURES = [
  // [mock mode, expected reason, requests made (1 = not retried, 3 = two retries), detail pattern]
  ['private', 'league_private', 1, /^HTTP 401 from 127\.0\.0\.1:\d+ \(AUTH_LEAGUE_NOT_VISIBLE\)$/],
  ['notfound', 'not_found', 1, /HTTP 404/],
  ['notfound-html', 'not_found', 1, /HTTP 404/],
  ['forbidden-html', 'endpoint_moved', 1, /HTTP 403/],
  ['error', 'server_error', 3, /HTTP 500/],
  ['ratelimit', 'rate_limited', 3, /HTTP 429/],
  ['html', 'endpoint_moved', 1, /web page/],
  ['empty', 'endpoint_moved', 1, /empty/],
  ['truncated', 'bad_shape', 1, /cut off or invalid/],
  ['hang', 'network', 3, /no answer from 127\.0\.0\.1:\d+ within 0\.4s/],
  ['drop', 'network', 3, /could not reach 127\.0\.0\.1:\d+/],
  ['redirect-login', 'endpoint_moved', 1, /redirected to 127\.0\.0\.1:\d+\/login/],
];

for (const [mode, reason, requestCount, detail] of FAILURES) {
  test(`mock: "${mode}" is reported as ${reason}`, async (t) => {
    const mock = await withMock(t);
    mock.behavior.league = mode;
    const { client, lines } = clientFor(mock);
    const res = await client.fetchLeague(2026, VIEWS.current);
    assert.equal(res.ok, false);
    assert.equal(res.reason, reason);
    assert.match(res.detail, detail);
    assert.equal(mock.count('current'), requestCount, 'retry policy');
    assert.equal(lines.length, requestCount);
    assert.doesNotMatch(lines.join('\n'), /Log in to continue|Access Denied|not authorized/); // bodies are never logged
  });
}

test('mock: a redirect that lands on real JSON is followed (ESPN moving politely just works)', async (t) => {
  const mock = await withMock(t);
  mock.behavior.league = 'redirect-ok';
  const { client, lines } = clientFor(mock);
  const res = await client.fetchLeague(2026, VIEWS.current);
  assert.equal(res.ok, true);
  assert.equal(res.data.teams.length, 12);
  assert.match(lines[0], /redirected to 127\.0\.0\.1:\d+\/moved\/apis/);
});

test('mock: blips are retried and recover, with at most two retries', async (t) => {
  const mock = await withMock(t);
  mock.behavior.failFirst = 2;
  const first = clientFor(mock);
  const ok = await first.client.fetchLeague(2026, VIEWS.current);
  assert.equal(ok.ok, true);
  assert.equal(mock.requests.length, 3);
  assert.match(first.lines[2], /retry 2/);

  mock.reset();
  mock.behavior.failFirst = 3;
  const second = clientFor(mock);
  const failed = await second.client.fetchLeague(2026, VIEWS.current);
  assert.equal(failed.reason, 'server_error');
  assert.equal(mock.requests.length, 3);

  mock.reset();
  mock.behavior.league = 'error';
  const none = clientFor(mock, { retries: 0 });
  await none.client.fetchLeague(2026, VIEWS.current);
  assert.equal(mock.requests.length, 1);
});

test('mock: retries wait with a growing backoff', async (t) => {
  const mock = await withMock(t);
  mock.behavior.league = 'error';
  const waits = [];
  const { client } = clientFor(mock, { backoffMs: 1500, sleep: async (ms) => waits.push(ms) });
  await client.fetchLeague(2026, VIEWS.current);
  assert.deepEqual(waits, [1500, 3000]);
});

test('season fallback: an automatic season that does not exist yet falls back one year', async (t) => {
  const mock = await withMock(t);
  mock.behavior.missingSeasons.add(2027);
  const auto = clientFor(mock);
  const res = await auto.client.fetchCurrentSeason({ season: 2027 });
  assert.equal(res.ok, true);
  assert.equal(res.season, 2026);
  assert.deepEqual(res.seasonsTried, [2027, 2026]);
  assert.deepEqual(mock.requests.map((r) => r.season), [2027, 2026]);

  // A season set by hand is taken literally.
  mock.requests.length = 0;
  const explicit = await clientFor(mock).client.fetchCurrentSeason({ season: 2027, explicit: true });
  assert.equal(explicit.reason, 'not_found');
  assert.deepEqual(mock.requests.map((r) => r.season), [2027]);

  // Only "not found" triggers the fallback. A private league does not.
  mock.reset();
  mock.behavior.league = 'private';
  const priv = await clientFor(mock).client.fetchCurrentSeason({ season: 2026 });
  assert.equal(priv.reason, 'league_private');
  assert.equal(mock.requests.length, 1);

  // Not found for both years is still just not_found, after two tries.
  mock.reset();
  mock.behavior.missingSeasons.add(2026).add(2025);
  const gone = await clientFor(mock).client.fetchCurrentSeason({ season: 2026 });
  assert.equal(gone.reason, 'not_found');
  assert.deepEqual(gone.seasonsTried, [2026, 2025]);
});

test('base URLs: a dead first address falls through to the next, which is then preferred', async (t) => {
  const mock = await withMock(t);
  const lines = [];
  const client = createClient({ baseUrls: [DEAD, mock.url], ...FAST, retries: 0, log: (l) => lines.push(l) });
  const res = await client.fetchCurrentSeason({ season: 2026 });
  assert.equal(res.ok, true);
  assert.equal(client.activeBase, mock.url);
  const before = lines.length;
  await client.fetchProSchedule(2026);
  assert.equal(lines.length, before + 1, 'the dead address is not tried again in this run');
  assert.equal(mock.count('proSchedule'), 1);
});

test('base URLs: a definite answer stops the search, and total failure is reported sensibly', async (t) => {
  const first = await withMock(t);
  const second = await withMock(t);
  first.behavior.league = 'private';
  let client = createClient({ baseUrls: [first.url, second.url], ...FAST });
  assert.equal((await client.fetchLeague(2026, VIEWS.current)).reason, 'league_private');
  assert.equal(second.requests.length, 0, 'ESPN said private: the fallback address is left alone');

  first.behavior.league = 'notfound';
  second.behavior.league = 'html';
  client = createClient({ baseUrls: [first.url, second.url], ...FAST });
  const res = await client.fetchLeague(2026, VIEWS.current);
  assert.equal(res.reason, 'not_found'); // the first address's answer is the headline
  assert.match(res.detail, /also tried 127\.0\.0\.1:\d+: endpoint_moved/);
  assert.equal(second.requests.length, 1);

  // First address unreachable, second answers with a web page: "moved" says more than "network".
  client = createClient({ baseUrls: [DEAD, second.url], ...FAST, retries: 0 });
  const moved = await client.fetchLeague(2026, VIEWS.current);
  assert.equal(moved.reason, 'endpoint_moved');
  assert.match(moved.detail, /also tried 127\.0\.0\.1:1: network/);

  // Everything unreachable is a network problem.
  client = createClient({ baseUrls: [DEAD, 'http://127.0.0.1:2/x'], ...FAST, retries: 0 });
  assert.equal((await client.fetchLeague(2026, VIEWS.current)).reason, 'network');
});

test('time budget: when a run is out of time, remaining requests are skipped, not hung', async (t) => {
  const mock = await withMock(t);
  const { client } = clientFor(mock, { budgetMs: 0 });
  const res = await client.fetchLeague(2026, VIEWS.current);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'network');
  assert.match(res.detail, /time budget/);
  assert.equal(mock.requests.length, 0);
});

// ---------------------------------------------------------------------------------------
// The owner's ESPN login (scripts/lib/espn-login.mjs + the Cookie header)
// ---------------------------------------------------------------------------------------

/** Shaped like the real pair, but invented. Nothing here is a real credential. */
const S2 = 'AEBfakefake%2Fnotreal%2Bvalue1234567890abcdefghijklmnop';
const SWID_BARE = '1234ABCD-12AB-34CD-56EF-1234567890AB';
const SWID = `{${SWID_BARE}}`;
const COOKIE = `espn_s2=${S2}; SWID=${SWID}`;

test('login: two secrets are read forgivingly and sent strictly', () => {
  // Nothing set is the default path: no login, and the scrubber is a pass-through.
  const none = readLogin({});
  assert.deepEqual([none.state, none.cookie, none.note], ['none', null, null]);
  assert.equal(none.scrub('nothing to hide'), 'nothing to hide');

  // Every one of these is the same login, however it was pasted.
  const pastes = [
    [S2, SWID],
    [`  ${S2}  `, `  ${SWID}  `],
    [`"${S2}"`, `'${SWID}'`],
    [S2, SWID_BARE], // braces left off
    [S2, `{{${SWID_BARE}}}`], // braces doubled
    [`espn_s2=${S2}`, `SWID=${SWID}`], // the name pasted with the value
    [`espn_s2=${S2};`, `SWID=${SWID_BARE};`], // ...with the trailing semicolon
    [`espn_s2=${S2}; SWID=${SWID}`, `espn_s2=${S2}; SWID=${SWID}`], // the whole pair in both boxes
    [`ESPN_S2 = ${S2}`, `swid = ${SWID}`], // odd spelling and spacing
  ];
  for (const [s2, swid] of pastes) {
    const login = readLogin({ ESPN_S2: s2, ESPN_SWID: swid });
    assert.equal(login.state, 'ready', JSON.stringify([s2, swid]));
    assert.equal(login.cookie, COOKIE, JSON.stringify([s2, swid]));
    assert.equal(login.note, null);
  }

  // One alone is a misconfiguration: no login is sent, and the owner is told without a value.
  for (const half of [{ ESPN_S2: S2 }, { ESPN_SWID: SWID }, { ESPN_S2: S2, ESPN_SWID: '   ' }]) {
    const login = readLogin(half);
    assert.equal(login.state, 'partial');
    assert.equal(login.cookie, null);
    assert.match(login.note, /Only one of the two ESPN login secrets is set/);
  }

  // A value that cannot go in a header is refused rather than thrown at undici (whose own
  // error message quotes the offending value back at us).
  for (const bad of [{ ESPN_S2: 'AEBfake value with spaces in it', ESPN_SWID: SWID }, { ESPN_S2: S2, ESPN_SWID: '{A B C}' }]) {
    const login = readLogin(bad);
    assert.equal(login.state, 'unusable');
    assert.equal(login.cookie, null);
    assert.match(login.note, /cannot be sent to ESPN/);
  }

  // A stray line break is treated as the end of the value, not as a reason to give up.
  assert.equal(readLogin({ ESPN_S2: `${S2}\n`, ESPN_SWID: `${SWID}\n` }).cookie, COOKIE);

  // A SWID that is not GUID-shaped is still used, with a gentle warning.
  const odd = readLogin({ ESPN_S2: S2, ESPN_SWID: 'not-a-guid-at-all' });
  assert.equal(odd.state, 'ready');
  assert.equal(odd.cookie, `espn_s2=${S2}; SWID={not-a-guid-at-all}`);
  assert.match(odd.note, /does not look like the usual/);

  // No note or state text ever names a value, its length or a prefix.
  for (const login of [none, readLogin({ ESPN_S2: S2 }), readLogin({ ESPN_S2: S2, ESPN_SWID: SWID }), odd]) {
    const text = String(login.note ?? '');
    assert.ok(!text.includes(S2) && !text.includes(SWID_BARE));
    assert.doesNotMatch(text, new RegExp(`${S2.slice(0, 8)}|${String(S2.length)} characters`));
  }
});

test('login: the scrubber catches a value, in plain and url-encoded form', () => {
  const { scrub } = readLogin({ ESPN_S2: S2, ESPN_SWID: SWID });
  assert.equal(scrub(`HTTP 401 for espn_s2=${S2}`), 'HTTP 401 for espn_s2=[redacted]');
  assert.equal(scrub(`SWID=${SWID} refused`), 'SWID=[redacted] refused');
  assert.equal(scrub(`bare ${SWID_BARE} too`), 'bare [redacted] too');
  // A value that was url-encoded again on its way into a URL or a header.
  assert.equal(scrub(`?c=${encodeURIComponent(S2)}`), '?c=[redacted]');
  // ...or decoded on the way out (the real espn_s2 arrives percent-encoded).
  assert.equal(scrub(`cookie: ${decodeURIComponent(S2)}`), 'cookie: [redacted]');
  // Both at once, repeated, inside a bigger string.
  const messy = `Headers.append: "${S2}" is invalid; SWID=${SWID}; again ${S2}`;
  const cleaned = scrub(messy);
  assert.ok(!cleaned.includes(S2) && !cleaned.includes(SWID_BARE));
  assert.equal(cleaned.match(/\[redacted\]/g).length, 3);
  // Short or empty values never turn into a wildcard that redacts innocent text.
  assert.equal(readLogin({ ESPN_S2: 'ab', ESPN_SWID: 'cd' }).scrub('ab cd'), 'ab cd');
  assert.equal(scrub(''), '');
  assert.equal(scrub('a perfectly ordinary log line'), 'a perfectly ordinary log line');
  // Regex metacharacters in a value are matched literally, not compiled.
  assert.equal(readLogin({ ESPN_S2: 'a.*b+c(d)[e]', ESPN_SWID: SWID }).scrub('x a.*b+c(d)[e] y'), 'x [redacted] y');
  assert.equal(readLogin({ ESPN_S2: 'a.*b+c(d)[e]', ESPN_SWID: SWID }).scrub('x aXXXbbbcd y'), 'x aXXXbbbcd y');
});

test('login: the cookie goes on league requests only, never to the public endpoints', async (t) => {
  const mock = await withMock(t);
  mock.behavior.auth = { espn_s2: S2, swid: SWID }; // private, but openable with this login
  const { client } = clientFor(mock, { cookie: COOKIE });
  assert.equal(client.hasLogin, true);

  assert.equal((await client.fetchCurrentSeason({ season: 2026 })).ok, true);
  assert.equal((await client.fetchLineups(2026, 9)).ok, true);
  assert.equal((await client.fetchDraft(2026)).ok, true);
  assert.equal((await client.fetchPastSeason(2025)).ok, true);
  assert.equal((await client.fetchProSchedule(2026)).ok, true);
  assert.equal((await client.fetchPlayers(2026)).ok, true);

  const byKind = new Map(mock.requests.map((r) => [r.kind, r]));
  for (const kind of ['current', 'lineups', 'draft', 'history']) {
    assert.equal(byKind.get(kind).headers.cookie, COOKIE, `${kind} must carry the login`);
  }
  for (const kind of ['proSchedule', 'players']) {
    assert.equal(byKind.get(kind).headers.cookie, undefined, `${kind} is public and must not carry the login`);
  }
  // Strict on the wire: lowercase espn_s2, uppercase SWID, braces on, one space, nothing else.
  assert.match(byKind.get('current').headers.cookie, /^espn_s2=[^;\s]+; SWID=\{[^;\s}]+\}$/);
  for (const r of mock.requests) {
    assert.equal(r.headers.authorization, undefined);
    assert.ok(!Object.keys(r.headers).some((h) => /swid|espn_s2/i.test(h)), 'the login is a cookie, not a header of its own');
    assert.ok(!String(r.query).includes(S2) && !String(r.path).includes(SWID_BARE), 'never in the URL');
  }
});

test('login: a refused login is reported as login_expired, after one try without it', async (t) => {
  const mock = await withMock(t);
  mock.behavior.auth = { espn_s2: 'a-different-and-newer-value', swid: '{0000FFFF-0000-FFFF-0000-FFFF0000FFFF}' };
  const { client, lines } = clientFor(mock, { cookie: COOKIE });

  const res = await client.fetchLeague(2026, VIEWS.current);

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'login_expired');
  assert.ok(REASONS.includes(res.reason));
  // A fixed sentence: no value, no length, not even the host.
  assert.match(res.detail, /^The ESPN login saved in the GitHub secrets no longer works/);
  assert.doesNotMatch(res.detail, /127\.0\.0\.1|HTTP|401 from/);
  assert.equal(res.retryable, false);
  // Two requests: the signed-in one, then the same one with no login at all.
  assert.equal(mock.count('current'), 2);
  assert.equal(mock.requests[0].headers.cookie, COOKIE);
  assert.equal(mock.requests[1].headers.cookie, undefined);
  const text = lines.join('\n');
  assert.match(text, /Trying again without the login/);
  assert.ok(!text.includes(S2) && !text.includes(SWID_BARE));
});

test('login: a stale login does not matter once the league is public', async (t) => {
  const mock = await withMock(t);
  // The league has been made public: an anonymous request works, a wrong login is still refused.
  mock.behavior.auth = { espn_s2: 'rotated-since', swid: '{0000FFFF-0000-FFFF-0000-FFFF0000FFFF}', allowAnonymous: true };
  const { client, lines } = clientFor(mock, { cookie: COOKIE });

  const res = await client.fetchLeague(2026, VIEWS.current);

  assert.equal(res.ok, true);
  assert.equal(res.data.teams.length, 12);
  assert.equal(mock.count('current'), 2);
  assert.match(lines.join('\n'), /it worked without the login: the league is public/);
});

test('login: with no login configured nothing about the request changes', async (t) => {
  const mock = await withMock(t);
  mock.behavior.league = 'private';
  const { client } = clientFor(mock); // no cookie option
  const res = await client.fetchLeague(2026, VIEWS.current);
  assert.equal(res.reason, 'league_private'); // not login_expired: there was no login to blame
  assert.equal(mock.count('current'), 1, 'no second, cookie-free try is needed');
  assert.equal(mock.requests[0].headers.cookie, undefined);
  assert.equal(client.hasLogin, false);
});

test('login: it is only ever sent to an https ESPN address', async () => {
  for (const url of [
    'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026',
    'https://fantasy.espn.com/apis/v3/games/ffl',
    'https://espn.com/x',
    'http://127.0.0.1:8787/apis/v3/games/ffl', // the local mock, for the tests
  ]) assert.equal(mayCarryLogin(url), true, url);
  for (const url of [
    'http://fantasy.espn.com/x', // cleartext
    'https://espn.com.not-espn.example/x', // a lookalike host
    'https://notespn.com/x',
    'https://proxy.example/apis/v3/games/ffl',
    'ftp://fantasy.espn.com/x',
    'not a url at all',
  ]) assert.equal(mayCarryLogin(url), false, url);

  // ...and the client obeys that, whatever ESPN_BASE_URLS says.
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(init.headers.Cookie ?? null);
    return new Response('{"teams":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const lines = [];
  const client = createClient({ baseUrls: ['https://a-proxy.example/apis/v3/games/ffl'], cookie: COOKIE, fetchImpl, ...FAST, log: (l) => lines.push(l) });
  assert.equal((await client.fetchLeague(2026, VIEWS.current)).ok, true);
  assert.deepEqual(sent, [null], 'the login was withheld');
  assert.match(lines.join('\n'), /login is NOT sent to this address/);
  assert.ok(!lines.join('\n').includes(S2));

  // ...and a 401 from such an address is NOT blamed on the login, since none was sent.
  const refuse = async () => new Response('{"details":[{"type":"AUTH_LEAGUE_NOT_VISIBLE"}]}', { status: 401, headers: { 'content-type': 'application/json' } });
  const withheld = createClient({ baseUrls: ['https://a-proxy.example/apis/v3/games/ffl'], cookie: COOKIE, fetchImpl: refuse, ...FAST, log: () => {} });
  const res = await withheld.fetchLeague(2026, VIEWS.current);
  assert.equal(res.reason, 'league_private');
  assert.equal(res.loginSent, false);
});
