// Cloud Nine boot and frame (Contract 1). Builds the engine, the island, the player, the camera,
// the HUD and the menus, loads every other part with await import() (each one optional, with a
// stand-in), and exposes the world object as window.__c9.
//
// The parts it loads, and what it uses when one is missing or fails:
//   ./world/island.js + ./world/sky.js  -> ./world/fallback-island.js
//   ./art/character.js                  -> ./world/placeholder-avatar.js
//   ./audio/index.js                    -> a silent stand-in (ui/standins.js)
//   ./net/index.js                      -> an offline stand-in; solo rooms and bots work
//   ./content/*.js                      -> tiny built-in lines (ui/standins.js)
//   ./world/toss.js, ./games/index.js   -> no basket toss, no game rules yet
//   ./world/photobooth.js               -> the photo booth stays scenery
//   ./ui/creator.js, ./rhythm/index.js  -> loaded when first opened; a friendly placeholder if missing
//
// URL switches (for testing):
//   ?solo=1               skip the menus, straight into solo free roam
//   ?room=CODE&nick=Name  auto-join a room with the local transport (several tabs, one room)
//   ?quality=low|high     skip the adaptive quality controller
//   ?debug=1              on-screen stats
//   ?noaudio=1            never create audio
//   ?birthday=1           force birthday mode (cake candles, banner, splash)

import * as THREE from '../lib/three.module.min.js';
import { GAME, PALETTE, BIRTHDAY, FEATURES } from './config.js';
import { createEngine } from './core/engine.js';
import { createStore } from './core/store.js';
import { createInput } from './core/input.js';
import { createCameraRig } from './core/camera.js';
import { createColliders } from './core/colliders.js';
import { emitter, clamp } from './core/util.js';
import { setReducedMotion } from './art/util.js';
import { createPlayer, createPeers } from './world/player.js';
import { createInteract } from './world/interact.js';
import { createSpiritSticks, lockedLooks } from './world/sticks.js';
import { createHud } from './ui/hud.js';
import { createMenu, buildPauseMenu, buildPicker, JOIN_REASONS } from './ui/menu.js';
import { createLabels } from './ui/labels.js';
import { createFx } from './ui/fx.js';
import { createSilentAudio, createStandinNet, STANDIN_CONTENT } from './ui/standins.js';
import { GAME_CHOICES, gameTitle, normalizeHowto } from './ui/gameui.js';
import { loadCss, el, reducedMotion, coarsePointer } from './ui/dom.js';
import { cleanCode } from './ui/codepad.js';
import { createSilentTip } from './ui/silent-tip.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const HINT_KEY = 'c9.hinted.v1';
const SKY_FLOOR = -40; // what the camera treats open sky as, so it never sees -Infinity

