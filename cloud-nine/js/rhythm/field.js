// The Hit Zero playfield on a 2D canvas: a cheer-mat runway in perspective, beat lines that
// scroll with the music, three target rings with cheer-motion icons, rhinestone gem notes,
// hold ribbons, two-lane stunt bows, the tap zones and the performer at the far end.
//
//   fieldLayout(w, h, top)           -> layout (pure: sizes and positions for a w x h overlay whose
//                                       top UI ends at `top`)
//   laneAt(L, x)                     -> 0 | 1 | 2   the tap zone under x
//   project(L, u)                    -> { y, s }    u = time to the hit line / approach time (0 at the line, 1 far away)
//   const field = createField({ calm })
//   field.resize(w, h, dpr, top)     field.layout
//   field.draw(ctx, view)            view: { song, songBeat, spb, approach, notes (run notes or null), first,
//                                      glow [3], motions [3], flip [3], fullOut, combo, figure (joints), t, dt,
//                                      keys ([3] key labels or null), look, bob }
//   field.hitPoint(lane)             -> { x, y } the centre of a target ring
//   drawNoteSample(ctx, kind, w, h, dpr)   the ready card's how-to pictures: 'tap' | 'hold' | 'stunt'
//   LANE_COLORS                      hot pink, rhinestone purple, sky blue

import { PALETTE, FONT_STACK } from '../config.js';
import { drawFigure, iconCanvas, starPath, drawBow, poseSkeleton } from './figure.js';
import { MOTION_LABELS } from './charts.js';

const GHOST = { skin: '#ffffff', hair: '#ffffff', bow: '#ffffff', top: '#ffffff', shorts: '#ffffff', shoes: '#ffffff' };

