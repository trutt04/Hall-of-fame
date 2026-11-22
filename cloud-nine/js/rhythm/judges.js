// The judges' panel: three cartoon judges behind a pink-draped table, holding up score cards.
// Canvas 2D shapes only. Left to right (lines.js JUDGES): Professor Hoot the owl (motions),
// Sparkle the unicorn (spirit) and Nimbus the cloud (stunts).
//
//   const panel = createJudgesPanel()
//   panel.setCards([9.5, 10, 8])        the numbers on the cards
//   panel.reveal(n, now?)               n cards are up (0..3); newly raised cards pop up with a bounce
//   panel.talking(i | -1)               judge i bobs while they say their line
//   panel.draw(ctx, x, y, w, h, t, { cheering, calm })   t: seconds (any running clock)
//   panel.anchor(i, x, y, w, h)         -> { x, y } just above judge i's head, for a speech bubble

import { PALETTE, FONT_STACK } from '../config.js';
import { drawBow, starPath } from './figure.js';

const INK = PALETTE.ink;
const TAU = Math.PI * 2;

const easeBack = (x) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function outlined(ctx, fill, lw) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function eyes(ctx, x, y, gap, r, lw, blink, { lashes = false, shine = true } = {}) {
  for (const s of [-1, 1]) {
    const ex = x + s * gap;
    if (blink) {
      ctx.beginPath();
      ctx.moveTo(ex - r, y);
      ctx.quadraticCurveTo(ex, y + r * 0.7, ex + r, y);
      ctx.lineWidth = lw * 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.ellipse(ex, y, r * 0.8, r, 0, 0, TAU);
    ctx.fillStyle = INK;
    ctx.fill();
    if (shine) {
      circle(ctx, ex + r * 0.25, y - r * 0.35, r * 0.32);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    if (lashes) {
      ctx.lineWidth = lw * 0.9;
      ctx.strokeStyle = INK;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + s * (0.35 + i * 0.32);
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 1.05);
        ctx.lineTo(ex + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.55);
        ctx.stroke();
      }
    }
  }
}

function cheeks(ctx, x, y, gap, r) {
  ctx.fillStyle = 'rgba(255,110,170,0.45)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + s * gap, y, r, r * 0.6, 0, 0, TAU);
    ctx.fill();
  }
}

function smile(ctx, x, y, w, lw, open) {
  ctx.beginPath();
  if (open) {
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y + w * 1.6, x + w, y);
    ctx.closePath();
    ctx.fillStyle = '#c2185b';
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
  } else {
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y + w * 0.9, x + w, y);
    ctx.lineWidth = lw * 1.1;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ the three judges
// Each draws centred on (cx, base), `s` pixels tall from the table line up. Returns the hand
// position that holds the card.

