// The game layer (PLAY): Hide and seek, Freeze tag, Dodgeball and Capture the Bow, played in the
// 3D world, solo with bot friends or in a room with real friends. The rules and bot brains are the
// GAMES part (js/games/, Contract 5); this layer runs them: the host loop, claims, bots moving as
// characters, props, poses and glows, the HUD, the music, and a clear way out.
//
//   import { installPlay } from './play/index.js'
//   installPlay(world)        main.js calls it once the world exists. It sets
//                             world.onGameStart(kind, data) -> true when it takes the game, and calls
//                             world.endGame() when a game is over and everyone is back in free roam.
//                             (A second argument { props, overlay, tags } swaps in stand-ins: the node
//                             tests run this whole layer with the real net and no three.js or DOM.)
//   world.play                for tests and dev: { session, info(), state, now(), start(kind), finishRound(),
//                             end(), leave(), join(), again(), roam }
//
// Between games, any bot friends (world.addBots) stroll around gently (roam.js), host only.
//
// Who runs what: the host (solo: this device) owns the game. It ticks the rules, drives the bots,
// broadcasts fx batches with net.send('fx', { g, f }) and shares the state with net.setGame(). Every
// other device mirrors the state (net 'game'), plays the fx, and sends its own touch claims and
// button presses with net.send('claim', c). A client that taps "Leave game" stays in the room as a
// spectator (claim { type: 'leave' }) and can hop back in (claim { type: 'join' }). When the host
// ends the game it sends 'game-end' and sets the shared game back to { kind: 'roam' }.
//
// Test switches (the page address; solo): ?solo=1&game=dodgeball starts that game right away,
// &bots=N bot friends (0..9), &speed=N game time runs N times faster, &quick=1 the shortest rounds,
// &botLevel=easy|normal|hard.

import { createSession } from './session.js';
import { createProps } from './props.js';
import { createOverlay } from './overlay.js';
import { createRoleTags } from './tags.js';
import { createRoamer } from './roam.js';
import { PLAY_KINDS, parseSwitches, cleanBatch, leaveCopy } from './logic.js';

