// Field goal kicks: a small practice field behind the League Office and a local mini game.
//
// Phone: swipe up to kick (speed is power, angle is direction). Keyboard: hold Space to charge,
// release to kick, arrow keys aim. Start at 20 yards, every make moves back 5 (up to 60), three
// misses end the round. The best distance is kept on this device ('lw.kick.best') and offered to
// net.submitScore('kick', ...) so a shared leaderboard can plug in later.
//
//   const kick = createKickGame(world)
//   kick.update(dt, t)
//   kick.place        { x, z, facing } where a visitor stands to start
//   kick.active       true while the game has the camera and the input
//   kick.leave()      end it now (safe from any state)

import * as THREE from '../../lib/three.module.min.js';
import { Geo, flatMat } from '../art/index.js';
import { drawSign } from './signs.js';
import { boardTexture } from './boards.js';
import { safeStorageGet, safeStorageSet } from '../core/util.js';

const BEST_KEY = 'lw.kick.best';
const YD = 0.55; // a "yard" on this practice field, in meters: 60 yards is 33 m
const HALF_W = 2.1; // half the gap between the uprights
const BAR = 2.3; // crossbar height
const TOP = 7.6; // top of the uprights
const BALL_R = 0.15;
const GRAVITY = 8.82;
const LOFT = 0.62; // launch angle, radians

