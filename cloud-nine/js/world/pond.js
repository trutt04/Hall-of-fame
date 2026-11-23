// The duck pond on the east lawn: a mama duck with four fluffy ducklings paddling after her in a
// wobbly line, a mallard drake and a white duck. They swim slow loops and bob, now and then dabble
// (tail up), preen, shake and quack; the ducklings do happy little spins. Stand on the dock or by the
// water: "Feed the ducks!" opens a tiny snack picker (Bread, Peas, Corn). She tosses, crumbs arc into
// the water and float, the nearest ducks paddle over quickly, eat and quack, and hearts pop up. A big
// feed (several in a row) makes the mama duck flap her wings for joy.
// In a room, each toss sends an 'fx' { kind: 'ducks', snack, x, z }: every device shows the crumbs and
// its own ducks rush over (the ducks are simulated on each device, which is fine: ducks are ducks).
//
//   import { installPond } from './world/pond.js'
//   const pond = installPond(world, { name })   once the world exists (main.js); null with no pond
//       name: the sign's words (the gift link's pondName on this device), 'Duck Pond' otherwise
//   pond.open()            the snack picker (the prompt does this)        pond.close()
//   pond.feed(snackId)     toss a snack (the picker's buttons; ignored during the short cooldown)
//   pond.active            the picker is open        pond.setName(name)   re-draws the sign
//   pond.ducks             [{ id, kind, x, z, act }] (tests)      pond.crumbsAfloat (tests)
//   pond.stats             { drawCalls, triangles }   pond.dispose()
//
// Pure parts (node tests, no three.js state, no DOM):
//   DUCK_SNACKS, SNACK_IDS, DUCK_FACT, POND_NAME
//   cleanDuckFx(data, pond) -> { snack, x, z } | null     untrusted 'fx' from the network: a known
//                                     snack, finite numbers, the point pulled inside the water
//   createFxGate({ gap, burst, per, max }) -> { allow(id, nowSeconds) }   spam stays out (per sender)
//   followStep(f, lead, spacing, dt, speed)   one step of a duckling on its string behind the duck ahead
//   clampToPond(pond, x, z, margin, out)      a point inside the water
//   pondNameOk(name) -> string | null          the sign's name, as drawn (24 characters at most)

import { buildPondArt } from '../art/pond-art.js';
import { createDuckMeshes } from '../art/duck.js';
import { makePond } from '../art/island-layout.js';
import { el, onTap, loadCss, reducedMotion } from '../ui/dom.js';

// ------------------------------------------------------------------------------------------ data

export const DUCK_SNACKS = Object.freeze([
  Object.freeze({ id: 'bread', label: 'Bread', icon: '\u{1F35E}', color: 0xeab877, fave: true }),
  Object.freeze({ id: 'peas', label: 'Peas', icon: '\u{1F7E2}', color: 0x7fd05a }),
  Object.freeze({ id: 'corn', label: 'Corn', icon: '\u{1F33D}', color: 0xffd23f }),
]);
export const SNACK_IDS = Object.freeze(DUCK_SNACKS.map((s) => s.id));
export const DUCK_FACT = 'Psst: ducks love peas and corn too!';
export const POND_NAME = 'Duck Pond';
export const POND_NAME_MAX = 24;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;
const FX_REACH = 14; // a toss lands within this far beyond the water's edge, or it is junk

export function pondNameOk(name) {
  if (typeof name !== 'string') return null;
  const s = name.replace(/\s+/g, ' ').trim();
  return s && s.length <= POND_NAME_MAX ? s : null;
}

export function clampToPond(pond, x, z, margin = 0.6, out = { x: 0, z: 0 }) {
  const dx = x - pond.x;
  const dz = z - pond.z;
  const d = Math.hypot(dx, dz);
  const lim = Math.max(0, pond.r - margin);
  const k = d > lim ? lim / d : 1;
  out.x = pond.x + dx * k;
  out.z = pond.z + dz * k;
  return out;
}

export function cleanDuckFx(data, pond) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.kind !== 'ducks') return null;
  if (!pond || !fin(pond.x) || !fin(pond.z) || !fin(pond.r)) return null;
  const snack = typeof data.snack === 'string' && SNACK_IDS.includes(data.snack) ? data.snack : null;
  if (!snack) return null;
  if (!fin(data.x) || !fin(data.z) || Math.abs(data.x) > 1e4 || Math.abs(data.z) > 1e4) return null;
  if (Math.hypot(data.x - pond.x, data.z - pond.z) > pond.r + FX_REACH) return null; // nobody throws that far
  const p = clampToPond(pond, data.x, data.z, 0.7);
  return { snack, x: round2(p.x), z: round2(p.z) };
}

