// Net lab: a 2D test bench for js/net/. Each tab is a dot you drive with the arrow keys (or WASD),
// or by dragging on the screen. Other tabs show up interpolated, the host wears a crown, emotes pop
// up as bubbles and everything that happens is logged.
//
//   ?net=local|offline|firebase   which transport (default: createNet's 'auto')
//   ?nick=Name                    your name     ?auto=create    make a room on load     ?join=CODE   join on load
//
// window.__lab is for automated tests: { net, me(), place(x, z), walkTo(x, z), create(), join(code),
// leave(), addBot(), emote(id), startGame(), log, events }.

import { createNet } from '../js/net/index.js';
import { PALETTE, FONT_STACK } from '../js/config.js';

document.body.style.setProperty('--font', FONT_STACK);
const params = new URLSearchParams(location.search);
const net = createNet();
window.__net = net;

// The real quick-cheers when the content module is there (net checks emotes with its cleanEmote).
let EMOTES = [
  { id: 'woo', text: 'Woo!' },
  { id: 'clap', text: 'Clap clap!' },
  { id: 'sparkle', text: 'Sparkle!' },
  { id: 'goTeam', text: 'Go team!' },
];
try {
  const m = await import('../js/content/emotes.js');
  const list = Array.isArray(m.EMOTES) ? m.EMOTES.filter((e) => e && typeof e.id === 'string').slice(0, 6) : [];
  if (list.length) EMOTES = list.map((e) => ({ id: e.id, text: String(e.text || e.id) }));
} catch (err) { /* not there yet */ }
const EMOTE_TEXT = new Map(EMOTES.map((e) => [e.id, e.text]));
const NICKS = ['Sparkle Comet', 'Glitter Star', 'Pom Pom Pal', 'Cloud Flyer', 'Rainbow Kick', 'Twinkle Toes'];
const BOT_NICKS = ['Robo Spark', 'Bot Bow', 'Beep Flyer', 'Buddy Bot'];
const REASONS = {
  'not-found': "Hmm, no room with that code. Check the letters?",
  full: 'That room is full right now.',
  offline: "Can't reach the clouds right now.",
  'bad-code': 'Room codes are 4 letters and numbers.',
};
const nick = params.get('nick') || NICKS[Math.floor(Math.random() * NICKS.length)];
const AREA = 20;

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');

const me = { x: (Math.random() - 0.5) * 8, y: 0, z: (Math.random() - 0.5) * 8, h: 0, anim: 'idle' };
const keys = new Set();
let drag = null;
let target = null;
const bubbles = new Map();
const nicks = new Map();
const bots = new Map();
const logLines = [];
const eventsSeen = [];
let gameRound = 0;
let hostToName = null; // the host changed before we knew their name

// ---- log ------------------------------------------------------------------------------------------
const nameOf = (id) => (id === net.me.id ? 'you' : nicks.get(id) || 'someone');
function log(text) {
  const t = new Date();
  const line = String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0') + '  ' + text;
  logLines.push(line);
  if (logLines.length > 200) logLines.shift();
  const box = $('log');
  box.textContent = '';
  for (const l of logLines.slice(-30)) {
    const d = document.createElement('div');
    d.textContent = l;
    box.appendChild(d);
  }
}

net.on('status', (s) => {
  log('status: ' + s);
  refresh();
});
net.on('join', ({ id }) => {
  const p = net.players.get(id);
  if (p) nicks.set(id, p.nick + (p.bot ? ' (bot)' : ''));
  log(nameOf(id) + ' joined');
  if (hostToName === id) {
    hostToName = null;
    log(nameOf(id) + ' is the host');
  }
  refresh();
});
net.on('player', ({ id }) => {
  const p = net.players.get(id);
  if (p) nicks.set(id, p.nick + (p.bot ? ' (bot)' : ''));
});
net.on('leave', ({ id, reason }) => {
  log(nameOf(id) + (id === net.me.id ? ' left the room' + (reason && reason !== 'left' ? ' (' + reason + ')' : '') : ' left'));
  bots.delete(id);
  bubbles.delete(id);
  refresh();
});
net.on('host', ({ id }) => {
  if (id && !nicks.has(id) && id !== net.me.id) hostToName = id;
  else if (id) log(nameOf(id) + (id === net.me.id ? ' are' : ' is') + ' the host');
  if (id !== net.me.id) bots.clear();
  refresh();
});
net.on('event', (e) => {
  eventsSeen.push({ from: e.from, type: e.type, data: e.data });
  if (e.type === 'emote') {
    // never show text from the network: emotes are preset ids
    const text = e.data && typeof e.data.id === 'string' ? EMOTE_TEXT.get(e.data.id) : null;
    if (!text) return;
    bubbles.set(e.from, { text, until: performance.now() + 2200 });
    log(nameOf(e.from) + ': ' + text);
  } else {
    log(nameOf(e.from) + ' sent ' + e.type);
  }
});
net.on('game', (g) => {
  $('game').textContent = g ? 'game: ' + JSON.stringify(g) : '';
  if (g) log('game state: round ' + g.round);
});