function drawOwl(ctx, cx, base, s, st) {
  const lw = Math.max(1.5, s * 0.025);
  const bodyW = s * 0.42;
  const top = base - s * 0.96;
  // body
  ctx.beginPath();
  ctx.ellipse(cx, base - s * 0.28, bodyW, s * 0.42, 0, 0, TAU);
  outlined(ctx, PALETTE.lavender, lw);
  ctx.beginPath();
  ctx.ellipse(cx, base - s * 0.2, bodyW * 0.62, s * 0.3, 0, 0, TAU);
  ctx.fillStyle = '#efe6ff';
  ctx.fill();
  // belly feathers
  ctx.lineWidth = lw * 0.7;
  ctx.strokeStyle = PALETTE.lavender;
  for (let r = 0; r < 3; r++) {
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(cx + i * s * 0.1 + (r % 2) * s * 0.05, base - s * 0.34 + r * s * 0.09, s * 0.04, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }
  // head
  const hy = top + s * 0.3;
  const hr = s * 0.3;
  // ear tufts
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sd * hr * 0.45, hy - hr * 0.78);
    ctx.lineTo(cx + sd * hr * 0.95, hy - hr * 1.28);
    ctx.lineTo(cx + sd * hr * 0.92, hy - hr * 0.5);
    ctx.closePath();
    outlined(ctx, '#9a7fe0', lw);
  }
  ctx.beginPath();
  ctx.ellipse(cx, hy, hr * 1.08, hr, 0, 0, TAU);
  outlined(ctx, PALETTE.lavender, lw);
  // face disc
  ctx.beginPath();
  ctx.ellipse(cx, hy + hr * 0.06, hr * 0.9, hr * 0.72, 0, 0, TAU);
  ctx.fillStyle = '#f6f0ff';
  ctx.fill();
  // big eyes behind round gold glasses
  const gap = hr * 0.42;
  const er = hr * 0.34;
  for (const sd of [-1, 1]) {
    circle(ctx, cx + sd * gap, hy, er);
    outlined(ctx, '#ffffff', lw);
  }
  eyes(ctx, cx + (st.look || 0) * er * 0.2, hy + er * 0.05, gap, er * 0.42, lw, st.blink);
  ctx.lineWidth = lw * 1.5;
  ctx.strokeStyle = PALETTE.gold;
  for (const sd of [-1, 1]) {
    circle(ctx, cx + sd * gap, hy, er * 1.08);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - gap + er * 1.05, hy - er * 0.2);
  ctx.quadraticCurveTo(cx, hy - er * 0.55, cx + gap - er * 1.05, hy - er * 0.2);
  ctx.stroke();
  // beak
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.13, hy + hr * 0.36);
  ctx.lineTo(cx + hr * 0.13, hy + hr * 0.36);
  ctx.lineTo(cx, hy + hr * (st.open ? 0.66 : 0.58));
  ctx.closePath();
  outlined(ctx, '#ffb347', lw * 0.8);
  // pink bow tie
  const by = hy + hr * 1.02;
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, by);
    ctx.lineTo(cx + sd * s * 0.12, by - s * 0.055);
    ctx.lineTo(cx + sd * s * 0.12, by + s * 0.055);
    ctx.closePath();
    outlined(ctx, PALETTE.pink, lw * 0.8);
  }
  circle(ctx, cx, by, s * 0.03);
  outlined(ctx, PALETTE.pink, lw * 0.8);
  // wings: the right one holds the card
  ctx.beginPath();
  ctx.ellipse(cx - bodyW * 0.95, base - s * 0.3, s * 0.09, s * 0.2, 0.3, 0, TAU);
  outlined(ctx, '#9a7fe0', lw);
  limbTo(ctx, cx + bodyW * 0.78, base - s * 0.2, st.hand.x, st.hand.y, s * 0.17, '#9a7fe0', lw);
}

// a wing-like oval stretched from (x0, y0) to (x1, y1)
function limbTo(ctx, x0, y0, x1, y1, width, color, lw) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  ctx.save();
  ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
  ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
  ctx.beginPath();
  ctx.ellipse(0, 0, len / 2 + width * 0.35, width / 2, 0, 0, TAU);
  outlined(ctx, color, lw);
  ctx.restore();
}