const LINES = {
  good: ['Good from {d}. Your kicker could never.', 'It is good. Somebody alert the waiver wire.', 'Right down the middle. Unlike your draft.', 'Good from {d}. Start yourself in the flex.', 'Money. That is more points than your tight end.'],
  left: ['Wide left. Like your waiver claims.', 'Wide left. The trade deadline of kicks.', 'Hooked it. Blame the bye week.'],
  right: ['Wide right. A classic, like your Week 1 optimism.', 'Pushed it right. The projections lied again.', 'Wide right. Sit yourself next week.'],
  short: ['Short. Like your bench.', 'Came up short. So did your Monday night comeback.', 'No leg. Much like your depth at running back.'],
  doink: ['Doink. The football gods have noticed you.', 'Doink. That sound is your playoff odds.', 'Off the iron. Fantasy luck in one noise.'],
};
const TITLE = { good: 'GOOD!', left: 'NO GOOD', right: 'NO GOOD', short: 'NO GOOD', doink: 'DOINK' };
const SUB = { left: 'Wide left', right: 'Wide right', short: 'Short' };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function createKickGame(w) {
  const { scene, layout, terrain, colliders, interact, hud, input, rig, player, audio, store, net } = w;
  const F = layout.places.kickField;
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const group = new THREE.Group();
  group.name = 'kickField';
  scene.add(group);
  const Y = terrain.heightAt(F.x, F.z);
  const goalZ = F.z - F.d / 2 + 5.5; // kicks travel north (-z), toward the Hill
  const teeZ = (yards) => goalZ + yards * YD;

  // ------------------------------------------------------------------ the field
  {
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    const quad = (x0, z0, x1, z1, y, hex) => {
      c.set(hex);
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
    };
    const x0 = F.x - F.w / 2;
    const x1 = F.x + F.w / 2;
    const zN = F.z - F.d / 2;
    const zS = F.z + F.d / 2;
    // mown stripes every five yards, counted from the goal line
    let i = 0;
    for (let z = goalZ - 2 * 5 * YD; z < zS - 0.01; z += 5 * YD, i++) quad(x0, Math.max(zN, z), x1, Math.min(zS, z + 5 * YD), Y + 0.045, i % 2 ? 0x4f9e4a : 0x5bb054);
    for (let yd = 0; yd <= 60; yd += 5) quad(x0 + 0.4, teeZ(yd) - (yd === 0 ? 0.12 : 0.06), x1 - 0.4, teeZ(yd) + (yd === 0 ? 0.12 : 0.06), Y + 0.06, 0xf3eedd);
    quad(x0 + 0.3, zN + 0.3, x0 + 0.45, zS - 0.3, Y + 0.06, 0xf3eedd);
    quad(x1 - 0.45, zN + 0.3, x1 - 0.3, zS - 0.3, Y + 0.06, 0xf3eedd);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    const turf = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 }));
    turf.name = 'turf';
    group.add(turf);

    // the uprights: one gooseneck post, a crossbar and two tall pipes, all the usual yellow
    const u = new Geo();
    const yel = 0xffd92e;
    u.tube([[F.x, Y, goalZ - 1.4], [F.x, Y + BAR - 0.5, goalZ - 1.4], [F.x, Y + BAR, goalZ - 0.6], [F.x, Y + BAR, goalZ]], 0.11, 0xe6c022, { seg: 6 });
    u.tube([[F.x - HALF_W, Y + BAR, goalZ], [F.x + HALF_W, Y + BAR, goalZ]], 0.085, yel, { seg: 6, caps: true });
    for (const sx of [-1, 1]) u.tube([[F.x + sx * HALF_W, Y + BAR, goalZ], [F.x + sx * HALF_W, Y + TOP, goalZ]], 0.07, yel, { seg: 6, caps: true });
    for (const sx of [-1, 1]) u.box(F.x + sx * HALF_W, Y + TOP - 0.5, goalZ, 0.02, 0.45, 0.3, 0xff6a3d);
    u.box(F.x, Y, goalZ - 1.4, 0.5, 0.9, 0.5, 0x2d6be0); // base pad
    // a rack of spare balls and the tee marks beside the first spot
    u.box(F.x + 2.2, Y, teeZ(20) + 1.2, 0.9, 0.5, 0.5, 0x8a8f9a);
    for (let k = 0; k < 3; k++) u.sphere(F.x + 1.9 + k * 0.3, Y + 0.62, teeZ(20) + 1.2, 0.14, 0x8a4b2a, { seg: 6, rings: 4, sz: 1.5 });
    const posts = u.mesh(flatMat);
    posts.name = 'uprights';
    group.add(posts);
    colliders.addCircle(F.x, goalZ - 1.4, 0.45, 'kick');
    colliders.addCircle(F.x + 2.2, teeZ(20) + 1.2, 0.6, 'kick');
  }

  // the ball and its tee
  const ball = (() => {
    const b = new Geo();
    b.sphere(0, 0, 0, BALL_R, 0x8a4b2a, { seg: 8, rings: 5, sy: 1.65 });
    b.box(0, -0.11, BALL_R - 0.015, 0.035, 0.22, 0.03, 0xf3eedd);
    const m = b.mesh(flatMat);
    m.name = 'football';
    group.add(m);
    return m;
  })();
  const tee = (() => {
    const b = new Geo();
    b.box(0, 0, 0, 0.16, 0.06, 0.16, 0xff6a3d);
    const m = b.mesh(flatMat);
    group.add(m);
    return m;
  })();
  const aimLine = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 3.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  aimLine.geometry.rotateX(-Math.PI / 2);
  aimLine.geometry.translate(0, 0, -1.9);
  aimLine.visible = false;
  group.add(aimLine);

  // signs: the scoreboard by the field, and a pointer on the plaza's east rim
  let best = Math.max(0, Math.min(60, parseInt(safeStorageGet(BEST_KEY), 10) || 0));
  const bestText = () => (best > 0 ? 'Best: ' + best + ' yd' : 'Best: none yet');
  const makeSign = (lines, wd, ht, x, z, facing, bg) => {
    const draw = (ls) => drawSign(ls, wd / ht, { height: 192, bg, color: '#ffffff', borderColor: '#f5c542', subBody: true });
    const tex = boardTexture(draw(lines));
    const side = new THREE.MeshLambertMaterial({ color: 0x18213f });
    const face = new THREE.MeshLambertMaterial({ map: tex });
    const board = new THREE.Mesh(new THREE.BoxGeometry(wd, ht, 0.08), [side, side, side, side, face, face]);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2 + ht, 0.14), side);
    const y = terrain.heightAt(x, z);
    // set back along the board's normal, or the post stands in front of the face and splits the text
    post.position.set(x - Math.sin(facing) * 0.09, y + (2.2 + ht) / 2 - 0.3, z - Math.cos(facing) * 0.09);
    board.position.set(x, y + 1.9 + ht / 2, z + 0.02);
    board.rotation.y = facing;
    post.rotation.y = facing;
    group.add(post, board);
    colliders.addCircle(x, z, 0.22, 'kick');
    return { redraw(ls) { tex.image = draw(ls); tex.needsUpdate = true; } };
  };
  const scoreSign = makeSign(['FIELD GOAL KICKS', bestText()], 3.4, 1.5, F.x - F.w / 2 - 0.9, teeZ(20) + 3.4, 0.5, '#14553c');
  const s = layout.stations.plaza;
  makeSign(['FIELD GOALS', 'Behind the League Office'], 2.9, 1.15, s.x + s.r + 2.4, s.z + 10.5, -Math.PI / 2, '#14553c');

  const place = { x: F.x - 2.6, z: teeZ(20) + 3.2, facing: Math.PI };

  // ------------------------------------------------------------------ overlay (ours, under one root)
  const root = el('div', 'lw-kick');
  root.hidden = true;
  const bar = el('div', 'lw-kick-bar');
  const oDist = el('span', 'lw-kick-dist', '20 YD');
  const oMade = el('span', 'lw-kick-made', 'MADE 0');
  const oLives = el('span', 'lw-kick-lives');
  const dots = [el('i'), el('i'), el('i')];
  oLives.append(...dots);
  oLives.setAttribute('aria-label', 'Misses left');
  const oBest = el('span', 'lw-kick-best');
  bar.append(oDist, oMade, oLives, oBest);
  const oWind = el('div', 'lw-kick-wind');
  const oResult = el('div', 'lw-kick-result');
  oResult.setAttribute('role', 'status');
  const oBig = el('div', 'lw-kick-big');
  const oSub = el('div', 'lw-kick-sub');
  const oLine = el('div', 'lw-kick-line');
  oResult.append(oBig, oSub, oLine);
  oResult.hidden = true;
  const oMeter = el('div', 'lw-kick-meter');
  const oFill = el('i');
  oMeter.appendChild(oFill);
  oMeter.hidden = true;
  const oHint = el('div', 'lw-kick-hint');
  const oLeave = el('button', 'lw-kick-leave', 'Tap to leave');
  oLeave.type = 'button';
  root.append(bar, oWind, oResult, oMeter, oHint, oLeave);
  hud.el.appendChild(root);
  (hud.onTap || ((n, fn) => n.addEventListener('click', fn)))(oLeave, () => leave());

  // ------------------------------------------------------------------ game state
  const G = {
    active: false, state: 'idle', yards: 20, made: 0, misses: 0, roundBest: 0, wind: 0, aim: 0, charge: 0, chargeDir: 1, charging: false,
    timer: 0, release: null, result: null, crossed: false, last: {},
  };
  const bp = new THREE.Vector3(); // ball position
  const bv = new THREE.Vector3(); // ball velocity
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camWant = new THREE.Vector3();
  const lookWant = new THREE.Vector3();
  let camReady = false;
  let spin = 0;

  function pick(kind) {
    const list = LINES[kind];
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === G.last[kind]) i = (i + 1) % list.length;
    G.last[kind] = i;
    return list[i].replace('{d}', String(G.yards));
  }

  function setBall() {
    const z = teeZ(G.active ? G.yards : 20);
    bp.set(F.x, Y + 0.06 + BALL_R * 1.65, z);
    ball.position.copy(bp);
    ball.rotation.set(-0.18, 0, 0);
    tee.position.set(F.x, Y + 0.05, z);
    aimLine.position.set(F.x, Y + 0.09, z);
  }
  setBall();

  function hudText() {
    oDist.textContent = G.yards + ' YD';
    oMade.textContent = 'MADE ' + G.made;
    dots.forEach((d, i) => d.classList.toggle('lw-off', i >= 3 - G.misses));
    oBest.textContent = best > 0 ? 'BEST ' + best : '';
    oBest.hidden = !(best > 0);
    const byTouch = input.usingTouch || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    oLeave.textContent = byTouch ? 'Tap to leave' : 'Esc to leave';
    const mph = Math.abs(G.wind);
    oWind.textContent = mph === 0 ? 'WIND  calm' : 'WIND  ' + (G.wind < 0 ? '← ' : '') + mph + ' mph' + (G.wind > 0 ? ' →' : '');
    oHint.textContent = G.state === 'over' ? (input.usingTouch ? 'Swipe up to go again' : 'Press Space to go again')
      : input.usingTouch || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 'Swipe up to kick. Faster is farther.' : 'Hold Space, release to kick. Arrows aim.';
  }

  function setupKick() {
    G.state = 'aim';
    G.aim = 0;
    G.charging = false;
    G.charge = 0;
    G.crossed = false;
    G.wind = Math.round((Math.random() * 2 - 1) * Math.min(12, 4 + G.yards * 0.16));
    oResult.hidden = true;
    oMeter.hidden = true;
    aimLine.visible = false;
    setBall();
    player.setSeat(F.x - 0.8, Y, teeZ(G.yards) + 0.9, Math.PI);
    hudText();
  }

  function newRound() {
    G.yards = 20;
    G.made = 0;
    G.misses = 0;
    G.roundBest = 0;
    setupKick();
  }

  function doKick(power, yaw) {
    if (!G.active || G.state !== 'aim') return;
    power = Math.max(0.1, Math.min(1, power));
    yaw = Math.max(-0.5, Math.min(0.5, yaw));
    const v = 8 + 13 * power;
    const h = Math.cos(LOFT) * v;
    bv.set(Math.sin(yaw) * h, Math.sin(LOFT) * v, -Math.cos(yaw) * h);
    G.state = 'fly';
    G.timer = 0;
    G.crossed = false;
    oMeter.hidden = true;
    aimLine.visible = false;
    audio.sfx('stamp', { volume: 0.35 });
    if (player.avatar && player.avatar.setAnim) player.avatar.setAnim('cheer');
  }

  function finish(kind) {
    if (G.state !== 'fly') return;
    G.result = kind;
    G.state = 'result';
    G.timer = 0;
    oBig.textContent = TITLE[kind];
    oSub.textContent = kind === 'good' ? 'From ' + G.yards + ' yards' : SUB[kind] || 'Off the post';
    oLine.textContent = pick(kind);
    oResult.dataset.kind = kind;
    oResult.hidden = false;
    oResult.classList.remove('lw-in');
    void oResult.offsetWidth;
    oResult.classList.add('lw-in');
    if (kind === 'good') {
      G.made++;
      G.roundBest = Math.max(G.roundBest, G.yards);
      audio.sfx('coin');
      if (G.yards > best) {
        best = G.yards;
        safeStorageSet(BEST_KEY, String(best));
        scoreSign.redraw(['FIELD GOAL KICKS', bestText()]);
        audio.sfx('fanfare', { volume: 0.6 });
        try {
          if (net && typeof net.submitScore === 'function') net.submitScore('kick', { yards: best, teamId: w.playerTeam });
        } catch (err) { /* a leaderboard is optional */ }
      }
    } else {
      G.misses++;
      if (kind === 'doink') audio.sfx('doink');
      else audio.sfx('whoosh', { volume: 0.4 });
    }
    hudText();
  }

  function afterResult() {
    if (player.avatar && player.avatar.setAnim) player.avatar.setAnim('idle');
    if (G.misses >= 3) {
      G.state = 'over';
      oBig.textContent = 'ROUND OVER';
      oSub.textContent = G.roundBest ? 'Long of ' + G.roundBest + ' yards' : 'Nothing but air';
      oLine.textContent = G.roundBest ? 'Best on this phone: ' + best + ' yards.' : 'The uprights remain undefeated.';
      oResult.dataset.kind = 'over';
      oResult.hidden = false;
      audio.sfx('sadTrombone', { volume: 0.5 });
      hudText();
      return;
    }
    if (G.result === 'good') G.yards = Math.min(60, G.yards + 5);
    setupKick();
  }

  function fly(dt) {
    const steps = 3;
    const h = dt / steps;
    const ground = Y + BALL_R;
    for (let i = 0; i < steps; i++) {
      const pz = bp.z;
      const px = bp.x;
      const py = bp.y;
      bv.y -= GRAVITY * h;
      bv.x += G.wind * 0.1 * h;
      bp.addScaledVector(bv, h);
      if (!G.crossed && pz > goalZ && bp.z <= goalZ) {
        G.crossed = true;
        const k = (pz - goalZ) / (pz - bp.z);
        const x = px + (bp.x - px) * k - F.x;
        const y = py + (bp.y - py) * k - Y;
        const nearPost = Math.abs(Math.abs(x) - HALF_W) < BALL_R + 0.1 && y > BAR - 0.15;
        const nearBar = Math.abs(y - BAR) < BALL_R + 0.1 && Math.abs(x) < HALF_W + 0.1;
        if (nearPost || nearBar) {
          // off the iron: it comes back out, and stays out
          bv.z = Math.abs(bv.z) * 0.32;
          bv.x = (x > 0 ? 1 : -1) * (1.5 + Math.random() * 2) * (nearBar ? 0.4 : 1);
          bv.y = nearBar ? 3 : Math.max(1.5, bv.y * 0.3);
          bp.z = goalZ + 0.05;
          finish('doink');
        } else if (Math.abs(x) < HALF_W && y > BAR) finish('good');
        else if (Math.abs(x) >= HALF_W) finish(x < 0 ? 'left' : 'right');
        else finish('short');
      }
      if (bp.y <= ground) {
        bp.y = ground;
        if (G.state === 'fly') finish('short');
        bv.set(bv.x * 0.5, Math.abs(bv.y) > 2 ? -bv.y * 0.35 : 0, bv.z * 0.5);
      }
    }
    spin += dt * 14;
    ball.position.copy(bp);
    ball.rotation.set(spin, 0, 0);
  }

  // ------------------------------------------------------------------ input while the game is on
  const sw = { id: null, x: 0, y: 0, t: 0, trail: [] };
  function onDown(e) {
    if (!G.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (sw.id !== null) return; // a swipe is already being tracked: extra fingers are ignored
    sw.id = e.pointerId;
    sw.x = e.clientX;
    sw.y = e.clientY;
    sw.t = performance.now();
    sw.trail = [[sw.x, sw.y, sw.t]];
  }
  function onMove(e) {
    if (e.pointerId !== sw.id) return;
    sw.trail.push([e.clientX, e.clientY, performance.now()]);
    if (sw.trail.length > 24) sw.trail.shift();
  }
  function onCancel(e) {
    if (e.pointerId === sw.id) sw.id = null;
  }
  function onUp(e) {
    if (!G.active || e.pointerId !== sw.id) return;
    sw.id = null;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    const ms = Math.max(40, performance.now() - sw.t);
    const H = window.innerHeight || 640;
    if (-dy < H * 0.06 || ms > 900) return; // not an upward swipe
    if (G.state === 'over') {
      newRound();
      return;
    }
    // Power is how fast the finger was moving as it let go (the last 130 ms or so), in screen
    // heights per second, so a slow wind-up does not cost distance. Direction is the whole stroke.
    const now = performance.now();
    let from = sw.trail[0];
    for (const p of sw.trail) {
      if (now - p[2] <= 130) break;
      from = p;
    }
    const span = Math.max(30, now - from[2]);
    const flick = (Math.hypot(e.clientX - from[0], e.clientY - from[1]) / span) * 1000 / H;
    const whole = (Math.hypot(dx, dy) / ms) * 1000 / H;
    doKick((Math.max(flick, whole) - 0.4) / 2.9, Math.atan2(dx, -dy) * 0.62);
  }
  function onKeyDown(e) {
    if (!G.active) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (G.state === 'over') newRound();
      else if (G.state === 'aim') {
        G.charging = true;
        G.charge = 0;
        G.chargeDir = 1;
        oMeter.hidden = false;
      }
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      if (G.state !== 'aim') return;
      G.aim = Math.max(-0.3, Math.min(0.3, G.aim + (e.code === 'ArrowLeft' ? -0.015 : 0.015)));
      aimLine.visible = true;
      aimLine.rotation.y = -G.aim;
    }
  }
  function onKeyUp(e) {
    if (!G.active || e.code !== 'Space' || !G.charging) return;
    G.charging = false;
    doKick(0.15 + 0.85 * G.charge, G.aim);
  }
  const canvas = w.engine.renderer.domElement;

  // ------------------------------------------------------------------ start and leave
  function start() {
    if (G.active || player.seated || rig.isCinematic) return;
    G.active = true;
    G.release = w.freezePlayer();
    camReady = false;
    player.sit(F.x - 0.8, Y, teeZ(20) + 0.9, Math.PI, () => leave(), 'idle');
    newRound();
    root.hidden = false;
    input.setSuspended(true);
    sw.id = null;
    for (const node of [canvas, root]) {
      node.addEventListener('pointerdown', onDown);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onCancel);
    }
    if (hud.hideHint) hud.hideHint(); // the walking hint has no business on top of the kicking hint
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    audio.sfx('pop', { volume: 0.5 });
    const portrait = w.camera3D.aspect < 1;
    rig.play([{
      cut: true, dur: 1e7, ease: 'linear', fov: portrait ? 62 : 46,
      pos: (u, sec) => {
        const z = teeZ(G.yards);
        camWant.set(F.x + 0.25, Y + (portrait ? 3.1 : 2.3), z + (portrait ? 7.2 : 5.6));
        if (!camReady || calm) camPos.copy(camWant);
        else camPos.lerp(camWant, 0.08);
        return camPos;
      },
      look: () => {
        // the uprights, drifting a little toward the ball while it is in the air
        lookWant.set(F.x, Y + BAR + 1.3, goalZ);
        if (G.state === 'fly' || G.state === 'result') lookWant.lerp(bp, calm ? 0 : 0.3);
        if (!camReady || calm) camLook.copy(lookWant);
        else camLook.lerp(lookWant, 0.1);
        camReady = true;
        return camLook;
      },
    }], { skippable: false, handoff: calm ? 0.01 : 0.7 }).then(() => leave(true));
  }

  function leave(fromOutside) {
    if (!G.active) return;
    G.active = false;
    G.state = 'idle';
    G.charging = false;
    root.hidden = true;
    oResult.hidden = true;
    for (const node of [canvas, root]) {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
    }
    sw.id = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    input.setSuspended(hud.isModalOpen());
    if (player.avatar && player.avatar.setAnim) player.avatar.setAnim('idle');
    if (player.seated) player.stand(place.x, place.z, place.facing);
    if (fromOutside !== true && rig.isCinematic) rig.skip();
    rig.setView({ yaw: place.facing + Math.PI });
    if (G.release) G.release();
    G.release = null;
    aimLine.visible = false;
    setBall();
  }

  interact.register({
    id: 'kick', position: new THREE.Vector3(place.x + 1.2, Y, place.z - 0.8), radius: 3.6, label: 'Kick field goals', priority: 2, object3D: ball, onUse: start,
  });
  input.on('escape', () => leave());
  hud.on('modal', (open) => {
    if (open) leave();
  });
  store.on('model', () => leave());

  function update(dt) {
    if (!G.active) return;
    if (G.charging) {
      G.charge += (G.chargeDir * dt) / 1.05;
      if (G.charge >= 1) {
        G.charge = 1;
        G.chargeDir = -1;
      } else if (G.charge <= 0) {
        G.charge = 0;
        G.chargeDir = 1;
      }
      oFill.style.transform = 'scaleX(' + G.charge.toFixed(3) + ')';
    }
    if (G.state === 'fly') {
      G.timer += dt;
      fly(dt);
      if (G.timer > 6) finish('short');
    } else if (G.state === 'result') {
      G.timer += dt;
      fly(dt);
      if (G.timer > 2.3) afterResult();
    }
  }

  return {
    group,
    update,
    place,
    leave: () => leave(),
    start,
    get active() { return G.active; },
    get state() { return { state: G.state, yards: G.yards, made: G.made, misses: G.misses, wind: G.wind, best, result: G.result }; },
    // tests: a kick with exact numbers (power 0..1, yaw radians, wind mph)
    _kick(power, yaw, wind) {
      if (typeof wind === 'number') G.wind = wind;
      hudText();
      doKick(power, yaw);
    },
  };
}
