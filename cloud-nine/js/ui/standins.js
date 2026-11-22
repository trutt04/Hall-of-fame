// Stand-ins main.js uses when a neighbor's module is missing or fails to load, so the app always
// boots and solo play always works. Each has the same shape as the real thing:
//
//   createSilentAudio({ store })          Contract 6 without a sound: sfx and music do nothing
//   createStandinNet({ mode, cleanNick, cleanLook })   Contract 4. 'offline': solo rooms on this
//                                         device (bots included). 'local': tabs of one browser share
//                                         rooms over BroadcastChannel (dev and tests only)
//   STANDIN_CONTENT                       Contract 8 in miniature: EMOTES, cleanEmote, randomNick,
//                                         cleanNick, hype, birthdayInfo, HOWTO
//
// No DOM and no three.js: runs under node --test.

import { GAME } from '../config.js';
import { emitter, clamp, angleDelta } from '../core/util.js';
import { basicCleanNick, basicCleanLook } from '../core/store.js';
import { cleanCode } from './codepad.js';

// ------------------------------------------------------------------------------------ audio

export function createSilentAudio({ store = null } = {}) {
  const beatEvents = emitter();
  let enabled = store && store.sound !== null ? !!store.sound : true;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const clock = () => ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / 1000;
  const bpm = 120;
  return {
    silent: true,
    unlock() {},
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      if (store) store.setSound(enabled);
    },
    music() {},
    sfx() {},
    setListener() {},
    beat: {
      bpm,
      playing: false,
      time: clock,
      nextBeatTime() {
        const b = 60 / bpm;
        return Math.ceil(clock() / b) * b;
      },
      structure: null,
      on: beatEvents.on.bind(beatEvents),
      off: beatEvents.off.bind(beatEvents),
    },
    dispose() {},
  };
}

// ------------------------------------------------------------------------------------ net

const EVENT_TYPES = ['emote', 'claim', 'fx', 'game-start', 'game-end'];
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ANIM_RE = /^[A-Za-z]{1,16}$/;
const LIMIT = 2000; // meters: anything further is nonsense from the network

function rid(prefix) {
  let s = prefix;
  for (let i = 0; i < 10; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)];
  return s;
}

export function randomCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < GAME.roomCodeLength; i++) s += GAME.roomCodeAlphabet[Math.floor(rng() * GAME.roomCodeAlphabet.length) % GAME.roomCodeAlphabet.length];
  return s;
}

// A position update from anywhere: finite, clamped, rounded. Null when it is not one.
export function cleanState(s) {
  if (!s || typeof s !== 'object') return null;
  const x = Number(s.x);
  const y = Number(s.y);
  const z = Number(s.z);
  const h = Number(s.h);
  if (![x, y, z, h].every(Number.isFinite)) return null;
  return {
    x: clamp(Math.round(x * 100) / 100, -LIMIT, LIMIT),
    y: clamp(Math.round(y * 100) / 100, -LIMIT, LIMIT),
    z: clamp(Math.round(z * 100) / 100, -LIMIT, LIMIT),
    h: Math.round(clamp(h, -100, 100) * 1000) / 1000,
    anim: typeof s.anim === 'string' && ANIM_RE.test(s.anim) ? s.anim : 'idle',
  };
}