function drawUnicorn(ctx, cx, base, s, st, t) {
  const lw = Math.max(1.5, s * 0.025);
  const hr = s * 0.3;
  const hy = base - s * 0.62;
  const mane = [PALETTE.pinkSoft, PALETTE.lemon, PALETTE.mint, PALETTE.babyBlue, PALETTE.lilac];
  // neck and shoulders
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.36, base);
  ctx.quadraticCurveTo(cx - s * 0.34, base - s * 0.34, cx - s * 0.18, base - s * 0.46);
  ctx.lineTo(cx + s * 0.18, base - s * 0.46);
  ctx.quadraticCurveTo(cx + s * 0.34, base - s * 0.34, cx + s * 0.36, base);
  ctx.closePath();
  outlined(ctx, '#fff5fb', lw);
  // sparkly scarf
  ctx.beginPath();
  ctx.ellipse(cx, base - s * 0.38, s * 0.26, s * 0.07, 0, 0, TAU);
  outlined(ctx, PALETTE.pink, lw);
  for (let i = -2; i <= 2; i++) {
    ctx.fillStyle = i % 2 ? PALETTE.rhinestoneSilver : PALETTE.lemon;
    starPath(ctx, cx + i * s * 0.09, base - s * 0.38, s * 0.022, 4, 0.4);
    ctx.fill();
  }
  // mane locks behind the head
  mane.forEach((c, i) => {
    const sd = i % 2 ? 1 : -1;
    const off = Math.floor(i / 2);
    ctx.beginPath();
    ctx.ellipse(cx + sd * hr * (0.82 + off * 0.12), hy + hr * (0.05 + off * 0.42), hr * 0.32, hr * 0.5, sd * 0.3, 0, TAU);
    outlined(ctx, c, lw);
  });
  // ears
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sd * hr * 0.35, hy - hr * 0.75);
    ctx.lineTo(cx + sd * hr * 0.78, hy - hr * 1.32);
    ctx.lineTo(cx + sd * hr * 0.86, hy - hr * 0.5);
    ctx.closePath();
    outlined(ctx, '#fff5fb', lw);
  }
  // head
  ctx.beginPath();
  ctx.ellipse(cx, hy, hr, hr * 1.02, 0, 0, TAU);
  outlined(ctx, '#fff5fb', lw);
  // muzzle
  ctx.beginPath();
  ctx.ellipse(cx, hy + hr * 0.55, hr * 0.62, hr * 0.4, 0, 0, TAU);
  outlined(ctx, '#ffd6ea', lw);
  ctx.fillStyle = '#e48ab4';
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sd * hr * 0.2, hy + hr * 0.5, hr * 0.06, hr * 0.045, 0, 0, TAU);
    ctx.fill();
  }
  smile(ctx, cx, hy + hr * 0.68, hr * 0.18, lw * 0.8, st.open);
  // forelock: a rainbow swoop over the forehead
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.7, hy - hr * 0.55);
  ctx.quadraticCurveTo(cx - hr * 0.1, hy - hr * 1.2, cx + hr * 0.55, hy - hr * 0.72);
  ctx.quadraticCurveTo(cx + hr * 0.1, hy - hr * 0.62, cx - hr * 0.2, hy - hr * 0.3);
  ctx.quadraticCurveTo(cx - hr * 0.5, hy - hr * 0.38, cx - hr * 0.7, hy - hr * 0.55);
  outlined(ctx, PALETTE.pinkSoft, lw);
  // golden horn
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.16, hy - hr * 0.86);
  ctx.lineTo(cx + hr * 0.03, hy - hr * 1.72);
  ctx.lineTo(cx + hr * 0.2, hy - hr * 0.86);
  ctx.closePath();
  outlined(ctx, PALETTE.gold, lw);
  ctx.lineWidth = lw * 0.7;
  ctx.strokeStyle = '#e0a93a';
  for (let i = 1; i <= 3; i++) {
    const yy = hy - hr * (0.86 + i * 0.2);
    ctx.beginPath();
    ctx.moveTo(cx - hr * (0.16 - i * 0.04), yy + hr * 0.05);
    ctx.lineTo(cx + hr * (0.2 - i * 0.045), yy - hr * 0.04);
    ctx.stroke();
  }
  // a twinkle on the horn tip
  const tw = 0.6 + 0.4 * Math.sin(t * 4);
  ctx.fillStyle = '#ffffff';
  starPath(ctx, cx + hr * 0.12, hy - hr * 1.78, hr * 0.14 * tw, 4, 0.35);
  ctx.fill();
  // eyes with lashes
  eyes(ctx, cx + (st.look || 0) * hr * 0.05, hy - hr * 0.08, hr * 0.38, hr * 0.15, lw, st.blink, { lashes: true });
  cheeks(ctx, cx, hy + hr * 0.2, hr * 0.62, hr * 0.13);
  // a foreleg holds the card, with a lilac hoof
  const hand = st.hand;
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.22, base - s * 0.12);
  ctx.quadraticCurveTo(cx + s * 0.42, base - s * 0.3, hand.x, hand.y + s * 0.04);
  ctx.lineWidth = s * 0.1 + lw * 2;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineWidth = s * 0.1;
  ctx.strokeStyle = '#fff5fb';
  ctx.stroke();
  circle(ctx, hand.x, hand.y + s * 0.04, s * 0.06);
  outlined(ctx, PALETTE.lavender, lw);
}

