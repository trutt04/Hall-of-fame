// Dev page for the GAMES owner: bots play the four Cloud Nine games on the sample arenas, drawn
// top-down on a 2D canvas, in real time with speed controls. The side panel shows exactly what
// game.ui() gives the HUD for the selected player (click a player to switch).
//
// URL options: ?mode=hideSeek|freezeTag|dodgeball|captureBow &n=2..10 &seed=1 &level=easy|normal|hard
//              &speed=0|0.5|1|2|4|8 &warp=<seconds to fast-forward> &until=<phase to fast-forward to>
//              &me=1 (play as P1: arrows/WASD, Space)

import { PALETTE, TEAMS, FONT_STACK } from '../js/config.js';
import { MODES, MODE_IDS, ballPos } from '../js/games/index.js';
import { createSim } from '../js/games/sim.js';
import { toWorld } from '../js/games/common.js';

const params = new URLSearchParams(location.search);
const intParam = (name, lo, hi, fallback) => {
  const v = Number.parseInt(params.get(name), 10);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};
const SPEEDS = [0, 0.5, 1, 2, 4, 8];
const LEVELS = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Tricky']];
const TITLES = { hideSeek: 'Hide and seek', freezeTag: 'Freeze tag', dodgeball: 'Dodgeball', captureBow: 'Capture the Bow' };
const opts = {
  mode: MODE_IDS.includes(params.get('mode')) ? params.get('mode') : 'dodgeball',
  n: intParam('n', 2, 10, 6),
  seed: intParam('seed', 1, 1e9, 1 + Math.floor(Math.random() * 9999)),
  level: LEVELS.some(([id]) => id === params.get('level')) ? params.get('level') : 'normal',
  me: params.get('me') === '1',
};
let speed = SPEEDS.includes(Number(params.get('speed'))) && params.get('speed') !== null ? Number(params.get('speed')) : 1;
const warp = Math.min(600, Math.max(0, Number(params.get('warp')) || 0));
const until = ['countdown', 'hide', 'play', 'results', 'lobby'].includes(params.get('until')) ? params.get('until') : null;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const KIND_STYLE = {
  hedge: { fill: '#7fcf8a', shape: 'box' },
  bush: { fill: '#a8e6a1', shape: 'blob' },
  slide: { fill: '#b89cf0', shape: 'box' },
  tent: { fill: '#ffc4a8', shape: 'tri' },
  rack: { fill: '#ffe68a', shape: 'box' },
  cloud: { fill: '#ffffff', shape: 'blob' },
  barrel: { fill: '#e0b48a', shape: 'circle' },
  curtain: { fill: '#ff8cc6', shape: 'box' },
};

let sim = null;
let viewer = null;
let particles = [];
let puffs = [];
let log = [];
let keys = new Set();
let simTime = 0; // seconds of game time since this game started
let panelAt = 0;

// ---------- game set-up ----------

function newGame() {
  sim = createSim({
    kind: opts.mode,
    players: opts.n,
    humans: opts.me ? 1 : 0,
    seed: opts.seed,
    settings: { botLevel: opts.level },
  });
  viewer = sim.game.state.order[0] || null;
  particles = [];
  puffs = [];
  log = [];
  simTime = 0;
  if (warp > 0) {
    for (let t = 0; t < warp; t += 1 / 30) step(1 / 30, true);
  }
  if (until) {
    for (let t = 0; t < 600 && sim.game.state.phase !== until; t += 1 / 30) step(1 / 30, true);
  }
  syncControls();
  writeUrl();
}

function writeUrl() {
  const q = new URLSearchParams({ mode: opts.mode, n: String(opts.n), seed: String(opts.seed), level: opts.level, speed: String(speed) });
  if (opts.me) q.set('me', '1');
  history.replaceState(null, '', `?${q}`);
}