// the pale figure in each tap zone, drawn once per motion and size
const ghostCache = new Map();
function ghostCanvas(motion, h, dpr) {
  const H = Math.round(h);
  const key = motion + '|' + H + '|' + dpr;
  let c = ghostCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.ceil(H * 1.2 * dpr);
  c.height = Math.ceil(H * 1.06 * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  drawFigure(g, H * 0.6, H * 1.03, H, poseSkeleton(motion), { detail: 'icon', look: GHOST });
  ghostCache.set(key, c);
  if (ghostCache.size > 40) ghostCache.delete(ghostCache.keys().next().value);
  return c;
}

export const LANE_COLORS = ['#ff2e93', '#a96bff', '#37a8ff'];
const LANE_LIGHT = ['#ffb3d9', '#dcc6ff', '#b5e1ff'];
const LANE_DARK = ['#b3115f', '#6a3dc4', '#1a6fb8'];
// index 3: a note that got away, in soft grey (canvas filters are missing on iOS Safari)
const COLS = [...LANE_COLORS, '#b9b1c4'];
const LIGHT = [...LANE_LIGHT, '#e8e3ee'];
const DARK = [...LANE_DARK, '#8a8296'];
const INK = PALETTE.ink;

export function fieldLayout(w, h, top = 130) {
  const portrait = h >= w * 0.9;
  const short = h < 520;
  const hitY = Math.round(h * (short ? 0.7 : portrait ? 0.665 : 0.68));
  const nearW = portrait ? Math.min(w - 20, 600) : Math.min(Math.max(w * 0.5, 460), 680, w - 20);
  const laneW = nearW / 3;
  const cx = w / 2;
  const side = (w - nearW) / 2;
  // the performer: beside the runway when there is room, else at its far end
  const perfSide = !portrait && side >= 170;
  const roomAbove = hitY - top;
  const perfH = perfSide ? Math.min(h * 0.42, side * 1.1, 280) : Math.max(64, Math.min(124, roomAbove * 0.3));
  const farY = Math.round(perfSide ? top + 14 : top + perfH * 0.97);
  const farScale = portrait ? 0.4 : 0.46;
  const targetR = Math.round(Math.max(24, Math.min(laneW * 0.34, short ? 34 : 50)));
  const zoneTop = hitY - targetR - 10;
  return {
    w, h, portrait, short, cx, hitY, farY, farScale, nearW, laneW, targetR, zoneTop,
    bounds: [cx - laneW / 2, cx + laneW / 2],
    perf: perfSide
      ? { x: side * 0.5, y: hitY - 6, size: perfH, side: true }
      : { x: cx, y: farY + 2, size: perfH, side: false },
    noteR: Math.round(Math.min(laneW * 0.3, 44)),
  };
}

export function laneAt(L, x) {
  return x < L.bounds[0] ? 0 : x < L.bounds[1] ? 1 : 2;
}

export function project(L, u) {
  const k = 1 / L.farScale - 1;
  const s = 1 / (1 + k * Math.max(-0.5, u));
  return { s, y: L.farY + ((L.hitY - L.farY) * (s - L.farScale)) / (1 - L.farScale) };
}

function laneX(L, lane, s) {
  return L.cx + (lane - 1) * L.laneW * s;
}

// a faceted rhinestone gem, pre-drawn once per lane and size bucket
const gemCache = new Map();
function gemCanvas(lane, px, dpr, star) {
  const key = lane + '|' + px + '|' + dpr + '|' + (star ? 1 : 0);
  let c = gemCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const S = Math.ceil(px * dpr);
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const r = px / 2 - 1.5;
  const x = px / 2;
  const y = px / 2;
  const col = COLS[lane];
  const shape = (rr) => {
    if (star) starPath(g, x, y + rr * 0.06, rr, 5, 0.6);
    else {
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
    }
  };
  shape(r);
  g.fillStyle = star && lane < 3 ? PALETTE.gold : DARK[lane];
  g.fill();
  g.lineWidth = Math.max(1.5, r * 0.09);
  g.strokeStyle = INK;
  g.stroke();
  shape(r * 0.8);
  g.fillStyle = col;
  g.fill();
  // facets
  g.save();
  shape(r * 0.8);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.moveTo(x - r, y - r);
  g.lineTo(x + r * 0.2, y - r);
  g.lineTo(x, y);
  g.lineTo(x - r, y + r * 0.2);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.beginPath();
  g.moveTo(x + r, y + r);
  g.lineTo(x - r * 0.2, y + r);
  g.lineTo(x, y);
  g.lineTo(x + r, y - r * 0.2);
  g.closePath();
  g.fill();
  g.restore();
  // table facet
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.lineTo(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42);
  }
  g.closePath();
  g.fillStyle = LIGHT[lane];
  g.fill();
  // glint
  g.fillStyle = '#ffffff';
  starPath(g, x - r * 0.3, y - r * 0.32, r * 0.3, 4, 0.3);
  g.fill();
  gemCache.set(key, c);
  return c;
}