export function installPlay(world, deps = {}) {
  if (!world || world.play) return world ? world.play : null;
  const net = world.net;
  const sw = parseSwitches(deps.search !== undefined ? deps.search : typeof location !== 'undefined' ? location.search : '');
  const props = deps.props || createProps(world);
  const tags = deps.tags || createRoleTags(world, { quality: world.quality });
  const roam = createRoamer(world);
  const overlay = (deps.overlay || createOverlay)(world, {
    onLeave: () => askLeave(),
    onAgain: () => {
      if (session) session.startNow();
    },
    onJoin: () => {
      if (session) session.joinGame();
    },
  });
  let session = null; // a client who steps out keeps hers, as a spectator with a Join button
  let autoStarted = false;

  const inRoom = () => !!(world.session && world.session.kind === 'room');
  const isSolo = () => !world.session || world.session.kind === 'solo';
  const hostId = () => (net.room ? net.room.hostId : null);
  const meId = () => (net.me ? net.me.id : null);

  function open(opts) {
    const s = createSession(world, Object.assign({ switches: sw, props, overlay, tags }, opts));
    session = s;
    return s;
  }

  /** End the current game. switching: another game takes over at once (keep the bots, the app state). */
  function stop({ remote = false, switching = false } = {}) {
    const s = session;
    if (!s) return;
    session = null;
    try {
      s.end({ remote, keepBots: switching });
    } catch (err) {
      console.error('[c9 play] ending the game failed', err);
    }
    if (!switching && typeof world.endGame === 'function') {
      try {
        world.endGame({ kind: s.kind });
      } catch (err) { /* the app moves on anyway */ }
    }
  }

  // ---------------------------------------------------------------- the app's hook
  world.onGameStart = (kind, data) => {
    if (!PLAY_KINDS.includes(kind)) return false;
    const startId = data && typeof data.id === 'string' ? data.id.slice(0, 24) : null;
    if (session && startId && session.startId === startId) return true;
    const host = isSolo() || !!net.isHost;
    if (host) {
      if (session) stop({ switching: true });
      open({ kind, host: true, solo: isSolo(), startId });
      return true;
    }
    // a client: the host's state brings the game (it may already be here)
    if (session && session.kind === kind && !session.ended && (session.waiting || session.gid === (net.game && net.game.gid))) return true;
    if (session) stop({ remote: true, switching: true });
    const g = net.game;
    const s = open({ kind, host: false, solo: false, startId, state: g && g.kind === kind ? g : null });
    if (s.waiting && g && g.kind === kind) s.adopt(g);
    return true;
  };

  // ---------------------------------------------------------------- the network
  function onGame(g) {
    if (!inRoom() || net.isHost) return;
    const kind = g && typeof g.kind === 'string' ? g.kind : null;
    if (!kind || !PLAY_KINDS.includes(kind)) {
      // back to free roam (or nothing): the host ended the game
      if (session && !session.isHost) stop({ remote: true });
      return;
    }
    if (session && !session.isHost) {
      if (session.kind === kind && session.adopt(g)) return;
      if (session.kind === kind && session.waiting) return; // not a state we can read
      if (session.gid === g.gid) return;
      stop({ remote: true, switching: true }); // a new game: start over
    }
    if (!session) {
      const s = open({ kind, host: false, solo: false, state: g });
      if (s.waiting) s.adopt(g);
    }
  }

  net.on('game', (g) => {
    try {
      onGame(g);
    } catch (err) {
      console.error('[c9 play] the shared game could not be read', err);
    }
  });

  net.on('event', (ev) => {
    if (!ev || typeof ev !== 'object' || !session) return;
    const me = meId();
    if (ev.type === 'claim') {
      if (session.isHost && ev.from !== me && ev.data && typeof ev.data === 'object') session.claim(ev.from, ev.data);
    } else if (ev.type === 'fx') {
      if (session.isHost || ev.from === me || ev.from !== hostId()) return;
      const batch = cleanBatch(ev.data);
      if (batch) session.remoteFx(batch);
    } else if (ev.type === 'game-end') {
      if (!session.isHost && ev.from === hostId()) stop({ remote: true });
    }
  });

  net.on('join', (e) => {
    if (session && e && e.id && e.id !== meId()) session.join(e.id);
  });

  net.on('leave', (e) => {
    if (!session || !e || !e.id) return;
    if (e.id === meId()) {
      stop({ remote: true }); // I am out of the room
      return;
    }
    session.left(e.id);
  });

  net.on('host', () => {
    if (!session || !inRoom()) return;
    if (net.isHost && !session.isHost) session.becomeHost();
    else if (!net.isHost && session.isHost) session.becomeClient();
  });

  // ---------------------------------------------------------------- leaving
  function askLeave() {
    const s = session;
    if (!s) return;
    const solo = s.solo;
    const host = s.isHost;
    overlay.confirm(leaveCopy({ solo, host }), () => {
      if (session !== s) return;
      if (solo || host) stop();
      else s.leaveGame();
    });
  }

  // ---------------------------------------------------------------- every frame
  world.onUpdate((dt, t) => {
    // the app left the room or solo play (back to the menu): the game goes too
    if (session && world.session !== session.appSession) stop({ remote: true });
    // Hit Zero (the app runs it, for the whole room) takes over from a game
    if (session && world.hitZero) stop({ remote: !session.isHost });
    if (session) {
      roam.reset();
      session.update(dt, t);
    } else roam.update(dt); // between games, bot friends stroll around instead of standing frozen
    // test switch: ?solo=1&game=hideSeek starts it as soon as she is on the island
    if (sw.game && !autoStarted && world.mode === 'play' && world.session && world.session.kind === 'solo' && typeof world.hostStartGame === 'function') {
      autoStarted = true;
      world.hostStartGame(sw.game);
    }
  });

  // The tab goes to the background (the app stops drawing): a solo game waits for her, while a
  // room's host keeps the rules ticking for everyone else.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!session) return;
      if (document.hidden) session.pause();
      else session.resume();
    });
  }
  const bg = setInterval(() => {
    if (!session || session.solo || !session.isHost || !session.game || typeof document === 'undefined' || !document.hidden) return;
    session.update(0);
  }, 500);
  if (bg && typeof bg.unref === 'function') bg.unref();

  // ---------------------------------------------------------------- tests and dev
  const api = {
    get session() {
      return session;
    },
    get switches() {
      return sw;
    },
    info() {
      return session ? session.info() : null;
    },
    get state() {
      return session && session.game ? session.game.state : null;
    },
    start(kind) {
      if (typeof world.hostStartGame === 'function') world.hostStartGame(kind);
    },
    end() {
      stop();
    },
    leave() {
      if (!session) return;
      if (session.solo || session.isHost) stop();
      else session.leaveGame();
    },
    join() {
      if (session) session.joinGame();
    },
    again() {
      return session ? session.startNow() : false;
    },
    /** Host: this round's results right now (tests and dev). */
    finishRound() {
      return session ? session.finishRound() : false;
    },
    /** The game's clock: every time in the shared state counts from the host's epoch. */
    now() {
      return session ? session.now() : null;
    },
    askLeave,
    props,
    overlay,
    tags,
    roam,
  };
  world.play = api;
  return api;
}
