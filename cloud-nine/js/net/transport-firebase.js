// Firebase transport: rooms in a Realtime Database, so devices anywhere can play together.
// Same internal interface as transport-local.js (see the header there).
//
// The SDK is loaded lazily, only when online play starts, from Google's CDN at a pinned version.
// Tests pass `sdk` ({ app, auth, database } module namespaces, e.g. tools/fake-firebase.mjs).
//
// Data under rooms/{code}/ (shapes in validate.js; firebase/database.rules.json enforces them):
//   meta, players/{id}, state/{id}, events/{pushId}, game, allow/{id}
// - A locked room (meta.locked) can only be joined, and its players, state, events and game only
//   read, by the ids on its allow list. Anyone else reads just its meta: the probe says locked, and
//   a player taken off the list loses the room (the listeners are cancelled: sink.removed()).
// - Anonymous sign-in gives this page its own id (the player id). Sign-in is kept in memory only,
//   so a reloaded page is a new player: a stale disconnect from the old page can never remove it.
// - onDisconnect().remove() takes my player entry, my state and my bots away when I vanish, and
//   is armed again after every reconnect (the server forgets it once it has run).
// - Events carry push ids and serverTimestamp(); I only listen to keys from my join onwards, and
//   the host trims old ones. My own events are held back until the server confirms them, so every
//   device sees all events in the server's one order (the SDK would show mine early).
// - net.now() is this device's clock plus .info/serverTimeOffset.

import { isId } from './validate.js';

export const SDK_VERSION = '10.14.1';
export const SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
export const STALE_MS = 12 * 60 * 60 * 1000;
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

let sdkPromise = null;
let appSeq = 0;

export function loadFirebaseSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import(SDK_BASE + 'firebase-app.js'),
      import(SDK_BASE + 'firebase-auth.js'),
      import(SDK_BASE + 'firebase-database.js'),
    ]).then(([app, auth, database]) => ({ app, auth, database }));
    sdkPromise.catch(() => {
      sdkPromise = null; // try again next time
    });
  }
  return sdkPromise;
}

// The first 8 characters of a push id: its time. Keys below this are older than ms.
export function pushKeyFor(ms) {
  let t = Math.max(0, Math.floor(ms));
  let s = '';
  for (let i = 0; i < 8; i++) {
    s = PUSH_CHARS.charAt(t % 64) + s;
    t = Math.floor(t / 64);
  }
  return s;
}

export function isDenied(err) {
  const s = String((err && (err.code || err.message)) || err || '').toLowerCase();
  return s.includes('permission');
}

function withTimeout(p, ms, what) {
  let timer = null;
  return Promise.race([
    p,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out ' + what)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitFor(cond, ms, what) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      if (cond()) resolve();
      else if (Date.now() - t0 > ms) reject(new Error('timed out ' + what));
      else setTimeout(check, 40);
    };
    check();
  });
}

const noop = () => {};

