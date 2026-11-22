// Local transport: tabs of one browser share rooms over a BroadcastChannel (for dev and tests), and
// with solo: true it is the offline transport (one device, nobody else can join).
//
// How it behaves like a server: one tab is the leader, picked by a Web Lock that the browser hands
// to the next tab in line when the leader closes. The leader keeps the one authoritative copy of
// every room (room-store.js, with the same permission checks as the Firebase rules), applies every
// request in order and broadcasts numbered changes. Every tab keeps a replica, so whoever leads
// next carries on from it. Each tab also holds a lock named after itself for as long as it lives;
// the leader waits on those locks, so a tab that closes (or crashes) counts as leaving.
//
// Internal transport interface (shared with transport-firebase.js; only js/net/index.js uses it):
//   t.kind, t.id                     t.id is known once connect() resolves
//   connect() -> Promise<{ id }>     throws when this transport can't work here
//   now() -> ms                      shared clock
//   onLink(fn(up))                   link to the authority up or down
//   probe(code) -> Promise<null | { meta, players } | { meta, locked: true }>   locked: I may not come in
//   create(code) -> Promise<'ok' | 'taken'>
//   enter(code, entry, sink)         subscribe, then write my player entry (joinedAt from the server)
//   exit(botIds)                     remove my bots, my state and my entry, unsubscribe
//   putPlayer(id, entry) patchPlayer(id, patch) dropPlayer(id) putState(id, s) dropState(id)
//   pushEvent({ type, data }) setGame(json | null) setMeta({ hostId? }) claimHost() trimEvents(beforeMs)
//   lock(locked, allowIds)           host: lock the room to the ids listed (unlock: false, [])
//   sendHome(id, allowIds)           host: lock to allowIds (without id), then remove id's entry and state
//   suspend() resume() dispose()
//   sink: { meta(raw | null), player(id, raw | null), state(id, raw | null), event(key, raw), game(raw | null), resync(),
//           removed() }   removed: the room was locked without me on its list, so I can't see it any more
// While the room is locked and this tab is not on its list, nothing more is delivered (Firebase
// stops a listener the rules no longer allow the same way).

import { createRoomStore } from './room-store.js';
import { isId } from './validate.js';

export const LOCAL_CHANNEL = 'c9-net-v1';
const LOCK_LEADER = 'c9net:leader';
const LOCK_TAB = 'c9net:tab:';
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