function step(dt, quiet = false) {
  simTime += dt;
  if (opts.me && viewer && sim.game.state.players[sim.game.state.order[0]]) {
    const me = sim.game.state.order[0];
    const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    const z = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
    sim.steer(me, { x, z });
  }
  const fx = sim.step(dt);
  for (const f of fx) {
    if (f.burst && Number.isFinite(f.x) && Number.isFinite(f.z) && !quiet) burst(f.x, f.z, f.type);
    if (f.type === 'hint' && !quiet) for (const s of f.spots) puffs.push({ x: s.x, z: s.z, t: 0 });
    if (f.type === 'win' && !quiet) {
      for (const id of f.ids) {
        const b = sim.bodies.get(id);
        if (b) burst(b.x, b.z, 'win');
      }
    }
    const text = sim.game.fxText(f, viewer);
    if (text) {
      log.unshift({ t: simTime, text });
      if (log.length > 12) log.length = 12;
    }
  }
}

function burst(x, z, type) {
  const colors = type === 'freeze' || type === 'melt' ? ['#9fd8ff', '#ffffff', '#cdb4ff'] : [PALETTE.rhinestonePink, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver, PALETTE.gold];
  const n = type === 'win' ? 26 : 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const v = 1.5 + Math.random() * 3;
    particles.push({ x, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, t: 0, life: 0.7 + Math.random() * 0.6, c: colors[i % colors.length] });
  }
}

// ---------- view transform ----------

let view = { k: 10, cx: 0, cz: 0, w: 1, h: 1 };

function corners(area, pad = 0) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => toWorld(area.f, sx * (area.hw + pad), sz * (area.hd + pad)));
}

function fit() {
  const A = sim.game.arena;
  const pts = corners(A.area, opts.mode === 'dodgeball' ? 4.5 : 2);
  if (A.start) pts.push(A.start);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  view = { k: Math.min(w / (x1 - x0), h / (z1 - z0)) * 0.92, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w, h };
}

const S = (x, z) => [view.w / 2 + (x - view.cx) * view.k, view.h / 2 + (z - view.cz) * view.k];

// ---------- drawing ----------

function poly(points) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const [sx, sy] = S(p.x, p.z);
    if (i) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  ctx.closePath();
}

