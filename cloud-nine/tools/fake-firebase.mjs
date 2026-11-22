// An in-memory stand-in for the Firebase JS SDK (the modular functions js/net/transport-firebase.js
// uses), so the Firebase transport can be tested in Node with several simulated devices. Test only.
//
//   const fb = createFakeFirebase({ rules, latencyMs = 2, serverOffsetMs = 0 })
//     rules: the parsed firebase/database.rules.json (enforced like the real server), or null for none
//   const dev = fb.device({ clock, signInFails })   one phone or tablet. Hand it to the transport:
//     createNet({ mode: 'firebase', firebase: { sdk: dev, config } })
//     dev.app / dev.auth / dev.database      the SDK namespaces (initializeApp, signInAnonymously, ref, set, ...)
//     dev.network(false | true)              the connection drops (the server runs onDisconnect jobs) / comes back
//     dev.blip({ staleMs })                  reconnects at once, but the server only notices the old
//                                            connection died staleMs later and runs its onDisconnect jobs then
//     dev.kill()                             the page is gone for good
//     dev.uid, dev.connected, dev.pendingWrites
//   fb.data(path?) -> a copy of the server data      fb.write(path, value)  admin write, no rules
//   fb.deny = ({ uid, path, value, kind }) => boolean   extra rejections on top of the rules (null for none)
//   fb.denied   [{ uid, path, reason }]  writes the server refused
//   fb.serverOffsetMs                    how far the server clock is from this machine's
//   fb.settle() -> Promise               resolves when no message is in flight
//
// Behaves like the real SDK where the transport depends on it: writes show locally at once and are
// rolled back if the server refuses them; listeners get events in order; push ids sort by time;
// serverTimestamp() is filled in by the server; .info/connected and .info/serverTimeOffset work;
// onDisconnect jobs are checked against the rules when set and run when the connection closes;
// get() needs a connection; writes made while offline are sent after reconnecting.

import { compileRules, applyAt, getAt, splitPath } from './rules-engine.mjs';

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const copy = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));

function deniedError() {
  const e = new Error('PERMISSION_DENIED: Permission denied');
  e.code = 'PERMISSION_DENIED';
  return e;
}

function resolveServerValues(v, t) {
  if (v === null || typeof v !== 'object') return v;
  if (v['.sv'] === 'timestamp' && Object.keys(v).length === 1) return t;
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) out[k] = resolveServerValues(v[k], t);
  return out;
}