// ---- controls -------------------------------------------------------------------------------------
function create() {
  return net.createRoom({ nick }).then(
    (code) => {
      log('made room ' + code);
      refresh();
      return code;
    },
    (err) => {
      log('could not make a room: ' + (REASONS[err.reason] || err.reason));
      refresh();
      throw err;
    },
  );
}
function join(code) {
  return net.joinRoom(code, { nick }).then((r) => {
    log(r.ok ? 'joined room ' + net.room.code : REASONS[r.reason] || r.reason);
    refresh();
    return r;
  });
}
function addBot() {
  const id = net.addBot({ nick: BOT_NICKS[bots.size % BOT_NICKS.length] });
  if (id) bots.set(id, { phase: Math.random() * 6, r: 3 + Math.random() * 6, cx: (Math.random() - 0.5) * 10, cz: (Math.random() - 0.5) * 10 });
  refresh();
  return id;
}
function emote(id) {
  return net.send('emote', { id });
}
function startGame() {
  if (!net.isHost) return false;
  gameRound++;
  const scores = {};
  for (const p of net.players.values()) scores[p.id] = Math.floor(Math.random() * 5);
  net.setGame({ kind: 'demo', phase: 'play', round: gameRound, scores });
  return net.send('game-start', { kind: 'demo', round: gameRound });
}

$('create').onclick = () => create().catch(() => {});
$('join').onclick = () => join($('joinCode').value);
$('joinCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join($('joinCode').value);
});
$('leave').onclick = () => net.leaveRoom().then(refresh);
$('bot').onclick = () => addBot();
$('game-btn').onclick = () => startGame();
for (const e of EMOTES) {
  const b = document.createElement('button');
  b.className = 'emote';
  b.textContent = e.text;
  b.onclick = () => emote(e.id);
  $('emotes').appendChild(b);
}

function refresh() {
  const st = $('status');
  st.textContent = net.mode + ' · ' + net.status;
  st.className = 'pill ' + net.status;
  $('code').textContent = net.room ? net.room.code : '';
  $('host').hidden = !net.isHost;
  $('leave').disabled = !net.room;
  $('bot').disabled = !net.isHost;
  $('game-btn').disabled = !net.isHost;
  $('join').disabled = net.mode === 'offline';
  const d = net.debug();
  $('who').textContent = net.players.size + ' in the room' + (d.leader ? ' · this tab leads' : '') + ' · sent ' + net.stats.sentStates + ' · dropped ' + Object.values(net.stats.dropped).reduce((a, b) => a + b, 0);
}
setInterval(refresh, 500);

// ---- input ----------------------------------------------------------------------------------------
const MOVE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (MOVE[e.key]) {
    keys.add(e.key);
    target = null;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', (e) => {
  drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId };
  target = null;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id) {
    drag.x = e.clientX;
    drag.y = e.clientY;
  }
});
const endDrag = (e) => {
  if (drag && e.pointerId === drag.id) drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- loop -----------------------------------------------------------------------------------------
function hue(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  let mx = 0;
  let mz = 0;
  for (const k of keys) {
    mx += MOVE[k][0];
    mz += MOVE[k][1];
  }
  if (drag) {
    const dx = drag.x - drag.x0;
    const dy = drag.y - drag.y0;
    const len = Math.hypot(dx, dy);
    if (len > 10) {
      mx = dx / len;
      mz = dy / len;
    }
  }
  let step = 5 * dt;
  if (target) {
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d <= step) {
      me.x = target.x;
      me.z = target.z;
      target = null;
    } else {
      mx = dx / d;
      mz = dz / d;
    }
  }
  if (mx || mz) {
    const len = Math.hypot(mx, mz);
    me.x = Math.max(-AREA, Math.min(AREA, me.x + (mx / len) * step));
    me.z = Math.max(-AREA, Math.min(AREA, me.z + (mz / len) * step));
    me.h = Math.atan2(mx, mz);
    me.anim = 'walk';
  } else {
    me.anim = 'idle';
  }
  net.sendState(me);
  if (net.isHost) {
    for (const [id, b] of bots) {
      b.phase += dt * 0.7;
      net.sendStateFor(id, { x: b.cx + Math.cos(b.phase) * b.r, y: 0, z: b.cz + Math.sin(b.phase) * b.r, h: -b.phase, anim: 'walk' });
    }
  }
  draw(t);
  requestAnimationFrame(frame);
}