function cloudPath(ctx, puffs) {
  ctx.beginPath();
  for (const [x, y, r] of puffs) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
}

function drawCloud(ctx, cx, base, s, st, t) {
  const lw = Math.max(1.5, s * 0.025);
  const bob = Math.sin(t * 2.2) * s * 0.015;
  const y0 = base - s * 0.44 + bob;
  const puffs = [
    [cx - s * 0.3, y0 + s * 0.12, s * 0.2], [cx + s * 0.3, y0 + s * 0.12, s * 0.2], [cx - s * 0.17, y0 - s * 0.1, s * 0.24],
    [cx + s * 0.15, y0 - s * 0.14, s * 0.27], [cx, y0 + s * 0.16, s * 0.26], [cx - s * 0.02, y0 - s * 0.28, s * 0.2],
  ];
  // outline: every puff stroked thick, then all filled over it, so only the outer edge shows
  cloudPath(ctx, puffs);
  ctx.lineWidth = lw * 2.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  cloudPath(ctx, puffs);
  ctx.fillStyle = PALETTE.cloud;
  ctx.fill();
  // soft shadow underneath
  ctx.save();
  cloudPath(ctx, puffs);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx, y0 + s * 0.42, s * 0.5, s * 0.2, 0, 0, TAU);
  ctx.fillStyle = PALETTE.cloudShadow;
  ctx.fill();
  ctx.restore();
  // sporty pink visor
  const vy = y0 - s * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.17, vy + s * 0.02);
  ctx.quadraticCurveTo(cx, vy - s * 0.05, cx + s * 0.17, vy + s * 0.02);
  ctx.lineTo(cx + s * 0.15, vy + s * 0.07);
  ctx.quadraticCurveTo(cx, vy + s * 0.03, cx - s * 0.15, vy + s * 0.07);
  ctx.closePath();
  outlined(ctx, PALETTE.pink, lw);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.02, vy + s * 0.05);
  ctx.quadraticCurveTo(cx + s * 0.2, vy + s * 0.05, cx + s * 0.27, vy + s * 0.12);
  ctx.quadraticCurveTo(cx + s * 0.12, vy + s * 0.13, cx - s * 0.02, vy + s * 0.09);
  ctx.closePath();
  outlined(ctx, '#d81b76', lw);
  // face
  eyes(ctx, cx + (st.look || 0) * s * 0.01, y0 - s * 0.02, s * 0.11, s * 0.04, lw, st.blink);
  cheeks(ctx, cx, y0 + s * 0.06, s * 0.19, s * 0.045);
  smile(ctx, cx, y0 + s * 0.07, s * 0.06, lw, st.open);
  // a whistle on a lanyard
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.12, y0 + s * 0.1);
  ctx.quadraticCurveTo(cx, y0 + s * 0.3, cx + s * 0.1, y0 + s * 0.12);
  ctx.lineWidth = lw * 0.9;
  ctx.strokeStyle = PALETTE.teamB;
  ctx.stroke();
  roundRect(ctx, cx - s * 0.035, y0 + s * 0.22, s * 0.09, s * 0.05, s * 0.02);
  outlined(ctx, PALETTE.gold, lw * 0.8);
  // a trail of puffs for an arm holds the card
  const hand = st.hand;
  const sx = cx + s * 0.38;
  const sy = y0 + s * 0.14;
  const arm = [0.25, 0.55, 0.85, 1].map((f, i) => [sx + (hand.x - sx) * f, sy + (hand.y + s * 0.03 - sy) * f, s * (0.055 + i * 0.008)]);
  cloudPath(ctx, arm);
  ctx.lineWidth = lw * 2.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  cloudPath(ctx, arm);
  ctx.fillStyle = PALETTE.cloud;
  ctx.fill();
}

