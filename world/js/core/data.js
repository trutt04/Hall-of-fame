// Loads the three data files the sync job writes, derives the model, and keeps both fresh.
// The browser never talks to ESPN: it only reads data/league.json, data/history.json and
// data/status.json from this site (cache-busted), or window.__LW_DATA when a preview or a test
// injects them.
//
//   const data = createData({ store })
//   await data.load()            -> { league, history, status }   throws DataError when there is no usable league
//   data.model                   the current derived model (also store.get('model'))
//   data.start(onChange)         re-fetch every 3 minutes while the tab is visible, re-derive every
//                                60 seconds; onChange(model, previous) fires when the model really changed
//   data.refresh()               fetch + derive now

import { PATHS } from '../config.js';
import { derive } from '../model/derive.js';

const REFETCH_MS = 3 * 60 * 1000;
const REDERIVE_MS = 60 * 1000;

export class DataError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'DataError';
    this.reason = reason;
  }
}

async function fetchJson(path) {
  const url = path + (path.includes('?') ? '&' : '?') + 'v=' + Date.now().toString(36);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + path);
  return res.json();
}

function usable(league) {
  return !!(league && Array.isArray(league.teams) && league.teams.length >= 2 && league.league);
}

export function createData({ store }) {
  let league = null;
  let history = null;
  let status = null;
  let model = null;
  let fingerprint = '';
  let onChange = null;
  let timers = [];
  let busy = false;

  async function fetchAll() {
    const injected = typeof window !== 'undefined' ? window.__LW_DATA : null;
    if (injected && injected.league) {
      return { league: injected.league, history: injected.history || null, status: injected.status || null };
    }
    const [l, h, s] = await Promise.allSettled([fetchJson(PATHS.league), fetchJson(PATHS.history), fetchJson(PATHS.status)]);
    if (l.status !== 'fulfilled') throw new DataError('The league data did not load.', 'network');
    return {
      league: l.value,
      history: h.status === 'fulfilled' ? h.value : null,
      status: s.status === 'fulfilled' ? s.value : null,
    };
  }

  function rederive() {
    let next;
    try {
      next = derive(league, history, { now: new Date() });
    } catch (err) {
      console.error('[lw] derive failed', err);
      return false;
    }
    let print = '';
    try {
      print = JSON.stringify(next);
    } catch (err) {
      print = String(Date.now());
    }
    if (print === fingerprint && model) return false;
    const prev = model;
    fingerprint = print;
    model = next;
    if (prev && onChange) {
      try {
        onChange(model, prev);
      } catch (err) {
        console.error('[lw] model change handler failed', err);
      }
    }
    return true;
  }

  async function load() {
    const got = await fetchAll();
    if (!usable(got.league)) throw new DataError('The league data is empty.', 'bad_shape');
    league = got.league;
    history = got.history;
    status = got.status;
    store.set('status', status);
    rederive();
    if (!model || !model.order || !model.order.length) throw new DataError('The league data has no teams.', 'bad_shape');
    return got;
  }

  async function refresh() {
    if (busy) return false;
    busy = true;
    try {
      const got = await fetchAll();
      if (!usable(got.league)) return false;
      const stamp = (x) => (x && x.generatedAt) || '';
      const changed = stamp(got.league) !== stamp(league) || stamp(got.history) !== stamp(history)
        || JSON.stringify(got.status) !== JSON.stringify(status);
      league = got.league;
      history = got.history;
      status = got.status;
      if (changed) store.set('status', status);
      return rederive();
    } catch (err) {
      console.warn('[lw] data refresh failed, keeping what we have', err);
      return false;
    } finally {
      busy = false;
    }
  }

  function start(handler) {
    onChange = handler || null;
    stop();
    timers.push(setInterval(() => {
      if (!document.hidden) refresh();
    }, REFETCH_MS));
    timers.push(setInterval(() => {
      if (!document.hidden && league) rederive();
    }, REDERIVE_MS));
    const onVisible = () => {
      if (!document.hidden && league) rederive();
    };
    document.addEventListener('visibilitychange', onVisible);
    timers.push({ off: () => document.removeEventListener('visibilitychange', onVisible) });
  }

  function stop() {
    for (const t of timers) {
      if (t && t.off) t.off();
      else clearInterval(t);
    }
    timers = [];
  }

  return {
    load,
    refresh,
    rederive,
    start,
    stop,
    get league() { return league; },
    get history() { return history; },
    get status() { return status; },
    get model() { return model; },
  };
}