function smallJson(data, max = 2048) {
  if (data === undefined) return null;
  try {
    const text = JSON.stringify(data);
    if (typeof text !== 'string' || text.length > max) return undefined;
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
}

export function createStandinNet({ mode = 'offline', cleanNick = basicCleanNick, cleanLook = basicCleanLook, channelName = 'c9.room.' } = {}) {
  const events = emitter();
  const players = new Map();
  const buffers = new Map(); // id -> [{ t, s }] newest last
  const lastHeard = new Map();
  const local = mode === 'local' && typeof BroadcastChannel === 'function';
  let status = 'offline';
  let room = null;
  let game = null;
  let channel = null;
  let beat = null;
  let hostId = null;
  let lastSent = null;
  let lastSentAt = -1e9;
  const me = { id: rid('p'), nick: 'Cheerleader', look: null };

  const now = () => Date.now();
  // joinedAt decides the host, so it needs to tell apart joins in the same millisecond
  const hiNow = () => (typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());
  const nick = (v) => {
    try {
      return cleanNick(v) || 'Cheerleader';
    } catch (err) {
      return 'Cheerleader';
    }
  };
  const look = (v) => {
    try {
      return cleanLook(v) || null;
    } catch (err) {
      return null;
    }
  };

  function setStatus(s) {
    if (s === status) return;
    status = s;
    events.emit('status', s);
  }

  function electHost() {
    let best = null;
    for (const p of players.values()) {
      if (p.bot) continue;
      if (!best || p.joinedAt < best.joinedAt || (p.joinedAt === best.joinedAt && p.id < best.id)) best = p;
    }
    const next = best ? best.id : null;
    if (next !== hostId) {
      hostId = next;
      if (room) room.hostId = next;
      events.emit('host', { id: next });
    }
  }

  function record(id, s, t) {
    let buf = buffers.get(id);
    if (!buf) buffers.set(id, (buf = []));
    if (buf.length && t < buf[buf.length - 1].t) t = buf[buf.length - 1].t;
    buf.push({ t, s });
    if (buf.length > 12) buf.shift();
  }

  function addPlayer(p, quiet) {
    if (!p || !ID_RE.test(p.id || '')) return null;
    const known = players.get(p.id);
    const entry = {
      id: p.id,
      nick: nick(p.nick),
      look: look(p.look),
      bot: !!p.bot,
      joinedAt: Number.isFinite(Number(p.joinedAt)) ? Number(p.joinedAt) : now(),
    };
    if (p.bot && typeof p.owner === 'string') entry.owner = p.owner;
    players.set(p.id, entry);
    lastHeard.set(p.id, now());
    if (!known && !quiet) events.emit('join', { id: p.id });
    electHost();
    return entry;
  }

  function dropPlayer(id) {
    if (!players.has(id)) return;
    players.delete(id);
    buffers.delete(id);
    lastHeard.delete(id);
    events.emit('leave', { id });
    // a host's bots leave with it
    for (const p of [...players.values()]) if (p.bot && p.owner === id) dropPlayer(p.id);
    electHost();
  }

  function post(msg) {
    if (!channel) return;
    try {
      channel.postMessage(msg);
    } catch (err) { /* closed */ }
  }

  function myRecord() {
    const p = players.get(me.id);
    return p ? { id: p.id, nick: p.nick, look: p.look, bot: false, joinedAt: p.joinedAt } : null;
  }

  function onMessage(e) {
    const m = e && e.data;
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.from && m.from === me.id) return;
    if (typeof m.from === 'string' && ID_RE.test(m.from) && players.has(m.from)) lastHeard.set(m.from, now());
    switch (m.t) {
      case 'hello':
        addPlayer(m.p);
        post({ t: 'here', from: me.id, p: myRecord(), bots: api.isHost ? [...players.values()].filter((p) => p.bot) : [], game: api.isHost ? game : undefined });
        break;
      case 'here':
        addPlayer(m.p);
        if (Array.isArray(m.bots)) for (const b of m.bots.slice(0, GAME.maxPlayers)) addPlayer(Object.assign({}, b, { bot: true }));
        if (m.game !== undefined && m.game !== null && m.from === hostId) {
          const g = smallJson(m.game, 16384);
          if (g !== undefined) {
            game = g;
            events.emit('game', game);
          }
        }
        break;
      case 'bot':
        if (m.p && m.from === hostId) addPlayer(Object.assign({}, m.p, { bot: true, owner: m.from }));
        break;
      case 'botbye':
        if (m.from === hostId && players.has(m.id) && players.get(m.id).bot) dropPlayer(m.id);
        break;
      case 'state': {
        const s = cleanState(m.s);
        const id = m.id;
        if (!s || !players.has(id)) break;
        const p = players.get(id);
        if (p.bot ? m.from !== hostId : id !== m.from) break; // only bots' host may speak for them
        record(id, s, Number.isFinite(Number(m.at)) ? Number(m.at) : now());
        break;
      }
      case 'event': {
        if (!players.has(m.from) || !EVENT_TYPES.includes(m.type)) break;
        const data = smallJson(m.data);
        if (data === undefined) break;
        events.emit('event', { from: m.from, type: m.type, data });
        break;
      }
      case 'game': {
        if (m.from !== hostId) break;
        const g = smallJson(m.state, 16384);
        if (g === undefined) break;
        game = g;
        events.emit('game', game);
        break;
      }
      case 'ping':
        if (!players.has(m.from) && m.p) addPlayer(m.p);
        break;
      case 'bye':
        dropPlayer(m.from);
        break;
      default:
        break;
    }
  }

  function open(code) {
    if (!local) return;
    channel = new BroadcastChannel(channelName + code);
    channel.onmessage = onMessage;
    if (typeof channel.unref === 'function') channel.unref();
    beat = setInterval(() => {
      post({ t: 'ping', from: me.id, p: myRecord() });
      const cut = now() - 4500;
      for (const [id, at] of [...lastHeard]) {
        const p = players.get(id);
        if (id !== me.id && p && !p.bot && at < cut) dropPlayer(id);
      }
    }, 1000);
    if (beat && typeof beat.unref === 'function') beat.unref();
  }

  function close() {
    if (channel) {
      post({ t: 'bye', from: me.id });
      try {
        channel.close();
      } catch (err) { /* already closed */ }
    }
    channel = null;
    if (beat) clearInterval(beat);
    beat = null;
  }

  function enter(code, who) {
    me.nick = nick(who && who.nick);
    me.look = look(who && who.look);
    room = { code, hostId: null, createdAt: now() };
    players.clear();
    buffers.clear();
    game = null;
    hostId = null;
    addPlayer({ id: me.id, nick: me.nick, look: me.look, joinedAt: hiNow() }, true);
    open(code);
    post({ t: 'hello', from: me.id, p: myRecord() });
    setStatus(local ? 'online' : 'offline');
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const api = {
    kind: local ? 'local' : 'offline',
    get status() { return status; },
    get me() { return me; },
    get room() { return room; },
    get players() { return players; },
    get isHost() { return !!room && hostId === me.id; },
    get game() { return game; },
    now,

    async createRoom({ nick: n, look: l, code } = {}) {
      api.leaveRoom();
      const want = cleanCode(code || '');
      enter(want || randomCode(), { nick: n, look: l });
      return room.code;
    },

    async joinRoom(code, { nick: n, look: l } = {}) {
      const c = cleanCode(typeof code === 'string' ? code : '');
      if (!c) return { ok: false, reason: 'bad-code' };
      if (!local) return { ok: false, reason: 'offline' };
      api.leaveRoom();
      setStatus('connecting');
      enter(c, { nick: n, look: l });
      await wait(260);
      if (players.size <= 1) {
        api.leaveRoom();
        return { ok: false, reason: 'not-found' };
      }
      if (players.size > GAME.maxPlayers) {
        api.leaveRoom();
        return { ok: false, reason: 'full' };
      }
      return { ok: true };
    },

    leaveRoom() {
      if (!room) return;
      close();
      const ids = [...players.keys()].filter((id) => id !== me.id);
      for (const id of ids) {
        players.delete(id);
        events.emit('leave', { id });
      }
      players.clear();
      buffers.clear();
      lastHeard.clear();
      room = null;
      game = null;
      hostId = null;
      setStatus('offline');
    },

    sendState(state) {
      if (!room) return;
      const s = cleanState(state);
      if (!s) return;
      const t = now();
      const same = lastSent && s.x === lastSent.x && s.y === lastSent.y && s.z === lastSent.z && s.h === lastSent.h && s.anim === lastSent.anim;
      if (same && t - lastSentAt < 1000) return;
      if (t - lastSentAt < 1000 / GAME.netHz) return;
      lastSent = s;
      lastSentAt = t;
      record(me.id, s, t);
      post({ t: 'state', from: me.id, id: me.id, s, at: t });
    },

    sendStateFor(botId, state) {
      if (!api.isHost) return;
      const p = players.get(botId);
      if (!p || !p.bot) return;
      const s = cleanState(state);
      if (!s) return;
      const t = now();
      record(botId, s, t);
      post({ t: 'state', from: me.id, id: botId, s, at: t });
    },

    stateOf(id, at = now()) {
      const buf = buffers.get(id);
      if (!buf || !buf.length) return null;
      const target = at - GAME.interpDelayMs;
      if (buf.length === 1 || target >= buf[buf.length - 1].t) return Object.assign({}, buf[buf.length - 1].s);
      if (target <= buf[0].t) return Object.assign({}, buf[0].s);
      for (let i = buf.length - 1; i > 0; i--) {
        const a = buf[i - 1];
        const b = buf[i];
        if (target >= a.t && target <= b.t) {
          const k = b.t > a.t ? (target - a.t) / (b.t - a.t) : 1;
          return {
            x: a.s.x + (b.s.x - a.s.x) * k,
            y: a.s.y + (b.s.y - a.s.y) * k,
            z: a.s.z + (b.s.z - a.s.z) * k,
            h: a.s.h + angleDelta(a.s.h, b.s.h) * k,
            anim: k < 0.5 ? a.s.anim : b.s.anim,
          };
        }
      }
      return Object.assign({}, buf[buf.length - 1].s);
    },

    addBot({ nick: n, look: l } = {}) {
      if (!api.isHost || players.size >= GAME.maxPlayers) return null;
      const id = rid('b');
      const entry = addPlayer({ id, nick: n, look: l, bot: true, owner: me.id, joinedAt: hiNow() });
      if (!entry) return null;
      post({ t: 'bot', from: me.id, p: entry });
      return id;
    },

    removeBot(id) {
      const p = players.get(id);
      if (!api.isHost || !p || !p.bot) return;
      dropPlayer(id);
      post({ t: 'botbye', from: me.id, id });
    },

    send(type, data) {
      if (!room || !EVENT_TYPES.includes(type)) return false;
      const clean = smallJson(data === undefined ? null : data);
      if (clean === undefined) return false;
      post({ t: 'event', from: me.id, type, data: clean });
      events.emit('event', { from: me.id, type, data: clean }); // everyone includes me
      return true;
    },

    setGame(state) {
      if (!api.isHost) return false;
      const g = state === null ? null : smallJson(state, 16384);
      if (g === undefined) return false;
      game = g;
      post({ t: 'game', from: me.id, state: g });
      events.emit('game', game);
      return true;
    },

    on: events.on.bind(events),
    off: events.off.bind(events),
  };
  return api;
}

// ------------------------------------------------------------------------------------ content

const EMOTES = [
  { id: 'hi', text: 'Hi!', icon: '👋' },
  { id: 'go', text: "Let's go!", icon: '📣' },
  { id: 'yay', text: 'Yay!', icon: '🎉' },
  { id: 'nice', text: 'Nice one!', icon: '⭐' },
  { id: 'follow', text: 'Follow me!', icon: '👉' },
  { id: 'again', text: 'Again!', icon: '🔁' },
  { id: 'love', text: 'Love it!', icon: '💖' },
  { id: 'gg', text: 'Good game!', icon: '🤝' },
];

const NICK_A = ['Sparkle', 'Glitter', 'Comet', 'Twirl', 'Bubbly', 'Sunny', 'Rainbow', 'Starry', 'Peppy', 'Shiny', 'Bouncy', 'Dazzle'];
const NICK_B = ['Comet', 'Star', 'Flyer', 'Bow', 'Cloud', 'Spark', 'Jumper', 'Twister', 'Pom', 'Dream', 'Gem', 'Wish'];

const HYPE = {
  welcome: ['Welcome to Cloud Nine!', 'The sky is all yours!', 'Ready, set, sparkle!'],
  cloudCatch: ['A cloud caught you! Floating home...', 'Whoops! Cloud taxi to the plaza!', 'Safe and fluffy! Back to the plaza.'],
  join: ['joined the squad!', 'is here! Hi!', 'flew in!'],
  win: ['What a team!', 'Champions of the sky!'],
  lose: ['So close! Great effort!', 'Next time for sure!'],
  tie: ['A tie! Everybody wins a little!'],
  idle: ['Go team!', 'You got this!'],
};

const HOWTO = {
  hideSeek: { title: 'Hide and seek', steps: ['One seeker counts with eyes covered.', 'Everyone else hides in the garden.', 'Seeker: get close and tap "Found you!"'] },
  freezeTag: { title: 'Freeze tag', steps: ['Whoever is "it" tags you and you freeze.', 'Teammates tap you to unfreeze you.', 'Freeze everyone, or stay free until time runs out!'] },
  dodgeball: { title: 'Dodgeball', steps: ['Team Pink vs Team Purple. Stay on your side.', 'Pick up a ball and throw it at the other team.', 'Catch a ball to bring a teammate back!'] },
  captureBow: { title: 'Capture the Bow', steps: ["Grab the other team's giant bow.", 'Carry it back to your base to score.', 'Tag carriers on your side to send them home.'] },
  hitZero: { title: 'Hit Zero', steps: ['Tap the lanes in time with the music.', 'Every eight-count is a new motion.', 'Miss nothing for a HIT ZERO!'] },
};

function pickLine(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length) % list.length];
}