export function createFirebaseTransport({ config, sdk = null, clock = () => Date.now(), tuning = {} } = {}) {
  const T = { sdkTimeoutMs: 15000, signInTimeoutMs: 15000, connectTimeoutMs: 12000, readTimeoutMs: 10000, writeTimeoutMs: 8000, ...tuning };
  const linkFns = new Set();
  const infoUnsubs = [];
  let fb = null;
  let uid = null;
  let offset = 0;
  let up = false;
  let everUp = false;
  let connecting = null;
  let disposed = false;
  let room = null;

  const now = () => clock() + offset;
  const R = (path) => fb.D.ref(fb.db, path);
  const roomRef = (r, rel) => fb.D.ref(fb.db, r.base + '/' + rel);

  function setUp(v) {
    if (v === up) return;
    up = v;
    if (v && everUp && room) rearm(room);
    if (v) everUp = true;
    for (const fn of linkFns) {
      try {
        fn(v);
      } catch (err) {
        console.error('[c9 net] link listener failed', err);
      }
    }
  }

  // The server forgets onDisconnect jobs once it has run them, so after a reconnect they go again,
  // then the room re-asserts itself (the net layer puts back whatever was removed meanwhile).
  function rearm(r) {
    for (const p of r.disconnectPaths) fb.D.onDisconnect(roomRef(r, p)).remove().catch(warnWrite);
    if (r.sink.resync) safe(() => r.sink.resync());
  }

  function arm(r, rel) {
    r.disconnectPaths.delete(rel);
    r.disconnectPaths.add(rel);
    return fb.D.onDisconnect(roomRef(r, rel)).remove();
  }

  function disarm(r, rel) {
    if (!r.disconnectPaths.delete(rel)) return;
    fb.D.onDisconnect(roomRef(r, rel)).cancel().catch(noop);
  }

  function safe(fn) {
    try {
      fn();
    } catch (err) {
      console.error('[c9 net] room update failed', err);
    }
  }

  function warnWrite(err) {
    if (!disposed) console.warn('[c9 net] a write was not accepted:', (err && (err.code || err.message)) || err);
  }

  async function doConnect() {
    const S = sdk || (await withTimeout(loadFirebaseSdk(), T.sdkTimeoutMs, 'loading Firebase'));
    if (disposed) throw new Error('closed');
    const A = S.auth;
    const D = S.database;
    const app = S.app.initializeApp(config, 'cloud-nine-' + ++appSeq);
    try {
      let auth;
      try {
        auth = A.initializeAuth(app, { persistence: A.inMemoryPersistence });
      } catch (err) {
        auth = A.getAuth(app);
      }
      const cred = await withTimeout(A.signInAnonymously(auth), T.signInTimeoutMs, 'signing in');
      const u = cred && cred.user && cred.user.uid;
      if (!isId(u)) throw new Error('sign-in gave no usable id');
      const db = D.getDatabase(app);
      fb = { S, A, D, app, auth, db };
      uid = u;
      infoUnsubs.push(
        D.onValue(D.ref(db, '.info/serverTimeOffset'), (s) => {
          const v = Number(s.val());
          offset = Number.isFinite(v) && Math.abs(v) < 864e5 ? v : 0;
        }),
      );
      infoUnsubs.push(D.onValue(D.ref(db, '.info/connected'), (s) => setUp(s.val() === true)));
      await waitFor(() => up || disposed, T.connectTimeoutMs, 'reaching the database');
      if (disposed) throw new Error('closed');
      return { id: uid };
    } catch (err) {
      for (const f of infoUnsubs.splice(0)) safe(f);
      fb = null;
      uid = null;
      up = false;
      Promise.resolve()
        .then(() => S.app.deleteApp(app))
        .catch(noop);
      throw err;
    }
  }

  function needRoom() {
    if (!room || !fb) throw new Error('not in a room');
    return room;
  }

  // The list goes in with the lock, in one update, so nobody on it ever sees the room locked
  // without being on the list. Unlocking clears the list.
  function lockRoom(r, locked, allowIds) {
    const D = fb.D;
    const allow = {};
    if (locked === true) for (const id of allowIds || []) if (isId(id)) allow[id] = true;
    return D.update(D.ref(fb.db, r.base), { allow: locked === true ? allow : null, 'meta/locked': locked === true, 'meta/beat': D.serverTimestamp() });
  }

  return {
    kind: 'firebase',
    get id() {
      return uid;
    },
    now,
    onLink(fn) {
      linkFns.add(fn);
      return () => linkFns.delete(fn);
    },
    connect() {
      if (disposed) return Promise.reject(new Error('closed'));
      if (fb && uid) return Promise.resolve({ id: uid });
      if (!connecting) {
        connecting = doConnect();
        connecting.catch(noop).then(() => {
          connecting = null;
        });
      }
      return connecting;
    },

    async probe(code) {
      const base = 'rooms/' + code;
      const D = fb.D;
      const read = (rel) => withTimeout(D.get(R(base + rel)), T.readTimeoutMs, 'reading the room');
      const meta = (await read('/meta')).val();
      if (!meta) return null;
      if (meta.locked === true && !(await read('/allow/' + uid)).exists()) return { meta, locked: true };
      try {
        return { meta, players: (await read('/players')).val() || {} };
      } catch (err) {
        if (isDenied(err)) return { meta, locked: true }; // it locked a moment ago
        throw err;
      }
    },

    // Rules let a device write meta only when the code is free (new, 12 hours stale, or nobody in
    // it), so a code someone else is using comes back 'taken' even if two devices pick it at once.
    async create(code) {
      const D = fb.D;
      const base = 'rooms/' + code;
      const m = await withTimeout(D.get(R(base + '/meta')), T.readTimeoutMs, 'reading the room');
      let p;
      try {
        p = await withTimeout(D.get(R(base + '/players')), T.readTimeoutMs, 'reading the room');
      } catch (err) {
        if (isDenied(err)) return 'taken'; // a locked room someone else is using
        throw err;
      }
      const cur = m.val();
      if (cur && typeof cur.beat === 'number' && cur.beat >= now() - STALE_MS && p.exists()) return 'taken';
      try {
        await withTimeout(
          D.set(R(base + '/meta'), { hostId: uid, createdAt: D.serverTimestamp(), beat: D.serverTimestamp(), v: 1 }),
          T.writeTimeoutMs,
          'creating the room',
        );
      } catch (err) {
        if (isDenied(err)) return 'taken';
        throw err;
      }
      D.remove(R(base + '/game')).catch(noop);
      D.remove(R(base + '/allow')).catch(noop); // an old room's list
      return 'ok';
    },

    async enter(code, entry, sink) {
      const D = fb.D;
      const r = { code, base: 'rooms/' + code, sink, unsubs: [], disconnectPaths: new Set(), mine: new Map() };
      room = r;
      const call = (fn) => (snap, prev) => {
        if (room === r) safe(() => fn(snap, prev));
      };
      const lost = (what) => (err) => {
        if (room !== r) return;
        if (isDenied(err) && sink.removed) {
          safe(() => sink.removed()); // the room locked without me on its list
          return;
        }
        console.warn('[c9 net] lost the room (' + what + '):', (err && err.message) || err);
        safe(() => sink.meta(null));
      };
      const u = r.unsubs;
      u.push(D.onValue(roomRef(r, 'meta'), call((s) => sink.meta(s.val())), lost('meta')));
      for (const [key, fn] of [
        ['players', sink.player],
        ['state', sink.state],
      ]) {
        u.push(D.onChildAdded(roomRef(r, key), call((s) => fn(s.key, s.val())), lost(key)));
        u.push(D.onChildChanged(roomRef(r, key), call((s) => fn(s.key, s.val()))));
        u.push(D.onChildRemoved(roomRef(r, key), call((s) => fn(s.key, null))));
      }
      const joinKey = D.push(roomRef(r, 'events')).key;
      const onEvent = (s) => {
        if (r.mine.has(s.key)) r.mine.set(s.key, s.val()); // mine: wait for the server's confirmation
        else sink.event(s.key, s.val());
      };
      u.push(D.onChildAdded(D.query(roomRef(r, 'events'), D.orderByKey(), D.startAt(joinKey)), call(onEvent), lost('events')));
      u.push(D.onValue(roomRef(r, 'game'), call((s) => sink.game(s.val())), lost('game')));
      await withTimeout(Promise.all([arm(r, 'state/' + uid), arm(r, 'players/' + uid)]), T.writeTimeoutMs, 'arming disconnect');
      await withTimeout(D.set(roomRef(r, 'players/' + uid), { ...entry, joinedAt: D.serverTimestamp() }), T.writeTimeoutMs, 'joining');
    },

    async exit(botIds = []) {
      if (!room || !fb) return;
      const r = room;
      room = null;
      const D = fb.D;
      for (const f of r.unsubs.splice(0)) safe(f);
      const jobs = [];
      for (const b of botIds) {
        jobs.push(D.remove(roomRef(r, 'state/' + b)));
        jobs.push(D.remove(roomRef(r, 'players/' + b)));
      }
      jobs.push(D.remove(roomRef(r, 'state/' + uid)));
      jobs.push(D.remove(roomRef(r, 'players/' + uid)));
      for (const p of [...r.disconnectPaths]) disarm(r, p);
      await withTimeout(Promise.allSettled(jobs), T.writeTimeoutMs, 'leaving').catch(noop);
    },

    async putPlayer(pid, entry) {
      const r = needRoom();
      await fb.D.set(roomRef(r, 'players/' + pid), { ...entry, joinedAt: fb.D.serverTimestamp() });
      if (pid !== uid && room === r) {
        // bots vanish with their host: state first, then the entry the state rule checks
        arm(r, 'state/' + pid).catch(warnWrite);
        arm(r, 'players/' + pid).catch(warnWrite);
      }
    },
    patchPlayer(pid, patch) {
      return fb.D.update(roomRef(needRoom(), 'players/' + pid), patch);
    },
    dropPlayer(pid) {
      const r = needRoom();
      if (pid !== uid) {
        disarm(r, 'state/' + pid);
        disarm(r, 'players/' + pid);
      }
      return fb.D.remove(roomRef(r, 'players/' + pid));
    },
    putState(pid, s) {
      return fb.D.set(roomRef(needRoom(), 'state/' + pid), s);
    },
    dropState(pid) {
      return fb.D.remove(roomRef(needRoom(), 'state/' + pid));
    },
    pushEvent(ev) {
      const r = needRoom();
      const D = fb.D;
      const ref = D.push(roomRef(r, 'events'));
      const key = ref.key;
      r.mine.set(key, null);
      return D.set(ref, { from: uid, type: ev.type, data: ev.data, t: D.serverTimestamp() }).then(
        () => {
          const v = r.mine.get(key);
          r.mine.delete(key);
          if (v && room === r) safe(() => r.sink.event(key, v));
        },
        (err) => {
          r.mine.delete(key);
          throw err;
        },
      );
    },
    setGame(json) {
      const r = needRoom();
      const D = fb.D;
      return json === null ? D.remove(roomRef(r, 'game')) : D.set(roomRef(r, 'game'), { by: uid, json, t: D.serverTimestamp() });
    },
    setMeta(patch = {}) {
      const D = fb.D;
      const u = { beat: D.serverTimestamp() };
      if (isId(patch.hostId)) u.hostId = patch.hostId;
      return D.update(roomRef(needRoom(), 'meta'), u);
    },
    claimHost() {
      const D = fb.D;
      return D.update(roomRef(needRoom(), 'meta'), { hostId: uid, beat: D.serverTimestamp() }).then(
        () => true,
        (err) => {
          if (isDenied(err)) return false;
          throw err;
        },
      );
    },
    lock: (locked, allowIds) => lockRoom(needRoom(), locked, allowIds),
    async sendHome(pid, allowIds) {
      const r = needRoom();
      await lockRoom(r, true, allowIds);
      await fb.D.remove(roomRef(r, 'players/' + pid));
      await fb.D.remove(roomRef(r, 'state/' + pid));
    },
    async trimEvents(before) {
      const r = needRoom();
      const D = fb.D;
      const q = D.query(roomRef(r, 'events'), D.orderByKey(), D.endAt(pushKeyFor(before)), D.limitToFirst(200));
      const snap = await withTimeout(D.get(q), T.readTimeoutMs, 'reading old events');
      const gone = {};
      snap.forEach((c) => {
        gone[c.key] = null;
      });
      if (Object.keys(gone).length && room === r) await D.update(roomRef(r, 'events'), gone);
    },

    suspend() {
      if (fb) fb.D.goOffline(fb.db);
    },
    resume() {
      if (fb) fb.D.goOnline(fb.db);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (room) for (const f of room.unsubs.splice(0)) safe(f);
      room = null;
      for (const f of infoUnsubs.splice(0)) safe(f);
      // Closing the connection makes the server run our onDisconnect jobs straight away.
      if (fb) Promise.resolve(fb.S.app.deleteApp(fb.app)).catch(noop);
      setUp(false);
      linkFns.clear();
    },
  };
}