const DRAW = [drawOwl, drawUnicorn, drawCloud];
const NAMES = ['HOOT', 'SPARKLE', 'NIMBUS'];

function fmtCard(v) {
  return v === 10 ? '10' : v.toFixed(1);
}

function drawCard(ctx, x, y, w, h, value, t, glow) {
  // the stick
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.5);
  ctx.lineTo(x, y + h * 0.95);
  ctx.lineWidth = Math.max(3, w * 0.07);
  ctx.strokeStyle = '#b07a4a';
  ctx.lineCap = 'round';
  ctx.stroke();
  if (glow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, w * 0.2, x, y, w * 1.1);
    g.addColorStop(0, 'rgba(255,211,110,0.55)');
    g.addColorStop(1, 'rgba(255,211,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 1.2, y - w * 1.2, w * 2.4, w * 2.4);
    ctx.restore();
  }
  roundRect(ctx, x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(2, w * 0.05);
  ctx.strokeStyle = value === 10 ? PALETTE.pink : INK;
  ctx.stroke();
  roundRect(ctx, x - w / 2 + w * 0.08, y - h / 2 + h * 0.08, w * 0.84, h * 0.16, h * 0.06);
  ctx.fillStyle = value === 10 ? PALETTE.pink : PALETTE.lilac;
  ctx.fill();
  ctx.fillStyle = value === 10 ? PALETTE.pink : INK;
  ctx.font = '900 ' + Math.round(h * 0.56) + 'px ' + FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtCard(value), x, y + h * 0.1);
  if (value === 10) {
    for (const [sx, sy, ph] of [[-0.42, -0.5, 0], [0.45, -0.38, 2], [0.4, 0.5, 4]]) {
      const tw = 0.5 + 0.5 * Math.sin(t * 6 + ph);
      ctx.fillStyle = PALETTE.gold;
      starPath(ctx, x + sx * w, y + sy * h, w * 0.1 * (0.6 + tw), 4, 0.35);
      ctx.fill();
    }
  }
}

