// The game props (PLAY): sparkly dodgeballs, the two giant bows of Capture the Bow (the island
// already paints the bases), and, for a hider during the hide phase, little sparkles over the
// hide spots near her (one Points object for every spot). Everything is built once and pooled:
// all the balls are one InstancedMesh (plus one for their shadows and one Points for their
// glints), each bow is one merged mesh that moves between its base, a carrier's back (character
// anchors.back) and the grass where it was dropped, and floats home on its own.
//
//   const props = createProps(world)
//   props.begin(kind, game)        show what this game needs (built the first time it is needed)
//   props.update(dt, t, frame)     frame = { game, now, me, charOf(id) -> character | null, posOf(id) -> { x, z } | null }
//   props.end()                    hide everything and give the bows back to the props root
//   props.dispose()
//   props.stats                    { balls, bows, spots } what is on screen (tests)
//
// Draw calls while a game is on: dodgeball 3 (balls, shadows, glints), Capture the Bow 2 (the two
// bows), hide and seek 1 while she hides (the spot sparkles). No allocation per frame: positions go
// through scratch vectors.

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { Geo, lin } from '../art/geo.js';
import { flatMat, blobMat } from '../art/materials.js';
import { getBlobGeo, isReducedMotion } from '../art/util.js';
import { bow as drawBow, K } from '../art/island-kit.js';
import { ballPos, BALL } from '../games/index.js';

const MAX_BALLS = 8;
const MAX_SPOTS = 64;
const SPOT_FAR = 18; // m: hide spots further away than this get no sparkle
const TRAIL = [PALETTE.rhinestonePink, PALETTE.rhinestoneSilver, PALETTE.rhinestonePurple, PALETTE.white];

function glintTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  for (const [w, h] of [[2.6, S / 2 - 3], [S / 2 - 3, 2.6]]) {
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2 - h);
    ctx.lineTo(S / 2 + w, S / 2);
    ctx.lineTo(S / 2, S / 2 + h);
    ctx.lineTo(S / 2 - w, S / 2);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A hide-spot sparkle: a four-point star, white in the middle, gold to hot pink, with an ink