function drawArena() {
  const g = sim.game;
  const A = g.arena;
  const kind = opts.mode;
  const base = { hideSeek: PALETTE.grass, freezeTag: '#c9f2dc', dodgeball: '#ffe9f4', captureBow: '#eef8e6' }[kind];
  ctx.save();
  poly(corners(A.area));
  ctx.fillStyle = base;
  ctx.fill();
  ctx.clip();
  if (kind === 'dodgeball' || kind === 'captureBow') {
    // tint each team's half
    let o;
    let u;
    if (kind === 'dodgeball') {
      o = { x: A.area.f.x, z: A.area.f.z };
      u = toWorld({ ...A.area.f, x: 0, z: 0 }, 0, 1);
    } else {
      const [b0, b1] = A.bases;
      o = { x: (b0.x + b1.x) / 2, z: (b0.z + b1.z) / 2 };
      const l = Math.hypot(b1.x - b0.x, b1.z - b0.z) || 1;
      u = { x: (b1.x - b0.x) / l, z: (b1.z - b0.z) / l };
    }
    const big = 400;
    for (const t of [0, 1]) {
      const sgn = t === 0 ? -1 : 1;
      const px = -u.z;
      const pz = u.x;
      poly([
        { x: o.x + px * big, z: o.z + pz * big },
        { x: o.x - px * big, z: o.z - pz * big },
        { x: o.x - px * big + u.x * big * sgn, z: o.z - pz * big + u.z * big * sgn },
        { x: o.x + px * big + u.x * big * sgn, z: o.z + pz * big + u.z * big * sgn },
      ]);
      ctx.fillStyle = TEAMS[t].color;
      ctx.globalAlpha = 0.13;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const [ax, ay] = S(o.x + -u.z * big, o.z + u.x * big);
    const [bx, by] = S(o.x - -u.z * big, o.z - u.x * big);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  poly(corners(A.area));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.stroke();

  if (kind === 'dodgeball') {
    // benches along the sideline
    for (const t of [0, 1]) {
      const sgn = t === 0 ? -1 : 1;
      const a = toWorld(A.area.f, -(A.area.hw + 0.8), sgn * 0.8);
      const b = toWorld(A.area.f, -(A.area.hw + 2.4), sgn * (A.area.hd - 0.5));
      poly([a, toWorld(A.area.f, -(A.area.hw + 2.4), sgn * 0.8), b, toWorld(A.area.f, -(A.area.hw + 0.8), sgn * (A.area.hd - 0.5))]);
      ctx.fillStyle = TEAMS[t].color;
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  if (kind === 'captureBow') {
    for (const b of A.bases) {
      const [x, y] = S(b.x, b.z);
      ctx.beginPath();
      ctx.arc(x, y, b.r * view.k, 0, Math.PI * 2);
      ctx.fillStyle = TEAMS[b.team].color;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = TEAMS[b.team].color;
      ctx.stroke();
    }
  }
  if (kind === 'hideSeek') {
    for (const s of A.spots) drawSpot(s);
    const [sx, sy] = S(A.start.x, A.start.z);
    star(sx, sy, 9, PALETTE.gold);
  }
}

function drawSpot(s) {
  const st = KIND_STYLE[s.kind] || KIND_STYLE.bush;
  const [x, y] = S(s.x, s.z);
  const r = s.r * view.k;
  ctx.fillStyle = st.fill;
  ctx.strokeStyle = 'rgba(43, 34, 51, .25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (st.shape === 'box') ctx.roundRect(x - r, y - r * 0.7, r * 2, r * 1.4, r * 0.3);
  else if (st.shape === 'tri') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
  } else if (st.shape === 'blob') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.moveTo(x + Math.cos(a) * r * 0.45 + r * 0.55, y + Math.sin(a) * r * 0.45);
      ctx.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.55, 0, Math.PI * 2);
    }
  } else ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function star(x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function bow(x, y, s, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#17121c';
  ctx.lineWidth = 1.5;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + sgn * s * 1.3, y - s * 1.1, x + sgn * s * 1.1, y);
    ctx.quadraticCurveTo(x + sgn * s * 1.3, y + s * 1.1, x, y);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, s * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#17121c';
  for (const [dx, dy] of [[-0.75, -0.2], [0.7, 0.25], [-0.55, 0.35], [0.55, -0.35]]) star(x + dx * s, y + dy * s, s * 0.14, '#17121c');
}

function drawBows() {
  const st = sim.game.state;
  if (!st.bows) return;
  for (const b of st.bows) {
    if (b.s === 'carried') continue;
    const [x, y] = S(b.x, b.z);
    bow(x, y, Math.max(8, view.k * 1.1), TEAMS[b.team].color);
    if (b.s === 'dropped') {
      const left = Math.max(0, (b.at - sim.now) / (st.settings.returnSeconds * 1000));
      ctx.beginPath();
      ctx.arc(x, y, view.k * 1.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.strokeStyle = TEAMS[b.team].color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

function drawBalls() {
  const st = sim.game.state;
  if (!st.balls) return;
  for (const b of st.balls) {
    if (b.s === 'held') continue;
    const p = ballPos(b, sim.now);
    const [x, y] = S(p.x, p.z);
    const r = Math.max(4, 0.3 * view.k * 1.4);
    if (b.s === 'air') {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(43, 34, 51, .22)';
      ctx.fill();
      for (let k = 1; k <= 4; k++) {
        const q = ballPos(b, sim.now - k * 40);
        const [tx, ty] = S(q.x, q.z);
        ctx.beginPath();
        ctx.arc(tx, ty - q.y * view.k * 0.5, r * (1 - k * 0.18), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 46, 147, ${0.25 - k * 0.05})`;
        ctx.fill();
      }
    }
    const lift = b.s === 'air' ? p.y * view.k * 0.5 : 0;
    ctx.beginPath();
    ctx.arc(x, y - lift, r, 0, Math.PI * 2);
    ctx.fillStyle = b.s === 'air' && b.fl && !b.fl.done ? '#ffd36e' : '#ffe9a8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff7ad1';
    ctx.stroke();
  }
}

function drawPlayers() {
  const g = sim.game;
  const st = g.state;
  const team = MODES[opts.mode].teams;
  const r = Math.max(7, 0.5 * view.k);
  ctx.textAlign = 'center';
  for (const id of st.order) {
    const body = sim.bodies.get(id);
    if (!body) continue;
    const w = g.who(id, body);
    const p = st.players[id];
    const [x, y] = S(body.x, body.z);
    ctx.globalAlpha = w.hidden ? 0.5 : 1;
    if (w.glow) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
      ctx.fillStyle = w.color || '#fff';
      ctx.globalAlpha *= 0.3;
      ctx.fill();
      ctx.globalAlpha = w.hidden ? 0.5 : 1;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = w.role === 'frozen' ? '#d9f0ff' : team ? TEAMS[p.team].color : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = w.color || (team ? '#ffffff' : '#b89cf0');
    if (w.hidden) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // heading notch
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(body.h) * r * 1.35, y + Math.cos(body.h) * r * 1.35);
    ctx.strokeStyle = '#2b2233';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (w.role === 'frozen') {
      ctx.strokeStyle = '#4aa8e8';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * r * 0.7, y - Math.sin(a) * r * 0.7);
        ctx.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
        ctx.stroke();
      }
    }
    if (w.carrying === 'ball') {
      ctx.beginPath();
      ctx.arc(x + r * 0.9, y - r * 0.6, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd36e';
      ctx.fill();
      ctx.strokeStyle = '#ff7ad1';
      ctx.stroke();
    } else if (w.carrying === 'bow0' || w.carrying === 'bow1') {
      bow(x, y - r * 1.5, r * 0.8, TEAMS[w.carrying === 'bow0' ? 0 : 1].color);
    }
    if (id === viewer) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = PALETTE.pink;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.fillStyle = '#2b2233';
    ctx.font = `700 13px ${FONT_STACK}`;
    ctx.fillText(p.nick || id, x, y - r - 6);
    const anim = body.anim && !['idle', 'walk', 'run'].includes(body.anim) ? body.anim : '';
    if (anim) {
      ctx.font = `600 11px ${FONT_STACK}`;
      ctx.fillStyle = 'rgba(43, 34, 51, .7)';
      ctx.fillText(anim, x, y + r + 13);
    }
    ctx.globalAlpha = 1;
  }
}

function drawFx(dt) {
  for (const p of puffs) p.t += dt;
  puffs = puffs.filter((p) => p.t < 2.5);
  for (const p of puffs) {
    const [x, y] = S(p.x, p.z);
    const a = 1 - p.t / 2.5;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + p.t * 2;
      ctx.globalAlpha = a;
      star(x + Math.cos(ang) * (10 + p.t * 14), y + Math.sin(ang) * (10 + p.t * 14) - p.t * 10, 6, i % 2 ? PALETTE.rhinestonePink : PALETTE.gold);
    }
    ctx.globalAlpha = 1;
  }
  for (const p of particles) {
    p.t += dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
  }
  particles = particles.filter((p) => p.t < p.life);
  for (const p of particles) {
    const [x, y] = S(p.x, p.z);
    ctx.globalAlpha = 1 - p.t / p.life;
    star(x, y, 5, p.c);
  }
  ctx.globalAlpha = 1;
}

function drawBig() {
  if (!viewer) return;
  const u = sim.game.ui(viewer, sim.now);
  if (!u.big) return;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const x = view.w / 2;
  const y = view.h * 0.42;
  ctx.font = `800 ${Math.round(Math.min(64, view.w / 9))}px ${FONT_STACK}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(u.big.text, x, y);
  ctx.fillStyle = PALETTE.pink;
  ctx.fillText(u.big.text, x, y);
  if (u.big.sub) {
    ctx.font = `700 ${Math.round(Math.min(26, view.w / 24))}px ${FONT_STACK}`;
    ctx.lineWidth = 6;
    ctx.strokeText(u.big.sub, x, y + 40);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(u.big.sub, x, y + 40);
  }
}

// ---------- side panel ----------

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function updatePanel() {
  const g = sim.game;
  const st = g.state;
  const u = g.ui(viewer, sim.now);
  $('phase').textContent = `${TITLES[opts.mode]} · ${st.phase} · round ${st.round}`;
  $('timer').textContent = u.timerText;
  $('badge').innerHTML = u.roleBadge ? `<span class="badge" style="background:${esc(u.roleBadge.color)}">${esc(u.roleBadge.text)}</span> <small>${esc(st.players[viewer] ? st.players[viewer].nick : '')}</small>` : '';
  $('line').textContent = u.line || ' ';
  $('action').innerHTML = u.action ? `<button class="on" id="act">${esc(u.action.label)}</button>` : '';
  const act = document.getElementById('act');
  if (act) act.onclick = () => sim.press(viewer);
  $('sbtitle').textContent = u.scoreboard ? u.scoreboard.title : 'Score';
  $('score').innerHTML = (u.scoreboard ? u.scoreboard.rows : [])
    .map((r) => `<tr class="${r.me ? 'me' : ''}"><td>${r.color ? `<span class="swatch" style="background:${esc(r.color)}"></span>` : ''}${esc(r.label)}</td><td class="v">${esc(r.value)}${r.wins !== undefined ? ` <small>(${esc(r.wins)} won)</small>` : ''}</td></tr>`)
    .join('');
  $('log').innerHTML = log.map((e) => `<li><small>${e.t.toFixed(0)}s</small>${esc(e.text)}</li>`).join('');
}

// ---------- controls ----------

function button(parent, label, on, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  if (on) b.classList.add('on');
  b.onclick = fn;
  parent.appendChild(b);
  return b;
}

function syncControls() {
  const modes = $('modes');
  modes.innerHTML = '';
  for (const id of MODE_IDS) button(modes, TITLES[id], id === opts.mode, () => { opts.mode = id; newGame(); });
  $('count').textContent = String(opts.n);
  const lv = $('levels');
  lv.innerHTML = '';
  for (const [id, label] of LEVELS) button(lv, label, id === opts.level, () => { opts.level = id; newGame(); });
  const sp = $('speeds');
  sp.innerHTML = '';
  for (const s of SPEEDS) button(sp, s === 0 ? 'Pause' : s === 0.5 ? '½×' : `${s}×`, s === speed, () => { speed = s; syncControls(); writeUrl(); });
  $('me').classList.toggle('on', opts.me);
}

$('minus').onclick = () => { opts.n = Math.max(2, opts.n - 1); newGame(); };
$('plus').onclick = () => { opts.n = Math.min(10, opts.n + 1); newGame(); };
$('restart').onclick = () => { opts.seed = 1 + Math.floor(Math.random() * 9999); newGame(); };
$('me').onclick = () => { opts.me = !opts.me; newGame(); };

addEventListener('keydown', (e) => {
  if (!opts.me) return;
  if (e.code === 'Space') {
    e.preventDefault();
    sim.press(sim.game.state.order[0]);
  }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys = new Set(); });

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let best = null;
  let bestD = 30;
  for (const [id, b] of sim.bodies) {
    const [x, y] = S(b.x, b.z);
    const d = Math.hypot(x - mx, y - my);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  if (best) {
    viewer = best;
    log = [];
    updatePanel();
  }
});

// ---------- loop ----------

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);

let last = performance.now();
let acc = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  acc += dt * speed;
  let n = 0;
  while (acc >= 1 / 30 && n < 16) {
    step(1 / 30);
    acc -= 1 / 30;
    n++;
  }
  if (n >= 16) acc = 0;
  if (!sim.game.state.players[viewer]) viewer = sim.game.state.order[0] || null;
  fit();
  ctx.clearRect(0, 0, view.w, view.h);
  const sky = ctx.createLinearGradient(0, 0, 0, view.h);
  sky.addColorStop(0, '#dfe9ff');
  sky.addColorStop(1, '#ffe3f1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, view.w, view.h);
  drawArena();
  drawBows();
  drawPlayers();
  drawBalls();
  drawFx(dt * (speed || 0));
  drawBig();
  if (t - panelAt > 120) {
    panelAt = t;
    updatePanel();
  }
  requestAnimationFrame(frame);
}

newGame();
resize();
requestAnimationFrame(frame);
window.__gamesSim = { get sim() { return sim; }, get opts() { return opts; } };
