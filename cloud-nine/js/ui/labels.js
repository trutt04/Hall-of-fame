// Text over people's heads, drawn on canvases (no font files): nickname tags and emote speech
// bubbles. Each is one sprite. Text comes from presets (emotes) or cleaned nicknames, and is only
// ever drawn with fillText, so nothing in it can run.
//
//   const labels = createLabels({ quality })
//   labels.nameTag(nick, { bot, color }) -> Sprite      a white pill with a hot-pink edge
//   labels.bubble(text, icon) -> Sprite                 a speech bubble; its anchor is the tail tip
//   labels.place(sprite, cameraPos, anchorPos, pop = 1) -> f   keeps it readable from far away
//   labels.release(sprite)                              frees its canvas texture
//   labels.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE, FONT_STACK } from '../config.js';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function fitFont(ctx, text, weight, size, maxW) {
  let s = size;
  ctx.font = weight + ' ' + s + 'px ' + FONT_STACK;
  while (s > 12 && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = weight + ' ' + s + 'px ' + FONT_STACK;
  }
  return s;
}

function star(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function createLabels({ quality = 'high' } = {}) {
  const k = quality === 'low' ? 1 : 2; // canvas resolution multiplier
  const live = new Set();

  function sprite(canvas, w, h, center) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.center.set(center[0], center[1]);
    s.scale.set(w, h, 1);
    s.renderOrder = 6;
    s.userData.base = { w, h };
    s.name = 'label';
    live.add(s);
    return s;
  }

  function nameTag(nick, { bot = false, color = null } = {}) {
    const text = String(nick || 'Cheerleader').slice(0, 20);
    const W = 256 * k;
    const H = 64 * k;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const size = fitFont(ctx, text, '800', 34 * k, W - 60 * k);
    const tw = ctx.measureText(text).width;
    const pw = Math.min(W - 6 * k, tw + (bot ? 64 : 40) * k);
    const x = (W - pw) / 2;
    const edge = color || (bot ? PALETTE.lavender : PALETTE.pink);
    roundRect(ctx, x, 5 * k, pw, H - 10 * k, (H - 10 * k) / 2);
    ctx.fillStyle = 'rgba(255,248,252,0.94)';
    ctx.fill();
    ctx.lineWidth = 5 * k;
    ctx.strokeStyle = edge;
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 ' + size + 'px ' + FONT_STACK;
    const tx = W / 2 + (bot ? 12 * k : 0);
    ctx.fillText(text, tx, H / 2 + 2 * k);
    if (bot) star(ctx, tx - tw / 2 - 16 * k, H / 2, 10 * k, PALETTE.lavender);
    return sprite(c, 1.5, 0.375, [0.5, 0.5]);
  }

  function bubble(text, icon) {
    const t = String(text || '').slice(0, 24);
    const ic = typeof icon === 'string' && icon.length <= 4 ? icon : '';
    const W = 320 * k;
    const H = 150 * k;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const body = H - 34 * k;
    const iconW = ic ? 50 * k : 0;
    const size = fitFont(ctx, t, '800', 44 * k, W - 56 * k - iconW);
    const tw = ctx.measureText(t).width;
    const bw = Math.min(W - 8 * k, tw + iconW + 50 * k);
    const x = (W - bw) / 2;
    // body and tail, outlined together
    ctx.beginPath();
    roundRect(ctx, x, 4 * k, bw, body, 34 * k);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 6 * k;
    ctx.strokeStyle = PALETTE.pink;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 18 * k, body + 1 * k);
    ctx.lineTo(W / 2, H - 4 * k);
    ctx.lineTo(W / 2 + 18 * k, body + 1 * k);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 6 * k;
    ctx.strokeStyle = PALETTE.pink;
    ctx.stroke();
    // cover the seam where the tail meets the body
    ctx.fillRect(W / 2 - 15 * k, body - 6 * k, 30 * k, 9 * k);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = W / 2 + iconW / 2;
    if (ic) {
      ctx.font = 38 * k + 'px ' + FONT_STACK;
      ctx.fillText(ic, cx - tw / 2 - iconW / 2 - 2 * k, 4 * k + body / 2 + 2 * k);
    }
    ctx.font = '800 ' + size + 'px ' + FONT_STACK;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(t, cx, 4 * k + body / 2 + 3 * k);
    // two rhinestone twinkles on the corners
    star(ctx, x + 14 * k, 14 * k, 9 * k, PALETTE.rhinestonePurple);
    star(ctx, x + bw - 14 * k, 18 * k, 7 * k, PALETTE.rhinestonePink);
    return sprite(c, 1.9, 0.89, [0.5, 0]);
  }

  // returns the distance factor, so a bubble can sit just above a name tag of any size
  function place(s, cameraPos, anchorPos, pop = 1) {
    const b = s.userData.base;
    if (!b) return 1;
    const d = cameraPos.distanceTo(anchorPos);
    // grows with distance so it stays readable, up to a point
    const f = Math.min(4, Math.max(1, d / 7.5));
    s.scale.set(b.w * f * pop, b.h * f * pop, 1);
    return f;
  }

  function release(s) {
    if (!s) return;
    live.delete(s);
    s.removeFromParent();
    if (s.material) {
      if (s.material.map) s.material.map.dispose();
      s.material.dispose();
    }
  }

  return {
    nameTag,
    bubble,
    place,
    release,
    dispose() {
      for (const s of [...live]) release(s);
    },
  };
}