function randomId(n) {
  const c = globalThis.crypto;
  const buf = new Uint8Array(n);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(buf);
  else for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (let i = 0; i < n; i++) s += ID_CHARS[buf[i] % ID_CHARS.length];
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function localAvailable() {
  const nav = globalThis.navigator;
  return typeof globalThis.BroadcastChannel === 'function' && !!(nav && nav.locks && typeof nav.locks.request === 'function');
}

export function createLocalTransport({
  solo = false,
  channelName = LOCAL_CHANNEL,
  BroadcastChannel: BC = globalThis.BroadcastChannel,
  locks = globalThis.navigator ? globalThis.navigator.locks : undefined,
  tuning = {},
} = {}) {
  const T = { takeoverMs: 80, requestTimeoutMs: 1500, connectTimeoutMs: 4000, ...tuning };
  const id = (solo ? 'S' : 'L') + randomId(11);
  const store = createRoomStore({ now: () => Date.now() });
  const pending = new Map();
  const recent = new Map();
  const watched = new Set();
  const linkFns = new Set();
  const queue = [];
  let seq = 0;
  let channel = null;
  let leader = solo ? id : null;
  let amLeader = solo;
  let awaitingSnap = !solo;
  let linkUp = false;
  let connecting = null;
  let connected = solo;
  let disposed = false;
  let ridSeq = 0;
  let room = null;
  let releaseTab = null;
  let releaseLeader = null;
  let queueAbort = null;
  let watchAbort = null;
  let flushing = false;

  // ---- delivery to the room's sink, always asynchronous and in order ----------------------------
  function later(fn) {
    queue.push(fn);
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => {
      while (queue.length) {
        const f = queue.shift();
        try {
          f();
        } catch (err) {
          console.error('[c9 net] local delivery failed', err);
        }
      }
      flushing = false;
    });
  }

  // The room locked without me on its list: like Firebase, stop showing it, and say so once.
  function shut(r) {
    if (store.canRead(id, r.code)) return false;
    if (!r.denied) {
      r.denied = true;
      if (r.sink.removed) r.sink.removed();
    }
    return true;
  }

  function deliver(changes) {
    const r = room;
    if (!r) return;
    later(() => {
      if (room !== r || shut(r)) return;
      for (const ch of changes) {
        if (ch.c !== r.code) continue;
        const s = r.sink;
        if (ch.k === 'meta') s.meta(ch.v);
        else if (ch.k === 'player') s.player(ch.id, ch.v);
        else if (ch.k === 'state') s.state(ch.id, ch.v);
        else if (ch.k === 'event') s.event(ch.id, ch.v);
        else if (ch.k === 'game') s.game(ch.v);
        else if (ch.k === 'room') {
          for (const pid of r.known) s.player(pid, null);
          r.known.clear();
          s.meta(null);
        }
        if (ch.k === 'player') {
          if (ch.v) r.known.add(ch.id);
          else r.known.delete(ch.id);
        }
      }
    });
  }

  // The whole room as it stands, for a fresh subscriber or after a new snapshot.
  function deliverWhole(r) {
    later(() => {
      if (room !== r || shut(r)) return;
      const data = store.room(r.code);
      const s = r.sink;
      const now = new Set(data ? data.players.keys() : []);
      for (const pid of r.known) if (!now.has(pid)) s.player(pid, null);
      r.known = now;
      s.meta(data ? data.meta : null);
      if (!data) return;
      for (const [pid, v] of data.players) s.player(pid, v);
      for (const [pid, v] of data.state) s.state(pid, v);
      s.game(data.game);
    });
  }

  function setLink(up) {
    if (up === linkUp) return;
    linkUp = up;
    for (const fn of linkFns) {
      try {
        fn(up);
      } catch (err) {
        console.error('[c9 net] link listener failed', err);
      }
    }
  }

  // ---- messages ----------------------------------------------------------------------------------
  function post(msg) {
    if (!channel || disposed) return;
    try {
      channel.postMessage(msg);
    } catch (err) {
      console.warn('[c9 net] could not post to other tabs', err);
    }
  }

  function remember(rid, res) {
    if (typeof rid !== 'string') return;
    recent.set(rid, res);
    if (recent.size > 500) recent.delete(recent.keys().next().value);
  }

  function onMessage(m) {
    if (disposed || !m || typeof m !== 'object' || m.v !== 1 || typeof m.k !== 'string') return;
    if (!isId(m.from) || m.from === id) return;
    switch (m.k) {
      case 'hello':
        if (amLeader) {
          post({ v: 1, k: 'leader', from: id, seq });
          post({ v: 1, k: 'snap', from: id, to: m.from, seq, data: store.snapshot(), recent: [...recent] });
        }
        break;
      case 'leader':
        if (!amLeader && leader !== m.from) {
          leader = m.from;
          awaitingSnap = true;
        }
        break;
      case 'snap':
        if (!amLeader && m.from === leader && (m.to === id || m.to === '*')) loadSnap(m);
        break;
      case 'req':
        if (amLeader) handleRequest(m.from, m.rid, m.op);
        break;
      case 'd':
        if (!amLeader && m.from === leader) applyDelta(m);
        break;
      case 'res':
        if (m.to === id) settle(m.rid, m.res);
        break;
      case 'bye':
        if (amLeader) tabGone(m.from);
        break;
    }
  }

  function loadSnap(m) {
    if (!store.load(m.data) || typeof m.seq !== 'number') return;
    seq = m.seq;
    awaitingSnap = false;
    if (Array.isArray(m.recent)) for (const [rid, res] of m.recent) remember(rid, res);
    for (const rid of [...pending.keys()]) if (recent.has(rid)) settle(rid, recent.get(rid));
    connected = true;
    setLink(true);
    resendPending();
    if (room) {
      deliverWhole(room);
      const r = room;
      later(() => {
        if (room === r && r.sink.resync) r.sink.resync();
      });
    }
  }

  function applyDelta(m) {
    if (awaitingSnap || typeof m.seq !== 'number' || m.seq <= seq) return;
    if (m.seq !== seq + 1) {
      // a gap: ask the leader for the whole thing again
      awaitingSnap = true;
      post({ v: 1, k: 'hello', from: id });
      return;
    }
    seq = m.seq;
    store.apply(m.changes);
    if (m.rid) remember(m.rid, m.res);
    deliver(Array.isArray(m.changes) ? m.changes : []);
    if (m.to === id && m.rid) {
      const rid = m.rid;
      const res = m.res;
      later(() => settle(rid, res));
    }
  }

  // ---- the leader ----------------------------------------------------------------------------------
  function broadcastChanges(changes, rid, to, res) {
    seq++;
    post({ v: 1, k: 'd', from: id, seq, rid: rid || null, to: to || null, res: res || null, changes });
    deliver(changes);
    for (const ch of changes) if (ch.k === 'player' && ch.v) watchTab(ch.v.bot ? ch.v.owner : ch.id);
  }

  function handleRequest(from, rid, op) {
    if (!isId(from) || !op || typeof op !== 'object') return;
    if (typeof rid === 'string' && recent.has(rid)) {
      post({ v: 1, k: 'res', from: id, to: from, rid, res: recent.get(rid) });
      return;
    }
    const r = store.exec(from, op);
    const res = { ok: r.ok, err: r.err || null, value: r.value === undefined ? null : r.value };
    if (typeof rid === 'string') remember(rid, res);
    if (r.changes.length) broadcastChanges(r.changes, rid, from, res);
    else if (typeof rid === 'string') post({ v: 1, k: 'res', from: id, to: from, rid, res });
  }

  // The leader's own requests: same path, answered here. A request the old leader already applied
  // (it is in the replicated log) is answered from the log instead of being applied twice.
  function handleOwn(p) {
    if (p.rid && recent.has(p.rid)) {
      const res = recent.get(p.rid);
      later(() => settle(p.rid, res));
      return;
    }
    const r = store.exec(id, p.op);
    const res = { ok: r.ok, err: r.err || null, value: r.value === undefined ? null : r.value };
    if (p.rid) remember(p.rid, res);
    if (r.changes.length) broadcastChanges(r.changes, p.rid, id, res);
    if (p.rid) later(() => settle(p.rid, res));
  }

  function tabGone(tab) {
    if (!amLeader || !isId(tab) || tab === id) return;
    const r = store.exec(null, { op: 'gone', id: tab });
    if (r.changes.length) broadcastChanges(r.changes);
  }

  function watchTab(tab) {
    if (!amLeader || solo || !locks || !isId(tab) || tab === id || watched.has(tab) || !watchAbort) return;
    watched.add(tab);
    const signal = watchAbort.signal;
    locks
      .request(LOCK_TAB + tab, { signal }, () => {
        watched.delete(tab);
        if (!disposed) tabGone(tab);
      })
      .catch(() => {
        watched.delete(tab);
      });
  }

  async function becomeLeader() {
    await sleep(T.takeoverMs); // let the last messages of the old leader arrive first
    if (disposed) return;
    amLeader = true;
    leader = id;
    awaitingSnap = false;
    connected = true;
    watchAbort = new AbortController();
    post({ v: 1, k: 'leader', from: id, seq });
    post({ v: 1, k: 'snap', from: id, to: '*', seq, data: store.snapshot(), recent: [...recent] });
    for (const tab of store.tabs()) watchTab(tab);
    setLink(true);
    resendPending();
    if (room) {
      const r = room;
      later(() => {
        if (room === r && r.sink.resync) r.sink.resync();
      });
    }
    await new Promise((resolve) => {
      releaseLeader = resolve;
    });
  }

  // ---- requests ------------------------------------------------------------------------------------
  function request(op, { track = true } = {}) {
    if (disposed) return Promise.reject(new Error('closed'));
    if (!track) {
      if (amLeader) handleOwn({ rid: null, op });
      else if (leader && !awaitingSnap) post({ v: 1, k: 'req', from: id, rid: null, op });
      return Promise.resolve(null);
    }
    const rid = id + ':' + (++ridSeq).toString(36);
    return new Promise((resolve, reject) => {
      const p = { rid, op, resolve, reject, tries: 0, timer: null };
      pending.set(rid, p);
      sendPending(p);
    });
  }

  function sendPending(p) {
    clearTimeout(p.timer);
    if (amLeader) {
      handleOwn(p);
      return;
    }
    if (leader && !awaitingSnap) post({ v: 1, k: 'req', from: id, rid: p.rid, op: p.op });
    p.tries++;
    p.timer = setTimeout(() => {
      if (!pending.has(p.rid)) return;
      if (p.tries >= 4) {
        pending.delete(p.rid);
        setLink(false);
        p.reject(new Error('timeout'));
        return;
      }
      post({ v: 1, k: 'hello', from: id }); // maybe the leader changed
      sendPending(p);
    }, T.requestTimeoutMs);
  }

  function resendPending() {
    for (const p of pending.values()) sendPending(p);
  }

  function settle(rid, res) {
    const p = pending.get(rid);
    if (!p) return;
    pending.delete(rid);
    clearTimeout(p.timer);
    if (res && res.ok) {
      p.resolve(res.value);
    } else {
      const err = new Error((res && res.err) || 'failed');
      err.code = (res && res.err) || 'failed';
      p.reject(err);
    }
  }

  // ---- connect -------------------------------------------------------------------------------------
  function connect() {
    if (disposed) return Promise.reject(new Error('closed'));
    if (connected && (solo || channel)) return Promise.resolve({ id });
    if (!connecting) {
      connecting = (async () => {
        if (typeof BC !== 'function' || !locks || typeof locks.request !== 'function') {
          throw new Error('local rooms need BroadcastChannel and Web Locks');
        }
        channel = new BC(channelName);
        channel.onmessage = (e) => onMessage(e && e.data);
        // Hold a lock named after this tab while it lives, so the leader notices when it closes.
        await new Promise((granted, failed) => {
          locks
            .request(LOCK_TAB + id, () => {
              granted();
              return new Promise((r) => {
                releaseTab = r;
              });
            })
            .catch(failed);
        });
        queueAbort = new AbortController();
        locks.request(LOCK_LEADER, { signal: queueAbort.signal }, () => becomeLeader()).catch(() => {});
        const t0 = Date.now();
        let lastHello = -Infinity;
        while (!connected && !disposed) {
          if (Date.now() - t0 > T.connectTimeoutMs) throw new Error('no leader');
          if (!amLeader && Date.now() - lastHello >= 500) {
            lastHello = Date.now();
            post({ v: 1, k: 'hello', from: id });
          }
          await sleep(15);
        }
        if (disposed) throw new Error('closed');
        return { id };
      })();
      connecting.catch(() => {
        connecting = null;
      });
    }
    return connecting;
  }

  function needRoom() {
    if (!room) throw new Error('not in a room');
    return room.code;
  }

  function quiet(p) {
    return p.catch((err) => {
      if (!disposed) console.warn('[c9 net] local write failed:', err && err.message);
      return null;
    });
  }

  return {
    kind: solo ? 'offline' : 'local',
    get id() {
      return id;
    },
    get isLeader() {
      return amLeader;
    },
    now: () => Date.now(),
    onLink(fn) {
      linkFns.add(fn);
      return () => linkFns.delete(fn);
    },
    connect,
    async probe(code) {
      return request({ op: 'probe', code });
    },
    async create(code) {
      try {
        await request({ op: 'create', code });
        return 'ok';
      } catch (err) {
        if (err && err.code === 'taken') return 'taken';
        throw err;
      }
    },
    async enter(code, entry, sink) {
      room = { code, sink, known: new Set() };
      deliverWhole(room);
      await request({ op: 'putPlayer', code, id, entry });
    },
    async exit(botIds = []) {
      if (!room) return;
      const code = room.code;
      const jobs = [];
      for (const b of botIds) {
        jobs.push(quiet(request({ op: 'dropState', code, id: b })));
        jobs.push(quiet(request({ op: 'dropPlayer', code, id: b })));
      }
      jobs.push(quiet(request({ op: 'dropState', code, id })));
      jobs.push(quiet(request({ op: 'dropPlayer', code, id })));
      room = null;
      await Promise.all(jobs);
    },
    putPlayer: (pid, entry) => request({ op: 'putPlayer', code: needRoom(), id: pid, entry }),
    patchPlayer: (pid, patch) => request({ op: 'patchPlayer', code: needRoom(), id: pid, patch }),
    dropPlayer: (pid) => request({ op: 'dropPlayer', code: needRoom(), id: pid }),
    putState: (pid, s) => request({ op: 'putState', code: needRoom(), id: pid, s }, { track: false }),
    dropState: (pid) => request({ op: 'dropState', code: needRoom(), id: pid }),
    pushEvent: (ev) => request({ op: 'event', code: needRoom(), ev }),
    setGame: (json) => request({ op: 'setGame', code: needRoom(), json }),
    setMeta: (patch) => request({ op: 'meta', code: needRoom(), patch }),
    claimHost: () =>
      request({ op: 'claim', code: needRoom() }).then(
        () => true,
        () => false,
      ),
    trimEvents: (before) => request({ op: 'trim', code: needRoom(), before }),
    lock: (locked, allow) => request({ op: 'lock', code: needRoom(), locked: locked === true, allow: Array.isArray(allow) ? allow : [] }),
    async sendHome(pid, allow) {
      const code = needRoom();
      await request({ op: 'lock', code, locked: true, allow: Array.isArray(allow) ? allow : [] });
      await request({ op: 'dropPlayer', code, id: pid });
      await request({ op: 'dropState', code, id: pid });
    },
    suspend() {
      post({ v: 1, k: 'bye', from: id });
    },
    resume() {},
    dispose() {
      if (disposed) return;
      post({ v: 1, k: 'bye', from: id });
      disposed = true;
      room = null;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('closed'));
      }
      pending.clear();
      if (queueAbort) queueAbort.abort();
      if (watchAbort) watchAbort.abort();
      if (releaseLeader) releaseLeader();
      if (releaseTab) releaseTab();
      if (channel) {
        try {
          channel.close();
        } catch (err) { /* already closed */ }
      }
      setLink(false);
      linkFns.clear();
    },
  };
}
