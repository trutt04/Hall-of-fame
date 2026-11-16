#!/usr/bin/env node
/**
 * mock-espn.mjs
 *
 * A tiny local stand-in for ESPN's fantasy API, serving the fixtures in scripts/fixtures/.
 * The tests use it to rehearse every way ESPN can fail. It is also handy by hand:
 *
 *   node scripts/testing/mock-espn.mjs            # serve the fixtures as a PUBLIC league
 *   node scripts/testing/mock-espn.mjs private    # answer 401 like a private league
 *   ESPN_BASE_URLS=http://127.0.0.1:8787/apis/v3/games/ffl LEAGUE_WORLD_DATA_DIR=/some/scratch/dir node scripts/sync-espn.mjs
 *
 * Modes (per kind of request): ok, private, forbidden-html, notfound, notfound-html, error,
 * ratelimit, html, truncated, empty, wrong-shape, hang, drop, redirect-login, redirect-ok.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.resolve(HERE, '..', 'fixtures');
export const API_ROOT = '/apis/v3/games/ffl';

const PRIVATE_BODY = JSON.stringify({
  messages: ['You are not authorized to view this League.'],
  details: [{
    message: 'You are not authorized to view this League.',
    shortMessage: 'You are not authorized to view this League.',
    resolution: null,
    type: 'AUTH_LEAGUE_NOT_VISIBLE',
    metaData: null,
  }],
});
const NOT_FOUND_BODY = JSON.stringify({
  messages: ['Not Found'],
  details: [{ message: 'Not Found', shortMessage: 'Not Found', resolution: null, type: 'GENERAL_NOT_FOUND', metaData: null }],
});
const LOGIN_PAGE = '<!DOCTYPE html><html><head><title>Log In</title></head><body><h1>Log in to continue</h1></body></html>';

/**
 * Start the mock. Returns a handle:
 *   url        base to put in ESPN_BASE_URLS
 *   behavior   mutable settings (see below)
 *   requests   every request received: { kind, season, path, query, headers }
 *   close()
 */