function draw(t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const scale = Math.min(W, H) / (AREA * 2 + 4);
  const sx = (x) => W / 2 + x * scale;
  const sy = (z) => H / 2 + z * scale;

  // the plaza: a soft cloud disc and a grid
  ctx.fillStyle = 'rgba(255, 244, 250, 0.75)';
  ctx.beginPath();
  ctx.arc(sx(0), sy(0), AREA * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(184, 156, 240, 0.35)';
  ctx.lineWidth = 1;
  for (let g = -AREA; g <= AREA; g += 4) {
    ctx.beginPath();
    ctx.moveTo(sx(g), sy(-AREA));
    ctx.lineTo(sx(g), sy(AREA));
    ctx.moveTo(sx(-AREA), sy(g));
    ctx.lineTo(sx(AREA), sy(g));
    ctx.stroke();
  }

  const list = net.room ? [...net.players.values()] : [{ id: net.me.id || 'me', nick, bot: false }];
  const hostId = net.room ? net.room.hostId : null;
  const r = Math.max(12, 0.7 * scale);
  ctx.textAlign = 'center';
  ctx.font = '700 16px ' + FONT_STACK;
  for (const p of list) {
    const mine = p.id === net.me.id || !net.room;
    const s = mine ? me : net.stateOf(p.id);
    if (!s) continue;
    const x = sx(s.x);
    const y = sy(s.z);
    ctx.fillStyle = mine ? PALETTE.pink : 'hsl(' + hue(p.id) + ', 80%, 68%)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = mine ? 4 : 2;
    ctx.strokeStyle = mine ? PALETTE.white : PALETTE.ink;
    if (p.bot) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    // heading
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(s.h) * r * 1.4, y + Math.cos(s.h) * r * 1.4);
    ctx.stroke();
    // name
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(p.nick + (p.bot ? ' (bot)' : ''), x, y + r + 18);
    // the host's crown
    if (p.id === hostId) {
      ctx.fillStyle = PALETTE.gold;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 1.5;
      const cy = y - r - 6;
      ctx.beginPath();
      ctx.moveTo(x - 12, cy);
      ctx.lineTo(x - 12, cy - 12);
      ctx.lineTo(x - 6, cy - 6);
      ctx.lineTo(x, cy - 15);
      ctx.lineTo(x + 6, cy - 6);
      ctx.lineTo(x + 12, cy - 12);
      ctx.lineTo(x + 12, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // an emote bubble
    const b = bubbles.get(p.id);
    if (b && b.until > t) {
      const w = ctx.measureText(b.text).width + 20;
      const by = y - r - (p.id === hostId ? 48 : 30);
      ctx.fillStyle = PALETTE.white;
      ctx.strokeStyle = PALETTE.pink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, by - 24, w, 30, 12);
      else ctx.rect(x - w / 2, by - 24, w, 30);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.pink;
      ctx.fillText(b.text, x, by - 3);
    } else if (b) bubbles.delete(p.id);
  }
  if (!net.room) {
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText('Make a room, or join one with its code', W / 2, 30);
  }
}

window.__lab = {
  net,
  me: () => ({ ...me }),
  place(x, z) {
    me.x = x;
    me.z = z;
    target = null;
  },
  walkTo(x, z) {
    target = { x, z };
  },
  create,
  join,
  leave: () => net.leaveRoom(),
  addBot,
  emote,
  emoteIds: EMOTES.map((e) => e.id),
  startGame,
  log: logLines,
  events: eventsSeen,
};

refresh();
requestAnimationFrame(frame);
if (params.get('auto') === 'create') create().catch(() => {});
else if (params.get('join')) join(params.get('join'));
