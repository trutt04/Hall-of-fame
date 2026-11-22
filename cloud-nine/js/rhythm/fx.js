// Hit Zero effects on a 2D canvas: rhinestone starbursts, rings, confetti, tiny bows and
// floating words. One pool, capped, no allocations once warm.
//
//   const fx = createFx({ max = 320, calm = false })     calm: prefers-reduced-motion (fewer, gentler)
//   fx.burst(x, y, { count, colors, speed, size, life, gravity, kind: 'star' | 'dot' | 'confetti' | 'bow', angle, spread })
//   fx.ring(x, y, { color, r0, r1, life, width })
//   fx.word(x, y, text, { color, size, life, rise, outline })   -> a handle for fx.retire(handle)
//   fx.retire(handle)            ends a word early (a newer one takes its place)
//   fx.update(dt) / fx.draw(ctx) / fx.clear()
//   fx.count

import { PALETTE, FONT_STACK } from '../config.js';
import { starPath, drawBow } from './figure.js';

export const SPARKLE_COLORS = [PALETTE.rhinestonePink, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver, PALETTE.gold, PALETTE.pink];

export function createFx({ max = 320, calm = false } = {}) {
  const pool = [];
  for (let i = 0; i < max; i++) pool.push({ live: false });
  let live = 0;

  function take() {
    for (const p of pool) if (!p.live) return p;
    // full: recycle the oldest-looking one
    let worst = pool[0];
    for (const p of pool) if (p.age / p.life > worst.age / worst.life) worst = p;
    return worst;
  }

  function spawn(props) {
    const p = take();
    if (!p.live) live++;
    Object.assign(p, { live: true, age: 0, vx: 0, vy: 0, g: 0, rot: 0, vr: 0, size: 6, color: '#fff', text: '', kind: 'dot', r0: 0, r1: 0, width: 3, rise: 0, outline: true, drag: 0 }, props);
    p.gen = (p.gen || 0) + 1;
    return p;
  }

  return {
    burst(x, y, o = {}) {
      const n = Math.round((o.count ?? 14) * (calm ? 0.4 : 1));
      const colors = o.colors || SPARKLE_COLORS;
      const speed = o.speed ?? 240;
      const spread = o.spread ?? Math.PI * 2;
      const angle = o.angle ?? -Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = speed * (0.35 + Math.random() * 0.75) * (calm ? 0.6 : 1);
        spawn({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.gravity ?? 380, drag: o.drag ?? 1.6,
          life: (o.life ?? 0.75) * (0.7 + Math.random() * 0.6), size: (o.size ?? 7) * (0.6 + Math.random() * 0.8),
          color: colors[i % colors.length], kind: o.kind || 'star', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
        });
      }
    },
    ring(x, y, o = {}) {
      spawn({ x, y, kind: 'ring', color: o.color || PALETTE.pink, r0: o.r0 ?? 10, r1: o.r1 ?? 60, life: o.life ?? 0.4, width: o.width ?? 4 });
    },
    word(x, y, text, o = {}) {
      const p = spawn({ x, y, kind: 'word', text: String(text), color: o.color || PALETTE.pink, size: o.size ?? 24, life: o.life ?? 0.7, rise: calm ? 0 : o.rise ?? 46, outline: o.outline !== false });
      return { p, gen: p.gen };
    },
    retire(h) {
      if (h && h.p.live && h.p.gen === h.gen) {
        // fade out fast rather than vanish
        h.p.age = Math.max(h.p.age, h.p.life * 0.8);
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.live) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.live = false;
          live--;
          continue;
        }
        if (p.kind === 'ring' || p.kind === 'word') continue;
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy = p.vy * k + p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    },
    draw(ctx) {
      if (!live) return;
      ctx.save();
      for (const p of pool) {
        if (!p.live) continue;
        const u = p.age / p.life;
        const fade = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
        if (p.kind === 'star' || p.kind === 'dot') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = fade;
          ctx.fillStyle = p.color;
          if (p.kind === 'star') {
            const s = p.size * (1 + 0.25 * Math.sin(p.age * 30));
            starPath(ctx, p.x, p.y, s, 4, 0.32);
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
          }
          ctx.fill();
        } else if (p.kind === 'confetti') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = fade;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.age * 9 + p.rot));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size * 0.6, -p.size * 0.3, p.size * 1.2, p.size * 0.6);
          ctx.restore();
        } else if (p.kind === 'bow') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = fade;
          drawBow(ctx, p.x, p.y, p.size * 2.2, p.color, { rot: p.rot * 0.3, outline: 1.2, stars: false, tails: false });
        } else if (p.kind === 'ring') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - u;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - (1 - u) * (1 - u)), 0, Math.PI * 2);
          ctx.lineWidth = p.width * (1 - u * 0.6);
          ctx.strokeStyle = p.color;
          ctx.stroke();
        } else if (p.kind === 'word') {
          ctx.globalCompositeOperation = 'source-over';
          const pop = u < 0.15 ? 0.7 + (u / 0.15) * 0.45 : u < 0.3 ? 1.15 - ((u - 0.15) / 0.15) * 0.15 : 1;
          ctx.globalAlpha = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
          ctx.font = '900 ' + Math.round(p.size * pop) + 'px ' + FONT_STACK;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const y = p.y - p.rise * (1 - (1 - u) * (1 - u));
          if (p.outline) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(3, p.size * 0.22);
            ctx.strokeStyle = PALETTE.white;
            ctx.strokeText(p.text, p.x, y);
          }
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, y);
        }
      }
      ctx.restore();
    },
    clear() {
      for (const p of pool) p.live = false;
      live = 0;
    },
    get count() { return live; },
  };
}
