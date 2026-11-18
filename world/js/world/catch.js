// The catching drill: a ball machine on the practice field at the foot of the substation.
//
// The machine fires an arcing ball down the field and a marker shows roughly where it will come
// down. The visitor MOVES the avatar (joystick on a phone, WASD or the arrow keys on a desktop)
// to get under it. Close enough as it arrives is a catch, anything else is a drop. Every catch
// makes the next throw longer, faster and further off to the side. Three drops end the round.
// The best streak is kept on this device ('lw.catch.best') and offered to
// net.submitScore('catch', ...) so a shared leaderboard can plug in later.
//
//   const game = createCatchGame(world)
//   game.update(dt, t)
//   game.place        { x, z, facing } where a visitor stands to start (the facility's spot)
//   game.active       true while the game has the camera
//   game.leave()      end it now (safe from any state)
//
// Unlike the kicking game this one leaves world input ALIVE, because the joystick is the control.
// Everything else that input would normally do is already off: the camera is cinematic and the
// player is frozen, so tap-to-walk and the action button both stand down on their own.

import * as THREE from '../../lib/three.module.min.js';
import { Geo, flatMat } from '../art/index.js';
import { clamp, damp, safeStorageGet, safeStorageSet } from '../core/util.js';

const BEST_KEY = 'lw.catch.best';
const GRAVITY = 9.2;
const BALL_R = 0.17;
const DRILL_SPEED = 7.4; // how fast the avatar covers ground during the drill, m/s
const CATCH_Y = 1.32; // the ball is caught as it falls through chest height
const LIVES = 3;