export function createJudgesPanel() {
  let cards = [0, 0, 0];
  let shown = 0;
  const raisedAt = [null, null, null];
  let talk = -1;
  let lastT = 0;

  function slot(i, x, w) {
    return x + (w / 3) * (i + 0.5);
  }

  // judges stand behind the table; cards go up over their heads, so the height they need is
  // about 1.45 judge sizes above the table top
  function geometry(x, y, w, h) {
    const tableH = Math.min(h * 0.26, 120);
    const tableY = y + h - tableH;
    const s = Math.min((h - tableH) / 1.46, (w / 3) * 0.92, 260);
    return { tableY, tableH, s };
  }

  function handAt(cx, base, s, up) {
    const rest = { x: cx + s * 0.4, y: base - s * 0.36 };
    const high = { x: cx + s * 0.3, y: base - s * 0.98 };
    return { x: rest.x + (high.x - rest.x) * up, y: rest.y + (high.y - rest.y) * up };
  }

  return {
    setCards(list) {
      cards = [0, 1, 2].map((i) => Number(list && list[i]) || 0);
    },
    reveal(n, now) {
      n = Math.max(0, Math.min(3, n | 0));
      for (let i = 0; i < 3; i++) {
        if (i < n && raisedAt[i] === null) raisedAt[i] = now ?? lastT;
        if (i >= n) raisedAt[i] = null;
      }
      shown = n;
    },
    talking(i) {
      talk = i;
    },
    get shown() { return shown; },
    anchor(i, x, y, w, h) {
      const g = geometry(x, y, w, h);
      return { x: slot(i, x, w), y: g.tableY - g.s * 1.45 };
    },
    draw(ctx, x, y, w, h, t, { cheering = false, calm = false } = {}) {
      lastT = t;
      const { tableY, tableH, s } = geometry(x, y, w, h);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const cx = slot(i, x, w);
        const since = raisedAt[i] === null ? -1 : t - raisedAt[i];
        const up = since < 0 ? 0 : calm ? 1 : easeBack(Math.min(1, since / 0.45));
        const blink = ((t + i * 1.7) % 3.6) < 0.12;
        const hop = cheering && !calm ? Math.abs(Math.sin(t * 6 + i)) * s * 0.06 : talk === i && !calm ? Math.abs(Math.sin(t * 9)) * s * 0.02 : 0;
        const base = tableY + s * 0.08 - hop;
        const wave = cheering && !calm ? Math.sin(t * 5 + i) * s * 0.04 : 0;
        const hand = handAt(cx, base, s, up);
        hand.x += wave;
        const st = { raise: up, blink, open: cheering || talk === i, look: Math.sin(t * 0.7 + i * 2), hand };
        DRAW[i](ctx, cx, base, s, st, t);
        // the card goes up with the hand, on a little stick
        if (since >= 0) {
          const cw = s * 0.5;
          const ch = s * 0.34;
          ctx.save();
          ctx.translate(hand.x, hand.y);
          ctx.rotate(wave / s + (1 - Math.min(1, up)) * 0.35);
          drawCard(ctx, 0, -ch * 0.5 - s * 0.14, cw, ch, cards[i], t, cards[i] === 10 && up > 0.9);
          ctx.restore();
        }
      }
      // the table: a white top and a hot-pink skirt with pleats
      ctx.fillStyle = PALETTE.pink;
      ctx.fillRect(x, tableY, w, tableH);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      const pleat = Math.max(18, w / 18);
      for (let px = x + pleat / 2; px < x + w; px += pleat) ctx.fillRect(px, tableY, pleat * 0.4, tableH);
      ctx.fillStyle = 'rgba(23,18,28,0.18)';
      ctx.fillRect(x, tableY + tableH * 0.86, w, tableH * 0.14);
      roundRect(ctx, x - 4, tableY - s * 0.05, w + 8, s * 0.1, s * 0.04);
      ctx.fillStyle = PALETTE.white;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.02);
      ctx.strokeStyle = INK;
      ctx.stroke();
      // name plates
      const fs = Math.max(13, Math.min(20, Math.round(s * 0.1)));
      ctx.font = '800 ' + fs + 'px ' + FONT_STACK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ph = fs * 1.7;
      const py = tableY + Math.max(s * 0.08, (tableH - ph) * 0.35);
      for (let i = 0; i < 3; i++) {
        const cx = slot(i, x, w);
        const pw = Math.min(w / 3 - 14, Math.max(s * 0.66, ctx.measureText(NAMES[i]).width + fs * 1.4));
        roundRect(ctx, cx - pw / 2, py, pw, ph, ph * 0.3);
        ctx.fillStyle = PALETTE.white;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.fillText(NAMES[i], cx, py + ph * 0.54);
      }
      // little team bows between the plates
      const bw = Math.min(s * 0.3, w * 0.07);
      for (const bx of [x + w / 3, x + (2 * w) / 3]) drawBow(ctx, bx, py + ph * 0.5, bw, PALETTE.black, { stars: false, tails: false });
      ctx.restore();
    },
  };
}