function checkValue(v, where) {
  if (v === undefined) throw new Error("set failed: value argument contains undefined in property '" + where + "'");
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw new Error('set failed: value argument contains a ' + typeof v + " in property '" + where + "'");
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('set failed: value argument contains ' + v + " in property '" + where + "'");
  if (v && typeof v === 'object') {
    if (v['.sv'] !== undefined && Object.keys(v).length === 1) return;
    for (const k of Object.keys(v)) {
      if (!k || /[.#$[\]/\u0000-\u001f\u007f]/.test(k)) throw new Error('set failed: value argument contains an invalid key (' + k + ") in property '" + where + "'");
      checkValue(v[k], where + '/' + k);
    }
  }
}

function checkPath(segs) {
  for (const s of segs) if (/[.#$[\]]/.test(s) && s !== '.info') throw new Error('invalid path segment ' + s);
}

const INT_RE = /^-?(0|[1-9][0-9]{0,9})$/;
function keyCompare(a, b) {
  const ai = INT_RE.test(a) && Math.abs(Number(a)) < 2 ** 31;
  const bi = INT_RE.test(b) && Math.abs(Number(b)) < 2 ** 31;
  if (ai && bi) return Number(a) - Number(b);
  if (ai) return -1;
  if (bi) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function filterQuery(v, q) {
  if (!q) return v;
  if (v === null || typeof v !== 'object') return null;
  let keys = Object.keys(v).sort(keyCompare);
  if (q.startAt !== undefined) keys = keys.filter((k) => keyCompare(k, String(q.startAt)) >= 0);
  if (q.endAt !== undefined) keys = keys.filter((k) => keyCompare(k, String(q.endAt)) <= 0);
  if (q.limitToFirst !== undefined) keys = keys.slice(0, q.limitToFirst);
  if (!keys.length) return null;
  const out = {};
  for (const k of keys) out[k] = v[k];
  return out;
}

function makeRef(client, segs) {
  const ref = {
    client,
    segs,
    key: segs.length ? segs[segs.length - 1] : null,
    toString: () => 'fake://' + segs.join('/'),
  };
  Object.defineProperty(ref, 'parent', { get: () => (segs.length ? makeRef(client, segs.slice(0, -1)) : null) });
  return ref;
}

class Snapshot {
  constructor(key, value, ref) {
    this.key = key;
    this._v = value === undefined ? null : value;
    this.ref = ref;
  }
  val() {
    return copy(this._v);
  }
  exists() {
    return this._v !== null;
  }
  child(path) {
    const segs = splitPath(path);
    return new Snapshot(segs[segs.length - 1] || this.key, getAt(this._v, segs), this.ref && makeRef(this.ref.client, this.ref.segs.concat(segs)));
  }
  hasChild(path) {
    return getAt(this._v, splitPath(path)) !== null;
  }
  hasChildren() {
    return this._v !== null && typeof this._v === 'object' && Object.keys(this._v).length > 0;
  }
  get size() {
    return this._v !== null && typeof this._v === 'object' ? Object.keys(this._v).length : 0;
  }
  forEach(fn) {
    if (this._v === null || typeof this._v !== 'object') return false;
    for (const k of Object.keys(this._v).sort(keyCompare)) {
      if (fn(this.child(k)) === true) return true;
    }
    return false;
  }
  toJSON() {
    return this.val();
  }
}

export function createFakeFirebase({ rules = null, latencyMs = 2, serverOffsetMs = 0 } = {}) {
  const server = { root: null, rules: rules ? compileRules(rules) : null, conns: new Set(), inflight: 0 };
  const api = {
    deny: null,
    denied: [],
    serverOffsetMs,
  };
  const serverNow = () => Date.now() + api.serverOffsetMs;
  let connSeq = 0;
  let uidSeq = 0;

  function later(fn, ms = latencyMs) {
    server.inflight++;
    setTimeout(() => {
      server.inflight--;
      try {
        fn();
      } catch (err) {
        console.error('[fake firebase]', err);
      }
    }, ms);
  }
  const toServer = (fn) => later(fn);
  const toClient = (conn, fn) =>
    later(() => {
      if (conn.open) fn(conn.client);
    });

  function authOf(client) {
    return client.uid ? { uid: client.uid, provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } } : null;
  }

  // Each client gets the data as it was right after this change, in the server's order (the real
  // server streams changes the same way), not whatever it is by the time the message lands.
  function broadcast() {
    const root = server.root;
    for (const conn of server.conns) toClient(conn, (c) => c.onServerRoot(root));
  }

  function locationsOf(op, t) {
    if (op.kind === 'set') return [{ segs: op.segs, value: resolveServerValues(op.value, t) }];
    return Object.entries(op.value).map(([k, v]) => ({ segs: op.segs.concat(splitPath(k)), value: resolveServerValues(v, t) }));
  }

  // -> { ok, newRoot } after the custom deny hook and the rules
  function check(client, locs, t) {
    const auth = authOf(client);
    if (api.deny) {
      for (const l of locs) {
        if (api.deny({ uid: auth && auth.uid, path: l.segs.join('/'), value: l.value })) {
          api.denied.push({ uid: auth && auth.uid, path: l.segs.join('/'), reason: 'deny hook' });
          return { ok: false };
        }
      }
    }
    if (server.rules) {
      const upd = {};
      for (const l of locs) upd[l.segs.join('/')] = l.value;
      const r = server.rules.canUpdate('', upd, { auth, root: server.root, now: t });
      if (!r.ok) api.denied.push({ uid: auth && auth.uid, path: locs.map((l) => l.segs.join('/')).join(', '), reason: r.reason });
      return r;
    }
    let newRoot = server.root;
    for (const l of locs) newRoot = applyAt(newRoot, l.segs, l.value);
    return { ok: true, newRoot };
  }

  function serverWrite(conn, op) {
    if (!server.conns.has(conn) || !conn.open) return; // the connection died first; the client sends it again
    const t = serverNow();
    const r = check(conn.client, locationsOf(op, t), t);
    if (!r.ok) {
      toClient(conn, (c) => c.onAck(op.id, deniedError()));
      return;
    }
    server.root = r.newRoot;
    broadcast();
    toClient(conn, (c) => c.onAck(op.id, null));
  }

  function serverOnDisconnect(conn, op) {
    if (!server.conns.has(conn) || !conn.open) return;
    if (op.kind === 'cancel') {
      conn.jobs = conn.jobs.filter((j) => !op.segs.every((s, i) => j.segs[i] === s));
      toClient(conn, (c) => c.onAck(op.id, null));
      return;
    }
    const t = serverNow();
    const r = check(conn.client, locationsOf(op, t), t);
    if (!r.ok) {
      toClient(conn, (c) => c.onAck(op.id, deniedError()));
      return;
    }
    conn.jobs.push(op);
    toClient(conn, (c) => c.onAck(op.id, null));
  }

  function serverGet(conn, segs, q, reply) {
    if (!server.conns.has(conn) || !conn.open) return;
    if (server.rules) {
      const r = server.rules.canRead(segs.join('/'), { auth: authOf(conn.client), root: server.root, now: serverNow() });
      if (!r.ok) {
        toClient(conn, () => reply(deniedError()));
        return;
      }
    }
    const v = filterQuery(getAt(server.root, segs), q);
    toClient(conn, () => reply(null, v));
  }

  function serverOpen(client) {
    const conn = { id: ++connSeq, client, open: true, jobs: [] };
    server.conns.add(conn);
    toClient(conn, (c) => c.onHandshake(conn, server.root, serverNow()));
    return conn;
  }

  function serverClose(conn, delayMs = 0) {
    if (!server.conns.has(conn)) return;
    conn.open = false;
    const run = () => {
      server.conns.delete(conn);
      if (!conn.jobs.length) return;
      const t = serverNow();
      let root = server.root;
      for (const j of conn.jobs) for (const l of locationsOf(j, t)) root = applyAt(root, l.segs, l.value);
      conn.jobs = [];
      server.root = root;
      broadcast();
    };
    if (delayMs > 0) later(run, delayMs);
    else run();
  }

  // ---- one connection, as the SDK in a page sees it -------------------------------------------------
  class Client {
    constructor(device) {
      this.device = device;
      this.clock = device.clock;
      this.uid = null;
      this.conn = null;
      this.connected = false;
      this.synced = false;
      this.cache = null;
      this.offset = 0;
      this.pending = [];
      this.waiting = new Map(); // onDisconnect jobs the server has not confirmed yet
      this.listeners = new Set();
      this.seq = 0;
      this.dead = false;
      this.online = true;
      this.raising = false;
      this.again = false;
      this.lastPushTime = 0;
      this.lastRand = [];
    }

    open() {
      if (this.dead || !this.online || this.conn) return;
      // the connection takes a moment to come up
      const c = this;
      later(() => {
        if (c.dead || !c.online || c.conn) return;
        c.conn = serverOpen(c);
      });
    }

    onHandshake(conn, root, t) {
      if (this.conn !== conn || this.dead) return;
      this.connected = true;
      this.synced = true;
      this.cache = root;
      this.offset = t - this.clock();
      for (const w of this.pending) this.sendWrite(w);
      for (const d of this.waiting.values()) this.sendJob(d);
      this.raise();
    }

    drop(staleMs = 0) {
      if (this.conn) serverClose(this.conn, staleMs);
      this.conn = null;
      if (this.connected) {
        this.connected = false;
        this.raise();
      }
    }

    kill() {
      this.drop();
      this.dead = true;
      this.listeners.clear();
    }

    onServerRoot(root) {
      this.cache = root;
      this.raise();
    }

    onAck(id, err) {
      const i = this.pending.findIndex((w) => w.id === id);
      if (i >= 0) {
        const [w] = this.pending.splice(i, 1);
        this.raise();
        if (err) w.reject(err);
        else w.resolve();
        return;
      }
      const j = this.waiting.get(id);
      if (j) {
        this.waiting.delete(id);
        if (err) j.reject(err);
        else j.resolve();
      }
    }

    estimatedNow() {
      return this.clock() + this.offset;
    }

    write(kind, segs, value) {
      if (this.dead) return new Promise(() => {});
      checkPath(segs);
      if (kind === 'update') {
        if (!value || typeof value !== 'object') throw new Error('update failed: values must be an object');
        for (const [k, v] of Object.entries(value)) {
          checkPath(splitPath(k));
          checkValue(v, k);
        }
      } else checkValue(value, segs.join('/'));
      return new Promise((resolve, reject) => {
        const w = { id: ++this.seq, kind, segs, value, local: resolveServerValues(value, this.estimatedNow()), resolve, reject };
        this.pending.push(w);
        this.raise();
        if (this.connected) this.sendWrite(w);
      });
    }

    sendWrite(w) {
      const conn = this.conn;
      toServer(() => serverWrite(conn, w));
    }

    job(kind, segs, value) {
      if (this.dead) return new Promise(() => {});
      if (kind !== 'cancel') checkValue(value, segs.join('/'));
      return new Promise((resolve, reject) => {
        const d = { id: ++this.seq, kind, segs, value, resolve, reject };
        this.waiting.set(d.id, d);
        if (this.connected) this.sendJob(d);
      });
    }

    sendJob(d) {
      const conn = this.conn;
      toServer(() => serverOnDisconnect(conn, d));
    }

    get(target) {
      return new Promise((resolve, reject) => {
        if (this.dead) return;
        if (target.segs[0] === '.info') {
          resolve(new Snapshot(target.segs[1], this.infoValue(target.segs[1]), makeRef(this, target.segs)));
          return;
        }
        if (!this.connected) {
          reject(new Error('Client is offline.'));
          return;
        }
        const conn = this.conn;
        toServer(() => {
          if (!conn.open) {
            later(() => reject(new Error('Client is offline.')));
            return;
          }
          serverGet(conn, target.segs, target.q, (err, v) => {
            if (err) reject(err);
            else resolve(new Snapshot(target.key, v, makeRef(this, target.segs)));
          });
        });
      });
    }

    nextPushId(t) {
      const dup = t === this.lastPushTime;
      this.lastPushTime = t;
      let ts = '';
      let n = t;
      for (let i = 0; i < 8; i++) {
        ts = PUSH_CHARS.charAt(n % 64) + ts;
        n = Math.floor(n / 64);
      }
      if (!dup) {
        for (let i = 0; i < 12; i++) this.lastRand[i] = Math.floor(Math.random() * 64);
      } else {
        let i = 11;
        for (; i >= 0 && this.lastRand[i] === 63; i--) this.lastRand[i] = 0;
        if (i >= 0) this.lastRand[i]++;
      }
      return ts + this.lastRand.map((x) => PUSH_CHARS.charAt(x)).join('');
    }

    view() {
      let v = this.cache;
      for (const w of this.pending) {
        if (w.kind === 'set') v = applyAt(v, w.segs, w.local);
        else for (const [k, x] of Object.entries(w.local)) v = applyAt(v, w.segs.concat(splitPath(k)), x);
      }
      return v;
    }

    infoValue(name) {
      if (name === 'connected') return this.connected;
      if (name === 'serverTimeOffset') return this.offset;
      return null;
    }

    listen(type, target, cb, cancel) {
      if (this.dead) return () => {};
      const L = { type, segs: target.segs, q: target.q, cb, init: false, last: null, ref: makeRef(this, target.segs) };
      if (target.segs[0] === '.info') {
        L.info = target.segs[1];
      } else if (server.rules) {
        const r = server.rules.canRead(target.segs.join('/'), { auth: authOf(this), root: server.root, now: serverNow() });
        if (!r.ok) {
          console.warn('FAKE FIREBASE WARNING: listen at /' + target.segs.join('/') + ' failed: permission_denied');
          later(() => {
            if (typeof cancel === 'function') cancel(deniedError());
          });
          return () => {};
        }
      }
      this.listeners.add(L);
      queueMicrotask(() => this.raise());
      return () => {
        this.listeners.delete(L);
      };
    }

    raise() {
      if (this.dead) return;
      if (this.raising) {
        this.again = true;
        return;
      }
      this.raising = true;
      try {
        do {
          this.again = false;
          this.raiseOnce();
        } while (this.again && !this.dead);
      } finally {
        this.raising = false;
      }
    }

    raiseOnce() {
      const root = this.synced ? this.view() : undefined;
      for (const L of [...this.listeners]) {
        if (!this.listeners.has(L) || this.dead) continue;
        if (L.info) {
          const v = this.infoValue(L.info);
          if (!L.init || v !== L.last) {
            L.init = true;
            L.last = v;
            L.cb(new Snapshot(L.info, v, L.ref));
          }
          continue;
        }
        if (root === undefined) continue;
        const v = filterQuery(getAt(root, L.segs), L.q);
        if (L.type === 'value') {
          const j = JSON.stringify(v);
          if (!L.init || j !== L.last) {
            L.init = true;
            L.last = j;
            L.cb(new Snapshot(L.ref.key, v, L.ref));
          }
          continue;
        }
        const prev = L.init ? L.last : {};
        const next = {};
        if (v && typeof v === 'object') for (const k of Object.keys(v)) next[k] = JSON.stringify(v[k]);
        L.init = true;
        L.last = next;
        const child = (k, val) => new Snapshot(k, val, makeRef(this, L.segs.concat(k)));
        if (L.type === 'child_removed') {
          for (const k of Object.keys(prev).sort(keyCompare)) if (!(k in next)) L.cb(child(k, JSON.parse(prev[k])));
        } else if (L.type === 'child_added') {
          let before = null;
          for (const k of Object.keys(next).sort(keyCompare)) {
            if (!(k in prev)) L.cb(child(k, v[k]), before);
            before = k;
          }
        } else if (L.type === 'child_changed') {
          for (const k of Object.keys(next).sort(keyCompare)) if (k in prev && prev[k] !== next[k]) L.cb(child(k, v[k]));
        }
      }
    }
  }

  // ---- a device: the three SDK namespaces plus test controls -----------------------------------------
  function device({ clock = () => Date.now(), signInFails = false } = {}) {
    const dev = { clock, clients: new Set(), apps: new Map(), online: true, uid: null };

    const appNs = {
      initializeApp(options, name = '[DEFAULT]') {
        if (dev.apps.has(name)) {
          const e = new Error('Firebase: Firebase App named ' + name + ' already exists (app/duplicate-app).');
          e.code = 'app/duplicate-app';
          throw e;
        }
        const app = { name, options: { ...options }, client: null, auth: null, deleted: false };
        dev.apps.set(name, app);
        return app;
      },
      async deleteApp(app) {
        app.deleted = true;
        dev.apps.delete(app.name);
        if (app.client) {
          app.client.kill();
          dev.clients.delete(app.client);
        }
      },
    };

    const authNs = {
      inMemoryPersistence: { type: 'NONE' },
      initializeAuth(app) {
        if (app.auth) {
          const e = new Error('Firebase: Error (auth/already-initialized).');
          e.code = 'auth/already-initialized';
          throw e;
        }
        app.auth = { app, currentUser: null };
        return app.auth;
      },
      getAuth(app) {
        if (!app.auth) app.auth = { app, currentUser: null };
        return app.auth;
      },
      signInAnonymously(auth) {
        return new Promise((resolve, reject) => {
          later(() => {
            if (signInFails || !dev.online) {
              const e = new Error('Firebase: Error (auth/network-request-failed).');
              e.code = 'auth/network-request-failed';
              reject(e);
              return;
            }
            let uid = '';
            for (let i = 0; i < 28; i++) uid += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
            uid = uid.slice(0, 24) + String(++uidSeq % 10000).padStart(4, '0');
            auth.currentUser = { uid, isAnonymous: true };
            dev.uid = uid;
            if (auth.app.client) auth.app.client.uid = uid;
            resolve({ user: auth.currentUser });
          });
        });
      },
    };

    const clientOf = (t) => t.client;
    const dbNs = {
      getDatabase(app) {
        if (!app.client) {
          const c = new Client(dev);
          c.uid = app.auth && app.auth.currentUser ? app.auth.currentUser.uid : null;
          c.online = dev.online;
          app.client = c;
          dev.clients.add(c);
          c.open();
        }
        return { app, client: app.client };
      },
      ref(db, path = '') {
        const segs = splitPath(path);
        checkPath(segs);
        return makeRef(db.client, segs);
      },
      child(ref, path) {
        return makeRef(ref.client, ref.segs.concat(splitPath(path)));
      },
      set: (ref, value) => clientOf(ref).write('set', ref.segs, value),
      update: (ref, values) => clientOf(ref).write('update', ref.segs, values),
      remove: (ref) => clientOf(ref).write('set', ref.segs, null),
      push(ref, value) {
        const c = clientOf(ref);
        const key = c.nextPushId(Math.floor(c.estimatedNow()));
        const childRef = makeRef(c, ref.segs.concat(key));
        const p = value === undefined ? Promise.resolve(childRef) : c.write('set', childRef.segs, value).then(() => childRef);
        return Object.assign(Object.create(null), childRef, { then: p.then.bind(p), catch: p.catch.bind(p) });
      },
      get: (target) => clientOf(target).get(target),
      query(ref, ...constraints) {
        const q = {};
        for (const k of constraints) Object.assign(q, k);
        return { client: ref.client, segs: ref.segs, key: ref.key, q };
      },
      orderByKey: () => ({ orderBy: 'key' }),
      startAt: (v) => ({ startAt: v }),
      endAt: (v) => ({ endAt: v }),
      limitToFirst: (n) => ({ limitToFirst: n }),
      onValue: (t, cb, cancel) => clientOf(t).listen('value', t, cb, cancel),
      onChildAdded: (t, cb, cancel) => clientOf(t).listen('child_added', t, cb, cancel),
      onChildChanged: (t, cb, cancel) => clientOf(t).listen('child_changed', t, cb, cancel),
      onChildRemoved: (t, cb, cancel) => clientOf(t).listen('child_removed', t, cb, cancel),
      onDisconnect(ref) {
        const c = clientOf(ref);
        return {
          set: (v) => c.job('set', ref.segs, v),
          update: (v) => c.job('update', ref.segs, v),
          remove: () => c.job('set', ref.segs, null),
          cancel: () => c.job('cancel', ref.segs, null),
        };
      },
      serverTimestamp: () => ({ '.sv': 'timestamp' }),
      goOffline(db) {
        db.client.online = false;
        db.client.drop();
      },
      goOnline(db) {
        db.client.online = dev.online;
        db.client.open();
      },
    };

    return {
      app: appNs,
      auth: authNs,
      database: dbNs,
      get uid() {
        return dev.uid;
      },
      get connected() {
        return [...dev.clients].some((c) => c.connected);
      },
      // writes made but not yet confirmed by the server (they pile up while offline)
      get pendingWrites() {
        let n = 0;
        for (const c of dev.clients) n += c.pending.length;
        return n;
      },
      network(on) {
        dev.online = !!on;
        for (const c of dev.clients) {
          c.online = dev.online;
          if (on) c.open();
          else c.drop();
        }
      },
      blip({ staleMs = 0 } = {}) {
        for (const c of dev.clients) {
          c.drop(staleMs);
          c.open();
        }
      },
      kill() {
        dev.online = false;
        for (const c of dev.clients) c.kill();
      },
    };
  }

  return Object.assign(api, {
    device,
    data: (path = '') => copy(getAt(server.root, splitPath(path))),
    write(path, value) {
      server.root = applyAt(server.root, splitPath(path), copy(value));
      broadcast();
    },
    get connections() {
      return server.conns.size;
    },
    async settle(extraMs = 0) {
      for (let i = 0; i < 2000; i++) {
        await new Promise((r) => setTimeout(r, Math.max(1, latencyMs)));
        if (server.inflight === 0) break;
      }
      if (extraMs) await new Promise((r) => setTimeout(r, extraMs));
    },
  });
}