export function createField({ calm = false } = {}) {
  let L = fieldLayout(390, 844, 130);
  let dpr = 1;
  let matGrad = null;
  let matCtx = null;
  const pulse = [0, 0, 0]; // target ring bump, decays
  let lastBeatSeen = -1;

  function resize(w, h, d, top) {
    L = fieldLayout(w, h, top);
    dpr = d;
    matGrad = null;
  }

  function hitPoint(lane) {
    return { x: laneX(L, lane, 1), y: L.hitY };
  }

  function drawMat(ctx, view) {
    const { farY, hitY, nearW, farScale, cx } = L;
    const halfFar = (nearW / 2) * farScale;
    const halfNear = nearW / 2;
    if (!matGrad || matCtx !== ctx) {
      matGrad = ctx.createLinearGradient(0, farY, 0, hitY);
      matGrad.addColorStop(0, 'rgba(23,18,28,0.30)');
      matGrad.addColorStop(0.55, 'rgba(23,18,28,0.70)');
      matGrad.addColorStop(1, 'rgba(23,18,28,0.86)');
      matCtx = ctx;
    }
    ctx.beginPath();
    ctx.moveTo(cx - halfFar, farY);
    ctx.lineTo(cx + halfFar, farY);
    ctx.lineTo(cx + halfNear, hitY);
    ctx.lineTo(cx - halfNear, hitY);
    ctx.closePath();
    ctx.fillStyle = matGrad;
    ctx.fill();
    // lanes held down light up
    for (let lane = 0; lane < 3; lane++) {
      const glow = view.glow[lane];
      if (glow <= 0.01) continue;
      const x0f = cx + (lane - 1.5) * (nearW / 3) * farScale;
      const x1f = cx + (lane - 0.5) * (nearW / 3) * farScale;
      const x0n = cx + (lane - 1.5) * (nearW / 3);
      const x1n = cx + (lane - 0.5) * (nearW / 3);
      const g = ctx.createLinearGradient(0, farY, 0, hitY);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, hexA(LANE_COLORS[lane], 0.42 * glow));
      ctx.beginPath();
      ctx.moveTo(x0f, farY);
      ctx.lineTo(x1f, farY);
      ctx.lineTo(x1n, hitY);
      ctx.lineTo(x0n, hitY);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
    // lane dividers
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    for (const b of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(cx + b * (nearW / 3) * farScale, farY);
      ctx.lineTo(cx + b * (nearW / 3), hitY);
      ctx.stroke();
    }
    // beat lines scroll down with the music; every "1" is brighter
    const b0 = Math.ceil(view.songBeat);
    const b1 = view.songBeat + view.approach / view.spb;
    for (let b = b0; b <= b1; b++) {
      const u = (b * view.spb - view.song) / view.approach;
      if (u < 0 || u > 1) continue;
      const p = project(L, u);
      const one = ((b % 8) + 8) % 8 === 0;
      const half = (nearW / 2) * p.s;
      ctx.beginPath();
      ctx.moveTo(cx - half, p.y);
      ctx.lineTo(cx + half, p.y);
      ctx.lineWidth = one ? 3 * p.s : 1.2 * p.s;
      ctx.strokeStyle = one ? 'rgba(255,122,209,' + (0.25 + 0.4 * p.s) + ')' : 'rgba(255,255,255,' + 0.1 * p.s + ')';
      ctx.stroke();
    }
    // rails: hot pink (gold when full out), with rhinestones sliding down on the beat
    const railCol = view.fullOut ? PALETTE.gold : PALETTE.pink;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sd * halfFar, farY);
      ctx.lineTo(cx + sd * halfNear, hitY);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = railCol;
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }
    const phase = ((view.songBeat % 1) + 1) % 1;
    ctx.fillStyle = view.fullOut ? '#ffffff' : PALETTE.rhinestoneSilver;
    for (let i = 0; i < 6; i++) {
      const u = 1 - (i + phase) / 6;
      if (u < 0 || u > 1) continue;
      const p = project(L, u * 1.0);
      for (const sd of [-1, 1]) {
        starPath(ctx, cx + sd * (nearW / 2) * p.s, p.y, 3.5 + 3 * p.s, 4, 0.35);
        ctx.fill();
      }
    }
  }

  function drawPerformer(ctx, view) {
    const P = L.perf;
    if (!view.figure || !P) return;
    // a little cloud stage under her feet
    ctx.save();
    const cw = P.size * 0.62;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(43,34,51,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [dx, dy, r] of [[-0.32, 0.04, 0.2], [0, 0.0, 0.26], [0.32, 0.04, 0.2], [-0.15, 0.1, 0.2], [0.15, 0.1, 0.2]]) {
      ctx.moveTo(P.x + dx * cw + r * cw, P.y + dy * cw);
      ctx.arc(P.x + dx * cw, P.y + dy * cw, r * cw, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
    drawFigure(ctx, P.x, P.y + P.size * 0.02 + (view.bob || 0), P.size, view.figure, { poms: true, t: view.t, look: view.look });
  }

  function drawTargets(ctx, view) {
    const { hitY, targetR, nearW, cx } = L;
    // the hit line
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - nearW / 2, hitY);
    ctx.lineTo(cx + nearW / 2, hitY);
    ctx.strokeStyle = view.fullOut ? 'rgba(255,211,110,0.45)' : 'rgba(255,122,209,0.4)';
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    // a bump on every beat
    const beat = Math.floor(view.songBeat);
    if (beat !== lastBeatSeen) {
      lastBeatSeen = beat;
      if (!calm && view.songBeat >= 0) for (let i = 0; i < 3; i++) pulse[i] = 1;
    }
    for (let lane = 0; lane < 3; lane++) {
      pulse[lane] *= Math.exp(-view.dt * 9);
      const x = laneX(L, lane, 1);
      const press = view.glow[lane];
      const r = targetR * (1 + 0.05 * pulse[lane] + 0.08 * press) * (view.flip ? view.flip[lane] : 1);
      if (press > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, hitY, r * 0.5, x, hitY, r * 1.9);
        g.addColorStop(0, hexA(LANE_COLORS[lane], 0.55 * press));
        g.addColorStop(1, hexA(LANE_COLORS[lane], 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r * 2, hitY - r * 2, r * 4, r * 4);
        ctx.restore();
      }
      const px = Math.round(targetR * 2);
      const icon = iconCanvas(view.motions[lane], px, LANE_COLORS[lane], dpr, press > 0.3 ? LANE_LIGHT[lane] : PALETTE.white);
      if (icon) ctx.drawImage(icon, x - r - 2 * (r / targetR), hitY - r - 2 * (r / targetR), (icon.width / dpr) * (r / targetR), (icon.height / dpr) * (r / targetR));
    }
  }

  function drawZones(ctx, view) {
    const { w, h, hitY, targetR, bounds } = L;
    const top = hitY + targetR + 8;
    const bottom = h - 10;
    if (bottom - top < 30) return;
    const xs = [[10, bounds[0] - 5], [bounds[0] + 5, bounds[1] - 5], [bounds[1] + 5, w - 10]];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let lane = 0; lane < 3; lane++) {
      const [x0, x1] = xs[lane];
      const press = view.glow[lane];
      roundRect(ctx, x0, top, x1 - x0, bottom - top, 22);
      ctx.fillStyle = hexA(LANE_COLORS[lane], 0.16 + 0.34 * press);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = hexA(LANE_COLORS[lane], 0.55 + 0.45 * press);
      ctx.stroke();
      const mx = (x0 + x1) / 2;
      const zh = bottom - top;
      // a ghost of the motion fills the zone: the move this lane is all about
      const figH = Math.min(zh - 64, 170, (x1 - x0) * 1.25);
      if (figH > 60) {
        ctx.save();
        ctx.globalAlpha = 0.3 + 0.35 * press;
        const gc = ghostCanvas(view.motions[lane], figH, dpr);
        const gw = gc.width / dpr;
        ctx.drawImage(gc, mx - gw * 0.5, bottom - 10 - Math.round(figH) * 1.03, gw, gc.height / dpr);
        ctx.restore();
      }
      // the motion's name, on two lines if it needs them, never wider than the zone
      const label = (MOTION_LABELS[view.motions[lane]] || '').toUpperCase();
      const room = x1 - x0 - 14;
      const big = L.short ? 17 : 21;
      let fs = big;
      ctx.font = '900 ' + fs + 'px ' + FONT_STACK;
      let lines = [label];
      const w1 = ctx.measureText(label).width;
      if (w1 > room) {
        // a little smaller first; two lines only when that is not enough
        fs = Math.floor((fs * room) / w1);
        if (fs < 16 && label.includes(' ')) {
          const i = label.indexOf(' ');
          lines = [label.slice(0, i), label.slice(i + 1)];
          fs = big;
          ctx.font = '900 ' + fs + 'px ' + FONT_STACK;
          const widest = Math.max(...lines.map((s) => ctx.measureText(s).width));
          if (widest > room) fs = Math.floor((fs * room) / widest);
        }
        fs = Math.max(14, fs);
        ctx.font = '900 ' + fs + 'px ' + FONT_STACK;
      }
      const ly = top + Math.min(30, zh * 0.2);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      lines.forEach((s, i) => {
        const y = ly + i * fs * 1.05;
        ctx.strokeStyle = INK;
        ctx.strokeText(s, mx, y);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(s, mx, y);
      });
      if (view.keys && zh > 120) {
        const key = view.keys[lane];
        const ky = ly + (lines.length - 1) * fs * 1.05 + 36;
        roundRect(ctx, mx - 22, ky - 17, 44, 34, 9);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.font = '900 18px ' + FONT_STACK;
        ctx.fillStyle = INK;
        ctx.fillText(key, mx, ky + 1);
      }
    }
    ctx.restore();
  }

  // the visible notes, far first so near ones sit on top
  function visible(view) {
    const notes = view.notes;
    const horizon = view.song + view.approach;
    let last = view.first;
    while (last < notes.length && notes[last].t <= horizon) last++;
    return last;
  }

  // hold ribbons go under the target rings, so a held ribbon flows into its ring
  function drawRibbons(ctx, view) {
    const notes = view.notes;
    for (let i = visible(view) - 1; i >= view.first; i--) {
      const n = notes[i];
      if (!(n.len > 0) || n.state === 'hit' || n.state === 'done') continue;
      const missed = n.state === 'miss' || n.state === 'drop';
      if (missed && (n.end - view.song) / view.approach < -0.1) continue;
      drawRibbon(ctx, view, n, missed);
    }
  }

  function drawNotes(ctx, view) {
    const { noteR } = L;
    const notes = view.notes;
    for (let i = visible(view) - 1; i >= view.first; i--) {
      const n = notes[i];
      const st = n.state;
      if (st === 'hit' || st === 'done' || st === 'holding') continue; // a held head is in the hand now
      const missed = st === 'miss' || st === 'drop';
      const uHead = (n.t - view.song) / view.approach;
      if (missed && uHead < -0.22) continue;
      const p = project(L, uHead);
      if (p.y > L.h + 40) continue;
      const r = noteR * p.s;
      const alpha = missed ? Math.max(0, 0.55 + uHead * 2.5) : Math.min(1, (1 - uHead) * 6);
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      const stunt = n.lanes.length > 1;
      if (stunt) {
        // two lanes at once: a satin band between the gems with a bow on it
        const xa = laneX(L, n.lanes[0], p.s);
        const xb = laneX(L, n.lanes[1], p.s);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(xa, p.y);
        ctx.lineTo(xb, p.y);
        ctx.strokeStyle = INK;
        ctx.lineWidth = r * 0.62 + 4;
        ctx.stroke();
        ctx.strokeStyle = PALETTE.pinkSoft;
        ctx.lineWidth = r * 0.62;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = r * 0.16;
        ctx.stroke();
        drawBow(ctx, (xa + xb) / 2, p.y, r * 1.5, PALETTE.pink, { tails: false, outline: Math.max(1.5, r * 0.07) });
      }
      for (const lane of n.lanes) {
        if (n.hits && n.hits[lane] !== undefined && !missed) continue; // this half of a stunt is in
        const x = laneX(L, lane, p.s);
        const size = r * 2 * (stunt ? 1.12 : 1);
        const bucket = size > 60 ? 96 : size > 34 ? 64 : 40;
        const gem = gemCanvas(missed ? 3 : lane, bucket, dpr, stunt);
        ctx.drawImage(gem, x - size / 2, p.y - size / 2, size, size);
      }
      ctx.restore();
    }
  }

  function drawRibbon(ctx, view, n, missed) {
    const uHead = n.state === 'holding' ? 0 : (n.t - view.song) / view.approach;
    const uTail = (n.end - view.song) / view.approach;
    if (uTail < -0.1 || uHead > 1) return;
    const a = project(L, Math.max(uHead, n.state === 'holding' ? 0 : -0.3));
    const b = project(L, Math.min(1, Math.max(uTail, 0)));
    if (b.y >= a.y) return;
    ctx.save();
    ctx.globalAlpha = missed ? 0.3 : 1;
    for (const lane of n.lanes) {
      const ci = missed ? 3 : lane;
      const xa = laneX(L, lane, a.s);
      const xb = laneX(L, lane, b.s);
      const wa = L.noteR * 0.42 * a.s;
      const wb = L.noteR * 0.42 * b.s;
      const holding = n.state === 'holding';
      ctx.beginPath();
      ctx.moveTo(xa - wa, a.y);
      ctx.lineTo(xb - wb, b.y);
      ctx.lineTo(xb + wb, b.y);
      ctx.lineTo(xa + wa, a.y);
      ctx.closePath();
      ctx.fillStyle = holding ? LIGHT[ci] : COLS[ci];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      // satin shine down the middle
      ctx.beginPath();
      ctx.moveTo(xa - wa * 0.25, a.y);
      ctx.lineTo(xb - wb * 0.25, b.y);
      ctx.lineTo(xb + wb * 0.05, b.y);
      ctx.lineTo(xa + wa * 0.05, a.y);
      ctx.closePath();
      ctx.fillStyle = holding ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)';
      ctx.fill();
      // little stars along the ribbon
      const span = n.len;
      for (let k = 1; k < span * 2; k++) {
        const u = (n.t + k * view.spb * 0.5 - view.song) / view.approach;
        if (u <= Math.max(0, uHead) || u >= Math.min(1, uTail)) continue;
        const p = project(L, u);
        ctx.fillStyle = holding ? '#ffffff' : LIGHT[ci];
        starPath(ctx, laneX(L, lane, p.s), p.y, 4 * p.s + 1.5, 4, 0.4);
        ctx.fill();
      }
      // the end of the hold: a star
      if (uTail <= 1 && uTail >= 0) {
        ctx.fillStyle = PALETTE.gold;
        starPath(ctx, xb, b.y, 9 * b.s + 2, 5, 0.5);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCombo(ctx, view) {
    if (view.combo < 5) return;
    const y = L.farY + (L.hitY - L.farY) * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + Math.round(L.laneW * 0.46) + 'px ' + FONT_STACK;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(view.combo), L.cx, y);
    ctx.font = '900 ' + Math.max(16, Math.round(L.laneW * 0.13)) + 'px ' + FONT_STACK;
    ctx.fillStyle = view.fullOut ? PALETTE.gold : PALETTE.rhinestonePink;
    ctx.fillText('IN A ROW', L.cx, y + L.laneW * 0.32);
    ctx.restore();
  }

  function draw(ctx, view) {
    drawPerformer(ctx, view);
    drawMat(ctx, view);
    drawCombo(ctx, view);
    drawZones(ctx, view);
    if (view.notes) drawRibbons(ctx, view);
    drawTargets(ctx, view);
    if (view.notes) drawNotes(ctx, view);
  }

  return {
    resize,
    draw,
    hitPoint,
    get layout() { return L; },
  };
}