// At most `burst` tosses per `per` seconds from one sender, never closer than `gap` apart. Remembers
// at most `max` senders (the oldest is forgotten).
export function createFxGate({ gap = 0.45, burst = 4, per = 5, max = 24 } = {}) {
  const seen = new Map(); // id -> { tokens, at, last }
  return {
    allow(id, now) {
      if (typeof id !== 'string' || !id || !fin(now)) return false;
      let s = seen.get(id);
      if (!s) {
        if (seen.size >= max) seen.delete(seen.keys().next().value);
        s = { tokens: burst, at: now, last: -Infinity };
        seen.set(id, s);
      }
      s.tokens = Math.min(burst, s.tokens + Math.max(0, now - s.at) * (burst / per));
      s.at = now;
      if (now - s.last < gap || s.tokens < 1) return false;
      s.tokens -= 1;
      s.last = now;
      return true;
    },
    get size() { return seen.size; },
  };
}

// A duckling on a string `spacing` long behind the duck ahead: when the string goes taut it paddles
// after it (faster the farther behind it is), and when it is close it just drifts. Turns it to face
// the duck ahead. Changes f (x, z, h); returns the distance it moved.
export function followStep(f, lead, spacing, dt, speed = 0.9) {
  const dx = lead.x - f.x;
  const dz = lead.z - f.z;
  const d = Math.hypot(dx, dz);
  if (!(d > 1e-6) || !(dt > 0)) return 0;
  if (d > spacing * 0.7) f.h = Math.atan2(dx, dz);
  if (d <= spacing) return 0;
  const behind = d - spacing;
  const step = Math.min(behind, speed * (1 + behind * 2.5) * dt);
  f.x += (dx / d) * step;
  f.z += (dz / d) * step;
  return step;
}

// ------------------------------------------------------------------------------------- behaviour

const FEED_GAP = 0.55; // seconds between two tosses (a double tap is one toss)
const CRUMBS_PER_TOSS = 6;
const BIG_FEED = 3; // tosses within BIG_WINDOW make the mama duck flap for joy
const BIG_WINDOW = 9;
const TOSS_REACH = 2.6; // how far out over the water her crumbs land
const PROMPT_REACH = 1.7; // from the rim stones: "Feed the ducks!"

const ACT = { swim: 0, chase: 1, eat: 2, dabble: 3, preen: 4, shake: 5, spin: 6, flap: 7, quack: 8 };

