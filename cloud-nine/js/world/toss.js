// The basket toss (Contract 9), the flyer's signature move. Stand on a pad's glittery mat and tap
// "Basket toss!" (or press Space): three bases and a back spot dip and throw you on "5, 6, 7, 8!"
// toward a cloud platform. Swipe (or press the arrows, Space to twist) for tricks in the air: near
// the top of the arc time slows for a moment and the same swipes become body positions. Stick the
// landing on the cloud for a sparkle burst, a hype line and a score, or get a soft cloud cradle
// if you are still mid-trick. Never a crash. Real friends standing on a pad's glowing base spots
// make you fly higher (each friend adds height); bots can't base, that's the squad's thing.
//
//   const toss = createToss(world)
//   toss.update(dt, t)      once a frame, after player.update and before the camera rig's update
//   toss.active             true while the toss has the player and the camera
//   toss.on('landed', fn({ height, tricks, score, stuck, padId, combo, best, newBest, friends }))
//                           height: metres from the mat to the top of the arc; tricks: ids of the tricks finished
//                           also 'start' { padId }, 'launch' { padId, apex, friends }, 'trick' { id, name, mult, apex }, 'end'
//   toss.cancel()           end it now, safely (a flyer in the air is floated onto the cloud)
//   toss.dispose()
//   toss.pads               [{ id, x, y, z, heading, target }] read only
//   toss.state              a snapshot for tests and dev pages
//   toss._start(i) / toss._gesture(g) / toss._friendsAt(i)   test hooks
//   SPOT_SETTLE, settleOnSpot(t, onSpot, dt)   (pure) passing over a base spot is not basing: the
//                           "Basket toss!" button stays put until she has stood on a spot a moment
//
// From the world (Contracts 1 and 2): scene, rig, input, player (position, heading, velocity, avatar,
// takeControl), groundAt, platforms, places.tossPads, interact (or hud.prompt), hud.toast, audio,
// spawnBurst, quality, net (optional), content (optional). Neighbours are loaded lazily, each with
// a fallback: ../art/character.js (else stand-ins) and ../content/hype.js (else built-in lines).
// Best scores per pad are kept on this device under 'c9.toss.best.v1'.
//
// The pieces: toss-rules.js (the pure maths and words), toss-swipe.js (gestures), toss-pad.js (the
// mat, spots and sign), toss-crew.js (the computer bases), toss-squad.js (real friends and network
// events), toss-camera.js (the cinematic camera), toss-fx.js (arc, ring, trail, shadow, cushion),
// toss-hud.js (the overlay) and toss-standin.js (a stand-in character for when there is none).

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { clamp, dampAngle, emitter, mulberry32, safeStorageGet, safeStorageSet, smoothstep } from '../core/util.js';
import {
  TOSS, solveToss, heightAt, vSpeedAt, clockRate, inApex, trickFor, nextChain, comboMultiplier,
  scoreToss, cleanNick, fallbackHype,
} from './toss-rules.js';
import { createSwipeInput } from './toss-swipe.js';
import { createPadArt } from './toss-pad.js';
import { createTossFx } from './toss-fx.js';
import { createCrew } from './toss-crew.js';
import { createTossHud } from './toss-hud.js';
import { createStandin, standinStyle } from './toss-standin.js';
import { createTossCamera } from './toss-camera.js';
import { createSquad } from './toss-squad.js';

const BEST_KEY = 'c9.toss.best.v1';
// Pad space: +Z points at the cloud, +X is the flyer's left. Three bases and a back spot.
const SPOTS = [{ x: 0.8, z: 0 }, { x: -0.8, z: 0 }, { x: 0, z: 0.8 }, { x: 0, z: -0.8, back: true }];
const CREW_RANGE = 42; // bases are drawn for pads this close
const MAX_CREWS = 2; // ... and for at most this many pads at once (character budget)
const NEAR_PAD = 6; // the sparkle arc shows from this close
const STEER_SPEED = 2.4; // m/s of landing-point drift at full stick
const SPARKLES = [PALETTE.rhinestonePink, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver, PALETTE.gold, PALETTE.white];
const COUNT_PITCH = [1, 1.06, 1.12, 1.26];

// Walking onto the mat across a base spot must not blink "Basket toss!" off and on again: she only
// counts as one of the bases once she has stood on a spot this long (seconds; at a walk a spot takes
// about 0.4 s to cross).
export const SPOT_SETTLE = 0.6;
export function settleOnSpot(t, onSpot, dt) {
  return onSpot ? t + dt : 0;
}

const hashId = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