export async function startMockEspn({ fixtureDir = DEFAULT_FIXTURES, leagueId = 70578866, port = 0 } = {}) {
  const read = (name) => {
    const file = path.join(fixtureDir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  const seasons = fs.readdirSync(fixtureDir).map((f) => f.match(/^espn-(\d{4})\.json$/)?.[1]).filter(Boolean).map(Number).sort();
  const currentSeason = seasons[seasons.length - 1];

  const behavior = {
    league: 'ok', // the current-season, lineups and draft requests
    history: 'ok', // past seasons
    proSchedule: 'ok', // the NFL schedule (not league-specific)
    players: 'ok', // the player name list (not league-specific)
    byKind: {}, // optional overrides: { lineups: 'error', draft: 'notfound', current: 'html' }
    missingSeasons: new Set(), // seasons that answer 404 whatever else is set
    failFirst: 0, // answer this many requests with a 500 first (to rehearse retries)
    transform: null, // function(kind, object, season) -> object, to bend a good answer
  };
  const requests = [];
  const hanging = new Set();

  const send = (res, status, body, type = 'application/json;charset=UTF-8', headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, ...headers });
    res.end(body);
  };

  function route(pathname, query) {
    const rest = pathname.startsWith(API_ROOT) ? pathname.slice(API_ROOT.length) : null;
    if (rest === null) return null;
    let m = rest.match(/^\/seasons\/(\d{4})\/segments\/0\/leagues\/(\d+)$/);
    if (m) {
      const season = Number(m[1]);
      if (Number(m[2]) !== leagueId) return { kind: 'unknown-league', season };
      const views = query.getAll('view');
      if (season !== currentSeason) return { kind: 'history', season, file: `espn-${season}.json` };
      if (views.length === 1 && views[0] === 'mDraftDetail') return { kind: 'draft', season, file: `espn-${season}-draft.json` };
      if (query.has('scoringPeriodId')) {
        return { kind: 'lineups', season, file: `espn-${season}-week${query.get('scoringPeriodId')}-lineups.json` };
      }
      return { kind: 'current', season, file: `espn-${season}.json` };
    }
    m = rest.match(/^\/seasons\/(\d{4})\/players$/);
    if (m) return { kind: 'players', season: Number(m[1]), file: `espn-${m[1]}-players.json` };
    m = rest.match(/^\/seasons\/(\d{4})$/);
    if (m) return { kind: 'proSchedule', season: Number(m[1]), file: `pro-schedule-${m[1]}.json` };
    return null;
  }

  function modeFor(kind) {
    if (behavior.byKind[kind]) return behavior.byKind[kind];
    if (kind === 'current' || kind === 'lineups' || kind === 'draft') return behavior.league;
    return behavior[kind] ?? 'ok';
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock.invalid');
    let pathname = url.pathname;
    if (pathname === '/login') return send(res, 200, LOGIN_PAGE, 'text/html; charset=utf-8');
    const moved = pathname.startsWith('/moved');
    if (moved) pathname = pathname.slice('/moved'.length);

    const hit = route(pathname, url.searchParams);
    requests.push({ kind: hit?.kind ?? 'unknown', season: hit?.season ?? null, path: url.pathname, query: url.search, headers: { ...req.headers } });
    if (!hit || hit.kind === 'unknown-league') return send(res, 404, NOT_FOUND_BODY);

    if (behavior.failFirst > 0) {
      behavior.failFirst--;
      return send(res, 500, '{"messages":["Internal Server Error"]}');
    }
    if (behavior.missingSeasons.has(hit.season)) return send(res, 404, NOT_FOUND_BODY);

    const mode = moved ? 'ok' : modeFor(hit.kind);
    const good = () => {
      let text = read(hit.file);
      if (text === null) return null;
      if (behavior.transform) text = JSON.stringify(behavior.transform(hit.kind, JSON.parse(text), hit.season));
      return text;
    };

    switch (mode) {
      case 'ok': {
        const text = good();
        return text === null ? send(res, 404, NOT_FOUND_BODY) : send(res, 200, text);
      }
      case 'private': return send(res, 401, PRIVATE_BODY);
      case 'forbidden-html': return send(res, 403, '<html><body><h1>Access Denied</h1></body></html>', 'text/html');
      case 'notfound': return send(res, 404, NOT_FOUND_BODY);
      case 'notfound-html': return send(res, 404, '<html><body>Page not found</body></html>', 'text/html');
      case 'error': return send(res, 500, '{"messages":["Internal Server Error"]}');
      case 'ratelimit': return send(res, 429, '{"messages":["Too Many Requests"]}', 'application/json', { 'Retry-After': '0' });
      case 'html': return send(res, 200, LOGIN_PAGE, 'text/html; charset=utf-8');
      case 'truncated': {
        const text = good() ?? '{"teams":[{"id":1,"name":"cut off he';
        return send(res, 200, text.slice(0, Math.floor(text.length / 2)));
      }
      case 'empty': return send(res, 200, '');
      case 'wrong-shape': return send(res, 200, '{"hello":"world","teams":"not a list"}');
      case 'hang': {
        hanging.add(res); // never answer; the client must give up by itself
        return undefined;
      }
      case 'drop': return req.socket.destroy();
      case 'redirect-login': return send(res, 302, '', 'text/plain', { Location: '/login' });
      case 'redirect-ok': return send(res, 302, '', 'text/plain', { Location: `/moved${url.pathname}${url.search}` });
      default: return send(res, 500, `{"messages":["mock: unknown mode ${mode}"]}`);
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: `${origin}${API_ROOT}`,
    behavior,
    requests,
    currentSeason,
    count: (kind) => requests.filter((r) => !kind || r.kind === kind).length,
    reset() {
      requests.length = 0;
      Object.assign(behavior, { league: 'ok', history: 'ok', proSchedule: 'ok', players: 'ok', byKind: {}, failFirst: 0, transform: null });
      behavior.missingSeasons.clear();
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2] ?? 'ok';
  const mock = await startMockEspn({ port: Number(process.argv[3] ?? 8787) });
  Object.assign(mock.behavior, { league: mode, history: mode });
  console.log(`Mock ESPN is up in "${mode}" mode (season ${mock.currentSeason}). Point the sync at it with:`);
  console.log(`  ESPN_BASE_URLS=${mock.url} LEAGUE_WORLD_DATA_DIR=<a scratch folder> node scripts/sync-espn.mjs`);
  console.log('Without LEAGUE_WORLD_DATA_DIR the sync writes to world/data. Ctrl+C to stop.');
}
