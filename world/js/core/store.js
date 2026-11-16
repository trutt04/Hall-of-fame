// One small place for shared state: who the visitor is, their settings, and the player's
// serializable state. A tiny event emitter, nothing clever.
//
//   const store = createStore()
//   store.get('teamId')                    -> number | null
//   store.set('teamId', 3)                 emits 'teamId' (value, previous) and 'change' (key, value)
//   store.on('teamId', fn)                 -> unsubscribe function
//   store.setTeam(id, { persist: true })   also remembers the choice in localStorage
//   store.params                           URLSearchParams of the page
//
// Keys used by the engine: teamId, settings { sound, quality }, player { teamId, x, z, heading, anim },
// debug (bool). Identity lives ONLY here (Contract 6): ?team=<id> wins, then localStorage.

import { STORAGE_KEYS } from '../config.js';
import { emitter, safeStorageGet, safeStorageSet } from './util.js';

function parseTeamId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function createStore(initial = {}) {
  const events = emitter();
  const state = new Map();
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (err) {
    params = new URLSearchParams('');
  }

  function get(key) {
    return state.get(key);
  }

  function set(key, value) {
    const prev = state.get(key);
    if (prev === value) return value;
    state.set(key, value);
    events.emit(key, value, prev);
    events.emit('change', key, value);
    return value;
  }

  // identity: URL first (personal links), then the remembered choice
  const fromUrl = parseTeamId(params.get('team'));
  const fromStorage = parseTeamId(safeStorageGet(STORAGE_KEYS.team));
  state.set('teamId', fromUrl !== null ? fromUrl : fromStorage);
  state.set('teamSource', fromUrl !== null ? 'url' : fromStorage !== null ? 'storage' : null);
  state.set('settings', { sound: safeStorageGet(STORAGE_KEYS.sound) === '1', quality: params.get('quality') || 'auto' });
  state.set('player', { teamId: state.get('teamId'), x: 0, z: 0, heading: 0, anim: 'idle' });
  state.set('debug', params.get('debug') === '1');
  for (const key of Object.keys(initial)) state.set(key, initial[key]);

  return {
    get,
    set,
    on: events.on.bind(events),
    off: events.off.bind(events),
    params,
    setTeam(id, opts = {}) {
      const value = parseTeamId(id);
      if (opts.persist !== false) safeStorageSet(STORAGE_KEYS.team, value === null ? null : String(value));
      set('teamSource', value === null ? null : 'picked');
      return set('teamId', value);
    },
    patch(key, partial) {
      return set(key, Object.assign({}, state.get(key) || {}, partial));
    },
    snapshot() {
      const out = {};
      for (const [k, v] of state) out[k] = v;
      return out;
    },
  };
}