const LINES = {
  caught: ['Hands.', 'Caught in traffic.', 'Hands of glue. Start yourself.', 'Plucked it. That is a target share.', 'Snagged. Your WR1 is taking notes.'],
  drop: ['That is a drop. Your WR2 would be proud.', 'Hands of stone.', 'Right off the facemask.', 'Alligator arms. We all saw that.', 'Dropped. That one is going on the tape.'],
  over: ['Three drops. The waiver wire is calling.', 'Round over. The machine stays undefeated.', 'Hands like a Tuesday waiver claim.', 'Three drops. Go ahead and blame the turf.'],
  none: ['Nothing caught. Bold strategy.', 'A clean zero. Consistent, at least.'],
};
const TITLE = { caught: 'CAUGHT', drop: 'DROP' };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function createCatchGame(w) {
  const { scene, terrain, interact, hud, input, rig, player, audio, store, net, engine } = w;
  const facility = w.facility;
  if (!facility) {
    // Nothing to stand on: hand back something inert rather than breaking the boot.
    return { update() {}, leave() {}, get active() { return false; }, place: null };
  }
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const F = facility.field;
  const M = facility.machine;
  const Y = F.y;
  const group = new THREE.Group();
  group.name = 'catchDrill';
  group.visible = false;
  scene.add(group);

  // where the avatar may run, and where a ball may come down
  const RUN = { x0: F.x0 + 1.5, x1: F.x1 - 1.5, z0: M.z + 4.5, z1: F.z1 - 3 };
  const LAND = { x0: F.x0 + 1.6, x1: F.x1 - 1.6, z0: M.z + 8, z1: F.z1 - 3.5 };

  // ------------------------------------------------------------------ the ball, its shadow, the marker
  const ball = (() => {
    const g = new Geo();
    g.sphere(0, 0, 0, BALL_R, 0x8a4b2a, { seg: 8, rings: 5, sy: 1.65 });
    g.box(-0.018, -0.11, BALL_R - 0.015, 0.035, 0.22, 0.03, 0xf3eedd);
    const m = g.mesh(flatMat);
    m.name = 'drillBall';
    group.add(m);
    return m;
  })();
  const ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.renderOrder = 2;
  group.add(ballShadow);
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.65, 22),
    new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 3;
  group.add(marker);

  // ------------------------------------------------------------------ overlay (ours, under one root)
  const root = el('div', 'lw-catch');
  root.hidden = true;
  const bar = el('div', 'lw-catch-bar');
  const oCaught = el('span', 'lw-catch-count', 'CAUGHT 0');
  const oLives = el('span', 'lw-catch-lives');
  const dots = [el('i'), el('i'), el('i')];
  oLives.append(...dots);
  oLives.setAttribute('aria-label', 'Drops left');
  const oBest = el('span', 'lw-catch-best');
  bar.append(oCaught, oLives, oBest);
  const oResult = el('div', 'lw-catch-result');
  oResult.setAttribute('role', 'status');
  const oBig = el('div', 'lw-catch-big');
  const oLine = el('div', 'lw-catch-line');
  oResult.append(oBig, oLine);
  oResult.hidden = true;
  const oHint = el('div', 'lw-catch-hint');
  const oLeave = el('button', 'lw-catch-leave', 'Tap to leave');
  oLeave.type = 'button';
  root.append(bar, oResult, oHint, oLeave);
  hud.el.appendChild(root);
  (hud.onTap || ((n, fn) => n.addEventListener('click', fn)))(oLeave, () => leave());

  // ------------------------------------------------------------------ state
  let best = Math.max(0, Math.min(999, parseInt(safeStorageGet(BEST_KEY), 10) || 0));
  facility.setBest(best);

  const G = {
    active: false, state: 'idle', caught: 0, drops: 0, timer: 0, release: null, last: {},
    px: 0, pz: 0, heading: Math.PI, anim: 'idle', speed: 0, armed: false,
  };
  const bp = new THREE.Vector3();
  const bv = new THREE.Vector3();
  const target = new THREE.Vector3();
  const vel = { x: 0, z: 0 };
  const mv = { x: 0, y: 0 };
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camWant = new THREE.Vector3();
  const lookWant = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let camReady = false;
  let spin = 0;

  function pick(kind) {
    const list = LINES[kind];
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === G.last[kind]) i = (i + 1) % list.length;
    G.last[kind] = i;
    return list[i];
  }

  const byTouch = () => input.usingTouch || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function hudText() {
    oCaught.textContent = 'CAUGHT ' + G.caught;
    dots.forEach((d, i) => d.classList.toggle('lw-off', i >= LIVES - G.drops));
    oBest.textContent = best > 0 ? 'BEST ' + best : '';
    oBest.hidden = !(best > 0);
    oLeave.textContent = byTouch() ? 'Tap to leave' : 'Esc to leave';
    oHint.textContent = G.state === 'over'
      ? (byTouch() ? 'Tap the field to go again' : 'Press Space to go again')
      : byTouch() ? 'Run under the ball' : 'Run under the ball. WASD or arrows.';
  }

  function setAnim(name) {
    if (name === G.anim) return;
    G.anim = name;
    const av = player.avatar;
    if (av && av.setAnim) av.setAnim(name);
  }

  // ------------------------------------------------------------------ throwing
  // Longer, faster and further off to the side with every catch.
  function throwBall() {
    const c = G.caught;
    const air = Math.max(1.18, 2.15 - c * 0.075);
    const reach = 1.5 + c * 0.7 + Math.random() * 1.3;
    // throw toward the side with more room, so a wall never makes it impossible
    const room = (RUN.x1 - G.px) - (G.px - RUN.x0);
    const dir = Math.abs(room) > reach ? Math.sign(room) : (Math.random() < 0.5 ? -1 : 1);
    const tx = clamp(G.px + dir * reach, LAND.x0, LAND.x1);
    const tz = clamp(M.z + 12 + c * 1.5 + (Math.random() - 0.3) * 3.4, Math.max(LAND.z0, G.pz - 11), Math.min(LAND.z1, G.pz + 11));
    target.set(tx, Y + CATCH_Y, tz);
    bp.copy(M.muzzle);
    bv.set((target.x - bp.x) / air, (target.y - bp.y) / air + 0.5 * GRAVITY * air, (target.z - bp.z) / air);
    ball.position.copy(bp);
    ball.visible = true;
    ballShadow.visible = true;
    marker.position.set(tx, Y + 0.08, tz);
    marker.visible = true;
    marker.scale.setScalar(1);
    G.state = 'fly';
    G.armed = false;
    G.timer = 0;
    oResult.hidden = true;
    if (facility.spinMachine) facility.spinMachine(9 + Math.min(9, c * 0.8));
    audio.sfx('whoosh', { volume: 0.32, position: M.muzzle });
    hudText();
  }

  function newRound() {
    G.caught = 0;
    G.drops = 0;
    G.px = clamp(G.px, RUN.x0, RUN.x1);
    G.pz = clamp(G.pz, RUN.z0, RUN.z1);
    oResult.hidden = true;
    hudText();
    G.state = 'ready';
    G.timer = 0;
  }

  function finish(kind) {
    if (G.state !== 'fly') return;
    G.state = 'result';
    G.timer = 0;
    marker.visible = false;
    oBig.textContent = TITLE[kind];
    oLine.textContent = pick(kind);
    oResult.dataset.kind = kind;
    oResult.hidden = false;
    oResult.classList.remove('lw-in');
    void oResult.offsetWidth;
    oResult.classList.add('lw-in');
    if (kind === 'caught') {
      G.caught++;
      ball.visible = false;
      ballShadow.visible = false;
      audio.sfx('catch', { volume: 0.75 });
      setAnim('cheer');
      if (G.caught > best) {
        best = G.caught;
        safeStorageSet(BEST_KEY, String(best));
        facility.setBest(best);
        audio.sfx('coin', { volume: 0.6 });
      }
    } else {
      G.drops++;
      audio.sfx('drop', { volume: 0.7 });
    }
    hudText();
  }

  function afterResult() {
    setAnim('idle');
    if (G.drops >= LIVES) {
      G.state = 'over';
      ball.visible = false;
      ballShadow.visible = false;
      oBig.textContent = 'ROUND OVER';
      oLine.textContent = G.caught > 0 ? pick('over') : pick('none');
      oResult.dataset.kind = 'over';
      oResult.hidden = false;
      audio.sfx('sadTrombone', { volume: 0.5 });
      try {
        if (net && typeof net.submitScore === 'function') net.submitScore('catch', { caught: G.caught, teamId: w.playerTeam });
      } catch (err) { /* a leaderboard is optional */ }
      hudText();
      return;
    }
    G.state = 'ready';
    G.timer = 0;
    oResult.hidden = true;
  }

  // ------------------------------------------------------------------ the ball in the air
  function fly(dt) {
    const steps = 3;
    const h = dt / steps;
    const floor = Y + BALL_R;
    for (let i = 0; i < steps; i++) {
      const py = bp.y;
      bv.y -= GRAVITY * h;
      bp.addScaledVector(bv, h);
      if (G.state !== 'fly') continue;
      // armed once it is past the top: only a ball on the way down can be caught
      if (bv.y < 0) G.armed = true;
      if (G.armed && py >= Y + CATCH_Y && bp.y < Y + CATCH_Y) {
        const k = (py - (Y + CATCH_Y)) / Math.max(1e-5, py - bp.y);
        const cx = bp.x - bv.x * h * (1 - k);
        const cz = bp.z - bv.z * h * (1 - k);
        const grab = Math.max(1.35, 1.85 - G.caught * 0.03);
        finish(Math.hypot(cx - G.px, cz - G.pz) <= grab ? 'caught' : 'drop');
      }
    }
    if (bp.y <= floor) {
      bp.y = floor;
      if (G.state === 'fly') finish('drop');
      bv.set(bv.x * 0.45, Math.abs(bv.y) > 2 ? -bv.y * 0.32 : 0, bv.z * 0.45);
    }
    spin += dt * 13;
    ball.position.copy(bp);
    ball.rotation.set(spin, 0, 0);
    ballShadow.position.set(bp.x, terrain.heightAt(bp.x, bp.z) + 0.07, bp.z);
    const lift = clamp(1 - (bp.y - Y) / 9, 0.35, 1);
    ballShadow.scale.setScalar(lift);
  }

  // ------------------------------------------------------------------ the avatar, driven by us
  // The camera is locked behind the avatar looking north, so the stick maps straight to the
  // world: right is +x, forward is -z. No camera yaw to chase.
  function move(dt) {
    input.getMove(mv);
    const mag = Math.min(1, Math.hypot(mv.x, mv.y));
    const want = mag > 0.05 ? mag * DRILL_SPEED : 0;
    const dirX = want > 0 ? mv.x / mag : 0;
    const dirZ = want > 0 ? -mv.y / mag : 0;
    vel.x = damp(vel.x, dirX * want, 11, dt);
    vel.z = damp(vel.z, dirZ * want, 11, dt);
    if (want === 0 && Math.abs(vel.x) + Math.abs(vel.z) < 0.03) {
      vel.x = 0;
      vel.z = 0;
    }
    G.px = clamp(G.px + vel.x * dt, RUN.x0, RUN.x1);
    G.pz = clamp(G.pz + vel.z * dt, RUN.z0, RUN.z1);
    G.speed = Math.hypot(vel.x, vel.z);
    if (G.speed > 0.4) G.heading = Math.atan2(vel.x, vel.z);
    else if (G.state === 'fly') {
      // standing still: watch the ball
      G.heading = Math.atan2(bp.x - G.px, bp.z - G.pz);
    }
    if (G.anim !== 'cheer') setAnim(G.speed < 0.35 ? 'idle' : G.speed < 3.4 ? 'walk' : 'run');
    const av = player.avatar;
    if (av && av.setSpeed) av.setSpeed(G.speed);
    player.setSeat(G.px, terrain.heightAt(G.px, G.pz), G.pz, G.heading);
  }

  // ------------------------------------------------------------------ input while the game is on
  function onCanvasDown() {
    if (!G.active || G.state !== 'over') return;
    newRound();
  }
  function onKeyDown(e) {
    if (!G.active) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (e.repeat) return;
      if (G.state === 'over') {
        e.preventDefault();
        newRound();
      }
    }
  }
  const canvas = engine.renderer.domElement;

  // ------------------------------------------------------------------ start and leave
  function start() {
    if (G.active || player.seated || rig.isCinematic) return;
    G.active = true;
    G.release = w.freezePlayer();
    camReady = false;
    group.visible = true;
    ball.visible = false;
    ballShadow.visible = false;
    marker.visible = false;
    vel.x = 0;
    vel.z = 0;
    G.px = (RUN.x0 + RUN.x1) / 2;
    G.pz = clamp(M.z + 13, RUN.z0, RUN.z1);
    G.heading = Math.PI;
    G.anim = 'idle';
    G.speed = 0;
    focus.set(G.px, Y + 2.4, G.pz - 5.5); // primed: the camera shot reads this on its first frame
    player.sit(G.px, terrain.heightAt(G.px, G.pz), G.pz, G.heading, () => leave(), 'idle');
    newRound();
    root.hidden = false;
    canvas.addEventListener('pointerdown', onCanvasDown);
    window.addEventListener('keydown', onKeyDown);
    if (hud.hideHint) hud.hideHint();
    audio.sfx('pop', { volume: 0.5 });
    rig.setView({ yaw: 0, pitch: 0.3 });
    const portrait = w.camera3D.aspect < 1;
    rig.play([{
      cut: true, dur: 1e7, ease: 'linear', fov: portrait ? 66 : 50,
      pos: () => {
        // Straight south of the look point, so the camera's forward stays exactly -z and the
        // stick keeps mapping to the world without a yaw to chase.
        camWant.set(focus.x, Y + (portrait ? 6.0 : 5.1), G.pz + (portrait ? 12.0 : 10.4));
        if (!camReady || calm) camPos.copy(camWant);
        else camPos.lerp(camWant, 0.12);
        return camPos;
      },
      look: () => {
        lookWant.set(focus.x, focus.y, focus.z);
        if (!camReady || calm) camLook.copy(lookWant);
        else camLook.lerp(lookWant, 0.16);
        camReady = true;
        return camLook;
      },
    }], { skippable: false, handoff: calm ? 0.01 : 0.7 }).then(() => leave(true));
  }

  function leave(fromOutside) {
    if (!G.active) return;
    G.active = false;
    G.state = 'idle';
    root.hidden = true;
    oResult.hidden = true;
    group.visible = false;
    ball.visible = false;
    ballShadow.visible = false;
    marker.visible = false;
    canvas.removeEventListener('pointerdown', onCanvasDown);
    window.removeEventListener('keydown', onKeyDown);
    input.setSuspended(hud.isModalOpen());
    const av = player.avatar;
    if (av && av.setAnim) av.setAnim('idle');
    if (av && av.setSpeed) av.setSpeed(0);
    G.anim = 'idle';
    const back = facility.place;
    if (player.seated) player.stand(back.x, back.z, back.facing);
    if (fromOutside !== true && rig.isCinematic) rig.skip();
    rig.setView({ yaw: back.facing + Math.PI });
    if (G.release) G.release();
    G.release = null;
  }

  interact.register({
    id: 'catch',
    position: new THREE.Vector3(M.x, M.y, M.z + 2.2),
    radius: 3.8,
    label: 'Catch some passes',
    priority: 2,
    object3D: M.group || null,
    onUse: start,
  });
  input.on('escape', () => leave());
  hud.on('modal', (open) => {
    if (open) leave();
  });
  store.on('model', () => leave());
  store.on('playerTeam', () => leave());
  engine.on('visibility', (visible) => {
    if (!visible) leave();
  });

  function update(dt, t) {
    if (!G.active) return;
    move(dt);
    if (G.state === 'ready') {
      G.timer += dt;
      focus.set(G.px, Y + 2.4, G.pz - 5.5);
      if (G.timer > (G.caught === 0 && G.drops === 0 ? 1.1 : 0.55)) throwBall();
      return;
    }
    if (G.state === 'fly' || G.state === 'result') {
      G.timer += dt;
      fly(dt);
      // Keep all three readable on a phone: lead a little toward where the ball will come down
      // so the marker is on screen, lift the look while the ball is high so it never leaves the
      // top, and lean down the field toward the ball itself.
      const high = clamp((bp.y - Y) / 7, 0, 1);
      focus.set(
        G.px + (target.x - G.px) * 0.5,
        Y + 2.2 + high * 1.7,
        G.pz + (bp.z - G.pz) * (0.3 + high * 0.25),
      );
      if (marker.visible) marker.scale.setScalar(calm ? 1 : 1 + Math.sin(t * 6) * 0.07);
      if (G.state === 'fly' && G.timer > 7) finish('drop');
      else if (G.state === 'result' && G.timer > 1.7) afterResult();
      return;
    }
    // over: hold the avatar in frame
    focus.set(G.px, Y + 2.4, G.pz - 5.5);
    if (marker.visible) marker.visible = false;
  }

  return {
    group,
    update,
    place: facility.place,
    leave: () => leave(),
    start,
    get active() { return G.active; },
    get state() {
      return { state: G.state, caught: G.caught, drops: G.drops, best, x: G.px, z: G.pz, ball: [bp.x, bp.y, bp.z], target: [target.x, target.z] };
    },
    // tests: put the avatar exactly where it needs to be, then run the throw out
    _moveTo(x, z) {
      G.px = clamp(x, RUN.x0, RUN.x1);
      G.pz = clamp(z, RUN.z0, RUN.z1);
    },
    _throw() {
      if (G.active && (G.state === 'ready' || G.state === 'over')) {
        if (G.state === 'over') newRound();
        throwBall();
      }
    },
  };
}
