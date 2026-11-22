// Role name tags (PLAY): while a game is on, everyone's name tag takes their role's colour and a
// little icon (a heart for Team Pink, a star for Team Purple, a snowflake when frozen, a star for
// "it", an eye for the seeker), so a glance across the field says who is who. They replace the
// peers' own tags (hidden meanwhile, given back after). Canvas sprites: no font files, nicknames
// only ever go through fillText.
//
//   const tags = createRoleTags(world)
//   tags.set(id, peerEntry, style | null, nick)   style = logic.tagStyle(kind, who) ({ color, ink, icon }),
//                                                 null = the normal tag; style.hidden hides it
//   tags.update()            every frame: sized (and faded far away) by the app's own labels.place(),
//                            so they always match everybody else's name tags
//   tags.clear()             give every peer its own tag back

import * as THREE from '../../lib/three.module.min.js';
import { FONT_STACK } from '../config.js';

const NAME_Y = 1.98; // where the app's peers put their name tag

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

function drawIcon(ctx, icon, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (icon === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else if (icon === 'heart') {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.85);
    ctx.bezierCurveTo(cx - r * 1.25, cy - r * 0.05, cx - r * 0.65, cy - r * 1.05, cx, cy - r * 0.38);
    ctx.bezierCurveTo(cx + r * 0.65, cy - r * 1.05, cx + r * 1.25, cy - r * 0.05, cx, cy + r * 0.85);
    ctx.fill();
  } else if (icon === 'snow') {
    ctx.lineWidth = r * 0.26;
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3;
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(cx - dx, cy - dy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.stroke();
    }
  } else if (icon === 'eye') {
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (icon === 'sparkle') {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const rr = i % 2 ? r * 0.28 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else if (icon === 'bow') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + s * r * 1.2, cy - r * 1.1, cx + s * r * 1.05, cy);
      ctx.quadraticCurveTo(cx + s * r * 1.2, cy + r * 1.1, cx, cy);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function createRoleTags(world, { quality = 'high' } = {}) {
  const k = quality === 'low' ? 1 : 2;
  const tags = new Map(); // id -> { sprite, key, entry }
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function make(nick, style, bot) {
    const text = String(nick || 'Cheerleader').slice(0, 20);
    const W = 256 * k;
    const H = 64 * k;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    let size = 32 * k;
    ctx.font = '800 ' + size + 'px ' + FONT_STACK;
    const iconW = style.icon ? 34 * k : 0;
    while (size > 12 && ctx.measureText(text).width > W - 56 * k - iconW) {
      size -= 2;
      ctx.font = '800 ' + size + 'px ' + FONT_STACK;
    }
    const tw = ctx.measureText(text).width;
    const pw = Math.min(W - 8 * k, tw + iconW + 40 * k);
    const x = (W - pw) / 2;
    roundRect(ctx, x, 5 * k, pw, H - 10 * k, (H - 10 * k) / 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = '#17121c';
    ctx.stroke();
    const tx = W / 2 + iconW / 2;
    if (style.icon) drawIcon(ctx, style.icon, tx - tw / 2 - 18 * k, H / 2, 11 * k, style.ink);
    ctx.fillStyle = style.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx, H / 2 + 2 * k);
    if (bot) {
      ctx.globalAlpha = 0.9;
      drawIcon(ctx, 'sparkle', x + pw - 12 * k, 15 * k, 6 * k, style.ink);
      ctx.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, 0.5);
    s.scale.set(1.5, 0.375, 1);
    s.userData.base = { w: 1.5, h: 0.375 }; // what labels.place() reads
    s.renderOrder = 6;
    s.name = 'play-tag';
    s.position.y = NAME_Y;
    return s;
  }

  function drop(id) {
    const t = tags.get(id);
    if (!t) return;
    tags.delete(id);
    t.sprite.removeFromParent();
    t.sprite.material.map.dispose();
    t.sprite.material.dispose();
    if (t.entry && t.entry.label && t.entry.group && t.entry.label.parent === t.entry.group) t.entry.label.visible = true;
  }

  return {
    set(id, entry, style, nick) {
      if (!entry || !entry.group) {
        drop(id);
        return;
      }
      if (!style) {
        drop(id);
        return;
      }
      const key = `${nick}|${style.color}|${style.ink}|${style.icon}|${entry.bot ? 1 : 0}`;
      let t = tags.get(id);
      if (t && (t.key !== key || t.entry !== entry)) {
        drop(id);
        t = null;
      }
      if (!t) {
        t = { sprite: make(nick, style, entry.bot), key, entry };
        entry.group.add(t.sprite);
        tags.set(id, t);
      }
      t.sprite.visible = !style.hidden;
      if (entry.label) entry.label.visible = false;
    },
    update() {
      if (!tags.size) return;
      world.camera.getWorldPosition(camPos);
      const place = world.labels && typeof world.labels.place === 'function' ? world.labels.place : null;
      for (const t of tags.values()) {
        if (!t.entry.group.visible || !t.sprite.visible) continue;
        t.entry.group.getWorldPosition(tmp);
        if (place) place(t.sprite, camPos, tmp, 1);
        else {
          const f = Math.min(2.4, Math.max(1, camPos.distanceTo(tmp) / 8));
          t.sprite.scale.set(1.5 * f, 0.375 * f, 1);
        }
      }
    },
    has(id) {
      return tags.has(id);
    },
    clear() {
      for (const id of [...tags.keys()]) drop(id);
    },
    get size() {
      return tags.size;
    },
  };
}