// The how-to pictures on the ready card: a bit of mat with a tap, a hold or a two-lane stunt.
export function drawNoteSample(ctx, kind, w, h, dpr = 1) {
  roundRect(ctx, 2, 2, w - 4, h - 4, 14);
  ctx.fillStyle = 'rgba(23,18,28,0.82)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(6, h * 0.78, w - 12, 3);
  const r = w * 0.17;
  if (kind === 'tap') {
    ctx.drawImage(gemCanvas(0, 64, dpr, false), w / 2 - r, h * 0.48 - r, r * 2, r * 2);
  } else if (kind === 'hold') {
    const x = w / 2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.42, h * 0.62);
    ctx.lineTo(x - r * 0.42, h * 0.14);
    ctx.lineTo(x + r * 0.42, h * 0.14);
    ctx.lineTo(x + r * 0.42, h * 0.62);
    ctx.closePath();
    ctx.fillStyle = LANE_COLORS[1];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = PALETTE.gold;
    starPath(ctx, x, h * 0.14, 7, 5, 0.5);
    ctx.fill();
    ctx.stroke();
    ctx.drawImage(gemCanvas(1, 64, dpr, false), x - r, h * 0.66 - r, r * 2, r * 2);
  } else {
    const y = h * 0.5;
    const xa = w * 0.26;
    const xb = w * 0.74;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(xa, y);
    ctx.lineTo(xb, y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.6 + 3;
    ctx.stroke();
    ctx.strokeStyle = PALETTE.pinkSoft;
    ctx.lineWidth = r * 0.6;
    ctx.stroke();
    drawBow(ctx, w / 2, y, r * 1.6, PALETTE.pink, { tails: false, outline: 1.5 });
    ctx.drawImage(gemCanvas(0, 64, dpr, true), xa - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
    ctx.drawImage(gemCanvas(2, 64, dpr, true), xb - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
}