export function installPond(world, opts = {}) {
  const place = world && world.places && world.places.pond;
  if (!place || !fin(place.x) || !fin(place.z) || !fin(place.r)) return null;
  const { scene, player, hud, interact, net } = world;
  if (!scene || !player || !hud || !interact) return null;
  const plan = world.island && world.island.plan && world.island.plan.pond && world.island.plan.pond.dock
    ? world.island.plan.pond
    : makePond({ x: place.x, z: place.z, r: place.r, facing: fin(place.facing) ? place.facing : 0, y: groundY(world, place.x, place.z) });
  const calm = reducedMotion();
  const M = calm ? 0.2 : 1;
  const W = plan.water;
  const R = plan.r;

  // ---------------------------------------------------------------- art
  let name = pondNameOk(opts.name) || POND_NAME;
  const art = buildPondArt(plan, { quality: world.quality, name });
  scene.add(art.group);
  const flock = createDuckMeshes({ hen: 2, drake: 1, duckling: 4 });
  for (const k of ['hen', 'drake', 'duckling']) art.group.add(flock.meshes[k]);
  flock.setBounds(plan.x, W + 0.3, plan.z, R + 1);
  flock.tint('hen', 0, 0xc9a07c); // the mama: a warm brown hen
  flock.tint('hen', 1, 0xffffff); // the white duck

  // ---------------------------------------------------------------- the ducks
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mk = (id, kind, i, scale, loopR, dir) => {
    const a = rnd() * Math.PI * 2;
    return {
      id, kind, i, scale, x: plan.x + Math.sin(a) * R * loopR, z: plan.z + Math.cos(a) * R * loopR, h: a + dir * Math.PI / 2,
      speed: 0, act: ACT.swim, actT: 0, actDur: 0, crumb: -1, loopA: a, loopR, dir, ph: rnd() * 10, idleT: 2 + rnd() * 6,
      lift: 0, spin: 0, wingL: 0, wingR: 0, headP: 0, headY: 0, pitch: 0, roll: 0, wake: rnd(), lead: null,
    };
  };
  // a little bigger than real ducks, so they read on a phone across the pond
  const mama = mk('mama', 'hen', 0, 1.3, 0.55, 1);
  const ducks = [mama, mk('white', 'hen', 1, 1.25, 0.62, -1), mk('drake', 'drake', 0, 1.34, 0.4, -1)];
  const babies = [];
  for (let i = 0; i < 4; i++) {
    const b = mk('duckling' + (i + 1), 'duckling', i, 0.6, 0.5, 1);
    const lead = i ? babies[i - 1] : mama;
    b.lead = lead;
    b.x = mama.x - Math.sin(mama.h) * 0.5 * (i + 1);
    b.z = mama.z - Math.cos(mama.h) * 0.5 * (i + 1);
    babies.push(b);
    ducks.push(b);
  }
  const SPACING = 0.5;

  // ---------------------------------------------------------------- crumbs, ripples, hearts
  const crumbs = [];
  for (let i = 0; i < art.crumbs.max; i++) crumbs.push({ on: false, fly: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, snack: 0, by: null, ph: i });
  const ripples = [];
  for (let i = 0; i < art.ripples.max; i++) ripples.push({ on: false, x: 0, z: 0, t: 0, dur: 1, size: 1 });
  const hearts = [];
  for (let i = 0; i < art.hearts.max; i++) hearts.push({ on: false, x: 0, y: 0, z: 0, t: 0, dur: 1, c: 0 });
  const HEART_COLS = [[1, 0.18, 0.58], [1, 0.55, 0.78], [0.8, 0.7, 1]];
  const SNACK_RGB = DUCK_SNACKS.map((s) => [((s.color >> 16) & 255) / 255, ((s.color >> 8) & 255) / 255, (s.color & 255) / 255]);
  let ripTurn = 0;
  let heartTurn = 0;
  function ripple(x, z, size, dur) {
    const r = ripples[ripTurn];
    ripTurn = (ripTurn + 1) % ripples.length;
    r.on = true;
    r.x = x;
    r.z = z;
    r.t = 0;
    r.size = size;
    r.dur = dur;
  }
  function heart(x, y, z) {
    const h = hearts[heartTurn];
    heartTurn = (heartTurn + 1) % hearts.length;
    h.on = true;
    h.x = x + (rnd() - 0.5) * 0.2;
    h.y = y;
    h.z = z + (rnd() - 0.5) * 0.2;
    h.t = 0;
    h.dur = 1.3 + rnd() * 0.4;
    h.c = Math.floor(rnd() * HEART_COLS.length);
  }
  const hold = { x: 0, z: 0 };
  function throwCrumbs(fx, fy, fz, tx, tz, snack) {
    const si = Math.max(0, SNACK_IDS.indexOf(snack));
    for (let k = 0; k < CRUMBS_PER_TOSS; k++) {
      let c = crumbs.find((q) => !q.on);
      if (!c) {
        // all out on the water: the oldest one makes room
        c = crumbs.reduce((a, b) => (b.age > a.age ? b : a), crumbs[0]);
      }
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * 0.85;
      clampToPond(plan, tx + Math.sin(a) * d, tz + Math.cos(a) * d, 0.35, hold);
      const T = 0.7 + rnd() * 0.25;
      c.on = true;
      c.fly = true;
      c.x = fx;
      c.y = fy;
      c.z = fz;
      c.vx = (hold.x - fx) / T;
      c.vz = (hold.z - fz) / T;
      c.vy = (W - fy + 0.5 * 9.8 * T * T) / T;
      c.age = 0;
      c.snack = si;
      c.by = null;
    }
  }
  const crumbsAfloat = () => crumbs.filter((c) => c.on && !c.fly).length;

  // ---------------------------------------------------------------- sound: a tiny quack on the game's audio context
  let quackAt = 0;
  function quack(x, z, kind, n = 1) {
    if (clock - quackAt < 0.3) return;
    const a = world.audio;
    const real = a && a.real;
    const ctx = real && real.context;
    if (!a || !a.enabled || !ctx || ctx.state !== 'running' || !real.unlocked) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const p = player.position;
    const d = Math.hypot(x - p.x, z - p.z);
    const level = 0.2 / (1 + (d / 12) * (d / 12));
    if (level < 0.012) return;
    quackAt = clock;
    try {
      const baby = kind === 'duckling';
      for (let k = 0; k < n; k++) {
        const t = ctx.currentTime + 0.01 + k * (baby ? 0.13 : 0.2);
        const osc = ctx.createOscillator();
        const bp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        const f0 = baby ? 2300 + rnd() * 400 : 430 + rnd() * 80;
        osc.type = baby ? 'triangle' : 'sawtooth';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(baby ? f0 * 1.25 : f0 * 0.7, t + (baby ? 0.08 : 0.15));
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(baby ? 2800 : 1150, t);
        bp.Q.value = baby ? 1.2 : 3.2;
        const dur = baby ? 0.09 : 0.17;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level * (baby ? 0.5 : 1), t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        osc.onended = () => {
          try {
            osc.disconnect();
            bp.disconnect();
            g.disconnect();
          } catch (err) { /* gone already */ }
        };
      }
    } catch (err) { /* a sound never stops the pond */ }
  }
  const sfx = (n, o) => {
    try {
      if (world.audio) world.audio.sfx(n, o);
    } catch (err) { /* sound is a bonus */ }
  };

  // ---------------------------------------------------------------- the prompt: "Feed the ducks!"
  const near = { x: 0, y: 0, z: 0 };
  function promptSpot() {
    const p = player.position;
    const dx = p.x - plan.x;
    const dz = p.z - plan.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < R + 0.6) {
      // on the dock: right where she stands
      near.x = p.x;
      near.z = p.z;
      near.y = p.y;
      return near;
    }
    near.x = plan.x + (dx / d) * (R + 0.6);
    near.z = plan.z + (dz / d) * (R + 0.6);
    near.y = plan.y;
    return near;
  }
  const entry = interact.register({
    id: 'duckPond', position: promptSpot, radius: PROMPT_REACH, label: 'Feed the ducks!', icon: '\u{1F986}',
    priority: 1, object3D: art.water, height: 1.6, onUse: () => open(),
  });

  // ---------------------------------------------------------------- the snack picker
  let ui = null;
  let lineEl = null;
  let factShown = false;
  const buttons = {};
  function ensureUi() {
    if (ui) return ui;
    ui = el('div', 'c9pond');
    ui.setAttribute('role', 'dialog');
    ui.setAttribute('aria-label', 'Feed the ducks');
    ui.hidden = true;
    const head = el('div', 'c9pond-head');
    head.append(el('span', 'c9pond-title', 'Feed the ducks!'));
    const done = el('button', 'c9pond-done', 'Done');
    done.type = 'button';
    onTap(done, () => close());
    head.append(done);
    const row = el('div', 'c9pond-snacks');
    DUCK_SNACKS.forEach((s, i) => {
      const b = el('button', 'c9pond-snack' + (s.fave ? ' c9pond-fave' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', 'Toss ' + s.label + (s.fave ? ', their favourite' : ''));
      b.append(el('span', 'c9pond-emoji', s.icon), el('span', 'c9pond-label', s.label));
      if (s.fave) b.append(el('span', 'c9pond-tag', 'Fave!'));
      b.append(el('span', 'c9pond-key', String(i + 1)));
      onTap(b, () => feed(s.id));
      buttons[s.id] = b;
      row.append(b);
    });
    lineEl = el('p', 'c9pond-line', '');
    lineEl.setAttribute('aria-live', 'polite');
    ui.append(head, row, lineEl);
    document.body.appendChild(ui);
    return ui;
  }
  function say(text) {
    if (lineEl) lineEl.textContent = text;
  }

  // ---------------------------------------------------------------- open, feed, close
  let phase = 'idle'; // 'idle' | 'open'
  let release = null;
  let current = SNACK_IDS[0];
  let nextFeed = 0;
  let pendingToss = null; // { at, snack, tx, tz }: her arm is still swinging
  let animBackAt = 0;
  const feeds = [];
  let lastFlapAt = -1e9;
  let fedEver = false;
  let clock = 0;
  const inRoom = () => !!(world.session && world.session.kind === 'room');
  const free = () => world.mode === 'play' && !player.controller && !player.rescuing && !(world.toss && world.toss.active)
    && !world.activeGame && !world.hitZero && !(world.booth && world.booth.active) && !hud.isModalOpen();
  const promptFn = () => feed(current);

  async function open() {
    if (phase !== 'idle' || !free()) return;
    phase = 'open';
    entry.enabled = false;
    if (typeof hud.closeWheel === 'function') hud.closeWheel();
    if (typeof hud.hideHint === 'function') hud.hideHint();
    release = player.takeControl('duckPond');
    const p = player.position;
    player.heading = Math.atan2(plan.x - p.x, plan.z - p.z);
    player.setAnim('idle');
    await loadCss('css/pond.css');
    if (phase !== 'open') return;
    ensureUi();
    ui.hidden = false;
    ui.classList.remove('c9pond-in');
    void ui.offsetWidth;
    ui.classList.add('c9pond-in');
    hud.setBusy(true);
    hud.prompt('Toss ' + DUCK_SNACKS[0].label + '!', promptFn, { icon: DUCK_SNACKS[0].icon });
    say(factShown ? 'Pick a snack and toss it in!' : DUCK_FACT);
    factShown = true;
    sfx('open', { volume: 0.45 });
    quack(plan.x, plan.z, 'hen', 2);
  }

  function close() {
    if (phase === 'idle') return;
    phase = 'idle';
    pendingToss = null;
    if (ui) ui.hidden = true;
    hud.clearPrompt(promptFn);
    hud.setBusy(false);
    if (release) {
      release();
      release = null;
    }
    entry.enabled = true;
  }

  // the point on the water ~2.6 m out in front of her
  function tossTarget(out) {
    const p = player.position;
    const h = player.heading;
    return clampToPond(plan, p.x + Math.sin(h) * TOSS_REACH, p.z + Math.cos(h) * TOSS_REACH, 0.7, out);
  }

  function feed(snackId) {
    if (phase !== 'open' || !SNACK_IDS.includes(snackId)) return false;
    if (clock < nextFeed || pendingToss) return false; // a double tap is one toss
    nextFeed = clock + FEED_GAP;
    current = snackId;
    const s = DUCK_SNACKS[SNACK_IDS.indexOf(snackId)];
    hud.prompt('Toss ' + s.label + '!', promptFn, { icon: s.icon });
    for (const id of SNACK_IDS) if (buttons[id]) buttons[id].classList.toggle('c9pond-picked', id === snackId);
    // face the water, then swing
    const p = player.position;
    const t = tossTarget({ x: 0, z: 0 });
    player.heading = Math.atan2(t.x - p.x, t.z - p.z);
    player.setAnim('throw', { loop: false });
    animBackAt = clock + 0.9;
    pendingToss = { at: clock + 0.28, snack: snackId, tx: t.x, tz: t.z };
    sfx('whoosh', { volume: 0.25, pitch: 1.4 });
    return true;
  }

  function launchToss(tq) {
    const p = player.position;
    const h = player.heading;
    throwCrumbs(p.x + Math.sin(h) * 0.35, p.y + 1.35, p.z + Math.cos(h) * 0.35, tq.tx, tq.tz, tq.snack);
    sfx('pop', { volume: 0.35, pitch: 1.5 });
    if (inRoom() && net && typeof net.send === 'function') {
      try {
        net.send('fx', { kind: 'ducks', snack: tq.snack, x: round2(tq.tx), z: round2(tq.tz) });
      } catch (err) { /* friends just miss this one */ }
    }
    // a big feed: three tosses close together
    feeds.push(clock);
    while (feeds.length && clock - feeds[0] > BIG_WINDOW) feeds.shift();
    const s = DUCK_SNACKS[SNACK_IDS.indexOf(tq.snack)] || DUCK_SNACKS[0];
    if (feeds.length >= BIG_FEED && clock - lastFlapAt > 12) {
      lastFlapAt = clock;
      startAct(mama, ACT.flap, 1.8);
      say(line('ducks', 'The ducks say thank you! Quack quack!'));
      setTimeout(() => {
        if (phase === 'open' || clock - lastFlapAt < 4) world.spawnBurst(mama.x, W + 0.8, mama.z, { count: calm ? 8 : 22, speed: 2.4, colors: [0xff8cc6, 0xffffff, 0xffd84a] });
      }, 500);
    } else {
      say(s.id === 'bread' ? 'Bread! Their favourite. Here they come!' : s.label + '! Yum for ducks. Here they come!');
    }
    if (!fedEver) {
      fedEver = true;
      if (world.todo && typeof world.todo.tick === 'function') world.todo.tick('ducks');
    }
  }
  function line(situation, fallback) {
    try {
      const l = world.content && typeof world.content.hype === 'function' ? world.content.hype(situation, { name: world.nick }) : '';
      return typeof l === 'string' && l ? l : fallback;
    } catch (err) {
      return fallback;
    }
  }

  // ---------------------------------------------------------------- friends' tosses ('fx')
  const gate = createFxGate();
  function onEvent(ev) {
    if (!ev || ev.type !== 'fx' || !net || !ev.data || ev.data.kind !== 'ducks') return;
    const me = net.me;
    if (me && ev.from === me.id) return;
    if (!inRoom() || !net.players || !net.players.has(ev.from)) return; // only from someone in my room
    const fx = cleanDuckFx(ev.data, plan);
    if (!fx || !gate.allow(String(ev.from), clock)) return;
    // from the friend's hand when this device sees them, else dropped from just above the water
    let from = null;
    try {
      from = world.peers && typeof world.peers.positionOf === 'function' ? world.peers.positionOf(ev.from) : null;
    } catch (err) {
      from = null;
    }
    if (from && fin(from.x) && Math.hypot(from.x - fx.x, from.z - fx.z) < R + 6) throwCrumbs(from.x, (from.y || plan.y) + 1.35, from.z, fx.x, fx.z, fx.snack);
    else throwCrumbs(fx.x, W + 2.2, fx.z, fx.x, fx.z, fx.snack);
  }
  if (net && typeof net.on === 'function') net.on('event', onEvent);
  const onModal = (openNow) => {
    if (openNow && phase === 'open') close();
  };
  if (typeof hud.on === 'function') hud.on('modal', onModal);
  const onDigit = (n) => {
    if (phase === 'open' && n >= 1 && n <= SNACK_IDS.length) feed(SNACK_IDS[n - 1]);
  };
  if (world.input && typeof world.input.on === 'function') world.input.on('digit', onDigit);

  // ---------------------------------------------------------------- the simulation
  function startAct(d, act, dur) {
    d.act = act;
    d.actT = 0;
    d.actDur = dur;
  }
  function nearestCrumb(d) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < crumbs.length; i++) {
      const c = crumbs[i];
      if (!c.on || c.fly || (c.by && c.by !== d)) continue;
      const dist = Math.hypot(c.x - d.x, c.z - d.z);
      if (dist < bd) {
        bd = dist;
        best = i;
      }
    }
    return best;
  }
  function steer(d, tx, tz, speed, turn, dt) {
    const want = Math.atan2(tx - d.x, tz - d.z);
    let dh = want - d.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    d.h += Math.max(-turn * dt, Math.min(turn * dt, dh));
    d.speed += (speed - d.speed) * Math.min(1, dt * 3);
    const go = d.speed * Math.max(0.15, Math.cos(dh));
    d.x += Math.sin(d.h) * go * dt;
    d.z += Math.cos(d.h) * go * dt;
  }
  const keep = { x: 0, z: 0 };
  function keepIn(d, margin) {
    clampToPond(plan, d.x, d.z, margin, keep);
    d.x = keep.x;
    d.z = keep.z;
  }
  // the dock sticks out over the water: ducks paddle round it
  const dk = plan.dock;
  const dkC = Math.cos(dk.facing);
  const dkS = Math.sin(dk.facing);
  function offDock(d) {
    const dx = d.x - dk.x;
    const dz = d.z - dk.z;
    const lx = dx * dkC - dz * dkS;
    const lz = dx * dkS + dz * dkC;
    const hw = dk.w / 2 + 0.35;
    const hd = dk.d / 2 + 0.35;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) return;
    // out the nearer side
    const nx = lx < 0 ? -hw : hw;
    const ox = nx - lx;
    d.x += ox * dkC;
    d.z -= ox * dkS;
  }

  function idleAct(d) {
    const r = rnd();
    if (d.kind === 'duckling') {
      if (r < 0.45) startAct(d, ACT.spin, 1.0);
      else if (r < 0.75) startAct(d, ACT.quack, 0.5);
      else startAct(d, ACT.shake, 0.7);
    } else if (r < 0.3) startAct(d, ACT.dabble, 2.2);
    else if (r < 0.55) startAct(d, ACT.preen, 1.8);
    else if (r < 0.75) startAct(d, ACT.shake, 0.9);
    else startAct(d, ACT.quack, 0.6);
    d.idleT = 4 + rnd() * 7;
  }

  function simDuck(d, dt, t) {
    const busy = d.act !== ACT.swim && d.act !== ACT.chase;
    if (busy) {
      d.actT += dt;
      if (d.act === ACT.eat && d.crumb >= 0 && d.actT > 0.25) {
        const c = crumbs[d.crumb];
        if (c.on && c.by === d) {
          c.on = false;
          heart(d.x, W + 0.35 + d.scale * 0.3, d.z);
          if (rnd() < 0.5) heart(d.x, W + 0.45, d.z);
          ripple(c.x, c.z, 0.5, 0.9);
          if (rnd() < 0.55) quack(d.x, d.z, d.kind, d.kind === 'duckling' ? 2 : 1);
          // sometimes a duckling spins for joy right after
          if (d.kind === 'duckling' && rnd() < 0.35) {
            d.crumb = -1;
            startAct(d, ACT.spin, 0.9);
            return;
          }
        }
        d.crumb = -1;
      }
      if (d.act === ACT.quack && d.actT < dt * 1.5) quack(d.x, d.z, d.kind, d.kind === 'duckling' ? 2 : 1 + (rnd() < 0.4 ? 1 : 0));
      if (d.act === ACT.flap && d.actT < dt * 1.5) quack(d.x, d.z, d.kind, 2);
      if (d.actT >= d.actDur) {
        d.act = ACT.swim;
        d.spin = 0;
      }
      // ducklings keep up with mama even mid-spin
      if (d.lead && d.act === ACT.spin) followStep(d, d.lead, SPACING, dt, 0.5);
      d.speed *= Math.max(0, 1 - dt * 2);
      d.x += Math.sin(d.h) * d.speed * dt;
      d.z += Math.cos(d.h) * d.speed * dt;
      return;
    }
    // a crumb on the water: paddle over quickly
    let ci = d.crumb >= 0 && crumbs[d.crumb].on && crumbs[d.crumb].by === d ? d.crumb : -1;
    if (ci < 0) {
      d.crumb = -1;
      const n = nearestCrumb(d);
      // ducklings only dash for crumbs near them; they stay close to mama
      if (n >= 0 && (d.kind !== 'duckling' || Math.hypot(crumbs[n].x - d.x, crumbs[n].z - d.z) < 2.2)) {
        ci = n;
        d.crumb = n;
        crumbs[n].by = d;
      }
    }
    if (ci >= 0) {
      const c = crumbs[ci];
      d.act = ACT.chase;
      const reach = 0.22 * (d.kind === 'duckling' ? 1.2 : 1);
      // the bill is a little ahead of the body
      const bx = d.x + Math.sin(d.h) * 0.3 * d.scale;
      const bz = d.z + Math.cos(d.h) * 0.3 * d.scale;
      if (Math.hypot(c.x - bx, c.z - bz) < reach || Math.hypot(c.x - d.x, c.z - d.z) < reach) {
        startAct(d, ACT.eat, 0.75);
        return;
      }
      steer(d, c.x, c.z, d.kind === 'duckling' ? 0.85 : 1.15, 5, dt);
      return;
    }
    d.act = ACT.swim;
    if (d.lead) {
      // a duckling: on its string behind the duck ahead
      followStep(d, d.lead, SPACING, dt, 0.8);
      d.speed = 0;
    } else {
      d.loopA += d.dir * dt * (0.07 + 0.02 * Math.sin(t * 0.13 + d.ph));
      const rr = R * (d.loopR + 0.12 * Math.sin(d.loopA * 2 + d.ph));
      steer(d, plan.x + Math.sin(d.loopA) * rr, plan.z + Math.cos(d.loopA) * rr, 0.3, 1.2, dt);
    }
    d.idleT -= dt;
    if (d.idleT <= 0 && !crumbsAfloatFast) idleAct(d);
  }

  let crumbsAfloatFast = 0;
  function update(dt, t) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    clock += dt;
    // the picker closes when something else takes over
    if (phase === 'open') {
      const away = world.mode !== 'play' || world.activeGame || world.hitZero || (world.toss && world.toss.active)
        || (world.booth && world.booth.active) || hud.isModalOpen() || player.rescuing;
      if (away) close();
    }
    if (pendingToss && clock >= pendingToss.at) {
      const tq = pendingToss;
      pendingToss = null;
      if (phase === 'open') launchToss(tq);
    }
    if (animBackAt && clock >= animBackAt) {
      animBackAt = 0;
      if (phase === 'open') player.setAnim('idle');
    }
    // crumbs: flying, then floating
    crumbsAfloatFast = 0;
    for (let i = 0; i < crumbs.length; i++) {
      const c = crumbs[i];
      if (!c.on) continue;
      c.age += dt;
      if (c.fly) {
        c.vy -= 9.8 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        if (c.y <= W + 0.02 && c.vy < 0) {
          c.fly = false;
          c.y = W + 0.02;
          ripple(c.x, c.z, 0.45, 0.8);
        }
      } else {
        crumbsAfloatFast++;
        c.x += Math.sin(t * 0.4 + c.ph) * 0.02 * dt;
        c.z += Math.cos(t * 0.37 + c.ph) * 0.02 * dt;
        if (c.age > 40) c.on = false;
      }
    }
    // ducks
    for (let i = 0; i < ducks.length; i++) {
      const d = ducks[i];
      simDuck(d, dt, t);
      offDock(d);
      keepIn(d, d.kind === 'duckling' ? 0.45 : 0.6);
    }
    // keep the grown-ups from swimming through each other
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < ducks.length; j++) {
        const a = ducks[i];
        const b = ducks[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = j < 3 ? 0.75 : 0.5;
        if (d > 1e-4 && d < min) {
          const k = (min - d) / d / 2;
          a.x -= dx * k;
          a.z -= dz * k;
          b.x += dx * k;
          b.z += dz * k;
        }
      }
    }
    pose(t, dt);
    art.update(dt, t);
  }

  // ---------------------------------------------------------------- drawing
  function pose(t, dt) {
    for (let i = 0; i < ducks.length; i++) {
      const d = ducks[i];
      const u = d.actDur > 0 ? Math.min(1, d.actT / d.actDur) : 0;
      const env = Math.sin(Math.PI * u); // 0 -> 1 -> 0 over the action
      let y = W - 0.02 + Math.sin(t * 2.1 + d.ph) * 0.014 * M;
      let pitch = Math.sin(t * 1.7 + d.ph) * 0.03 * M;
      let roll = Math.sin(t * 3.1 + d.ph) * 0.035 * M;
      let wingL = 0;
      let wingR = 0;
      let headP = Math.sin(t * 2.6 + d.ph) * 0.07 * M;
      let headY = 0;
      let yaw = d.h;
      switch (d.act) {
        case ACT.chase:
          headP = 0.15 + Math.sin(t * 9 + d.ph) * 0.08 * M;
          roll = Math.sin(t * 9 + d.ph) * 0.06 * M;
          break;
        case ACT.eat:
          pitch = 0.45 * env;
          headP = 0.9 * env;
          y -= 0.03 * env;
          break;
        case ACT.dabble: {
          const k = Math.min(1, Math.min(u, 1 - u) * 5);
          pitch = 1.25 * k;
          headP = 0.6 * k;
          y -= 0.06 * k;
          roll = Math.sin(t * 7) * 0.06 * k * M;
          break;
        }
        case ACT.preen: {
          const side = d.ph > 5 ? 1 : -1;
          headY = side * 2.3 * env;
          headP = 0.55 * env;
          if (side > 0) wingL = 0.45 * env;
          else wingR = 0.45 * env;
          break;
        }
        case ACT.shake:
          roll = Math.sin(d.actT * 38) * 0.28 * env * (calm ? 0.3 : 1);
          wingL = wingR = 0.35 * env * Math.abs(Math.sin(d.actT * 30));
          headY = Math.sin(d.actT * 30) * 0.4 * env;
          break;
        case ACT.spin: {
          const e = u * u * (3 - 2 * u);
          yaw = d.h + e * Math.PI * 2 * (calm ? 0 : 1);
          y += Math.sin(Math.PI * u) * 0.06 * M;
          wingL = wingR = 0.6 * env;
          if (calm) headP = -0.3 * env;
          break;
        }
        case ACT.flap: {
          const f = Math.abs(Math.sin(d.actT * 14));
          y += 0.1 * env;
          pitch = -0.45 * env;
          wingL = wingR = (0.25 + 1.15 * f) * env * (calm ? 0.5 : 1);
          headP = -0.4 * env;
          break;
        }
        case ACT.quack:
          headP = -0.25 * env + Math.sin(d.actT * 24) * 0.12 * env;
          break;
        default:
          break;
      }
      // a duckling waddles from side to side on the water
      let x = d.x;
      let z = d.z;
      if (d.kind === 'duckling') {
        const w = Math.sin(t * 2.4 + d.i * 1.3) * 0.05 * M;
        x += Math.cos(d.h) * w;
        z -= Math.sin(d.h) * w;
      }
      flock.set(d.kind, d.i, x, y, z, yaw, pitch, roll, d.scale, wingL, wingR, headP, headY);
      // a soft wake behind a duck on the move
      d.wake -= dt;
      if (d.wake <= 0) {
        d.wake = d.act === ACT.chase ? 0.35 : 1.4 + rnd();
        if (d.speed > 0.15 || d.act === ACT.dabble || d.act === ACT.flap) ripple(d.x - Math.sin(d.h) * 0.2 * d.scale, d.z - Math.cos(d.h) * 0.2 * d.scale, 0.55 * d.scale + 0.2, 1.4);
      }
    }
    flock.commit();
    // crumbs
    let top = 0;
    for (let i = 0; i < crumbs.length; i++) {
      const c = crumbs[i];
      if (!c.on) {
        art.crumbs.hide(i);
        continue;
      }
      const col = SNACK_RGB[c.snack] || SNACK_RGB[0];
      const s = c.snack === 0 ? 0.055 : 0.04;
      const y = c.fly ? c.y : W + 0.015 + Math.sin(t * 2 + c.ph) * 0.006;
      art.crumbs.set(i, c.x, y, c.z, s, c.ph + t * (c.fly ? 6 : 0), col[0], col[1], col[2]);
      top = i + 1;
    }
    art.crumbs.commit(top);
    // ripples (additive: the colour fades them)
    top = 0;
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      if (!r.on) {
        art.ripples.hide(i);
        continue;
      }
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) {
        r.on = false;
        art.ripples.hide(i);
        continue;
      }
      const f = (1 - u) * (1 - u) * 0.55;
      art.ripples.set(i, r.x, W + 0.008, r.z, 0.12 + r.size * u, 0, f, f, f);
      top = i + 1;
    }
    art.ripples.commit(top);
    // hearts float up, facing the camera
    top = 0;
    const cam = world.camera;
    for (let i = 0; i < hearts.length; i++) {
      const h = hearts[i];
      if (!h.on) {
        art.hearts.hide(i);
        continue;
      }
      h.t += dt;
      const u = h.t / h.dur;
      if (u >= 1) {
        h.on = false;
        art.hearts.hide(i);
        continue;
      }
      const pop = u < 0.15 ? u / 0.15 * 1.25 : u < 0.3 ? 1.25 - (u - 0.15) / 0.15 * 0.25 : u > 0.8 ? (1 - u) / 0.2 : 1;
      const yaw = cam ? Math.atan2(cam.position.x - h.x, cam.position.z - h.z) : 0;
      const c = HEART_COLS[h.c];
      art.hearts.set(i, h.x + Math.sin(h.t * 5 + i) * 0.04, h.y + u * 0.7, h.z, 0.13 * pop, yaw, c[0], c[1], c[2]);
      top = i + 1;
    }
    art.hearts.commit(top);
  }
  pose(0, 0);
  const off = typeof world.onUpdate === 'function' ? world.onUpdate((dt, t) => update(dt, t)) : null;

  return {
    open,
    close,
    feed,
    update,
    setName(next) {
      name = pondNameOk(next) || POND_NAME;
      art.setName(name);
    },
    get name() { return name; },
    get active() { return phase === 'open'; },
    get ducks() { return ducks.map((d) => ({ id: d.id, kind: d.kind, x: d.x, z: d.z, act: Object.keys(ACT).find((k) => ACT[k] === d.act) })); },
    get crumbsAfloat() { return crumbsAfloat(); },
    get crumbsFlying() { return crumbs.filter((c) => c.on && c.fly).length; },
    get stats() {
      return { drawCalls: art.drawCalls + 3, triangles: art.triangles };
    },
    plan,
    dispose() {
      close();
      if (typeof off === 'function') off();
      if (net && typeof net.off === 'function') net.off('event', onEvent);
      if (typeof hud.off === 'function') hud.off('modal', onModal);
      if (world.input && typeof world.input.off === 'function') world.input.off('digit', onDigit);
      interact.unregister('duckPond');
      flock.dispose();
      art.dispose();
      if (ui && ui.parentNode) ui.parentNode.removeChild(ui);
    },
  };
}

function groundY(world, x, z) {
  try {
    const y = world.groundAt(x, z);
    return Number.isFinite(y) ? y : 0;
  } catch (err) {
    return 0;
  }
}
