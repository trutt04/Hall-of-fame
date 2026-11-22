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
import { createHud } from './ui/hud.js';
import { createMenu, buildPauseMenu, buildPicker, JOIN_REASONS } from './ui/menu.js';
import { createLabels } from './ui/labels.js';
import { createFx } from './ui/fx.js';
import { createSilentAudio, createStandinNet, STANDIN_CONTENT } from './ui/standins.js';
import { GAME_CHOICES, gameTitle, normalizeHowto } from './ui/gameui.js';
import { loadCss, el, reducedMotion, coarsePointer } from './ui/dom.js';
import { cleanCode } from './ui/codepad.js';

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
  const FORWARD = ['status', 'join', 'leave', 'host', 'event', 'game'];
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
    get kind() { return cur ? cur.kind || 'net' : 'none'; },
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
    stateOf(id, now) { return cur ? guard(() => cur.stateOf(id, now), null) : null; },
    addBot(o) { return cur ? guard(() => cur.addBot(o), null) : null; },
    removeBot(id) { if (cur) guard(() => cur.removeBot(id)); },
    send(type, data) { return cur ? guard(() => cur.send(type, data), false) : false; },
    setGame(state) { return cur ? guard(() => cur.setGame(state), false) : false; },
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
  engine.on('contextlost', () => hud.toast('Taking a quick breather... the sky will be right back!', { icon: 'sparkle', ms: 4000 }));

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
  if (fallbackIsland) island = fallbackIsland.buildIsland({ scene, quality, colliders });
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
  const terrain = { heightAt: (x, z) => Math.max(SKY_FLOOR, groundAt(x, z)) };
  hud.setLoading(0.55, 'Tying the bows');
  await nextFrame();

  // ---------------------------------------------------------------- input, camera, audio, net
  const input = createInput({ canvas, stick: hud.stick });
  const rig = createCameraRig({ camera, engine, terrain, input });
  rig.setBlocker((x, z) => colliders.insideBox(x, z, 1.6));

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
  const home = () => places.plaza;
  const player = createPlayer({ scene, groundAt, platforms, slides: Array.isArray(places.slides) ? places.slides : [], colliders, input, rig, audio, hud, home });
  let myLook = store.look || cleanLook(charMod.DEFAULT_LOOK || placeholder.DEFAULT_LOOK);
  let myNick = store.nick;
  if (!myNick) myNick = store.setNick(content.randomNick()) || content.randomNick();
  player.setAvatar(makeCharacter(myLook));
  player.place(places.plaza.x, places.plaza.z, places.plaza.facing ?? 0);
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
      }
    } catch (err) {
      console.warn('[c9] the basket toss part failed to start', err);
    }
  }
  world.games = gamesMod || null;

  // ---------------------------------------------------------------- state of the app
  let mode = 'boot'; // 'title' | 'menu' | 'closet' | 'lobby' | 'play' | 'overlay'
  let session = null; // { kind: 'solo' | 'room', code }
  let lobbyUI = null;
  let lastEmoteAt = -1e9;
  let myBubble = null;
  let myBubbleUntil = 0;
  let unlocked = false;
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
  function toggleSound() {
    const on = !audio.enabled;
    audio.unlock();
    unlocked = true;
    audio.setEnabled(on);
    if (on) {
      audio.music(isBirthday ? 'birthday' : 'island');
      sfx('pop');
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
    if (audio.enabled) audio.music(isBirthday ? 'birthday' : 'island');
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
  function refreshPeople() {
    peers.sync();
    const rows = playerRows();
    hud.setPlayers(session ? rows : []);
    hud.setRoom(session && session.kind === 'room' && net.room ? net.room.code : null);
    hud.setButton('games', { hidden: !(session && (session.kind === 'solo' || net.isHost)) });
    if (lobbyUI) {
      const host = rows.find((r) => r.host);
      lobbyUI.update({ players: rows, isHost: net.isHost, hostNick: host ? host.nick : '' });
    }
  }
  net.on('join', (e) => {
    refreshPeople();
    const p = e && net.players.get(e.id);
    if (p && session && session.kind === 'room' && !p.bot && e.id !== (net.me && net.me.id)) {
      hud.toast(nickOf(p) + ' ' + content.hype('join', { nick: nickOf(p) }).replace(/^\s*/, ''), { icon: 'sparkle' });
      sfx('chime', { volume: 0.6 });
    }
  });
  net.on('leave', () => refreshPeople());
  net.on('host', () => {
    refreshPeople();
    if (session && session.kind === 'room' && net.isHost && playing()) hud.toast('You are the host now! You pick the games.', { icon: 'crown' });
  });
  net.on('status', () => refreshPeople());

  // ---------------------------------------------------------------- emotes
  function showMyBubble(e) {
    if (myBubble) labels.release(myBubble);
    myBubble = labels.bubble(e.text || e.id, e.icon);
    myBubble.position.y = 1.72; // just above her bow
    player.group.add(myBubble);
    myBubbleUntil = performance.now() + 3000;
    myBubble.userData.pop = 0;
  }
  function sendEmote(e) {
    const now = performance.now();
    if (now - lastEmoteAt < 1100) return;
    lastEmoteAt = now;
    showMyBubble(e);
    player.emote(animForEmote(e), 1.8);
    sfx('pop', { volume: 0.7 });
    if (session) net.send('emote', { id: e.id });
  }
  function toggleWheel() {
    if (hud.wheelOpen) {
      hud.closeWheel();
      return;
    }
    if (!playing() || hud.isModalOpen()) return;
    sfx('open', { volume: 0.5 });
    hud.openWheel(content.EMOTES, sendEmote);
  }
  net.on('event', (ev) => {
    if (!ev || typeof ev !== 'object') return;
    const from = ev.from;
    const mine = net.me && from === net.me.id;
    if (ev.type === 'emote') {
      if (mine) return; // shown already
      const e = content.cleanEmote(ev.data && ev.data.id);
      if (!e) return;
      peers.emote(from, { text: e.text || e.id, icon: e.icon, anim: animForEmote(e) });
      const pos = peers.positionOf(from);
      sfx('pop', pos ? { volume: 0.55, x: pos.x, z: pos.z } : { volume: 0.4 });
    } else if (ev.type === 'game-start') {
      const data = ev.data && typeof ev.data === 'object' ? ev.data : {};
      if (session && session.kind === 'room' && net.room && from !== net.room.hostId && !mine) return; // only the host starts things
      onGameStart(data);
    } else if (ev.type === 'game-end') {
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
    if (kind === 'hitZero') {
      launchHitZero();
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

  async function launchHitZero() {
    const mod = await optional('./rhythm/index.js');
    if (!mod || typeof mod.createHitZero !== 'function') {
      hud.toast('Hit Zero is still warming up backstage!', { icon: 'music', ms: 3000 });
      return;
    }
    await loadCss('css/rhythm.css');
    const container = el('div', 'c9-overlay c9-rhythm-host');
    document.body.appendChild(container);
    const before = mode;
    setMode('overlay');
    audio.music(null);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        if (inst && typeof inst.dispose === 'function') inst.dispose();
      } catch (err) { /* already gone */ }
      container.remove();
      setMode(before === 'overlay' ? 'play' : before);
      if (audio.enabled) audio.music('island');
      const zero = result && (result.hitZero || result.zero || result.perfect);
      if (zero) {
        fx.burst(player.position.x, player.position.y + 1.6, player.position.z, { count: 60, speed: 7 });
        hud.big('HIT ZERO!', content.hype('routineZero'), { ms: 2600 });
      } else if (result) hud.toast(content.hype('routineGood'), { icon: 'music' });
    };
    let inst = null;
    try {
      inst = mod.createHitZero({ audio, container, level: 1, onDone: finish });
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
  async function openCheerleader(back) {
    const mod = await optional('./ui/creator.js');
    if (mod && typeof mod.openCreator === 'function') {
      await loadCss('css/creator.css');
      const before = mode;
      setMode('overlay');
      menu.hide();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        back();
      };
      try {
        mod.openCreator({
          look: myLook,
          nick: myNick,
          onDone(look, nick) {
            if (look) applyLook(look);
            if (nick) applyNick(nick);
            if (session && net.current && typeof net.current.updateMe === 'function') {
              try {
                net.current.updateMe({ nick: myNick, look: myLook });
              } catch (err) { /* friends see it next time */ }
            }
            close();
          },
          onCancel: close,
        });
      } catch (err) {
        console.error('[c9] the creator failed to open', err);
        setMode(before);
        close();
      }
      return;
    }
    // the placeholder closet
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
    if (world.activeGame) onGameEnd();
    if (session) net.leaveRoom();
    session = null;
    net.use(null);
    peers.clear();
    refreshPeople();
  }

  async function startSolo() {
    leaveSession();
    const n = makeNet('offline');
    net.use(n);
    try {
      await withTimeout(n.createRoom({ nick: myNick, look: myLook }), 5000, null);
    } catch (err) { /* solo works without a room too */ }
    session = { kind: 'solo' };
    refreshPeople();
    enterWorld();
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
    if (n.kind === 'offline') {
      roomsUnavailable();
      return;
    }
    net.use(n);
    const code = await withTimeout(n.createRoom({ nick: myNick, look: myLook }), 15000, null);
    if (!code || !net.room) {
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
        if (n.kind === 'offline') return { ok: false, reason: 'offline' };
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
    });
    refreshPeople();
  }

  let welcomed = false;
  function enterWorld() {
    lobbyUI = null;
    menu.hide();
    setMode('play');
    followCamera();
    refreshPeople();
    if (!welcomed) {
      welcomed = true;
      // arrive from the sky: a little drop onto the plaza with a sparkle landing
      const p = places.plaza;
      player.place(p.x, p.z, p.facing ?? 0);
      player.position.y += 7;
      player.velocity.y = -2;
      followCamera();
      if (isBirthday) {
        hud.big('Happy Birthday, ' + BIRTHDAY.name + '!', age ? 'Turning ' + age + ' on Cloud Nine!' : content.hype('birthday'), { ms: 3400 });
        audio.music('birthday');
      } else {
        hud.big(GAME.title, content.hype('welcome', { nick: myNick }), { ms: 2200 });
      }
    }
    if (audio.enabled && unlocked && !isBirthday) audio.music('island');
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
      let p = places[key];
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
  function openPauseMenu() {
    if (!playing() || hud.isModalOpen()) return;
    sfx('open', { volume: 0.5 });
    const inRoom = session && session.kind === 'room';
    hud.openPanel({
      title: 'Menu',
      contentEl: buildPauseMenu({
        code: inRoom && net.room ? net.room.code : null,
        isHost: inRoom && net.isHost,
        canPick: session && (session.kind === 'solo' || net.isHost),
        places: travelSpots(),
        sound: audio.enabled,
        quality: engine.quality,
        leaveLabel: inRoom ? 'Leave the room' : 'Back to the menu',
        onClose: () => hud.closePanel(),
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
    if (hud.wheelOpen) hud.closeWheel();
    else if (hud.cardOpen) hud.closeCard();
    else if (hud.panelOpen) hud.closePanel();
    else if (playing()) openPauseMenu();
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
    hud.toast(content.hype('cloudCatch'), { icon: 'sparkle', ms: 3000 });
  });
  player.on('rescued', ({ x, y, z }) => {
    fx.burst(x, y + 0.6, z, { count: 28, speed: 4 });
    sfx('sparkle', { volume: 0.6 });
  });

  // ---------------------------------------------------------------- systems, in order
  const listener = { x: 0, z: 0 };
  engine.addSystem({ update: () => input.update() }, 0);
  engine.addSystem(player, 10);
  engine.addSystem({ update: (dt, t) => peers.update(dt, t) }, 14);
  engine.addSystem(interact, 16);
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
  engine.addSystem({ update: (dt) => fx.update(dt) }, 50);
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
      audio.setListener(listener.x, listener.z, rig.yaw);
    },
  }, 60);
  engine.addSystem({
    update() {
      // only from the island: in the lobby or a menu you are not standing anywhere yet
      if (session && mode === 'play') net.sendState(player.getState());
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
      hud.toast((JOIN_REASONS[res.reason] || JOIN_REASONS.error).title, { icon: 'key' });
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