export function createToss(world) {
  const w = world || {};
  const scene = w.scene;
  const rig = w.rig || null;
  const cam3 = w.camera && w.camera.isCamera ? w.camera : rig && rig.object && rig.object.isCamera ? rig.object : null;
  const input = w.input || null;
  const audio = w.audio || null;
  const player = w.player || null;
  const hud = w.hud || null;
  const interact = w.interact && typeof w.interact.register === 'function' ? w.interact : null;
  const net = w.net || null;
  const groundAt = typeof w.groundAt === 'function' ? w.groundAt : () => 0;
  const quality = w.quality === 'low' ? 'low' : 'high';
  const calm = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const events = emitter();
  let disposed = false;

  const isTouch = () => !!((input && input.usingTouch) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  const sfx = (name, opts) => {
    try {
      if (audio && typeof audio.sfx === 'function') audio.sfx(name, opts);
    } catch (err) { /* sound is a bonus */ }
  };
  const toast = (text, opts) => {
    try {
      if (hud && typeof hud.toast === 'function') hud.toast(text, opts);
    } catch (err) { /* the HUD is optional here */ }
  };
  const burst = (x, y, z, count) => {
    try {
      if (typeof w.spawnBurst === 'function') w.spawnBurst(x, y, z, { count, colors: SPARKLES });
    } catch (err) { /* sparkles are a bonus */ }
  };

  // ------------------------------------------------------------------ words: content/hype.js, else ours
  let hypeFn = null;
  if (w.content && typeof w.content.hype === 'function') hypeFn = w.content.hype;
  else if (w.content && w.content.hype && typeof w.content.hype.hype === 'function') hypeFn = w.content.hype.hype;
  else {
    import('../content/hype.js').then((m) => {
      if (m && typeof m.hype === 'function') hypeFn = m.hype;
    }).catch(() => { /* fallback lines it is */ });
  }
  function line(situation, ctx) {
    let s = null;
    if (hypeFn) {
      try {
        s = hypeFn(situation, ctx, Math.random);
      } catch (err) {
        s = null;
      }
    }
    if (typeof s !== 'string' || !s.trim() || s.length > 140) s = fallbackHype(situation, ctx);
    return s;
  }

  // ------------------------------------------------------------------ best scores on this device
  const bests = {};
  try {
    const raw = JSON.parse(safeStorageGet(BEST_KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw).slice(0, 24)) {
        const v = Math.round(Number(raw[k]));
        if (Number.isFinite(v) && v > 0) bests[k] = Math.min(99999, v);
      }
    }
  } catch (err) { /* a fresh start */ }
  const saveBests = () => safeStorageSet(BEST_KEY, JSON.stringify(bests));

  // ------------------------------------------------------------------ characters: the real ones, else stand-ins
  let makeChar = null;
  import('../art/character.js').then((mod) => {
    if (!disposed) makeChar = factory(mod);
  }).catch(() => {
    if (!disposed) makeChar = factory(null);
  });

  function lookFor(mod, pad, i) {
    const team = pad.index % 2;
    const rnd = mulberry32(hashId(pad.id) + i * 101);
    let look = {};
    try {
      look = typeof mod.randomLook === 'function' ? Object.assign({}, mod.randomLook(rnd)) : {};
    } catch (err) {
      look = {};
    }
    // the team uniform: Team Pink wears the outfit from DEFAULT_LOOK; Team Purple swaps in purple pieces
    const base = mod.DEFAULT_LOOK || {};
    for (const k of ['top', 'bottom', 'bow', 'bowPattern', 'bowSize', 'shoes', 'socks', 'sparkle']) if (base[k] !== undefined) look[k] = base[k];
    if (team === 1 && mod.LOOK_OPTIONS) {
      for (const k of ['top', 'bottom', 'bow']) {
        const list = mod.LOOK_OPTIONS[k];
        if (!Array.isArray(list)) continue;
        const purple = list.find((o) => o && /purple|violet|lilac|lavender/i.test(String(o.id) + ' ' + String(o.label)));
        if (purple) look[k] = purple.id;
      }
    }
    try {
      if (typeof mod.cleanLook === 'function') look = mod.cleanLook(look);
    } catch (err) { /* createCharacter cleans it too */ }
    return look;
  }

  function factory(mod) {
    if (mod && typeof mod.createCharacter === 'function') {
      return (pad, i) => {
        try {
          return mod.createCharacter(lookFor(mod, pad, i), { quality });
        } catch (err) {
          console.warn('[c9] createCharacter failed, using a stand-in', err);
          return createStandin(standinStyle(hashId(pad.id) + i, pad.index % 2), { seed: i });
        }
      };
    }
    return (pad, i) => createStandin(standinStyle(hashId(pad.id) + i * 3, pad.index % 2), { seed: i + pad.index * 4 });
  }

  // ------------------------------------------------------------------ shared effects and the overlay
  const fx = createTossFx({ scene, calm, quality });
  const thud = createTossHud({ calm, touch: isTouch });

  // ------------------------------------------------------------------ the pads
  const padDefs = w.places && Array.isArray(w.places.tossPads) ? w.places.tossPads : [];
  const platforms = Array.isArray(w.platforms) ? w.platforms : [];
  const pads = [];

  function signLines(pad) {
    const big = pad.land ? Math.max(1, Math.round(pad.land.y - pad.y)) + ' m' : 'Sky high';
    return { big, small: pad.best > 0 ? 'BEST ' + pad.best : 'Fly to the cloud!' };
  }

  function buildPad(d, index) {
    if (!d || !Number.isFinite(+d.x) || !Number.isFinite(+d.z)) return null;
    const id = d.id !== undefined && d.id !== null ? String(d.id) : 'pad' + index;
    const x = +d.x;
    const z = +d.z;
    let y = groundAt(x, z);
    if (!Number.isFinite(y)) y = 0;
    const plat = platforms.find((p) => p && String(p.id) === String(d.targetPlatformId) && Number.isFinite(+p.x) && Number.isFinite(+p.y) && Number.isFinite(+p.z)) || null;
    const heading = plat && Math.hypot(plat.x - x, plat.z - z) > 0.5 ? Math.atan2(plat.x - x, plat.z - z) : Number.isFinite(+d.facing) ? +d.facing : 0;
    const fx0 = Math.sin(heading);
    const fz0 = Math.cos(heading);
    const lx = Math.cos(heading);
    const lz = -Math.sin(heading);
    const spots = SPOTS.map((s) => ({ x: x + lx * s.x + fx0 * s.z, y, z: z + lz * s.x + fz0 * s.z, back: !!s.back }));
    let land = null;
    if (plat) {
      const r = Math.max(0.8, Number(plat.r) || 3);
      const dx = x - plat.x;
      const dz = z - plat.z;
      const dd = Math.hypot(dx, dz) || 1;
      const k = Math.min(r * 0.2, 0.8);
      land = { x: plat.x + (dx / dd) * k, z: plat.z + (dz / dd) * k, r };
      const ly = groundAt(land.x, land.z);
      land.y = Number.isFinite(ly) ? ly : +plat.y;
      land.steer = Math.max(0, Math.min(TOSS.steer * r, r - 0.75 - k));
    }
    const pad = {
      id, index, x, y, z, heading, fx: fx0, fz: fz0, lx, lz, spots, plat, land, best: bests[id] || 0,
      taken: spots.map(() => null), friendCount: 0, friendIds: [], meSpot: -1, spotT: 0, dist: Infinity, wasNear: false,
      entry: null, remote: null, art: null, crew: null,
    };
    pad.art = createPadArt({ x, y, z, heading, spots: SPOTS, title: signLines(pad), quality });
    scene.add(pad.art.group);
    pad.crew = createCrew({ parent: scene, center: { x, y, z }, spots });
    if (interact) {
      try {
        pad.entry = interact.register({
          id: 'toss-' + id, position: new THREE.Vector3(x, y, z), radius: TOSS.padRadius, label: 'Basket toss!',
          priority: 3, object3D: pad.art.mat, onUse: () => start(pad),
        }) || null;
      } catch (err) {
        console.warn('[c9] toss pad could not register its prompt', err);
      }
    }
    return pad;
  }
  padDefs.forEach((d, i) => {
    try {
      const p = buildPad(d, pads.length);
      if (p) pads.push(p);
    } catch (err) {
      console.warn('[c9] a toss pad was skipped', err);
    }
  });
  const squad = createSquad({ net, player, pads, toast, burst, flying: (pad) => S.active && S.pad === pad });

  // ------------------------------------------------------------------ the toss state
  const S = {
    active: false, phase: 'idle', pad: null, t: 0, release: null, cool: 0,
    from: { x: 0, y: 0, z: 0, h: 0 }, beat: TOSS.countBeat, countAt: 0.42, countK: -1,
    friends: 0, friendNames: [], sol: null, classic: false, tau: 0, airT: 0,
    pos: new THREE.Vector3(), aim: { x: 0, z: 0 }, steer: { x: 0, z: 0 }, baseHeading: 0, spin: 0,
    trick: null, queued: null, tricks: [], chain: 0, prevId: null, maxChain: 0, apexShown: false, trailClock: 0,
    landing: null, landT: 0, landY: 0, pending: null, anim: '', blobs: [], flights: 0,
    card: false, cardT: 0, cardAt: null,
  };
  const mv = { x: 0, y: 0 };
  const camDir = new THREE.Vector3();
  const keys = new Set();
  let promptPad = null;
  let previewKey = '';

  function setAnim(name, opts) {
    if (S.anim === name) return;
    S.anim = name;
    const av = player && player.avatar;
    if (av && typeof av.setAnim === 'function') {
      try {
        av.setAnim(name, opts);
      } catch (err) { /* unknown names fall back to idle in the character */ }
    }
  }
  function hideBlob(on) {
    if (on) {
      S.blobs = [];
      const av = player && player.avatar;
      if (av && av.group && av.group.traverse) {
        av.group.traverse((o) => {
          if (o !== av.group && (o.name === 'blob' || /shadow/i.test(o.name)) && o.visible) {
            S.blobs.push(o);
            o.visible = false;
          }
        });
      }
    } else {
      for (const o of S.blobs) o.visible = true;
      S.blobs = [];
    }
  }

  function grab() {
    if (player && typeof player.takeControl === 'function') {
      try {
        const rel = player.takeControl('toss');
        if (typeof rel === 'function') return rel;
      } catch (err) {
        console.warn('[c9] takeControl failed', err);
      }
      return () => {};
    }
    const was = !!(player && player.frozen);
    if (player) player.frozen = true;
    return () => {
      if (player) player.frozen = was;
    };
  }

  function applyPlayer(vx = 0, vy = 0, vz = 0) {
    if (!player || !player.position) return;
    player.position.set(S.pos.x, S.pos.y, S.pos.z);
    const h = S.baseHeading + S.spin;
    try {
      player.heading = h;
    } catch (err) { /* read-only heading: the group below still turns */ }
    if (player.group && player.group.rotation) player.group.rotation.y = h;
    if (player.velocity && typeof player.velocity.set === 'function') player.velocity.set(vx, vy, vz);
  }

  function onMat(pad, p = player && player.position) {
    return !!p && Math.hypot(p.x - pad.x, p.z - pad.z) <= TOSS.padRadius && Math.abs(p.y - pad.y) <= 1.2;
  }
  // she is one of this pad's bases (standing on a spot, not just passing over one)
  const basingOn = (pad) => pad.meSpot >= 0 && pad.spotT >= SPOT_SETTLE;
  function canOffer(pad) {
    return !S.active && !disposed && S.cool <= 0 && !!player && !player.frozen && onMat(pad) && !basingOn(pad) && !(rig && rig.isCinematic);
  }

  // ------------------------------------------------------------------ the camera
  const camera = createTossCamera({ rig, camera: cam3, groundAt, calm });
  const view = { phase: 'idle', pad: null, pos: null, sol: null, tau: 0, aimX: 0, aimZ: 0, steerX: 0, steerZ: 0 };
  function aimCamera(dt) {
    view.phase = S.phase;
    view.pad = S.pad;
    view.pos = S.pos;
    view.sol = S.sol;
    view.tau = S.tau;
    view.aimX = S.aim.x;
    view.aimZ = S.aim.z;
    view.steerX = S.steer.x;
    view.steerZ = S.steer.z;
    camera.update(dt, view);
  }

  // ------------------------------------------------------------------ start, count and launch
  function start(pad) {
    if (S.active || disposed || !pad || !player || !player.position) return false;
    const pp = player.position;
    if (Math.hypot(pp.x - pad.x, pp.z - pad.z) > TOSS.padRadius + 0.6 || Math.abs(pp.y - pad.y) > 1.5) return false;
    if (rig && rig.isCinematic) return false;
    hideCard();
    S.release = grab();
    S.active = true;
    S.pad = pad;
    S.phase = 'load';
    S.t = 0;
    S.anim = '';
    const p = player.position;
    S.from = { x: p.x, y: p.y, z: p.z, h: Number.isFinite(player.heading) ? player.heading : pad.heading };
    S.pos.set(p.x, p.y, p.z);
    S.baseHeading = S.from.h;
    S.spin = 0;
    S.tricks = [];
    S.chain = 0;
    S.prevId = null;
    S.maxChain = 0;
    S.trick = null;
    S.queued = null;
    S.landing = null;
    S.pending = null;
    S.apexShown = false;
    S.friends = 0;
    S.friendNames = [];
    S.countK = -1;
    // the count, on the music's beat when the music has one
    let beat = TOSS.countBeat;
    let first = 0.42;
    const b = audio && audio.beat;
    if (b && b.playing && Number.isFinite(b.bpm) && b.bpm >= 80 && b.bpm <= 200 && typeof b.time === 'function' && typeof b.nextBeatTime === 'function') {
      beat = clamp(60 / b.bpm, 0.3, 0.6);
      let wait = Number(b.nextBeatTime()) - Number(b.time());
      if (!Number.isFinite(wait) || wait < 0) wait = 0;
      while (wait < 0.36) wait += beat;
      first = Math.min(wait, 1.2);
    }
    S.beat = beat;
    S.countAt = first;
    hideBlob(true);
    keys.clear();
    swipes.reset();
    pad.remote = null;
    pad.crew.cue('ready');
    pad.crew.watch(null);
    fx.preview(null);
    previewKey = '';
    fx.ring(0, 0, 0, 0);
    thud.show(true);
    thud.banner(null);
    thud.result(null);
    thud.legend(null);
    thud.gauge(null);
    thud.hint(null);
    thud.squad(0);
    if (!interact && promptPad && hud && typeof hud.clearPrompt === 'function') {
      hud.clearPrompt();
      promptPad = null;
    }
    camera.start();
    setAnim('jump');
    sfx('tap', { volume: 0.6 });
    events.emit('start', { padId: pad.id });
    return true;
  }

  function stepLoad(dt) {
    const pad = S.pad;
    const k = smoothstep(0, 1, S.t / Math.min(0.36, S.countAt));
    const hop = Math.sin(Math.min(1, k) * Math.PI) * 0.35;
    S.pos.set(
      S.from.x + (pad.x - S.from.x) * k,
      S.from.y + (pad.y + TOSS.basketY - S.from.y) * k + hop,
      S.from.z + (pad.z - S.from.z) * k,
    );
    S.baseHeading = dampAngle(S.baseHeading, pad.heading, 14, dt);
    if (k >= 1) setAnim('daggers');
    pad.crew.dip(0);
    if (S.t >= S.countAt) {
      S.phase = 'count';
      S.countK = -1;
    }
  }

  function stepCount(dt) {
    const pad = S.pad;
    S.baseHeading = dampAngle(S.baseHeading, pad.heading, 14, dt);
    const ct = S.t - S.countAt;
    const k = Math.floor(ct / S.beat);
    const p = ct / S.beat - k;
    if (k !== S.countK && k <= 3) {
      S.countK = k;
      thud.count(['5', '6', '7', '8!'][k]);
      sfx('count', { pitch: COUNT_PITCH[k], volume: k === 3 ? 1 : 0.8 });
      if (k === 0) squad.send({ kind: 'toss', pad: pad.id, beat: S.beat });
      if (k === 3) {
        pad.crew.cue('throw');
        setAnim('highV');
      }
    }
    // live squad: a friend can still hop on a spot during the count
    if (pad.friendCount !== S.friends) {
      S.friends = pad.friendCount;
      S.friendNames = squad.names(pad);
      thud.squad(S.friends, S.friendNames);
      if (S.friends > 0) sfx('chime', { volume: 0.5, pitch: 1 + S.friends * 0.08 });
    }
    let dip = 0;
    if (k === 0) dip = -0.2 * Math.sin(p * Math.PI);
    else if (k === 1) dip = -0.05 * Math.sin(p * Math.PI);
    else if (k === 2) dip = -0.3 * smoothstep(0, 0.7, p);
    if (k >= 3) {
      // the throw: from the bottom of the dip up to full extension, then she is away
      const u = Math.min(1, p / 0.38);
      const y = pad.y + TOSS.basketY - 0.3 + (TOSS.releaseY - TOSS.basketY + 0.3) * u * u;
      S.pos.set(pad.x, y, pad.z);
      pad.crew.dip(0.06 * u);
      if (p >= 0.38 || k > 3) launch();
      return;
    }
    setAnim('daggers');
    S.pos.set(pad.x, pad.y + TOSS.basketY + dip, pad.z);
    pad.crew.dip(dip * 0.55);
  }

  function launch() {
    const pad = S.pad;
    S.friends = pad.friendCount;
    S.friendNames = squad.names(pad);
    const from = { x: pad.x, y: pad.y + TOSS.releaseY, z: pad.z };
    S.classic = !pad.land;
    S.sol = S.classic
      ? solveToss({ from, to: { x: pad.x, y: pad.y + TOSS.catchY, z: pad.z }, friends: S.friends, calm, classic: true })
      : solveToss({ from, to: pad.land, friends: S.friends, calm });
    S.phase = 'air';
    S.tau = 0;
    S.airT = 0;
    S.trailClock = 0;
    S.aim = { x: S.sol.x1, z: S.sol.z1 };
    S.steer = { x: 0, z: 0 };
    S.pos.set(from.x, from.y, from.z);
    S.baseHeading = pad.heading;
    S.flights++;
    pad.crew.dip(0);
    pad.crew.cue('throw');
    sfx('toss');
    sfx('whoosh', { volume: 0.8 });
    if (S.friends > 0) sfx('cheer', { volume: 0.5 });
    thud.count(null);
    thud.legend('air');
    thud.squad(S.friends, S.friendNames);
    if (S.flights <= 2) thud.hint(isTouch() ? 'Swipe for tricks!' : 'Arrow keys for tricks!');
    setAnim('jump');
    fx.trailClear();
    events.emit('launch', { padId: pad.id, apex: S.sol.apex - pad.y, friends: S.friends });
  }

  // ------------------------------------------------------------------ in the air
  function gesture(g, info) {
    if (!S.active) return;
    if (S.phase === 'load' || S.phase === 'count') {
      S.queued = { g, info };
      return;
    }
    if (S.phase !== 'air') return;
    if (S.trick || S.airT < 0.12) {
      S.queued = { g, info };
      return;
    }
    startTrick(g, info);
  }

  function startTrick(g, info) {
    const atApex = inApex(S.sol, S.tau);
    const def = trickFor(g, atApex);
    if (!def) return;
    S.chain = nextChain(S.prevId, def.id, S.chain);
    S.prevId = def.id;
    S.maxChain = Math.max(S.maxChain, S.chain);
    const mult = comboMultiplier(S.chain);
    let dir = 1;
    if (g === 'right') dir = -1;
    else if (g === 'circle') dir = info && info.dir > 0 ? -1 : 1;
    S.trick = { def, t: 0, mult, dir, entry: { id: def.id, done: false } };
    S.tricks.push(S.trick.entry);
    S.anim = '';
    setAnim(def.anim, { loop: false });
    thud.trick(def.name, { mult, apex: atApex });
    thud.hint(null);
    thud.squad(0); // the ribbon made its point at the launch; the top of the screen is for tricks now
    sfx('whoosh', { volume: 0.55, pitch: 1 + Math.min(0.5, (S.chain - 1) * 0.1) });
    events.emit('trick', { id: def.id, name: def.name, mult, apex: atApex });
  }

  function finishTrick() {
    const tr = S.trick;
    tr.entry.done = true;
    S.spin = 0;
    S.trick = null;
    const pts = Math.round(tr.def.points * tr.mult);
    thud.points(pts);
    sfx('sparkle', { volume: 0.55, pitch: 1 + 0.06 * Math.min(6, S.chain) });
    if (tr.mult > 1) sfx('chime', { volume: 0.35, pitch: 1 + 0.08 * Math.min(6, S.chain) });
    if (!calm) burst(S.pos.x, S.pos.y + 0.9, S.pos.z, quality === 'low' ? 6 : 12);
  }

  function steer(dt) {
    if (S.classic || !S.pad.land || !cam3) return;
    let mx = 0;
    let my = 0;
    if (input && input.stickActive && typeof input.getMove === 'function') {
      input.getMove(mv);
      mx = mv.x;
      my = mv.y;
    } else {
      if (keys.has('KeyD')) mx += 1;
      if (keys.has('KeyA')) mx -= 1;
      if (keys.has('KeyW')) my += 1;
      if (keys.has('KeyS')) my -= 1;
    }
    if (!mx && !my) return;
    cam3.getWorldDirection(camDir);
    const len = Math.hypot(camDir.x, camDir.z) || 1;
    const fx0 = camDir.x / len;
    const fz0 = camDir.z / len;
    const wx = -fz0 * mx + fx0 * my;
    const wz = fx0 * mx + fz0 * my;
    S.steer.x += wx * STEER_SPEED * dt;
    S.steer.z += wz * STEER_SPEED * dt;
    const max = S.pad.land.steer;
    const d = Math.hypot(S.steer.x, S.steer.z);
    if (d > max) {
      S.steer.x *= max / d;
      S.steer.z *= max / d;
    }
  }

  function surfaceAt(x, z) {
    const g = groundAt(x, z);
    if (Number.isFinite(g)) return g;
    const L = S.pad.land;
    if (L && Math.hypot(x - L.x, z - L.z) < 1.4) return L.y;
    return -Infinity;
  }

  function stepAir(dt) {
    const s = S.sol;
    const pad = S.pad;
    S.airT += dt;
    const dtau = dt * clockRate(s, S.tau);
    const remain = Math.max(0.05, s.T - S.tau);
    S.tau += dtau;
    steer(dt);
    const tx = S.aim.x + S.steer.x;
    const tz = S.aim.z + S.steer.z;
    const k = Math.min(1, dtau / remain);
    const px = S.pos.x;
    const pz = S.pos.z;
    S.pos.x += (tx - S.pos.x) * k;
    S.pos.z += (tz - S.pos.z) * k;
    S.pos.y = heightAt(s, S.tau);

    // tricks
    if (!S.trick && S.queued && S.airT >= 0.12) {
      const q = S.queued;
      S.queued = null;
      startTrick(q.g, q.info);
    }
    if (S.trick) {
      const tr = S.trick;
      tr.t += dt;
      const u = clamp(tr.t / tr.def.dur, 0, 1);
      if (tr.def.spin) {
        const from = tr.def.id === 'kickDouble' ? 0.32 : 0;
        S.spin = tr.dir * tr.def.spin * Math.PI * 2 * easeInOut(clamp((u - from) / (1 - from), 0, 1));
      }
      if (u >= 1) finishTrick();
    }
    if (!S.trick) setAnim(S.airT < 0.24 ? 'jump' : 'highV');

    // the top of the arc
    const apex = inApex(s, S.tau);
    if (apex && !S.apexShown) {
      S.apexShown = true;
      thud.legend('apex');
      sfx('sparkle', { volume: 0.7, pitch: 1.3 });
    } else if (!apex && S.apexShown && S.tau > s.tUp) thud.legend('air');
    if (S.airT > 1.5) thud.hint(null);
    if (S.airT > 1.3 && S.friends > 0) thud.squad(0);

    // trail, shadow, landing ring, gauge
    S.trailClock += dt;
    if (S.trailClock > (quality === 'low' ? 0.05 : 0.03)) {
      S.trailClock = 0;
      fx.trailPush(S.pos.x, S.pos.y + 0.75, S.pos.z);
    }
    const below = surfaceAt(S.pos.x, S.pos.z);
    fx.shadow(S.pos.x, below, S.pos.z, Number.isFinite(below) ? S.pos.y - below : null);
    if (!S.classic) {
      const ly = surfaceAt(tx, tz);
      const soon = S.tau > s.tUp ? 1 : 0.6;
      fx.ring(tx, Number.isFinite(ly) ? ly : pad.land.y, tz, soon);
    }
    thud.gauge({ height: S.pos.y - pad.y, apex: s.apex - pad.y, target: S.classic ? 0 : pad.land.y - pad.y });
    pad.crew.watch(S.pos.x, S.pos.z);
    if (S.airT > 0.6) pad.crew.cue(S.classic && S.tau > s.tUp ? 'catch' : 'air');

    const vy = vSpeedAt(s, S.tau) * (dtau / Math.max(1e-6, dt));
    applyPlayer((S.pos.x - px) / Math.max(1e-6, dt), vy, (S.pos.z - pz) / Math.max(1e-6, dt));

    // touchdown
    if (S.tau >= s.tUp) {
      if (S.classic) {
        if (S.tau >= s.T) {
          S.pos.y = s.y1;
          touchdown();
        }
      } else if (S.pos.y <= below) {
        S.pos.y = below;
        touchdown();
      } else if (S.tau > s.T + 0.6) {
        // a cloud always catches you: float onto the landing point
        S.pos.set(tx, pad.land.y, tz);
        touchdown();
      }
    }
  }

  // ------------------------------------------------------------------ landing
  function touchdown() {
    const pad = S.pad;
    const mid = !!S.trick;
    if (mid) {
      S.trick.entry.done = false;
      S.trick = null;
    }
    S.spin = 0;
    S.queued = null;
    const landing = mid ? 'cradle' : 'stuck';
    const apexHeight = S.sol.apex - pad.y;
    const sc = scoreToss({ apexHeight, tricks: S.tricks, landing });
    const prevBest = pad.best;
    const newBest = sc.total > prevBest;
    if (newBest) {
      pad.best = sc.total;
      bests[pad.id] = sc.total;
      saveBests();
      pad.art.setSign(signLines(pad));
    }
    S.phase = 'land';
    S.landT = 0;
    S.landing = landing;
    S.landY = S.pos.y;
    const { x, y, z } = S.pos;
    S.anim = '';
    if (S.classic) {
      setAnim('cradle');
      sfx('catch');
      sfx('cradle', { volume: 0.8 });
      burst(x, y + 0.6, z, calm ? 10 : landing === 'stuck' ? 30 : 16);
    } else if (landing === 'stuck') {
      setAnim('land');
      sfx('land');
      sfx('cheer', { volume: 0.7 });
      burst(x, y + 0.5, z, calm ? 16 : quality === 'low' ? 28 : 44);
    } else {
      fx.cushion(x, y, z);
      S.pos.y = y + 0.32;
      setAnim('cradle');
      sfx('cradle');
      burst(x, y + 0.7, z, calm ? 8 : 18);
    }
    if (newBest && prevBest > 0) sfx('tada', { volume: 0.7 });
    pad.crew.cue(S.classic ? 'catch' : 'land');
    pad.crew.watch(x, z);
    fx.trailClear();
    fx.shadow(0, null, 0, null);
    fx.ring(0, 0, 0, 0);
    thud.legend(null);
    thud.gauge(null);
    thud.hint(null);
    thud.squad(0);
    const word = S.classic ? (landing === 'stuck' ? 'Clean catch!' : 'Squad save!') : landing === 'stuck' ? 'Stuck it!' : 'Cloud cradle!';
    thud.banner(word.toUpperCase(), landing);
    const done = S.tricks.filter((t) => t.done !== false).map((t) => t.id);
    const unfinished = S.tricks.find((t) => t.done === false);
    const nick = net && net.me ? cleanNick(net.me.nick) : null;
    const ctx = {
      stuck: landing === 'stuck', classic: S.classic, score: sc.total, height: Math.round(apexHeight), tricks: done.length, combo: S.maxChain,
      friends: S.friends, bases: S.friends, name: nick, newBest, trick: unfinished ? unfinished.id : done.length ? done[done.length - 1] : undefined,
    };
    // a classic catch has its own words (the content lines are about clouds); a huge stuck toss gets
    // 'bigToss', a catch mid-trick 'cradle', her first toss ever 'firstToss', a new best 'personalBest'
    const big = landing === 'stuck' && !S.classic && (S.friends >= 2 || apexHeight >= 24 || S.maxChain >= 3);
    const first = !S.classic && !prevBest && !Object.keys(bests).some((k) => k !== pad.id && bests[k] > 0);
    let situation = big ? 'bigToss' : 'tossLand';
    if (landing === 'cradle') situation = 'cradle';
    else if (first) situation = 'firstToss';
    else if (newBest && prevBest > 0) situation = 'personalBest';
    const hypeLine = S.classic ? fallbackHype('tossLand', ctx) : line(situation, ctx);
    S.pending = { sc, line: hypeLine, newBest, prevBest, apexHeight };
    applyPlayer();
    events.emit('landed', {
      height: Math.round(apexHeight * 10) / 10, tricks: done, score: sc.total, stuck: landing === 'stuck', padId: pad.id,
      combo: S.maxChain, best: pad.best, newBest, friends: S.friends,
    });
    squad.send({ kind: 'tossLand', pad: pad.id, stuck: landing === 'stuck', score: sc.total });
  }

  function cardFor(p) {
    const rows = [['Height ' + p.apexHeight.toFixed(1) + ' m', p.sc.height]];
    const tr = p.sc.rows;
    let shown = tr;
    if (tr.length > 4) {
      const early = tr.slice(0, tr.length - 3);
      rows.push(['+' + early.length + ' more tricks', early.reduce((a, r) => a + r.points, 0)]);
      shown = tr.slice(-3);
    }
    for (const r of shown) rows.push([r.name + (r.done ? (r.mult > 1 ? ' ×' + r.mult : '') : ' (so close!)'), r.done ? r.points : '✦', !r.done]);
    const landWord = S.classic ? (p.sc.landing === 'stuck' ? 'Clean catch' : 'Squad save') : p.sc.landing === 'stuck' ? 'Stuck landing' : 'Cloud cradle';
    rows.push([landWord, p.sc.landingPoints]);
    return { line: p.line, rows, total: p.sc.total, best: p.newBest ? 0 : S.pad.best, newBest: p.newBest && p.prevBest > 0 };
  }

  function showCard() {
    const p = S.pending;
    S.pending = null;
    const pad = S.pad;
    S.card = true;
    S.cardT = 0;
    S.cardAt = { x: S.pos.x, z: S.pos.z };
    thud.result(cardFor(p), {
      onAgain: () => {
        hideCard();
        again(pad);
      },
    });
  }

  function hideCard() {
    if (!S.card && !thud.root.querySelector('.c9t-word')) return;
    S.card = false;
    thud.result(null);
    thud.banner(null);
    if (!S.active) thud.show(false);
  }

  // "Toss again!": float back to the mat and go.
  function again(pad) {
    if (S.active || !player) return;
    sfx('whoosh', { volume: 0.5 });
    const go = () => {
      if (!S.active && !disposed) start(pad);
    };
    try {
      if (typeof player.teleport === 'function') {
        Promise.resolve(player.teleport(pad.x, pad.z, pad.heading, { fade: true })).then(go, go);
        return;
      }
    } catch (err) { /* below */ }
    player.position.set(pad.x, pad.y, pad.z);
    go();
  }

  function stepLand(dt) {
    const pad = S.pad;
    S.landT += dt;
    if (S.landT > 0.5 && S.pending) showCard();
    const t = S.landT;
    if (S.classic) {
      if (t > 0.95 && t < 1.3) {
        // the bases pop her back onto her feet
        const u = smoothstep(0.95, 1.3, t);
        S.pos.y = S.landY + Math.sin(u * Math.PI) * 0.45 + (pad.y - S.landY) * u;
        setAnim(u < 0.6 ? 'jump' : 'land');
      } else if (t >= 1.3) {
        S.pos.y = pad.y;
        setAnim(t > 1.55 ? 'highV' : 'land');
      }
    } else if (S.landing === 'stuck') {
      if (t > 0.5) setAnim('cheer');
    } else if (t > 1.0) {
      fx.cushionOff();
      const u = smoothstep(1.0, 1.35, t);
      S.pos.y = S.landY + 0.32 * (1 - u) + Math.sin(u * Math.PI) * 0.3;
      setAnim(u < 1 ? 'jump' : 'highV');
    }
    const hold = S.classic ? 2.0 : S.landing === 'stuck' ? 1.9 : 2.1;
    // stick it, then turn to the crowd: she ends up facing home, and the camera behind her sees it
    if (!S.classic && t > hold - 0.5) S.baseHeading = dampAngle(S.baseHeading, pad.heading + Math.PI, 9, dt);
    applyPlayer();
    if (t >= hold) finish();
  }

  function finish() {
    const pad = S.pad;
    if (S.pending) showCard();
    if (S.landing === 'cradle' && !S.classic) S.pos.y = S.landY;
    S.spin = 0;
    applyPlayer();
    S.anim = '';
    setAnim('idle');
    hideBlob(false);
    const rel = S.release;
    S.release = null;
    camera.end(S.baseHeading);
    if (rel) {
      try {
        rel();
      } catch (err) { /* released either way */ }
    }
    S.active = false;
    S.phase = 'idle';
    S.cool = 0.8;
    S.cardT = 0;
    keys.clear();
    if (pad) {
      pad.crew.dip(0);
      pad.crew.watch(null);
      pad.crew.cue('idle');
    }
    fx.ring(0, 0, 0, 0);
    fx.shadow(0, null, 0, null);
    thud.count(null);
    thud.legend(null);
    thud.gauge(null);
    thud.hint(null);
    thud.squad(0);
    thud.banner(null);
    if (!S.card) thud.show(false);
    events.emit('end', { padId: pad ? pad.id : null });
  }

  // End now, safely: whoever is in the air lands softly on the cloud (or back on the mat).
  function cancel() {
    if (!S.active) return;
    const pad = S.pad;
    if (S.phase === 'air' && pad.land) S.pos.set(pad.land.x, pad.land.y, pad.land.z);
    else if (S.phase !== 'land') S.pos.set(pad.x, pad.y, pad.z);
    else if (S.landing === 'cradle' && !S.classic) S.pos.y = S.landY;
    S.trick = null;
    S.queued = null;
    S.pending = null;
    fx.cushionOff();
    fx.trailClear();
    finish();
    hideCard();
  }

  function step(dt) {
    S.t += dt;
    if (S.phase === 'load') stepLoad(dt);
    else if (S.phase === 'count') stepCount(dt);
    else if (S.phase === 'air') stepAir(dt);
    else if (S.phase === 'land') stepLand(dt);
    if (S.phase === 'load' || S.phase === 'count') applyPlayer();
    if (S.active) aimCamera(dt);
  }

  // ------------------------------------------------------------------ input
  const stickZone = (x, y) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    return H >= W ? x < W * 0.55 && y > H * 0.42 : x < W * 0.42 && y > H * 0.22;
  };
  const swipes = createSwipeInput({
    target: window,
    onGesture: (g, info) => gesture(g, info),
    onTrail: (x, y, id) => {
      if (S.active && S.phase !== 'land') thud.trail(x, y, id);
    },
    onTrailEnd: (id) => thud.trailEnd(id),
    maxMsAt: (x, y) => (stickZone(x, y) ? 420 : 1100),
  });
  const KEY_G = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  function onKeyDown(e) {
    if (!S.active || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
      keys.add(e.code);
      return;
    }
    if (e.repeat) return;
    let g = KEY_G[e.code] || null;
    if (!g && (e.code === 'Space' || e.code === 'Enter') && S.phase !== 'load' && S.phase !== 'land') g = 'circle';
    if (!g) return;
    e.preventDefault();
    gesture(g, { dir: 1, key: true });
  }
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ------------------------------------------------------------------ the frame
  function updatePads(dt, t) {
    const pp = player && player.position;
    if (!pp) return;
    for (const pad of pads) pad.dist = Math.hypot(pp.x - pad.x, pp.z - pad.z);
    // bases are drawn for the nearest pads only (one when the room is crowded): the character budget
    const crowd = net && net.players && net.players.size > 6 ? 1 : MAX_CREWS;
    let preview = null;
    for (const pad of pads) {
      const mine = S.active && S.pad === pad;
      let closer = 0;
      for (const o of pads) if (o !== pad && o.dist < pad.dist) closer++;
      const show = mine || (pad.dist < CREW_RANGE && closer < crowd);
      if (show && !pad.crew.ready && makeChar) pad.crew.populate((i) => makeChar(pad, i));
      pad.crew.setVisible(show);
      if (pad.dist < 30 || mine) squad.scan(pad);
      else squad.clear(pad);
      pad.spotT = settleOnSpot(pad.spotT, pad.meSpot >= 0, dt);
      if (pad.dist < 70 || mine) pad.art.update(dt, t);
      if (pad.remote && !mine) squad.stepRemote(pad, dt);
      else if (!mine) pad.crew.cue(onMat(pad) && !basingOn(pad) && !S.active && !(player && player.frozen) ? 'ready' : 'idle');
      const near = pad.dist < 9;
      if (near && !pad.wasNear && !S.active && pad.crew.ready) pad.crew.wave(pp.x, pp.z);
      pad.wasNear = near;
      pad.crew.update(dt, t);
      if (pad.entry) pad.entry.enabled = canOffer(pad);
      if (!S.active && pad.dist < NEAR_PAD && Math.abs(pp.y - pad.y) < 1.5 && (!preview || pad.dist < preview.dist)) preview = pad;
    }
    // the sparkle arc and the landing ring for the pad you are standing at
    if (preview && !S.active) {
      const key = preview.id + ':' + preview.friendCount;
      if (key !== previewKey) {
        previewKey = key;
        const from = { x: preview.x, y: preview.y + TOSS.releaseY, z: preview.z };
        const s = preview.land
          ? solveToss({ from, to: preview.land, friends: preview.friendCount, calm })
          : solveToss({ from, to: { x: preview.x, y: preview.y + TOSS.catchY, z: preview.z }, friends: preview.friendCount, calm, classic: true });
        const pts = [];
        const n = 36;
        for (let i = 0; i < n; i++) {
          const tau = (i / (n - 1)) * s.T * (preview.land ? 1 : 0.5);
          const u = tau / s.T;
          pts.push([s.x0 + (s.x1 - s.x0) * u, heightAt(s, tau) + 0.7, s.z0 + (s.z1 - s.z0) * u]);
        }
        fx.preview(pts);
      }
      if (preview.land) fx.ring(preview.land.x, preview.land.y, preview.land.z, 0.55);
    } else if (!S.active && previewKey) {
      previewKey = '';
      fx.preview(null);
      fx.ring(0, 0, 0, 0);
    }
    // without an interact system, offer the toss through the HUD prompt directly
    if (!interact && hud && typeof hud.prompt === 'function') {
      const offer = pads.find((p) => canOffer(p)) || null;
      if (offer !== promptPad) {
        if (offer) hud.prompt('Basket toss!', () => start(offer));
        else if (typeof hud.clearPrompt === 'function') hud.clearPrompt();
        promptPad = offer;
      }
    }
  }

  function update(dt, t) {
    if (disposed) return;
    dt = Math.min(Math.max(0, dt || 0), 0.05);
    thud.update(dt);
    fx.update(dt, t);
    updatePads(dt, t);
    if (S.active) {
      try {
        step(dt);
      } catch (err) {
        console.error('[c9] the toss tripped, landing safely', err);
        cancel();
      }
    } else if (S.cool > 0) S.cool -= dt;
    squad.update(dt);
    if (S.card && !S.active) {
      S.cardT += dt;
      const p = player && player.position;
      const moved = p && S.cardAt && Math.hypot(p.x - S.cardAt.x, p.z - S.cardAt.z) > 2.5;
      if (S.cardT > 6 || moved) hideCard();
    }
  }

  function dispose() {
    if (disposed) return;
    if (S.active) cancel();
    disposed = true;
    swipes.dispose();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    squad.dispose();
    for (const pad of pads) {
      if (pad.entry && interact && typeof interact.unregister === 'function') interact.unregister('toss-' + pad.id);
      pad.art.dispose();
      pad.crew.dispose();
    }
    if (promptPad && hud && typeof hud.clearPrompt === 'function') hud.clearPrompt();
    fx.dispose();
    thud.dispose();
  }

  return {
    update,
    on: events.on.bind(events),
    off: events.off.bind(events),
    cancel,
    dispose,
    get active() { return S.active; },
    get pads() {
      return pads.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, heading: p.heading, target: p.land ? { x: p.land.x, y: p.land.y, z: p.land.z } : null, best: p.best }));
    },
    get state() {
      return {
        active: S.active, phase: S.phase, pad: S.pad ? S.pad.id : null, tau: S.tau, airT: S.airT,
        T: S.sol ? S.sol.T : 0, tUp: S.sol ? S.sol.tUp : 0, apex: S.sol ? S.sol.apex : 0, classic: S.classic,
        pos: [S.pos.x, S.pos.y, S.pos.z], trick: S.trick ? S.trick.def.id : null, tricks: S.tricks.map((t) => ({ id: t.id, done: t.done })),
        chain: S.chain, landing: S.landing, friends: S.friends, anim: S.anim, steer: [S.steer.x, S.steer.z],
        inApex: S.sol && S.phase === 'air' ? inApex(S.sol, S.tau) : false, basing: squad.basing, card: S.card,
        crews: pads.map((p) => ({ id: p.id, visible: p.crew.visible, ready: p.crew.ready, cue: p.crew.cueName, friends: p.friendCount, meSpot: p.meSpot })),
      };
    },
    _start(i = 0) {
      const pad = pads[i];
      if (!pad || !player) return false;
      if (!onMat(pad)) player.position.set(pad.x, pad.y, pad.z);
      return start(pad);
    },
    _gesture(g, info) {
      gesture(g, info || { dir: 1 });
    },
    _friendsAt(i) {
      return pads[i] ? pads[i].friendCount : 0;
    },
  };
}