// outline so it reads on the pale grass and the pastel sky.
function spotTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const star = (r, k) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const rr = i % 2 ? r * k : r;
      ctx.lineTo(S / 2 + Math.cos(a) * rr, S / 2 + Math.sin(a) * rr);
    }
    ctx.closePath();
  };
  star(29, 0.34);
  ctx.fillStyle = '#17121c';
  ctx.fill();
  star(25, 0.3);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 25);
  g.addColorStop(0, '#fff8fc');
  g.addColorStop(0.35, '#ffd36e');
  g.addColorStop(1, '#ff2e93');
  ctx.fillStyle = g;
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A faceted "rhinestone" ball: an icosphere whose facets alternate pinks, white, lilac and gold.
function ballGeometry() {
  const geo = new THREE.IcosahedronGeometry(BALL.radius, 1);
  const pos = geo.attributes.position;
  const faces = pos.count / 3;
  const col = new Float32Array(pos.count * 3);
  const pal = [0xff7ad1, 0xff2e93, 0xfff8fc, 0xff7ad1, 0xa96bff, 0xff8cc6, 0xfff8fc, 0xffd36e];
  for (let f = 0; f < faces; f++) {
    const c = lin(pal[(f * 7 + (f >> 2)) % pal.length]);
    for (let v = 0; v < 3; v++) col.set(c, (f * 3 + v) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function bowMesh(team) {
  const g = new Geo();
  g.jit = 0.03;
  const color = team ? K.teamB : K.teamA;
  drawBow(g, 0, 0, 0, 1.45, { color, star: team ? K.white : K.black, detail: 'hi' });
  // a rhinestone on the knot, so it reads as "the" bow from across the field
  g.ico(0, -0.17, 0.2, 0.09, team ? K.rSilver : K.rPink, { detail: 0 });
  const m = g.mesh(flatMat);
  m.name = 'play-bow-' + team;
  return m;
}

export function createProps(world) {
  const scene = world.scene;
  const groundAt = (x, z) => {
    const y = world.groundAt(x, z);
    return Number.isFinite(y) ? y : 0;
  };
  const burst = (x, y, z, o) => {
    try {
      world.spawnBurst(x, y, z, o);
    } catch (err) { /* sparkles are a bonus */ }
  };
  const root = new THREE.Group();
  root.name = 'play-props';
  scene.add(root);

  const tmp = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const tmpE = new THREE.Euler();
  const stats = { balls: 0, bows: 0, spots: 0 };
  let kind = null;
  let courtY = 0;
  let glint = null; // one glint texture for the balls and the hide spots
  const glintTex = () => glint || (glint = glintTexture());

  // ---------------------------------------------------------------- dodgeballs
  let balls = null;
  function buildBalls() {
    const mesh = new THREE.InstancedMesh(ballGeometry(), flatMat, MAX_BALLS);
    mesh.name = 'play-balls';
    mesh.frustumCulled = false;
    mesh.count = 0;
    const shadows = new THREE.InstancedMesh(getBlobGeo(), blobMat, MAX_BALLS);
    shadows.name = 'play-ball-shadows';
    shadows.frustumCulled = false;
    shadows.renderOrder = 1;
    shadows.count = 0;
    const gpos = new Float32Array(MAX_BALLS * 3);
    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', new THREE.BufferAttribute(gpos, 3).setUsage(THREE.DynamicDrawUsage));
    ggeo.setDrawRange(0, 0);
    const gmat = new THREE.PointsMaterial({ size: 0.75, map: glintTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff, fog: false });
    const glints = new THREE.Points(ggeo, gmat);
    glints.name = 'play-ball-glints';
    glints.frustumCulled = false;
    glints.renderOrder = 4;
    root.add(mesh, shadows, glints);
    balls = { mesh, shadows, glints, gpos, ggeo, gmat, spin: new Float32Array(MAX_BALLS), trail: new Float32Array(MAX_BALLS), twinkle: new Float32Array(MAX_BALLS) };
    for (let i = 0; i < MAX_BALLS; i++) balls.twinkle[i] = Math.random() * 3;
  }

  function updateBalls(dt, t, frame) {
    const st = frame.game.state;
    const list = Array.isArray(st.balls) ? st.balls : [];
    const n = Math.min(MAX_BALLS, list.length);
    const calm = isReducedMotion();
    let shown = 0;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      let x;
      let y;
      let z;
      let flying = false;
      if (b.s === 'held') {
        const ch = frame.charOf(b.by);
        const hand = ch && ch.anchors ? ch.anchors.handR || ch.anchors.handL : null;
        if (hand) {
          // held out from the hand, not through it: push it away from her middle
          hand.getWorldPosition(tmp);
          ch.group.getWorldPosition(tmpS);
          let ox = tmp.x - tmpS.x;
          let oz = tmp.z - tmpS.z;
          const ol = Math.hypot(ox, oz) || 1;
          ox /= ol;
          oz /= ol;
          x = tmp.x + ox * BALL.radius * 0.75;
          y = tmp.y + 0.04;
          z = tmp.z + oz * BALL.radius * 0.75;
        } else {
          const p = frame.posOf(b.by);
          if (!p) continue;
          x = p.x;
          y = groundAt(p.x, p.z) + 1.0;
          z = p.z;
        }
      } else {
        const p = ballPos(b, frame.now);
        if (!p) continue;
        x = p.x;
        z = p.z;
        y = p.y + courtY;
        flying = b.s === 'air';
      }
      if (flying) balls.spin[i] += dt * 9;
      else if (b.s === 'ground') balls.spin[i] += dt * 0.4;
      tmpE.set(balls.spin[i] * 0.7, balls.spin[i], 0);
      tmpQ.setFromEuler(tmpE);
      tmp.set(x, y, z);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmp, tmpQ, tmpS);
      balls.mesh.setMatrixAt(shown, tmpM);
      // the shadow shrinks as the ball rises
      const gy = b.s === 'held' ? groundAt(x, z) : courtY;
      const h = Math.max(0, y - gy);
      const s = 0.42 / (1 + h * 0.5);
      tmp.set(x, gy + 0.035, z);
      tmpQ.identity();
      tmpS.set(s, 1, s);
      tmpM.compose(tmp, tmpQ, tmpS);
      balls.shadows.setMatrixAt(shown, tmpM);
      // a glint that twinkles just in front of the ball
      balls.twinkle[i] += dt;
      balls.gpos[shown * 3] = x + 0.12;
      balls.gpos[shown * 3 + 1] = y + 0.14;
      balls.gpos[shown * 3 + 2] = z + 0.12;
      if (flying && !calm) {
        balls.trail[i] -= dt;
        if (balls.trail[i] <= 0) {
          balls.trail[i] = 0.045;
          burst(x, y, z, { count: 2, size: 0.3, speed: 0.7, up: 0, colors: TRAIL });
        }
      }
      shown++;
    }
    balls.mesh.count = shown;
    balls.shadows.count = shown;
    balls.mesh.instanceMatrix.needsUpdate = true;
    balls.shadows.instanceMatrix.needsUpdate = true;
    balls.ggeo.attributes.position.needsUpdate = true;
    balls.ggeo.setDrawRange(0, shown);
    balls.gmat.size = calm ? 0.6 : 0.55 + 0.35 * Math.abs(Math.sin(t * 4.2));
    stats.balls = shown;
  }

  // ---------------------------------------------------------------- giant bows
  let bows = null;
  function buildBows(game) {
    const field = game.arena;
    const bases = field.bases;
    const centre = field.area.f;
    const list = [0, 1].map((team) => {
      const mesh = bowMesh(team);
      root.add(mesh);
      const b = bases[team];
      // it floats just in front of the flagpole, toward the middle of the field
      const dx = centre.x - b.x;
      const dz = centre.z - b.z;
      const dl = Math.hypot(dx, dz) || 1;
      const home = { x: b.x + (dx / dl) * 1.3, z: b.z + (dz / dl) * 1.3 };
      return { team, mesh, home, face: Math.atan2(dx, dz), state: 'home', by: null, from: null, fly: 0, sparkle: Math.random(), pos: new THREE.Vector3() };
    });
    bows = { list };
  }

  function placeAtRoot(bw) {
    if (bw.mesh.parent !== root) root.add(bw.mesh);
  }

  function updateBows(dt, t, frame) {
    const st = frame.game.state;
    const calm = isReducedMotion();
    let shown = 0;
    for (const bw of bows.list) {
      const s = Array.isArray(st.bows) ? st.bows[bw.team] : null;
      const m = bw.mesh;
      if (!s) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      shown++;
      // floating home after a drop: a little arc from where it lay
      if (s.s === 'home' && bw.state === 'dropped' && bw.pos.lengthSq() > 0) {
        bw.from = bw.pos.clone();
        bw.fly = 0;
      }
      if (s.s === 'carried') {
        const ch = frame.charOf(s.by);
        const back = ch && ch.anchors ? ch.anchors.back : null;
        if (back) {
          if (m.parent !== back) back.add(m);
          m.position.set(0, 0.16, -0.16);
          m.rotation.set(0.12, Math.PI, 0);
          m.scale.setScalar(0.46);
        } else {
          // their character is not on screen yet: float it where they are
          placeAtRoot(bw);
          const p = frame.posOf(s.by);
          if (p) m.position.set(p.x, groundAt(p.x, p.z) + 1.6, p.z);
          m.rotation.set(0, t, 0);
          m.scale.setScalar(0.46);
        }
        bw.from = null;
      } else if (s.s === 'dropped') {
        placeAtRoot(bw);
        const y = groundAt(s.x, s.z);
        const bob = calm ? 0 : Math.sin(t * 2.4 + bw.team) * 0.08;
        m.position.set(s.x, y + 0.55 + bob, s.z);
        m.rotation.set(-0.5, t * 0.9, 0.15);
        m.scale.setScalar(0.72);
        bw.sparkle -= dt;
        if (bw.sparkle <= 0 && !calm) {
          bw.sparkle = 0.35;
          burst(s.x, y + 0.8, s.z, { count: 3, size: 0.35, speed: 1.4, colors: [bw.team ? PALETTE.teamB : PALETTE.teamA, PALETTE.gold, PALETTE.white] });
        }
        bw.from = null;
      } else {
        placeAtRoot(bw);
        const y = groundAt(bw.home.x, bw.home.z);
        const bob = calm ? 0 : Math.sin(t * 1.8 + bw.team * 1.3) * 0.12;
        let x = bw.home.x;
        let yy = y + 1.45 + bob;
        let z = bw.home.z;
        if (bw.from) {
          bw.fly += dt / 1.1;
          const k = Math.min(1, bw.fly);
          const e = k * k * (3 - 2 * k);
          x = bw.from.x + (x - bw.from.x) * e;
          z = bw.from.z + (z - bw.from.z) * e;
          yy = bw.from.y + (yy - bw.from.y) * e + Math.sin(k * Math.PI) * 2.2;
          if (k >= 1) bw.from = null;
        }
        m.position.set(x, yy, z);
        m.rotation.set(0, bw.face + Math.sin(t * 0.7 + bw.team) * 0.5, Math.sin(t * 1.3) * 0.05);
        m.scale.setScalar(1);
      }
      bw.state = s.s;
      bw.by = s.by;
      m.getWorldPosition(bw.pos);
    }
    stats.bows = shown;
  }

  // ---------------------------------------------------------------- hide spot sparkles
  // While she hides, a little pink-and-gold star bobs over each hide spot near her ("hide here!").
  // One Points object for every spot (alpha-blended with an ink outline, so it reads on the pale
  // grass); the near ones are packed into the draw range each frame. Seekers never see them, and
  // they go the moment seeking starts.
  let spots = null;
  function buildSpots(game) {
    const list = Array.isArray(game.arena.spots) ? game.arena.spots.slice(0, MAX_SPOTS) : [];
    const n = list.length;
    const pos = new Float32Array(Math.max(1, n) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size: 1.9, map: spotTexture(), transparent: true, depthWrite: false, alphaTest: 0.02, fog: false });
    const pts = new THREE.Points(geo, mat);
    pts.name = 'play-hide-spots';
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    pts.visible = false;
    root.add(pts);
    const ys = new Float32Array(Math.max(1, n));
    const phase = new Float32Array(Math.max(1, n));
    for (let i = 0; i < n; i++) {
      ys[i] = groundAt(list[i].x, list[i].z) + 1.7; // just over the hedge tops
      phase[i] = Math.random() * Math.PI * 2;
    }
    spots = { pts, geo, mat, pos, list, n, ys, phase, key: list.map((s) => s.id).join('|') };
  }

  function updateSpots(dt, t, frame) {
    const st = frame.game.state;
    const me = frame.me;
    const p = me && st.players && Object.prototype.hasOwnProperty.call(st.players, me) ? st.players[me] : null;
    const on = st.phase === 'hide' && !!p && p.role === 'hider';
    spots.pts.visible = on;
    if (!on) {
      stats.spots = 0;
      return;
    }
    const at = frame.posOf(me);
    const calm = isReducedMotion();
    const pos = spots.pos;
    let k = 0;
    for (let i = 0; i < spots.n; i++) {
      const s = spots.list[i];
      const d = at ? Math.hypot(s.x - at.x, s.z - at.z) : 0;
      if (d > SPOT_FAR || d < s.r + 0.3) continue; // far away, or the one she's tucked into
      pos[k * 3] = s.x;
      pos[k * 3 + 1] = spots.ys[i] + (calm ? 0 : Math.sin(t * 2.6 + spots.phase[i]) * 0.14);
      pos[k * 3 + 2] = s.z;
      k++;
    }
    spots.geo.setDrawRange(0, k);
    spots.geo.attributes.position.needsUpdate = true;
    spots.mat.size = calm ? 1.9 : 1.75 + 0.25 * Math.sin(t * 3.4);
    stats.spots = k;
  }

  function disposeSpots() {
    if (!spots) return;
    spots.pts.removeFromParent();
    spots.geo.dispose();
    spots.mat.map.dispose();
    spots.mat.dispose();
    spots = null;
  }

  // ---------------------------------------------------------------- the API
  return {
    begin(k, game) {
      this.end();
      kind = k;
      if (k === 'dodgeball') {
        const f = game.arena.area.f;
        courtY = groundAt(f.x, f.z);
        if (!balls) buildBalls();
        balls.mesh.visible = balls.shadows.visible = balls.glints.visible = true;
      } else if (k === 'hideSeek') {
        const key = Array.isArray(game.arena.spots) ? game.arena.spots.slice(0, MAX_SPOTS).map((s) => s.id).join('|') : '';
        if (spots && spots.key !== key) disposeSpots();
        if (!spots) buildSpots(game);
        spots.pts.visible = false;
      } else if (k === 'captureBow') {
        if (!bows) buildBows(game);
        for (const bw of bows.list) {
          bw.state = 'home';
          bw.from = null;
          bw.pos.set(0, 0, 0);
          placeAtRoot(bw);
          bw.mesh.visible = true;
        }
      }
    },
    update(dt, t, frame) {
      if (!frame || !frame.game) return;
      try {
        if (kind === 'dodgeball' && balls) updateBalls(dt, t, frame);
        else if (kind === 'captureBow' && bows) updateBows(dt, t, frame);
        else if (kind === 'hideSeek' && spots) updateSpots(dt, t, frame);
      } catch (err) {
        if (!this.failed) console.warn('[c9 play] props update failed', err);
        this.failed = true;
      }
    },
    end() {
      kind = null;
      if (balls) {
        balls.mesh.count = 0;
        balls.shadows.count = 0;
        balls.ggeo.setDrawRange(0, 0);
        balls.mesh.visible = balls.shadows.visible = balls.glints.visible = false;
      }
      if (bows) {
        for (const bw of bows.list) {
          placeAtRoot(bw);
          bw.mesh.visible = false;
        }
      }
      if (spots) spots.pts.visible = false;
      stats.balls = 0;
      stats.bows = 0;
      stats.spots = 0;
    },
    dispose() {
      this.end();
      root.removeFromParent();
      disposeSpots();
      if (glint) glint.dispose();
      glint = null;
      if (balls) {
        balls.mesh.geometry.dispose();
        balls.ggeo.dispose();
        balls.gmat.dispose();
        balls.mesh.dispose();
        balls.shadows.dispose();
      }
      if (bows) {
        for (const bw of bows.list) {
          bw.mesh.removeFromParent();
          bw.mesh.geometry.dispose();
        }
      }
      balls = null;
      bows = null;
    },
    get stats() {
      return stats;
    },
    get root() {
      return root;
    },
  };
}