export const STANDIN_CONTENT = {
  standin: true,
  EMOTES,
  cleanEmote(id) {
    return typeof id === 'string' ? EMOTES.find((e) => e.id === id) || null : null;
  },
  randomNick(rng = Math.random) {
    let a = pickLine(NICK_A, rng);
    let b = pickLine(NICK_B, rng);
    if (a === b) b = 'Star';
    if (a === 'Comet' && b === 'Star') a = 'Shiny';
    return a + ' ' + b;
  },
  cleanNick: basicCleanNick,
  hype(situation, ctx, rng = Math.random) {
    const list = HYPE[situation] || HYPE.idle;
    return pickLine(list, rng);
  },
  birthdayInfo(date, b) {
    const out = { isBirthday: false, age: null, daysUntil: null, isBirthdayWeek: false };
    if (!b || !b.month || !b.day) return out;
    const d = date instanceof Date ? date : new Date();
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let next = new Date(d.getFullYear(), b.month - 1, b.day);
    if (next < today) next = new Date(d.getFullYear() + 1, b.month - 1, b.day);
    out.daysUntil = Math.round((next - today) / 86400000);
    out.isBirthday = out.daysUntil === 0;
    out.isBirthdayWeek = out.daysUntil <= 6; // the week leading up to it, the day included
    if (b.year) out.age = next.getFullYear() - b.year;
    return out;
  },
  HOWTO,
};