let debugOn = false;
async function optional(path) {
  try {
    return await import(path);
  } catch (err) {
    if (debugOn) console.info('[c9] optional part not loaded:', path, err && err.message);
    return null;
  }
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function showFallback(message) {
  const box = document.getElementById('fallback');
  const veil = document.getElementById('veil');
  if (veil) veil.hidden = true;
  if (!box) return;
  const msg = document.getElementById('fallback-msg');
  if (msg && message) msg.textContent = message;
  box.hidden = false;
}

// ------------------------------------------------------------------------------------ safe facades

// Audio from the AUDIO part, or the silent stand-in, behind try/catch: a sound never stops the game.
function safeAudio(real) {
  const warned = new Set();
  const call = (fn, ...args) => {
    try {
      return typeof real[fn] === 'function' ? real[fn](...args) : undefined;
    } catch (err) {
      if (!warned.has(fn)) {
        warned.add(fn);
        console.warn('[c9] audio.' + fn + ' failed', err);
      }
      return undefined;
    }
  };
  return {
    real,
    unlock: () => call('unlock'),
    get enabled() {
      try {
        return !!real.enabled;
      } catch (err) {
        return false;
      }
    },
    setEnabled: (on) => call('setEnabled', !!on),
    music: (id, o) => call('music', id, o),
    sfx: (name, o) => call('sfx', name, o),
    setListener: (x, z, h) => call('setListener', x, z, h),
    get beat() { return real.beat; },
    dispose: () => call('dispose'),
  };
}

// One stable world.net for everyone. Solo play and online rooms are separate nets underneath
// (offline for solo, so a solo game never touches the network); this forwards to whichever is
// current and re-emits its events.
function createNetFacade() {
  const events = emitter();
  const FORWARD = ['status', 'join', 'leave', 'host', 'player', 'event', 'game', 'room'];
  let cur = null;
  let offs = [];
  const emptyPlayers = new Map();
  const guard = (fn, fallback) => {
    try {
      return fn();
    } catch (err) {
      console.warn('[c9] net call failed', err);
      return fallback;
    }
  };
  return {
    use(n) {
      for (const off of offs) off();
      offs = [];
      cur = n || null;
      if (!cur || typeof cur.on !== 'function') return;
      for (const evt of FORWARD) {
        const fn = (a) => events.emit(evt, a);
        cur.on(evt, fn);
        offs.push(() => {
          try {
            n.off(evt, fn);
          } catch (err) { /* gone */ }
        });
      }
    },
    get current() { return cur; },
    get kind() { return cur ? cur.kind || cur.mode || 'net' : 'none'; },
    get status() { return cur ? cur.status : 'offline'; },
    get me() { return cur ? cur.me : null; },
    get room() { return cur ? cur.room : null; },
    get players() { return cur && cur.players ? cur.players : emptyPlayers; },
    get isHost() { return cur ? !!cur.isHost : true; },
    get game() { return cur ? cur.game : null; },
    now() { return cur && typeof cur.now === 'function' ? guard(() => cur.now(), Date.now()) : Date.now(); },
    createRoom(o) { return cur ? cur.createRoom(o) : Promise.reject(new Error('no net')); },
    joinRoom(code, o) { return cur ? cur.joinRoom(code, o) : Promise.resolve({ ok: false, reason: 'offline' }); },
    leaveRoom() { if (cur) guard(() => cur.leaveRoom()); },
    sendState(s) { if (cur && cur.room) guard(() => cur.sendState(s)); },
    sendStateFor(id, s) { if (cur) guard(() => cur.sendStateFor(id, s)); },
    stateOf(id, now, out) { return cur ? guard(() => cur.stateOf(id, now, out), null) : null; },
    updateMe(o) { return cur && typeof cur.updateMe === 'function' ? guard(() => cur.updateMe(o), false) : false; },
    addBot(o) { return cur ? guard(() => cur.addBot(o), null) : null; },
    removeBot(id) { if (cur) guard(() => cur.removeBot(id)); },
    send(type, data) { return cur ? guard(() => cur.send(type, data), false) : false; },
    setGame(state) { return cur ? guard(() => cur.setGame(state), false) : false; },
    lockRoom(on) { return cur && typeof cur.lockRoom === 'function' ? cur.lockRoom(on).catch(() => false) : Promise.resolve(false); },
    sendHome(id) { return cur && typeof cur.sendHome === 'function' ? cur.sendHome(id).catch(() => false) : Promise.resolve(false); },
    on: events.on.bind(events),
    off: events.off.bind(events),
  };
}

// ------------------------------------------------------------------------------------ content

function assembleContent(mods) {
  const S = STANDIN_CONTENT;
  const out = { modules: mods };
  // everything the content part exports, flattened (EMOTES, hype, FAMILY_NOTES, ...)
  for (const m of Object.values(mods)) if (m) for (const k of Object.keys(m)) if (k !== 'default') out[k] = m[k];
  const emotes = mods.emotes && Array.isArray(mods.emotes.EMOTES) && mods.emotes.EMOTES.length ? mods.emotes.EMOTES : S.EMOTES;
  out.EMOTES = emotes;
  out.cleanEmote = (id) => {
    try {
      if (mods.emotes && typeof mods.emotes.cleanEmote === 'function') {
        const r = mods.emotes.cleanEmote(id);
        if (r && typeof r === 'object') return r;
        if (typeof r === 'string') return emotes.find((e) => e.id === r) || null;
        return null;
      }
    } catch (err) { /* fall through */ }
    return emotes.find((e) => e && e.id === id) || null;
  };
  out.randomNick = (rng) => {
    try {
      if (mods.names && typeof mods.names.randomNick === 'function') {
        const n = mods.names.randomNick(rng || Math.random);
        if (typeof n === 'string' && n) return n;
      }
    } catch (err) { /* fall through */ }
    return S.randomNick(rng);
  };
  out.cleanNick = (raw) => {
    try {
      if (mods.names && typeof mods.names.cleanNick === 'function') return mods.names.cleanNick(raw);
    } catch (err) {
      return null;
    }
    return S.cleanNick(raw);
  };
  out.hype = (situation, ctx, rng) => {
    try {
      if (mods.hype && typeof mods.hype.hype === 'function') {
        const line = mods.hype.hype(situation, ctx || {}, rng || Math.random);
        if (typeof line === 'string' && line.trim()) return line;
      }
    } catch (err) { /* fall through */ }
    return S.hype(situation, ctx, rng);
  };
  out.birthdayInfo = (date, b) => {
    try {
      if (mods.birthday && typeof mods.birthday.birthdayInfo === 'function') return mods.birthday.birthdayInfo(date, b) || {};
    } catch (err) { /* fall through */ }
    return S.birthdayInfo(date, b);
  };
  out.howto = (kind) => normalizeHowto(mods.howto, kind) || normalizeHowto(S, kind);
  return out;
}

const JOIN_LINES = ['joined the squad!', 'is here! Hi!', 'flew in!', 'landed on Cloud Nine!'];

const EMOTE_ANIMS = [
  [/wave|hi|hey|hello|bye/i, 'wave'],
  [/clap|nice|good|gg|great/i, 'clap'],
  [/dance|party|groove/i, 'dance'],
  [/love|heart|aww/i, 'highV'],
  [/go|yay|cheer|win|woo|again|lets/i, 'cheer'],
];
function animForEmote(e) {
  if (e && typeof e.anim === 'string') return e.anim;
  const key = (e && (e.id + ' ' + (e.text || ''))) || '';
  for (const [re, anim] of EMOTE_ANIMS) if (re.test(key)) return anim;
  return 'cheer';
}

// ------------------------------------------------------------------------------------ boot

async function boot() {
  const store = createStore();
  const params = store.params;
  debugOn = store.flag('debug');
  const calm = reducedMotion();
  setReducedMotion(calm);
  const canvas = document.getElementById('scene');
  const hud = createHud(document.getElementById('hud'), { veil: document.getElementById('veil') });
  const menu = createMenu(document.getElementById('screens'));
  menu.hide();
  hud.setLoading(0.06, 'Fluffing the clouds');

  // ---------------------------------------------------------------- the parts, all at once
  const parts = Promise.all([
    optional('./world/island.js'), optional('./world/sky.js'), optional('./art/character.js'),
    params.get('noaudio') === '1' ? null : optional('./audio/index.js'), optional('./net/index.js'),
    optional('./content/emotes.js'), optional('./content/names.js'), optional('./content/hype.js'),
    optional('./content/birthday.js'), optional('./content/howto.js'), optional('./content/notes.js'),
    optional('./content/glossary.js'), optional('./content/collectibles.js'),
    optional('./world/toss.js'), optional('./games/index.js'),
  ]);

  let engine;
  try {
    engine = createEngine({ canvas, quality: store.quality });
  } catch (err) {
    console.warn('[c9] WebGL is not available', err);
    window.__c9 = { store, hud, failed: 'webgl' };
    showFallback('This device could not start the 3D sky island. Try another browser, or ask a grown-up to update this one.');
    return;
  }
  const { scene, camera, renderer } = engine;
  engine.on('contextlost', () => hud.skyLost(true));
  engine.on('contextrestored', () => hud.skyLost(false));

  const [islandMod, skyMod, charMod0, audioMod, netMod, emotesMod, namesMod, hypeMod, birthdayMod, howtoMod, notesMod, glossaryMod, collectiblesMod, tossMod, gamesMod] = await parts;
  hud.setLoading(0.3, 'Building the island');
  await nextFrame();

  const content = assembleContent({ emotes: emotesMod, names: namesMod, hype: hypeMod, birthday: birthdayMod, howto: howtoMod, notes: notesMod, glossary: glossaryMod, collectibles: collectiblesMod });
  const placeholder = await import('./world/placeholder-avatar.js');
  const charMod = charMod0 && typeof charMod0.createCharacter === 'function' ? charMod0 : placeholder;
  const cleanLook = (raw) => {
    try {
      return charMod.cleanLook ? charMod.cleanLook(raw) : placeholder.cleanLook(raw);
    } catch (err) {
      return placeholder.cleanLook(raw);
    }
  };
  store.setCleaners({ cleanLook, cleanNick: content.cleanNick });

  const quality = store.quality === 'low' ? 'low' : 'high';
  const makeCharacter = (look) => {
    const l = look ? cleanLook(look) : charMod.DEFAULT_LOOK || placeholder.DEFAULT_LOOK;
    try {
      const c = charMod.createCharacter(l, { quality });
      if (c && c.group) return c;
    } catch (err) {
      console.warn('[c9] the character part could not build this look', err);
    }
    return placeholder.createCharacter(l, { quality });
  };

  // ---------------------------------------------------------------- island and sky
  const colliders = createColliders();
  let island = null;
  if (islandMod && typeof islandMod.buildIsland === 'function') {
    try {
      island = islandMod.buildIsland({ scene, quality, colliders });
    } catch (err) {
      console.warn('[c9] the island part failed, using the stand-in island', err);
      colliders.clear();
      island = null;
    }
  }
  const fallbackIsland = !island || !island.places || typeof island.groundAt !== 'function' ? await import('./world/fallback-island.js') : null;
  if (fallbackIsland) {
    if (island) {
      console.warn('[c9] the island part has no places or groundAt, using the stand-in island');
      try {
        if (island.dispose) island.dispose();
      } catch (err) { /* it is going anyway */ }
      colliders.clear();
    }
    island = fallbackIsland.buildIsland({ scene, quality, colliders });
  }
  let sky = null;
  if (skyMod && typeof skyMod.createSky === 'function') {
    try {
      sky = skyMod.createSky({ scene, quality });
    } catch (err) {
      console.warn('[c9] the sky part failed, using the stand-in sky', err);
    }
  }
  if (!sky) sky = (fallbackIsland || (await import('./world/fallback-island.js'))).createSky({ scene, quality });

  const groundAt = (x, z) => {
    let y;
    try {
      y = island.groundAt(x, z);
    } catch (err) {
      y = -Infinity;
    }
    return Number.isFinite(y) ? y : -Infinity;
  };
  const places = island.places || {};
  if (!places.plaza) places.plaza = { x: 0, z: 0, facing: 0 };
  const platforms = Array.isArray(island.platforms) ? island.platforms : [];
  // What the camera treats as ground: the walkable surface, open sky clamped to a floor, and each
  // cloud platform's puffy body (wider than its walkable top), so riding a slide down off a cloud
  // the camera rises over the puffs instead of looking through them.
  const camFocus = { x: 0, y: 0, z: 0 }; // where she is, from the last frame (for the camera's ground and blockers)
  const camGround = (x, z) => {
    let g = groundAt(x, z);
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const r = p.r * 1.75;
      if (dx * dx + dz * dz < r * r && p.y + 0.4 > g && camFocus.y > p.y - 7) g = p.y + 0.4;
    }
    return Math.max(SKY_FLOOR, g);
  };
  const terrain = { heightAt: camGround, isSky: (x, z) => !Number.isFinite(groundAt(x, z)) };
  hud.setLoading(0.55, 'Tying the bows');
  await nextFrame();

  // ---------------------------------------------------------------- input, camera, audio, net
  const input = createInput({ canvas, stick: hud.stick });
  const rig = createCameraRig({ camera, engine, terrain, input });
  // The camera never sits inside a building, nor in a tree's canopy (trees only have a thin trunk
  // collider): it slides in toward her and rises instead. Canopies go in a coarse grid.
  const canopies = new Map();
  const CANOPY_CELL = 8;
  const cellKey = (ix, iz) => ix * 4096 + iz;
  for (const p of island.decor && Array.isArray(island.decor.props) ? island.decor.props : []) {
    if (!p || (p.type !== 'tree' && p.type !== 'bigTree') || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const r = (p.type === 'bigTree' ? 4.2 : 2.1) * (Number(p.s) || 1);
    const c = { x: p.x, z: p.z, r2: r * r };
    for (let ix = Math.floor((p.x - r) / CANOPY_CELL); ix <= Math.floor((p.x + r) / CANOPY_CELL); ix++) {
      for (let iz = Math.floor((p.z - r) / CANOPY_CELL); iz <= Math.floor((p.z + r) / CANOPY_CELL); iz++) {
        const k = cellKey(ix, iz);
        if (!canopies.has(k)) canopies.set(k, []);
        canopies.get(k).push(c);
      }
    }
  }
  const inCanopy = (x, z) => {
    const list = canopies.get(cellKey(Math.floor(x / CANOPY_CELL), Math.floor(z / CANOPY_CELL)));
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz >= c.r2) continue;
      // the tree she stands under does not count: there is no getting out of that one
      const px = camFocus.x - c.x;
      const pz = camFocus.z - c.z;
      if (px * px + pz * pz < c.r2) continue;
      return true;
    }
    return false;
  };
  rig.setBlocker((x, z) => colliders.insideBox(x, z, 1.6) || inCanopy(x, z));

  let audioReal = null;
  if (audioMod && typeof audioMod.createAudio === 'function') {
    try {
      audioReal = audioMod.createAudio();
    } catch (err) {
      console.warn('[c9] the audio part failed to start', err);
    }
  }
  const audio = safeAudio(audioReal || createSilentAudio({ store }));
  const net = createNetFacade();
  const makeNet = (mode) => {
    if (netMod && typeof netMod.createNet === 'function') {
      try {
        return netMod.createNet({ mode });
      } catch (err) {
        console.warn('[c9] the net part failed to start', err);
      }
    }
    const devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const m = mode === 'offline' ? 'offline' : mode === 'local' || devHost ? 'local' : 'offline';
    return createStandinNet({ mode: m, cleanNick: (n) => content.cleanNick(n), cleanLook });
  };

  // ---------------------------------------------------------------- the player
  // Where she arrives (and where the rescue cloud brings her): the west side of the plaza, facing
  // the cheer gym. The cake, the fountain and the gym's CHEER sign all stand on one line from the
  // plaza's centre, so from there the sign hides behind the fountain; from out here the camera
  // behind her sees the whole sign, the fountain, the cake and the Hit Zero stage.
  const arrival = (() => {
    const p = places.plaza;
    const f = Number.isFinite(p.facing) ? p.facing : 0;
    const g = places.gym;
    // [to her left, ahead]: the signpost stands on her right
    for (const [side, ahead] of [[11, 5], [9.5, 3], [8, 1], [4.5, 0], [0, 0]]) {
      const x = p.x + Math.cos(f) * side + Math.sin(f) * ahead;
      const z = p.z - Math.sin(f) * side + Math.cos(f) * ahead;
      if (!Number.isFinite(groundAt(x, z)) || colliders.hits(x, z, 0.6)) continue;
      let facing = f;
      if (g && Number.isFinite(g.x) && Number.isFinite(g.z)) {
        const gf = Number.isFinite(g.facing) ? g.facing : 0;
        const half = (Number(g.d) || 12) / 2;
        facing = Math.atan2(g.x + Math.sin(gf) * half - x, g.z + Math.cos(gf) * half - z);
      }
      return { x, z, facing };
    }
    return { x: p.x, z: p.z, facing: f };
  })();
  const home = () => arrival;
  const player = createPlayer({ scene, groundAt, platforms, slides: Array.isArray(places.slides) ? places.slides : [], colliders, input, rig, audio, hud, home });
  let myLook = store.look || cleanLook(charMod.DEFAULT_LOOK || placeholder.DEFAULT_LOOK);
  let myNick = store.nick;
  if (!myNick) myNick = store.setNick(content.randomNick()) || content.randomNick();
  player.setAvatar(makeCharacter(myLook));
  player.place(arrival.x, arrival.z, arrival.facing);
  player.frozen = true;
  const interact = createInteract({ player, camera, hud, canvas });
  const labels = createLabels({ quality });
  const fx = createFx({ scene, renderer, camera, quality });
  const peers = createPeers({ scene, net, makeCharacter, labels, camera, meId: () => (net.me ? net.me.id : null) });

  // ---------------------------------------------------------------- the world object (Contract 1)
  const world = {
    THREE, scene, camera, renderer, engine, rig, input, audio, net, content,
    player, groundAt, platforms, colliders, interact, places, hud,
    onUpdate(fn) {
      return engine.onFrame(fn, 25);
    },
    spawnBurst(x, y, z, o = {}) {
      fx.burst(x, y, z, o);
    },
    quality,
    // extras for the other parts and for tests
    store, island, sky, peers, labels, menu, makeCharacter, cleanLook,
    get me() { return net.me; },
    get nick() { return myNick; },
    get look() { return myLook; },
    tapToWalk: true,
  };
  window.__c9 = world;

  // ---------------------------------------------------------------- birthday
  const bInfo = FEATURES.birthdayMode ? content.birthdayInfo(new Date(), BIRTHDAY) || {} : {};
  const isBirthday = !!(bInfo.isBirthday || store.flag('birthday'));
  const age = Number.isFinite(bInfo.age) && bInfo.age > 0 ? bInfo.age : BIRTHDAY.year ? new Date().getFullYear() - BIRTHDAY.year : 11;
  try {
    if (island.setBirthday) island.setBirthday({ isBirthday, age, name: BIRTHDAY.name });
  } catch (err) {
    console.warn('[c9] setBirthday failed', err);
  }
  world.birthday = { isBirthday, age, name: BIRTHDAY.name, info: bInfo };
  // a soft pop for the birthday fireworks while she is on the island (not under every menu)
  if (isBirthday && typeof island.onFirework === 'function') {
    let pops = 0;
    island.onFirework(() => {
      if (document.body.dataset.mode !== 'play') return;
      pops++;
      if (pops < 12 || pops % 3 === 0) audio.sfx('firework', { volume: 0.3, pitch: 0.9 + Math.random() * 0.25 });
    });
  }

  // ---------------------------------------------------------------- the basket toss (and other parts that need the world)
  let toss = null;
  if (tossMod && typeof tossMod.createToss === 'function') {
    try {
      toss = tossMod.createToss(world);
      world.toss = toss;
      if (toss && typeof toss.on === 'function') {
        toss.on('landed', (r) => {
          const best = Number(store.progress.bestToss) || 0;
          if (r && Number(r.height) > best) store.patchProgress({ bestToss: Math.round(Number(r.height) * 10) / 10 });
        });
        // while she flies, the toss's own overlay has the screen
        toss.on('start', () => {
          hud.closeWheel();
          hud.hideHint(); // the walking hint has done its job once she is flying
          hud.setBusy(true);
        });
        toss.on('end', () => hud.setBusy(false));
      }
    } catch (err) {
      console.warn('[c9] the basket toss part failed to start', err);
    }
  }
  world.games = gamesMod || null;

  // ---------------------------------------------------------------- spirit sticks (CONTENT's collectibles)
  const STICKS = Array.isArray(content.SPIRIT_STICKS) ? content.SPIRIT_STICKS : [];
  const cleanFound = (raw) => {
    try {
      if (typeof content.cleanFoundSticks === 'function') return content.cleanFoundSticks(raw);
    } catch (err) { /* below */ }
    const ids = new Set(STICKS.map((s) => s.id));
    return Array.isArray(raw) ? [...new Set(raw.filter((id) => ids.has(id)))] : [];
  };
  let foundSticks = cleanFound(store.progress.sticks);
  let sticks = null;
  if (STICKS.length && typeof island.spotFor === 'function') {
    try {
      sticks = createSpiritSticks({ scene, island, list: STICKS, found: foundSticks, groundAt, quality });
    } catch (err) {
      console.warn('[c9] the spirit sticks could not be placed', err);
    }
  }
  world.sticks = sticks;

  // ---------------------------------------------------------------- the game layers (phase 2)
  // js/play/index.js exports installPlay(world): it sets world.onGameStart(kind, data) (see onGameStart
  // below) and calls world.endGame() when a game is over, so the app clears its game state.
  world.endGame = (data) => onGameEnd(data || {});
  const playMod = await optional('./play/index.js');
  if (playMod && typeof playMod.installPlay === 'function') {
    try {
      playMod.installPlay(world);
    } catch (err) {
      console.warn('[c9] the game layers failed to start', err);
    }
  }
  // the photo booth by the plaza (js/world/photobooth.js): world.booth.close() whenever something else takes over
  // (a game or the routine says so: her unsaved photo waits, and she hears about it once it is over)
  const boothMod = await optional('./world/photobooth.js');
  if (boothMod && typeof boothMod.installPhotoBooth === 'function') {
    try {
      world.booth = boothMod.installPhotoBooth(world);
    } catch (err) {
      console.warn('[c9] the photo booth failed to start', err);
    }
  }
  function closeBooth(why) {
    if (world.booth) world.booth.close(why);
  }
  function boothBusy() {
    return !!(world.booth && world.booth.active);
  }

  // ---------------------------------------------------------------- state of the app
  let mode = 'boot'; // 'title' | 'menu' | 'closet' | 'lobby' | 'play' | 'overlay'
  let session = null; // { kind: 'solo' | 'room', code }
  let lobbyUI = null;
  let lastEmoteAt = -1e9;
  let myBubble = null;
  let myBubbleUntil = 0;
  let unlocked = false;
  let stageShow = false; // she is up on the stage while Hit Zero runs
  let hitZeroOpen = false;
  let currentHz = null; // the Hit Zero overlay while it is open (tests read it as world.hitZero)
  const handledStarts = new Set();

  const sfx = (name, o) => audio.sfx(name, o);
  const playing = () => mode === 'play';
  function setMode(next) {
    mode = next;
    document.body.dataset.mode = next;
    hud.setPlaying(next === 'play');
    player.frozen = next !== 'play';
    input.setSuspended(next !== 'play' || hud.isModalOpen());
  }

  // ---------------------------------------------------------------- camera moods
  function titleCamera() {
    const sp = calm ? 0.012 : 0.04;
    const portrait = () => camera.aspect < 0.9;
    rig.play([{
      cut: true,
      dur: 1e7,
      ease: 'linear',
      fov: portrait() ? 60 : 44,
      pos: (u, sec) => {
        const a = 0.6 + sec * sp;
        const r = portrait() ? 175 : 150;
        return [Math.sin(a) * r, (portrait() ? 64 : 50) + Math.sin(sec * 0.05) * 4, Math.cos(a) * r];
      },
      // aim above the island so it floats in the lower half, under the logo
      look: () => [0, portrait() ? 22 : 16, 0],
    }], { skippable: false, handoff: 1.4 });
  }
  const tmpA = new THREE.Vector3();
  function menuCamera() {
    rig.play([{
      dur: 1.6,
      ease: 'inOut',
      pos: () => menuFrame(tmpA, true),
      look: () => menuFrame(new THREE.Vector3(), false),
    }, {
      dur: 1e7,
      ease: 'linear',
      cut: true,
      pos: () => menuFrame(tmpA, true),
      look: () => menuFrame(new THREE.Vector3(), false),
    }], { skippable: false, handoff: 1.1 });
  }
  // In front of the cheerleader: in portrait she stands in the top half above the card, in
  // landscape on the left beside it.
  function menuFrame(out, isPos) {
    const p = player.position;
    const h = player.heading;
    const fx_ = Math.sin(h);
    const fz = Math.cos(h);
    const rx = Math.cos(h); // her left, which is the camera's right
    const rz = -Math.sin(h);
    const portrait = camera.aspect < 0.9;
    if (isPos) {
      const d = portrait ? 5.4 : 4.6;
      return out.set(p.x + fx_ * d, p.y + (portrait ? 0.35 : 1.25), p.z + fz * d);
    }
    if (portrait) return out.set(p.x, p.y - 0.95, p.z);
    const side = camera.aspect > 1.25 ? 1.55 : 1.05;
    return out.set(p.x + rx * side, p.y + 0.95, p.z + rz * side);
  }
  // Stand her on the plaza facing away from the cake (it makes the backdrop), turned a little if
  // the camera spot in front of her would be inside something.
  function poseForMenu() {
    const p = places.plaza;
    const base = (Number.isFinite(p.facing) ? p.facing : 0) + Math.PI;
    const d = camera.aspect < 0.9 ? 5.4 : 4.6;
    let heading = base;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
      const h = base + off;
      const cx = p.x + Math.sin(h) * d;
      const cz = p.z + Math.cos(h) * d;
      if (Number.isFinite(groundAt(cx, cz)) && !colliders.hits(cx, cz, 0.9)) {
        heading = h;
        break;
      }
    }
    player.place(p.x, p.z, heading);
  }
  function followCamera() {
    if (rig.isCinematic) rig.skip();
    rig.snapBehind(player.heading);
  }

  // ---------------------------------------------------------------- sound
  function syncSound() {
    const on = audio.enabled;
    hud.setButton('sound', { pressed: on, label: on ? 'Sound on' : 'Sound off' });
    menu.setSound(on);
  }
  // The island's music always loops underneath; on her birthday the birthday song plays when she
  // first lands on the island, and the island track comes back when it ends (one-shots return to
  // the last looping track).
  let birthdaySung = false;
  function islandMusic() {
    if (hitZeroOpen) return; // Hit Zero runs its own track
    audio.music('island');
    if (isBirthday && !birthdaySung && audio.enabled && unlocked && mode === 'play') {
      birthdaySung = true;
      audio.music('birthday');
    }
  }
  // iPhone and iPad: the silent switch mutes the game; the first time sound starts, say so once
  const silentTip = createSilentTip({ hud, store, isOn: () => !!audioReal && audio.enabled, inPlay: () => mode === 'play' });
  function toggleSound() {
    const on = !audio.enabled;
    audio.unlock();
    unlocked = true;
    audio.setEnabled(on);
    if (on) {
      islandMusic();
      sfx('pop');
      silentTip.soundStarted();
    }
    syncSound();
    hud.toast(on ? 'Sound on' : 'Sound off', { icon: on ? 'sound' : 'mute', ms: 1200 });
  }
  const unlockOnce = () => {
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
    if (unlocked) return;
    unlocked = true;
    audio.unlock();
    if (audio.enabled) {
      islandMusic();
      silentTip.soundStarted();
    }
    syncSound();
  };
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);

  // ---------------------------------------------------------------- players list and peers
  const DOTS = [PALETTE.pink, PALETTE.rhinestonePurple, PALETTE.babyBlue, PALETTE.mint, PALETTE.gold, PALETTE.coral, PALETTE.lilac, PALETTE.peach];
  function colorFor(p) {
    const bows = charMod.LOOK_OPTIONS && Array.isArray(charMod.LOOK_OPTIONS.bow) ? charMod.LOOK_OPTIONS.bow : null;
    const opt = bows && p.look ? bows.find((o) => o.id === p.look.bow) : null;
    const c = opt ? opt.color ?? opt.hex ?? opt.main : null;
    if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return c;
    let h = 0;
    for (const ch of String(p.id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return DOTS[h % DOTS.length];
  }
  function nickOf(p) {
    const n = p && typeof p.nick === 'string' ? content.cleanNick(p.nick) : null;
    return n || 'Cheerleader';
  }
  function playerRows() {
    const me = net.me ? net.me.id : null;
    const hostId = net.room ? net.room.hostId : null;
    const rows = [];
    for (const [id, p] of net.players) rows.push({ id, nick: id === me ? myNick : nickOf(p), color: colorFor(Object.assign({ id }, p)), host: id === hostId, bot: !!p.bot, me: id === me });
    if (!rows.length) rows.push({ id: 'me', nick: myNick, color: colorFor({ id: 'me', look: myLook }), host: false, bot: false, me: true });
    rows.sort((a, b) => (b.me - a.me) || (b.host - a.host) || (a.bot - b.bot));
    return rows;
  }
  // the friends in the room we have seen, so a goodbye can still say who left
  const knownFriends = new Map(); // id -> nick (humans only, never me)
  function refreshPeople() {
    peers.sync();
    const rows = playerRows();
    hud.setPlayers(session ? rows : []);
    hud.setRoom(session && session.kind === 'room' && net.room ? net.room.code : null);
    hud.setButton('games', { hidden: !(session && (session.kind === 'solo' || net.isHost)) });
    if (lobbyUI) {
      const host = rows.find((r) => r.host);
      lobbyUI.update({ players: rows, isHost: net.isHost, hostNick: host ? host.nick : '', locked: !!(net.room && net.room.locked) });
    }
    if (session && session.kind === 'room') for (const r of rows) if (!r.me && !r.bot) knownFriends.set(r.id, r.nick);
  }
  net.on('join', (e) => {
    refreshPeople();
    const p = e && net.players.get(e.id);
    if (p && session && session.kind === 'room' && !p.bot && e.id !== (net.me && net.me.id)) {
      const line = content.hype('friendJoin', { name: nickOf(p) });
      hud.toast(line || nickOf(p) + ' ' + JOIN_LINES[Math.floor(Math.random() * JOIN_LINES.length)], { icon: 'sparkle' });
      sfx('chime', { volume: 0.6 });
    }
  });
  net.on('leave', (e) => {
    const id = e && e.id;
    if (id && net.me && id === net.me.id) {
      // NET says I am out of the room (the connection or the room was lost, or the host closed it
      // to me): keep playing here, solo
      if (session && session.kind === 'room') {
        if (e.reason === 'removed') roomClosed();
        else roomLost();
      }
      return;
    }
    refreshPeople();
    const nick = id ? knownFriends.get(id) : null;
    if (nick && session && session.kind === 'room') {
      knownFriends.delete(id);
      hud.toast(content.hype('friendLeave', { name: nick }), { icon: 'sparkle', ms: 2400 });
    }
  });
  // a friend changed their name or look (net.updateMe on their device)
  net.on('player', () => refreshPeople());
  // the host locked or unlocked the room
  let roomLockShown = null;
  net.on('room', (e) => {
    refreshPeople();
    const locked = !!(e && e.locked);
    if (session && session.kind === 'room' && roomLockShown !== null && locked !== roomLockShown && playing()) {
      if (locked) hud.toast(net.isHost ? 'Room locked! Only the friends here can play.' : 'The host locked the room for this game.', { icon: 'key', ms: 2800 });
      else hud.toast(net.isHost ? 'Room unlocked. Friends can join with the code.' : 'The room is open again!', { icon: 'key', ms: 2400 });
    }
    roomLockShown = locked;
  });
  net.on('host', () => {
    refreshPeople();
    if (session && session.kind === 'room' && net.isHost && playing()) hud.toast('You are the host now! You pick the games.', { icon: 'crown' });
  });
  let lastStatus = null;
  net.on('status', (st) => {
    refreshPeople();
    if (session && session.kind === 'room' && st !== lastStatus) {
      if (st === 'offline' && lastStatus === 'online') hud.toast('Lost the connection. Hang on, trying again...', { icon: 'sparkle', ms: 3600 });
      else if (st === 'online' && lastStatus === 'offline') hud.toast('Back with your squad!', { icon: 'sparkle' });
    }
    lastStatus = st;
  });

  // ---------------------------------------------------------------- emotes
  function showMyBubble(e) {
    if (myBubble) labels.release(myBubble);
    myBubble = labels.bubble(e.text || e.id, e.icon);
    myBubble.position.y = 1.72; // just above her bow
    player.group.add(myBubble);
    myBubbleUntil = performance.now() + 3000;
    myBubble.userData.pop = 0;
  }
  const emoteSound = (e) => (e && typeof e.sfx === 'string' ? e.sfx : 'pop');
  function sendEmote(e) {
    const now = performance.now();
    if (now - lastEmoteAt < 1100) return;
    lastEmoteAt = now;
    showMyBubble(e);
    player.emote(animForEmote(e), 1.8);
    sfx(emoteSound(e), { volume: 0.7 });
    if (session) net.send('emote', { id: e.id });
  }
  // The wheel holds 12 quick-cheers: CONTENT's list in its order, with "Happy birthday!" moved to
  // the front on her birthday (and left out on other days, so the wheel stays roomy).
  function wheelEmotes() {
    const list = (content.EMOTES || []).filter((e) => e && typeof e.id === 'string');
    const bday = list.find((e) => e.id === 'happyBirthday');
    const rest = list.filter((e) => e !== bday);
    return (isBirthday && bday ? [bday, ...rest] : rest).slice(0, 12);
  }
  function toggleWheel() {
    if (hud.wheelOpen) {
      hud.closeWheel();
      return;
    }
    if (!playing() || hud.isModalOpen() || (toss && toss.active) || boothBusy()) return;
    sfx('open', { volume: 0.5 });
    hud.openWheel(wheelEmotes(), sendEmote);
  }
  net.on('event', (ev) => {
    if (!ev || typeof ev !== 'object') return;
    const from = ev.from;
    const mine = net.me && from === net.me.id;
    if (ev.type === 'emote') {
      if (mine) return; // shown already (NET echoes events to the sender too)
      const e = content.cleanEmote(ev.data && ev.data.id);
      if (!e) return;
      peers.emote(from, { text: e.text || e.id, icon: e.icon, anim: animForEmote(e) });
      const pos = peers.positionOf(from);
      sfx(emoteSound(e), pos ? { volume: 0.55, x: pos.x, z: pos.z } : { volume: 0.4 });
    } else if (ev.type === 'game-start') {
      const data = ev.data && typeof ev.data === 'object' ? ev.data : {};
      if (session && session.kind === 'room' && net.room && from !== net.room.hostId && !mine) return; // only the host starts things
      onGameStart(data);
    } else if (ev.type === 'game-end') {
      if (session && session.kind === 'room' && net.room && from !== net.room.hostId && !mine) return;
      onGameEnd(ev.data || {});
    } else if (ev.type === 'fx') {
      const d = ev.data || {};
      if (d.kind === 'burst' && [d.x, d.y, d.z].every(Number.isFinite)) fx.burst(clamp(d.x, -500, 500), clamp(d.y, -100, 300), clamp(d.z, -500, 500), { count: clamp(Number(d.count) || 20, 1, 60) });
    }
  });
  net.on('game', (g) => {
    if (g && g.kind === 'roam' && mode === 'lobby') enterWorld();
  });

  // ---------------------------------------------------------------- games (the host picks; the game layers plug in later)
  function openPicker() {
    if (!session || !(session.kind === 'solo' || net.isHost)) {
      hud.toast('The host picks the games. Ask them!', { icon: 'crown' });
      return;
    }
    sfx('open', { volume: 0.5 });
    hud.openPanel({
      title: 'Pick a game!',
      contentEl: buildPicker({
        games: GAME_CHOICES,
        note: session.kind === 'solo' ? 'Playing by yourself: bot friends fill in where a game needs a squad.' : 'Everyone in the room plays together.',
        onPick: (g) => {
          hud.closePanel();
          showHowTo(g.id, true);
        },
      }),
    });
  }
  function showHowTo(kind, asHost) {
    const card = content.howto(kind) || { title: gameTitle(kind), steps: [] };
    const g = GAME_CHOICES.find((c) => c.id === kind);
    sfx('open', { volume: 0.5 });
    hud.openCard({
      icon: g ? g.icon : 'games',
      kicker: 'How to play',
      title: card.title || gameTitle(kind),
      steps: card.steps,
      accent: g ? g.color : null,
      actions: asHost
        ? [{ label: "Let's go!", icon: 'play', primary: true, onClick: () => hostStartGame(kind) }, { label: 'Back', onClick: () => openPicker() }]
        : [{ label: 'Ready!', icon: 'check', primary: true }],
    });
  }
  function hostStartGame(kind) {
    const id = Math.random().toString(36).slice(2, 10);
    const data = { kind, id, at: net.now() };
    onGameStart(data, true);
    if (session && session.kind === 'room') net.send('game-start', data);
  }
  function onGameStart(data, local) {
    const kind = typeof data.kind === 'string' ? data.kind : '';
    if (data.id) {
      if (handledStarts.has(data.id)) return;
      handledStarts.add(data.id);
    }
    if (kind === 'roam') {
      if (mode === 'lobby') enterWorld();
      return;
    }
    if (!GAME_CHOICES.some((g) => g.id === kind)) return;
    closeBooth('game');
    // a friend in the quick-cheer wheel or the menu when the host starts: the game has the screen now
    hud.closeWheel();
    if (hud.panelOpen) hud.closePanel();
    if (kind === 'hitZero') {
      // in a room everyone gets the same chart: the seed comes from the start's id
      let seed;
      if (typeof data.id === 'string' && data.id) {
        seed = 0;
        for (const ch of data.id.slice(0, 16)) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
      }
      launchHitZero({ seed });
      return;
    }
    if (!local && playing()) showHowTo(kind, false);
    hud.big(gameTitle(kind), 'Get ready!', { ms: 2000 });
    sfx('whistle', { volume: 0.7 });
    world.activeGame = { kind, startedAt: Date.now(), id: data.id || null };
    // the game layers (integration) take over from here through world.onGameStart
    let taken = false;
    if (typeof world.onGameStart === 'function') {
      try {
        taken = world.onGameStart(kind, data) !== false;
      } catch (err) {
        console.error('[c9] the game layer failed to start', err);
      }
    }
    if (!taken) {
      setTimeout(() => {
        if (world.activeGame && world.activeGame.kind === kind) {
          hud.toast('The ' + gameTitle(kind) + ' field is still being set up. ' + (toss ? 'Try the basket toss!' : 'Have fun exploring!'), { icon: 'sparkle', ms: 3600 });
          world.activeGame = null;
        }
      }, 2300);
    }
  }
  function onGameEnd() {
    world.activeGame = null;
    hud.setGameUI(null);
  }

  // ---------------------------------------------------------------- Hit Zero, on the stage
  // The routine runs in RHYTHM's overlay; its scrim lets the island show through, so she performs
  // every motion on the stage mat behind it (onMove), facing the judges, with the camera out front.
  const stage = places.stage && Number.isFinite(places.stage.x) && Number.isFinite(places.stage.z) ? places.stage : null;
  if (stage) {
    const sy = groundAt(stage.x, stage.z);
    interact.register({
      id: 'stage', position: new THREE.Vector3(stage.x, Number.isFinite(sy) ? sy : 0, stage.z), radius: 4.2, label: 'Hit Zero!',
      icon: 'music', priority: 2, onUse: () => launchHitZero(),
    });
  }
  // performer colours for the overlay's own little figure, from her real look
  function figureLook() {
    const opt = (slot) => {
      try {
        return charMod.lookOption ? charMod.lookOption(slot, myLook && myLook[slot]) : null;
      } catch (err) {
        return null;
      }
    };
    const out = {};
    for (const [key, slot] of [['skin', 'skin'], ['hair', 'hair'], ['bow', 'bow'], ['top', 'top'], ['shorts', 'bottom'], ['shoes', 'shoes']]) {
      const o = opt(slot);
      if (o && typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)) out[key] = o.color;
    }
    return Object.keys(out).length ? out : undefined;
  }
  // The camera out front, by the judges: it frames her real character exactly where Hit Zero would
  // draw its performer (hz.performer: above the runway on a phone, beside it on a tablet), so she
  // dances on the real stage in the gap the overlay leaves for her.
  const STAGE_FOV = 50;
  const stageCam = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  // Where she stands on the mat: the middle alone; with friends in a room, a V formation by join
  // order (the first to join at the point), all facing the judges.
  const FORMATION = [[0, 0], [1.6, -1.3], [-1.6, -1.3], [3.2, -2.6], [-3.2, -2.6], [0, -2.6], [4.6, -3.9], [-4.6, -3.9], [1.6, -3.9], [-1.6, -3.9]];
  const stageSpot = { x: 0, z: 0 };
  function stageSpotFor() {
    let k = 0;
    if (session && session.kind === 'room' && net.me) {
      const humans = [...net.players.values()].filter((p) => p && !p.bot).map((p) => p.id);
      k = Math.max(0, humans.indexOf(net.me.id)) % FORMATION.length;
    }
    const f = Number.isFinite(stage.facing) ? stage.facing : 0;
    const [ax, az] = FORMATION[k];
    // local x across the mat (her left), local z toward the judges
    stageSpot.x = stage.x + Math.cos(f) * ax + Math.sin(f) * az;
    stageSpot.z = stage.z - Math.sin(f) * ax + Math.cos(f) * az;
    if (!Number.isFinite(groundAt(stageSpot.x, stageSpot.z))) {
      stageSpot.x = stage.x;
      stageSpot.z = stage.z;
    }
    return stageSpot;
  }
  function stageFrame() {
    const f = Number.isFinite(stage.facing) ? stage.facing : 0;
    const sx = stageSpot.x;
    const sz = stageSpot.z;
    const y0 = Number.isFinite(groundAt(sx, sz)) ? groundAt(sx, sz) : 0;
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const K = H / 2 / Math.tan((STAGE_FOV * Math.PI) / 360);
    let box = null;
    try {
      box = currentHz && currentHz.performer;
    } catch (err) {
      box = null;
    }
    const ok = box && [box.x, box.y, box.size].every(Number.isFinite) && box.size > 20;
    const px = ok ? box.x : W / 2;
    const py = ok ? box.y : H * 0.3;
    const size = ok ? box.size : Math.min(H * 0.16, 130);
    // far enough that she is as tall on screen as the drawn performer would be (bow included)
    const dist = clamp((1.55 * K) / Math.max(40, size * 0.95), 3.2, 30);
    stageCam.pos.set(sx + Math.sin(f) * dist, y0 + 1.4 + dist * 0.05, sz + Math.cos(f) * dist);
    // aim so her middle lands on the performer's spot: turn and tilt off her by those angles
    const ax = Math.atan((px - W / 2) / K);
    const ay = Math.atan((py - size * 0.47 - H / 2) / K);
    const dx = sx - stageCam.pos.x;
    const dy = y0 + 0.72 - stageCam.pos.y;
    const dz = sz - stageCam.pos.z;
    const yaw = Math.atan2(dx, dz) + ax;
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + ay;
    stageCam.look.set(stageCam.pos.x + Math.sin(yaw) * Math.cos(pitch), stageCam.pos.y + Math.sin(pitch), stageCam.pos.z + Math.cos(yaw) * Math.cos(pitch));
    return stageCam;
  }
  function stageCamera() {
    rig.play([{
      dur: calm ? 0.01 : 1.1,
      ease: 'inOut',
      fov: STAGE_FOV,
      pos: () => stageFrame().pos,
      look: () => stageCam.look,
    }, {
      dur: 1e7,
      ease: 'linear',
      cut: true,
      fov: STAGE_FOV,
      pos: () => stageFrame().pos,
      look: () => stageCam.look,
    }], { skippable: false, handoff: calm ? 0.01 : 0.8 });
  }

  async function launchHitZero(opts = {}) {
    if (hitZeroOpen) return;
    hitZeroOpen = true;
    closeBooth('routine');
    // the host started it for everyone: a flyer in the air lands softly on her cloud first
    if (toss && toss.active) toss.cancel();
    const mod = await optional('./rhythm/index.js');
    if (!mod || typeof mod.createHitZero !== 'function') {
      hitZeroOpen = false;
      hud.toast('Hit Zero is still warming up backstage!', { icon: 'music', ms: 3000 });
      return;
    }
    await loadCss('css/rhythm.css');
    // a friend still dressing up when the host starts Hit Zero: the creator closes first (as Cancel)
    if (cheerClose) cheerClose();
    hud.closeAll();
    hud.hideHint();
    const before = mode === 'overlay' ? 'play' : mode;
    let release = null;
    if (stage && before === 'play') {
      // up onto the mat, facing the judges (behind a quick fade, the camera already out front)
      await hud.fade(true, 170);
      const spot = stageSpotFor();
      player.place(spot.x, spot.z, Number.isFinite(stage.facing) ? stage.facing : 0);
      release = player.takeControl('hitZero');
      player.setAnim('clasp');
      stageShow = true;
      stageCamera();
      sfx('whoosh', { volume: 0.5 });
    }
    const container = el('div', 'c9-overlay c9-rhythm-host');
    document.body.appendChild(container);
    setMode('overlay');
    audio.music(null);
    if (stageShow) hud.fade(false, 260);
    let done = false;
    let inst = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        if (inst && typeof inst.destroy === 'function' && inst.phase !== 'closed') inst.destroy();
      } catch (err) { /* already gone */ }
      container.remove();
      stageShow = false;
      hitZeroOpen = false;
      currentHz = null;
      if (release) {
        player.setAnim('idle');
        release();
      }
      setMode(before);
      if (before === 'play') followCamera();
      // Hit Zero leaves its victory sting playing: the island's music comes back after it
      if (audio.enabled) audio.music('island');
      const ctx = { name: myNick, score: result && Number.isFinite(result.score) ? result.score : undefined, misses: result && Number.isFinite(result.misses) ? result.misses : undefined };
      const zero = result && (result.hitZero || result.zero || result.perfect);
      if (zero) {
        fx.burst(player.position.x, player.position.y + 1.6, player.position.z, { count: 60, speed: 7 });
        if (before === 'play') player.emote('cheer', 2.4);
        hud.big('HIT ZERO!', content.hype('routineZero', ctx), { ms: 2600 });
      } else if (result) {
        if (before === 'play') player.emote('clap', 2);
        hud.toast(content.hype('routineGood', ctx), { icon: 'music' });
      }
    };
    try {
      inst = mod.createHitZero({
        audio, container, level: opts.level || 1, onDone: finish, look: figureLook(),
        seed: Number.isFinite(opts.seed) ? opts.seed : undefined,
        // on the stage her real character is the performer: the overlay leaves her spot empty
        performer: !stageShow,
        autoplay: store.flag('autoplay'), // test switch: a perfect bot plays the routine
        // every motion she hits, her character does on the stage (Contract 3 names)
        onMove: (name) => {
          if (stageShow && typeof name === 'string') player.setAnim(name, { restart: true });
        },
      });
      if (!done) currentHz = inst;
    } catch (err) {
      console.error('[c9] Hit Zero failed to start', err);
      finish(null);
    }
  }

  // ---------------------------------------------------------------- my cheerleader
  function applyLook(look) {
    const clean = store.setLook(look) || cleanLook(look);
    myLook = clean;
    if (player.avatar && typeof player.avatar.setLook === 'function') {
      try {
        player.avatar.setLook(clean);
        return;
      } catch (err) { /* rebuild instead */ }
    }
    player.setAvatar(makeCharacter(clean));
  }
  function applyNick(nick) {
    const clean = store.setNick(nick);
    if (clean) myNick = clean;
    refreshPeople();
    return myNick;
  }
  function newName() {
    let n = content.randomNick();
    for (let i = 0; i < 4 && n === myNick; i++) n = content.randomNick();
    applyNick(n);
    sfx('pop');
    return myNick;
  }
  // One creator at a time: a double tap on "My cheerleader" must not stack two (each with its own
  // renderer). And if she moved on while it loaded (tapped "Play by myself"), it does not open.
  let cheerOpening = false;
  let cheerClose = null; // shuts an open creator, like Cancel (the host started Hit Zero for everyone)
  async function openCheerleader(back) {
    if (cheerOpening) return;
    cheerOpening = true;
    const from = mode;
    const mod = await optional('./ui/creator.js');
    if (mod && typeof mod.openCreator === 'function') {
      await loadCss('css/creator.css');
      if (mode !== from) {
        cheerOpening = false;
        return;
      }
      const before = mode;
      setMode('overlay');
      menu.hide();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cheerOpening = false;
        cheerClose = null;
        back();
      };
      try {
        const handle = mod.openCreator({
          look: myLook,
          nick: myNick,
          audio,
          // options a spirit stick still has to unlock show a lock and the stick's hint
          locked: lockedLooks(STICKS, foundSticks),
          onDone(look, nick) {
            if (look) applyLook(look);
            if (nick) applyNick(nick);
            // in a room, everyone sees the new look and name right away (Contract 4)
            if (session) net.updateMe({ nick: myNick, look: myLook });
            close();
          },
          onCancel: close,
        });
        cheerClose = () => {
          try {
            if (handle && typeof handle.close === 'function') handle.close();
          } catch (err) {
            /* already closing */
          }
          close();
        };
      } catch (err) {
        console.error('[c9] the creator failed to open', err);
        setMode(before);
        close();
      }
      return;
    }
    // the placeholder closet (a menu screen: opening it again just replaces it)
    cheerOpening = false;
    if (mode !== from) return;
    setMode('closet');
    menuCamera();
    const ui = menu.closet({
      nick: myNick,
      onNewName: () => ui.setNick(newName()),
      onSurprise: () => {
        const rand = charMod.randomLook ? charMod.randomLook(Math.random) : placeholder.randomLook(Math.random);
        applyLook(rand);
        player.emote('cheer', 1.4);
        fx.burst(player.position.x, player.position.y + 1.3, player.position.z, { count: 22, speed: 4 });
        sfx('sparkle');
      },
      onDone: () => back(),
    });
  }

  // ---------------------------------------------------------------- the flow: title -> menu -> solo / rooms -> play
  function showTitle() {
    setMode('title');
    titleCamera();
    menu.title({ onPlay: () => showMenu(), onSound: toggleSound, sound: audio.enabled });
  }

  function showMenu() {
    leaveSession();
    setMode('menu');
    hud.setGameUI(null);
    poseForMenu();
    player.emote('wave', 1.6);
    const ui = menu.main({
      nick: myNick,
      sound: audio.enabled,
      onSound: toggleSound,
      online: FEATURES.online,
      onNewName: () => ui.setNick(newName()),
      onSolo: () => startSolo(),
      onMake: () => makeRoom(),
      onJoin: () => showJoin(),
      onCheerleader: () => openCheerleader(() => showMenu()),
    });
    menuCamera();
  }

  function leaveSession() {
    lobbyUI = null;
    closeBooth();
    if (toss && toss.active) toss.cancel();
    if (world.activeGame) onGameEnd();
    if (session) net.leaveRoom();
    session = null;
    roomLockShown = null;
    net.use(null);
    peers.clear();
    refreshPeople();
  }

  // A double tap on "Play by myself" starts one solo session, not two (the first would be left
  // running underneath, never left).
  let soloStarting = null;
  function startSolo(opts = {}) {
    if (!soloStarting) soloStarting = startSoloNow(opts).finally(() => { soloStarting = null; });
    return soloStarting;
  }
  async function startSoloNow(opts) {
    leaveSession();
    const n = makeNet('offline');
    net.use(n);
    try {
      await withTimeout(n.createRoom({ nick: myNick, look: myLook }), 5000, null);
    } catch (err) { /* solo works without a room too */ }
    session = { kind: 'solo' };
    refreshPeople();
    if (opts.stay && mode !== 'lobby' && mode !== 'menu' && mode !== 'title') return; // keep playing right where she is
    enterWorld();
  }

  // NET dropped us from the room (the connection or the room went away). Never a dead end: on the
  // island she keeps playing by herself where she stands; from the lobby, a friendly choice.
  function roomLost() {
    if (mode === 'lobby' || mode === 'menu') {
      leaveSession();
      menu.message({
        title: 'Lost the room',
        lines: ['The connection to your friends dropped.', 'You can play by yourself, or make a new room.'],
        actions: [{ label: 'Play by myself', icon: 'star', onClick: () => startSolo() }, { label: 'Back', onClick: () => showMenu() }],
      });
      return;
    }
    hud.toast("Lost the room. You're still on Cloud Nine! Make or join a room from the menu.", { icon: 'sparkle', ms: 5200 });
    startSolo({ stay: true });
  }

  // The host closed the room to me (locked it without me, or sent me home). No blame, no fuss:
  // she keeps playing, and can make her own room.
  function roomClosed() {
    const lines = ['The host closed the room for now.', 'You can make your own room, or keep exploring by yourself!'];
    if (mode === 'lobby' || mode === 'menu') {
      leaveSession();
      menu.message({
        title: 'Time for your own adventure!',
        lines,
        actions: [{ label: 'Make my own room', icon: 'plus', onClick: () => makeRoom() }, { label: 'Play by myself', icon: 'star', onClick: () => startSolo() }],
      });
      return;
    }
    // a friend still dressing up: the creator closes first (as Cancel), so the card is not left
    // waiting underneath it until she taps Done
    if (cheerClose) cheerClose();
    startSolo({ stay: true });
    hud.openCard({
      icon: 'sparkle',
      kicker: 'Room closed',
      title: 'Time for your own adventure!',
      lines,
      actions: [{ label: 'Make my own room', primary: true, icon: 'plus', onClick: () => makeRoom() }, { label: 'Keep playing', primary: false }],
    });
  }

  // The host: send a friend home, after a check.
  function confirmSendHome(id, nick) {
    const name = nick || 'this friend';
    hud.openCard({
      icon: 'home',
      kicker: 'Send home',
      title: 'Send ' + name + ' home?',
      lines: ['They keep playing on their own island.', 'The room locks, so nobody new can join.'],
      actions: [
        { label: 'Send home', primary: true, icon: 'home', onClick: () => sendHome(id, name) },
        { label: 'Keep playing', primary: false },
      ],
    });
  }
  async function sendHome(id, name) {
    const ok = await net.sendHome(id);
    hud.toast(ok ? name + ' is heading home. The room is locked.' : "Couldn't send " + name + ' home. Try again in a moment!', { icon: 'home', ms: 2600 });
  }
  // The host's list of friends to pick from (pause menu)
  function pickFriendToSendHome() {
    const me = net.me ? net.me.id : null;
    const friends = [...net.players.values()].filter((p) => p && !p.bot && p.id !== me);
    if (!friends.length) return;
    hud.openCard({
      icon: 'home',
      kicker: 'Send a friend home',
      title: 'Who is heading home?',
      lines: ['They keep playing on their own island.'],
      actions: friends.slice(0, 9).map((p) => ({ label: nickOf(p), primary: false, onClick: () => confirmSendHome(p.id, nickOf(p)) }))
        .concat([{ label: 'Never mind', primary: false }]),
    });
  }

  function roomsUnavailable() {
    menu.message({
      title: "Rooms aren't ready yet",
      lines: ['Playing with friends needs the internet and the room helper.', 'You can still explore and play by yourself!'],
      actions: [{ label: 'Play by myself', icon: 'star', onClick: () => startSolo() }, { label: 'Back', onClick: () => showMenu() }],
    });
  }

  async function makeRoom() {
    leaveSession();
    menu.busy('Making your room...');
    const n = makeNet(params.get('net') || 'auto');
    if ((n.kind || n.mode) === 'offline') {
      roomsUnavailable();
      return;
    }
    net.use(n);
    const code = await withTimeout(n.createRoom({ nick: myNick, look: myLook }), 15000, null);
    // a room only this device can see is no room for friends
    if (!code || !net.room || net.status === 'offline') {
      leaveSession();
      roomsUnavailable();
      return;
    }
    session = { kind: 'room', code };
    showLobby();
  }

  function showJoin(initial = '') {
    setMode('menu');
    menu.join({
      initial,
      onBack: () => showMenu(),
      onSubmit: async (code) => {
        leaveSession();
        const n = makeNet(params.get('net') || 'auto');
        if ((n.kind || n.mode) === 'offline') return { ok: false, reason: 'offline' };
        net.use(n);
        const res = await withTimeout(n.joinRoom(code, { nick: myNick, look: myLook }), 15000, { ok: false, reason: 'offline' });
        if (!res || !res.ok) {
          leaveSession();
          return res || { ok: false, reason: 'error' };
        }
        session = { kind: 'room', code };
        sfx('chime');
        if (net.game && net.game.kind) enterWorld(); // the fun already started: jump right in
        else showLobby();
        return res;
      },
    });
  }

  function showLobby() {
    setMode('lobby');
    lobbyUI = menu.lobby({
      code: net.room ? net.room.code : session.code,
      onStart: () => {
        if (!net.isHost) return;
        net.setGame({ kind: 'roam', phase: 'roam', at: net.now() });
        const id = Math.random().toString(36).slice(2, 10);
        net.send('game-start', { kind: 'roam', id });
        enterWorld();
      },
      onLeave: () => showMenu(),
      onExplore: () => enterWorld(),
      onLock: (on) => net.lockRoom(on),
      onSendHome: (id, nick) => sendHome(id, nick || 'Your friend'),
    });
    refreshPeople();
  }

  // In a room everyone arrives together: stand in a line beside each other (by join order), not
  // all on one spot.
  function arrivalFor() {
    let k = 0;
    if (session && session.kind === 'room' && net.me) {
      const humans = [...net.players.values()].filter((p) => p && !p.bot).map((p) => p.id);
      k = Math.max(0, humans.indexOf(net.me.id));
    }
    if (!k) return arrival;
    const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5;
    const rx = Math.cos(arrival.facing);
    const rz = -Math.sin(arrival.facing);
    for (const s of [side, side * 0.6, 0]) {
      const x = arrival.x + rx * s;
      const z = arrival.z + rz * s;
      if (Number.isFinite(groundAt(x, z)) && !colliders.hits(x, z, 0.5)) return { x, z, facing: arrival.facing };
    }
    return arrival;
  }

  let welcomed = false;
  function enterWorld() {
    lobbyUI = null;
    menu.hide();
    setMode('play');
    followCamera();
    refreshPeople();
    const spot = arrivalFor();
    player.place(spot.x, spot.z, spot.facing);
    followCamera();
    if (!welcomed) {
      welcomed = true;
      // the first time: arrive from the sky, a little drop onto the plaza with a sparkle landing
      player.position.y += 7;
      player.velocity.y = -2;
      if (isBirthday) {
        hud.big('Happy Birthday,\n' + BIRTHDAY.name + '!', age ? 'Turning ' + age + ' on Cloud Nine!' : content.hype('birthday', { age }), { ms: 3400 });
        // a burst of birthday sparkle over the cake as she lands
        const c = places.cake || places.plaza;
        setTimeout(() => {
          if (playing()) fx.burst(c.x, (Number.isFinite(groundAt(c.x, c.z)) ? groundAt(c.x, c.z) : 0) + 4, c.z, { count: calm ? 20 : 60, speed: 7 });
        }, 600);
      } else {
        hud.big(GAME.title, content.hype('welcome', { name: myNick }), { ms: 2200 });
      }
      if (familyNotes.length) {
        setTimeout(() => {
          if (playing()) hud.toast(familyNotes.length === 1 ? 'Your family left you a note! It is in the menu.' : 'Your family left you notes! They are in the menu.', { icon: 'bow', ms: 5200 });
        }, isBirthday ? 4200 : 2800);
      }
    }
    if (audio.enabled && unlocked) islandMusic();
    const touch = coarsePointer();
    let hinted = false;
    try {
      hinted = window.localStorage.getItem(HINT_KEY) === '1';
    } catch (err) { /* private mode */ }
    if (!hinted && !input.hasMoved) {
      setTimeout(() => {
        if (playing() && !input.hasMoved) hud.showHint(touch ? 'Drag on the left to walk. Tap the big button to jump!' : 'WASD to walk, Space to jump, drag to look. Q to cheer!');
      }, 1800);
    }
  }
  input.on('firstmove', () => {
    hud.hideHint();
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch (err) { /* private mode */ }
  });

  // ---------------------------------------------------------------- the in-world menu
  const PLACE_LIST = [
    ['plaza', 'The plaza', 'home'], ['tossPads', 'Basket toss', 'jump'], ['gym', 'Cheer gym', 'bow'], ['stage', 'Hit Zero stage', 'music'],
    ['court', 'Dodgeball court', 'ball'], ['bowField', 'Capture the Bow', 'flag'], ['hideGarden', 'Hide-and-seek garden', 'eyes'],
  ];
  function travelSpots() {
    const out = [];
    for (const [key, name, ic] of PLACE_LIST) {
      let p = key === 'plaza' ? arrival : places[key];
      if (Array.isArray(p)) p = p[0];
      if (key === 'hideGarden' && p) p = p.seekerStart;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      // stand just in front of it, facing it
      let x = p.x;
      let z = p.z;
      let facing = Number.isFinite(p.facing) ? p.facing : 0;
      if (key === 'gym' || key === 'stage') {
        const back = key === 'gym' ? (p.d || 12) / 2 + 4 : 10;
        x = p.x + Math.sin(facing) * back;
        z = p.z + Math.cos(facing) * back;
        facing += Math.PI;
      } else if (key === 'tossPads') {
        x = p.x - Math.sin(facing) * 5;
        z = p.z - Math.cos(facing) * 5;
      } else if (key === 'court' || key === 'bowField') {
        x = p.x + Math.sin(facing + Math.PI / 2) * ((p.w || 10) / 2 + 3);
        z = p.z + Math.cos(facing + Math.PI / 2) * ((p.w || 10) / 2 + 3);
        facing -= Math.PI / 2;
      }
      if (!Number.isFinite(groundAt(x, z))) {
        x = p.x;
        z = p.z;
      }
      out.push({ id: key, name, icon: ic, x, z, facing });
    }
    return out;
  }
  // Notes from the family (js/content/notes.js): checked by CONTENT's cleanNote, shown in a card
  // from the menu. Nothing shows until the owner adds some.
  const familyNotes = (() => {
    try {
      if (!FEATURES.familyNotes || typeof content.familyNotes !== 'function') return [];
      const list = content.familyNotes();
      return Array.isArray(list) ? list.filter((n) => n && typeof n.text === 'string' && n.text).slice(0, 20) : [];
    } catch (err) {
      return [];
    }
  })();
  function showNotes() {
    if (!familyNotes.length) return;
    sfx('open', { volume: 0.5 });
    const box = el('div', 'c9-notes');
    for (const n of familyNotes) {
      const item = el('figure', 'c9-note-card');
      item.appendChild(el('blockquote', 'c9-note-text', n.text));
      if (n.from) item.appendChild(el('figcaption', 'c9-note-from', 'From ' + n.from));
      box.appendChild(item);
    }
    hud.openCard({
      icon: 'bow',
      kicker: 'Notes from your family',
      title: familyNotes.length === 1 ? 'A note for you!' : familyNotes.length + ' notes for you!',
      contentEl: box,
      actions: [{ label: 'Thank you!', icon: 'check', primary: true }],
    });
  }

  // The spirit stick card: how many, the next hint, and what the found ones unlocked.
  function showSticks() {
    const s = sticksRow();
    if (!s) return;
    sfx('open', { volume: 0.5 });
    const all = s.count >= s.total;
    const box = el('div', 'c9-sticks');
    const meter = el('div', 'c9-sticks-meter');
    for (const st of STICKS) {
      const got = foundSticks.includes(st.id);
      const dot = el('span', 'c9-sticks-dot' + (got ? ' c9-got' : ''));
      dot.title = got ? st.name : 'Not found yet';
      meter.appendChild(dot);
    }
    box.appendChild(meter);
    const won = STICKS.filter((st) => foundSticks.includes(st.id) && st.unlock && !st.unlock.later).map((st) => st.unlock.label);
    const lines = [];
    if (!all && s.hint) lines.push('Next hint: ' + s.hint);
    if (won.length) lines.push('Unlocked: ' + won.join(', ') + '.');
    else lines.push('Each stick unlocks something new for your cheerleader!');
    hud.openCard({
      icon: 'star',
      kicker: 'Spirit sticks',
      title: all ? 'All ' + s.total + ' found!' : s.count + ' of ' + s.total + ' found',
      lines,
      contentEl: box,
      actions: [{ label: 'Keep looking!', icon: 'check', primary: true }, { label: 'My cheerleader', icon: 'bow', onClick: () => openCheerleader(backToPlay) }],
    });
  }
  function backToPlay() {
    menu.hide();
    setMode('play');
    followCamera();
  }

  function openPauseMenu() {
    if (!playing() || hud.isModalOpen() || (toss && toss.active) || boothBusy()) return;
    sfx('open', { volume: 0.5 });
    const inRoom = session && session.kind === 'room';
    hud.openPanel({
      title: 'Menu',
      contentEl: buildPauseMenu({
        code: inRoom && net.room ? net.room.code : null,
        isHost: inRoom && net.isHost,
        locked: !!(inRoom && net.room && net.room.locked),
        friends: inRoom ? [...net.players.values()].filter((p) => p && !p.bot && (!net.me || p.id !== net.me.id)).length : 0,
        onLock: (on) => {
          hud.closePanel();
          net.lockRoom(on).then((ok) => {
            if (!ok) hud.toast("Couldn't change the lock. Try again in a moment!", { icon: 'key', ms: 2400 });
          });
        },
        onSendHome: () => {
          hud.closePanel();
          pickFriendToSendHome();
        },
        canPick: session && (session.kind === 'solo' || net.isHost),
        places: travelSpots(),
        sound: audio.enabled,
        quality: engine.quality,
        sticks: sticksRow(),
        notes: familyNotes.length,
        leaveLabel: inRoom ? 'Leave the room' : 'Back to the menu',
        onClose: () => hud.closePanel(),
        onNotes: () => {
          hud.closePanel();
          showNotes();
        },
        onSticks: () => {
          hud.closePanel();
          showSticks();
        },
        onTravel: (p) => {
          hud.closePanel();
          player.teleport(p.x, p.z, p.facing).then(() => followCamera());
        },
        onPick: () => {
          hud.closePanel();
          openPicker();
        },
        onCheerleader: () => {
          hud.closePanel();
          openCheerleader(() => {
            menu.hide();
            setMode('play');
            followCamera();
          });
        },
        onSound: () => {
          toggleSound();
          hud.closePanel();
          openPauseMenu();
        },
        onQuality: () => {
          const next = engine.quality === 'low' ? 'auto' : 'low';
          engine.setQuality(next);
          store.setQuality(next);
          hud.closePanel();
          hud.toast(next === 'low' ? 'Battery saver on' : 'Automatic graphics', { icon: 'sparkle', ms: 1400 });
        },
        onLeave: () => {
          hud.closePanel();
          showMenu();
        },
      }),
    });
  }

  // ---------------------------------------------------------------- input wiring
  hud.on('modal', (open) => {
    input.setSuspended(open || !playing());
    if (open) player.halt();
  });
  hud.onButton('jump', () => {
    if (playing()) player.jump();
  });
  hud.onButton('emote', () => toggleWheel());
  hud.onButton('menu', () => openPauseMenu());
  hud.onButton('sound', () => toggleSound());
  hud.onButton('games', () => openPicker());
  hud.onAction(() => interact.use());
  input.on('jump', () => {
    if (!playing() || hud.isModalOpen()) return;
    // Space does the big button when one is up (a toss pad, a game prompt), and jumps otherwise
    if (hud.hasPrompt) hud.usePrompt();
    else player.jump();
  });
  input.on('use', () => {
    if (playing() && !hud.isModalOpen()) hud.usePrompt();
  });
  input.on('emote', () => toggleWheel());
  input.on('digit', (n) => {
    if (hud.wheelOpen) hud.pickWheel(n);
  });
  input.on('map', () => {
    if (hud.panelOpen) hud.closePanel();
    else openPauseMenu();
  });
  input.on('escape', () => {
    if (hud.escape()) return;
    if (playing()) openPauseMenu();
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function groundUnder(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    let prev = 0;
    for (let s = 0.5; s < 160; s += s < 20 ? 0.5 : 1.2) {
      const x = o.x + d.x * s;
      const y = o.y + d.y * s;
      const z = o.z + d.z * s;
      const g = groundAt(x, z);
      if (g >= y) {
        // refine between the last two samples
        let a = prev;
        let b = s;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          if (groundAt(o.x + d.x * m, o.z + d.z * m) >= o.y + d.y * m) b = m;
          else a = m;
        }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prev = s;
    }
    return null;
  }
  input.on('tap', ({ x, y }) => {
    if (!playing() || player.frozen || player.controller || rig.isCinematic || !world.tapToWalk) return;
    const item = interact.pick(x, y);
    if (item) {
      sfx('tap', { volume: 0.5 });
      interact.walkToAndUse(item);
      return;
    }
    const p = groundUnder(x, y);
    if (p) player.walkTo(p.x, p.z);
  });

  // ---------------------------------------------------------------- player moments
  player.on('land', ({ height, x, y, z }) => {
    if (height > 2.2) fx.burst(x, y + 0.2, z, { count: Math.min(36, 10 + Math.round(height * 1.6)), speed: 3.5, size: 0.4 });
  });
  player.on('rescue', () => {
    hud.toast(content.hype('cloudCatch', { name: myNick }), { icon: 'sparkle', ms: 3000 });
  });

  // ---------------------------------------------------------------- spirit sticks: touch one to collect it
  function collectStick(hit) {
    if (!hit || foundSticks.includes(hit.id)) return;
    sticks.collect(hit.id);
    foundSticks = cleanFound([...foundSticks, hit.id]);
    store.patchProgress({ sticks: foundSticks });
    const count = foundSticks.length;
    const total = STICKS.length;
    const all = count >= total;
    fx.burst(hit.x, hit.y + 1.1, hit.z, { count: calm ? 24 : 56, speed: 6.5, size: 0.55 });
    sfx('chime');
    sfx('sparkle', { volume: 0.8, pitch: 1.2 });
    if (all) sfx('tada', { volume: 0.8 });
    player.emote('cheer', 1.6);
    hud.big('Spirit stick\n' + count + ' of ' + total + '!', content.hype(all ? 'collectAll' : 'collect', { name: myNick, stick: hit.id, count, total }), { ms: 2800 });
    const u = hit.stick && hit.stick.unlock;
    if (u && !u.later && typeof u.label === 'string') {
      setTimeout(() => hud.toast('Unlocked: ' + u.label + '! Try it on in My cheerleader.', { icon: 'bow', ms: 4600 }), 900);
    }
  }
  function sticksRow() {
    const total = STICKS.length;
    if (!sticks || !total) return null;
    let hint = null;
    try {
      hint = typeof content.nextHint === 'function' ? content.nextHint(foundSticks) : null;
    } catch (err) {
      hint = null;
    }
    return { count: foundSticks.length, total, hint };
  }
  player.on('rescued', ({ x, y, z }) => {
    fx.burst(x, y + 0.6, z, { count: 28, speed: 4 });
    sfx('sparkle', { volume: 0.6 });
  });

  // ---------------------------------------------------------------- systems, in order
  const listener = { x: 0, z: 0 };
  engine.addSystem({ update: () => input.update() }, 0);
  engine.addSystem(player, 10);
  // the toss drives the player and aims the camera: after the player's own update, before the rig's (Contract 9)
  if (toss) engine.addSystem({ update: (dt, t) => toss.update(dt, t) }, 12);
  engine.addSystem({ update: (dt, t) => peers.update(dt, t) }, 14);
  engine.addSystem(interact, 16);
  if (sticks) {
    engine.addSystem({
      update(dt, t) {
        // only she collects, walking about (not mid-toss, not on the stage, not in a menu)
        const free = mode === 'play' && !player.controller && !player.rescuing;
        const hit = sticks.update(dt, t, free ? player.position : null);
        if (hit) collectStick(hit);
      },
    }, 18);
  }
  engine.addSystem(rig, 40);
  engine.addSystem({
    update(dt, t) {
      try {
        if (island.update) island.update(dt, t, { camera, playerPos: player.position });
      } catch (err) {
        if (!island.failed) console.error('[c9] island.update failed', err);
        island.failed = true;
      }
      try {
        if (sky.update) sky.update(dt, t, camera);
      } catch (err) {
        if (!sky.failed) console.error('[c9] sky.update failed', err);
        sky.failed = true;
      }
    },
  }, 45);
  let trail = 0;
  engine.addSystem({
    update(dt) {
      // a little sparkle trail behind the cloud taxi
      if (player.rescuing && (trail -= dt) <= 0) {
        trail = 0.18;
        const q = player.position;
        fx.burst(q.x, q.y - 0.4, q.z, { count: 3, speed: 1.2, size: 0.32, up: 0 });
      }
      fx.update(dt);
    },
  }, 50);
  const camPos = new THREE.Vector3();
  engine.addSystem({
    update(dt) {
      if (!myBubble) return;
      camPos.copy(camera.position);
      myBubble.userData.pop = Math.min(1, (myBubble.userData.pop || 0) + dt * 6);
      const k = myBubble.userData.pop;
      labels.place(myBubble, camPos, player.position, k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1);
      if (performance.now() > myBubbleUntil) {
        labels.release(myBubble);
        myBubble = null;
      }
    },
  }, 55);
  engine.addSystem({
    update() {
      listener.x = player.position.x;
      listener.z = player.position.z;
      camFocus.x = player.position.x;
      camFocus.y = player.position.y;
      camFocus.z = player.position.z;
      // the rig's yaw points from the player back to the camera; the ears face the other way (Contract 6)
      audio.setListener(listener.x, listener.z, rig.yaw + Math.PI);
    },
  }, 60);
  const myState = { x: 0, y: 0, z: 0, h: 0, anim: 'idle' };
  engine.addSystem({
    update() {
      // only from the island (and the Hit Zero stage): in the lobby or a menu you are not standing anywhere yet
      if (session && (mode === 'play' || stageShow)) net.sendState(player.getState(myState));
    },
  }, 70);
  if (debugOn) {
    let clock = 0;
    engine.addSystem({
      update(dt) {
        clock += dt;
        if (clock < 0.25) return;
        clock = 0;
        const s = engine.stats();
        const p = player.position;
        hud.setDebug(
          s.fps + ' fps  ' + s.frameMs + ' ms  pr ' + s.pixelRatio + '  ' + engine.quality + '\n'
          + s.drawCalls + ' calls  ' + s.triangles + ' tris  ' + s.geometries + ' geos\n'
          + 'x ' + p.x.toFixed(1) + '  y ' + p.y.toFixed(1) + '  z ' + p.z.toFixed(1) + '  ' + player.anim + (player.grounded ? '' : ' (air)') + '\n'
          + 'mode ' + mode + '  net ' + net.kind + '/' + net.status + '  players ' + net.players.size
          + '\n' + [island.fallback ? 'island:stand-in' : 'island', charMod === placeholder ? 'chars:stand-in' : 'chars', audioReal ? 'audio' : 'audio:silent', netMod ? 'net' : 'net:stand-in', toss ? 'toss' : 'no toss', gamesMod ? 'games' : 'no games'].join(' '),
        );
      },
    }, 90);
  }

  Object.defineProperties(world, {
    mode: { get: () => mode, enumerable: true },
    hitZero: { get: () => currentHz, enumerable: false },
    session: { get: () => session, enumerable: true },
  });
  Object.assign(world, {
    stats: () => engine.stats(),
    teleport: (x, z, facing) => player.place(x, z, facing ?? player.heading),
    showTitle,
    showMenu,
    startSolo,
    makeRoom,
    showJoin,
    enterWorld,
    openPicker,
    openPauseMenu,
    sendEmote,
    hostStartGame,
    setNick: applyNick,
    setLook: applyLook,
    // bot friends for games (host only): random names and looks; they are players like anyone else
    addBots(n = 1) {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const look = charMod.randomLook ? charMod.randomLook(Math.random) : placeholder.randomLook(Math.random);
        const id = net.addBot({ nick: content.randomNick(), look });
        if (!id) break;
        ids.push(id);
      }
      refreshPeople();
      return ids;
    },
    removeBots() {
      for (const [id, p] of [...net.players]) if (p && p.bot) net.removeBot(id);
      refreshPeople();
    },
    parts: {
      island: !island.fallback, sky: !!skyMod, character: charMod !== placeholder, audio: !!audioReal, net: !!netMod,
      toss: !!toss, games: !!gamesMod, content: Object.fromEntries(Object.entries(content.modules).map(([k, v]) => [k, !!v])),
    },
  });

  // ---------------------------------------------------------------- go
  syncSound();
  engine.start();
  await nextFrame();
  await nextFrame();
  hud.setLoading(1, 'Ready!');

  const roomParam = params.get('room');
  if (roomParam) {
    // test switch: straight into a room over the local transport, creating it when nobody is there yet
    const code = cleanCode(roomParam);
    const nk = params.get('nick');
    const n2 = nk ? content.cleanNick(nk) : null;
    if (n2) myNick = n2;
    const n = makeNet('local');
    net.use(n);
    let res = code ? await withTimeout(n.joinRoom(code, { nick: myNick, look: myLook }), 8000, { ok: false, reason: 'offline' }) : { ok: false, reason: 'bad-code' };
    if (!res.ok && res.reason === 'not-found') {
      const c = await withTimeout(n.createRoom({ nick: myNick, look: myLook, code }), 8000, null);
      res = { ok: !!c };
    }
    if (res.ok) {
      session = { kind: 'room', code: net.room ? net.room.code : code };
      refreshPeople();
      enterWorld();
    } else {
      net.use(null);
      showTitle();
      const why = JOIN_REASONS[res.reason] || JOIN_REASONS.error;
      hud.toast(res.reason === 'locked' ? why.title + '. ' + why.line : why.title, { icon: 'key' });
    }
  } else if (store.flag('solo')) {
    await startSolo();
  } else {
    showTitle();
  }
  setTimeout(() => hud.hideLoading(), 200);
}

boot().catch((err) => {
  console.error('[c9] boot failed', err);
  showFallback('Something went wobbly while building the sky island. Reloading usually fixes it!');
});
