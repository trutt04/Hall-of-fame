// The basket toss overlay: the big "5, 6, 7, 8!", trick names (big and sparkly), points and combos,
// the height gauge, the swipe legend, the squad ribbon, the landing word and score card, and the
// sparkle line that follows a swiping finger. One root (.c9t) over the 3D view. Pointer events pass
// straight through to the game, except on the card's button. All text is set with textContent.
//
//   const hud = createTossHud({ calm, touch })      touch() -> true when the legend should show swipes
//   hud.show(on)
//   hud.count(label)                  '5' | '6' | '7' | '8!'
//   hud.trick(name, { mult, apex })   a trick starts
//   hud.points(points)                the trick finished
//   hud.legend(mode)                  null | 'air' | 'apex'
//   hud.gauge(null | { height, apex, target })   metres above the pad
//   hud.squad(count, names)           the "Squad lift" ribbon; 0 hides it
//   hud.banner(word, kind)            the landing word ('stuck' | 'cradle'); null hides it
//   hud.result(null | { line, rows: [[label, points, dim?]], total, best, newBest }, { onAgain })
//   hud.hint(text | null)
//   hud.trail(x, y, id) / hud.trailEnd(id)
//   hud.update(dt)
//   hud.dispose()

import { FONT_STACK, PALETTE } from '../config.js';
import { GESTURES, TRICKS } from './toss-rules.js';

const CSS = `
.c9t{position:fixed;inset:0;z-index:30;pointer-events:none;overflow:hidden;font-family:${FONT_STACK};color:${PALETTE.white};
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;line-height:1.15;contain:layout style}
.c9t[hidden],.c9t [hidden]{display:none!important}
.c9t-trail{position:absolute;inset:0;width:100%;height:100%}
.c9t-word{position:relative;display:inline-block;isolation:isolate;font-weight:900;letter-spacing:.02em;white-space:nowrap}
.c9t-word .c9t-o{position:absolute;left:0;top:0;z-index:0;color:${PALETTE.black};-webkit-text-stroke:.17em ${PALETTE.black};text-shadow:0 .1em 0 ${PALETTE.black}}
.c9t-word .c9t-f{position:relative;z-index:1;background:linear-gradient(180deg,#fff 10%,#ffe3f2 36%,${PALETTE.rhinestonePink} 64%,#c58cff 94%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.c9t-word .c9t-s{position:absolute;z-index:2;font-size:.42em;line-height:1;color:#fff;text-shadow:0 0 .3em ${PALETTE.rhinestonePink},0 0 .08em #fff;animation:c9t-tw 1.1s ease-in-out infinite}
.c9t-gold .c9t-f{background:linear-gradient(180deg,#fff 6%,#fff1bf 34%,${PALETTE.gold} 60%,${PALETTE.rhinestonePink} 96%);-webkit-background-clip:text;background-clip:text}
.c9t-plain .c9t-f{background:linear-gradient(180deg,#fff 30%,${PALETTE.pinkPale} 100%);-webkit-background-clip:text;background-clip:text}
.c9t-plain .c9t-o{color:${PALETTE.pink};-webkit-text-stroke-color:${PALETTE.pink};text-shadow:0 .08em 0 ${PALETTE.black}}
.c9t-count{position:absolute;left:0;right:0;top:27%;text-align:center;font-size:clamp(84px,min(30vw,26vh),190px)}
.c9t-count .c9t-word{animation:c9t-count .62s cubic-bezier(.2,1.3,.4,1) both}
.c9t-top{position:absolute;left:0;right:0;top:calc(15% + env(safe-area-inset-top));text-align:center;font-size:clamp(32px,min(10.5vw,9.5vh),72px)}
.c9t-top .c9t-word{display:block;width:max-content;margin:0 auto;animation:c9t-pop .3s cubic-bezier(.2,1.5,.4,1) both}
.c9t-top .c9t-word.c9t-out{position:absolute;left:0;right:0;top:0;animation:c9t-rise .3s ease-in both}
.c9t-sub{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:.2em;font-size:16px;min-height:44px}
.c9t-pts{font-weight:900;font-size:clamp(24px,6.5vw,36px);color:${PALETTE.gold};text-shadow:0 3px 0 ${PALETTE.black},-2px 0 0 ${PALETTE.black},2px 0 0 ${PALETTE.black},0 -2px 0 ${PALETTE.black};animation:c9t-pop .28s cubic-bezier(.2,1.6,.4,1) both}
.c9t-chipx{font-weight:900;font-size:17px;letter-spacing:.06em;padding:6px 13px;border-radius:999px;color:#fff;background:${PALETTE.pink};box-shadow:0 3px 0 ${PALETTE.black};animation:c9t-pop .3s cubic-bezier(.2,1.6,.4,1) both}
.c9t-chipx.c9t-apexchip{background:linear-gradient(90deg,${PALETTE.rhinestonePurple},${PALETTE.rhinestonePink})}
.c9t-squad{position:absolute;left:50%;top:calc(9% + env(safe-area-inset-top));transform:translateX(-50%);padding:8px 18px;border-radius:999px;text-align:center;
  background:linear-gradient(90deg,${PALETTE.pink},${PALETTE.rhinestonePurple});box-shadow:0 3px 0 ${PALETTE.black};white-space:nowrap;max-width:calc(100vw - 24px);box-sizing:border-box}
.c9t-squad b{display:block;font-weight:900;font-size:19px;letter-spacing:.05em}
.c9t-squad span{display:block;font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis}
.c9t-gauge{position:absolute;right:calc(14px + env(safe-area-inset-right));top:50%;transform:translateY(-50%);width:18px;height:min(38vh,250px);border-radius:12px;
  background:rgba(23,18,28,.45);border:2px solid rgba(255,248,252,.85);box-shadow:0 2px 0 rgba(23,18,28,.4)}
.c9t-fill{position:absolute;left:2px;right:2px;bottom:2px;border-radius:8px;background:linear-gradient(0deg,${PALETTE.pink},${PALETTE.rhinestonePink} 55%,#fff);height:0}
.c9t-goal{position:absolute;left:-7px;right:-7px;height:4px;border-radius:2px;background:#fff;box-shadow:0 0 6px ${PALETTE.rhinestonePink}}
.c9t-alt{position:absolute;right:26px;transform:translateY(50%);font-weight:900;font-size:18px;white-space:nowrap;text-shadow:0 2px 0 ${PALETTE.black},-1px 0 0 ${PALETTE.black},1px 0 0 ${PALETTE.black}}
.c9t-legend{position:absolute;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;gap:6px;
  width:max-content;max-width:calc(100vw - 20px)}
.c9t-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 13px 4px 4px;border-radius:999px;background:rgba(23,18,28,.72);font-weight:800;font-size:16px;white-space:nowrap}
.c9t-chip b{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 4px;box-sizing:border-box;border-radius:999px;background:${PALETTE.pink};color:#fff;font-size:17px;font-weight:900}
.c9t-legend.c9t-apex .c9t-chip b{background:linear-gradient(135deg,${PALETTE.rhinestonePink},${PALETTE.rhinestonePurple})}
.c9t-chip.c9t-tag{padding:4px 13px;background:${PALETTE.gold};color:${PALETTE.black};font-weight:900}
.c9t-hint{position:absolute;left:50%;bottom:calc(92px + env(safe-area-inset-bottom));transform:translateX(-50%);padding:8px 16px;border-radius:14px;background:rgba(23,18,28,.78);
  font-weight:800;font-size:18px;white-space:nowrap;animation:c9t-bob 1.4s ease-in-out infinite}
.c9t-card{position:absolute;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(370px,calc(100vw - 24px));box-sizing:border-box;
  padding:12px 16px 14px;border-radius:22px;background:linear-gradient(180deg,${PALETTE.white},${PALETTE.pinkPale});color:${PALETTE.ink};border:3px solid ${PALETTE.black};
  box-shadow:0 5px 0 ${PALETTE.black},0 12px 30px rgba(23,18,28,.3);pointer-events:auto;animation:c9t-up .32s cubic-bezier(.2,1.3,.4,1) both}
.c9t-line{font-weight:800;font-size:18px;text-align:center;margin:0 2px 8px}
.c9t-rows{list-style:none;margin:0;padding:0;display:grid;gap:3px}
.c9t-rows li{display:flex;justify-content:space-between;gap:12px;font-size:16px;font-weight:700}
.c9t-rows li b{color:${PALETTE.pink};font-weight:900}
.c9t-rows li.c9t-dim{opacity:.6}
.c9t-total{display:flex;justify-content:space-between;align-items:baseline;margin-top:7px;padding-top:6px;border-top:2px dashed ${PALETTE.pinkSoft};font-weight:900;font-size:18px}
.c9t-total b{font-size:32px;color:${PALETTE.black}}
.c9t-best{display:inline-block;margin-left:8px;padding:3px 10px;border-radius:999px;background:${PALETTE.gold};color:${PALETTE.black};font-size:16px;font-weight:900;vertical-align:middle;animation:c9t-pop .4s .2s cubic-bezier(.2,1.6,.4,1) both}
.c9t-again{display:block;width:100%;min-height:52px;margin-top:10px;border:0;border-radius:16px;background:${PALETTE.pink};color:#fff;font:inherit;font-weight:900;font-size:19px;
  box-shadow:0 4px 0 ${PALETTE.black};cursor:pointer;touch-action:manipulation}
.c9t-again:active{transform:translateY(2px);box-shadow:0 2px 0 ${PALETTE.black}}
.c9t-again:focus-visible{outline:3px solid ${PALETTE.rhinestonePurple};outline-offset:3px}
@keyframes c9t-pop{0%{transform:scale(.3) rotate(-5deg);opacity:0}60%{transform:scale(1.12) rotate(2deg);opacity:1}100%{transform:none;opacity:1}}
@keyframes c9t-rise{0%{transform:none;opacity:.9}100%{transform:translateY(-.9em) scale(.85);opacity:0}}
@keyframes c9t-count{0%{transform:scale(2.3);opacity:0}35%{transform:scale(.92);opacity:1}60%{transform:scale(1.05)}82%{transform:scale(1);opacity:1}100%{transform:scale(.96);opacity:0}}
@keyframes c9t-tw{0%,100%{transform:scale(.55) rotate(0);opacity:.55}50%{transform:scale(1.15) rotate(45deg);opacity:1}}
@keyframes c9t-bob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,-5px)}}
@keyframes c9t-up{0%{transform:translate(-50%,40px);opacity:0}100%{transform:translate(-50%,0);opacity:1}}
.c9t-calm *{animation-duration:.01s!important;animation-iteration-count:1!important}
.c9t-calm .c9t-count .c9t-word{animation:c9t-fade .62s linear both!important}
@keyframes c9t-fade{0%{opacity:0}15%{opacity:1}80%{opacity:1}100%{opacity:0}}
@media (max-height:500px) and (orientation:landscape){
  .c9t-top{top:calc(9% + env(safe-area-inset-top))}
  .c9t-squad{top:calc(3% + env(safe-area-inset-top))}
  .c9t-card{left:auto;right:calc(12px + env(safe-area-inset-right));top:calc(10px + env(safe-area-inset-top));bottom:auto;transform:none;width:min(330px,45vw);max-height:calc(100vh - 20px);overflow:auto;animation:none}
  .c9t-hascard .c9t-top{right:calc(min(330px,45vw) + 16px)}
  .c9t-gauge{height:46vh}
  .c9t-hint{bottom:calc(60px + env(safe-area-inset-bottom))}
}
@media (prefers-reduced-motion:reduce){.c9t *{animation-duration:.01s!important;animation-iteration-count:1!important}}
`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

// Gradient text with a dark outline behind it and a few sparkles around it.
function word(text, extra = '', sparkles = 5) {
  const w = el('div', 'c9t-word' + (extra ? ' ' + extra : ''));
  w.setAttribute('role', 'status');
  w.append(el('span', 'c9t-o', text), el('span', 'c9t-f', text));
  const spots = [[-8, -18], [92, -26], [104, 40], [-14, 62], [46, -38], [70, 78]];
  for (let i = 0; i < sparkles; i++) {
    const s = el('span', 'c9t-s', '✦');
    s.style.left = spots[i][0] + '%';
    s.style.top = spots[i][1] + '%';
    s.style.animationDelay = (i * 0.17).toFixed(2) + 's';
    if (i % 3 === 1) s.style.color = PALETTE.rhinestonePink;
    if (i % 3 === 2) s.style.color = PALETTE.rhinestoneSilver;
    s.setAttribute('aria-hidden', 'true');
    w.appendChild(s);
  }
  return w;
}

const fmtMult = (m) => '×' + (Math.round(m * 10) / 10).toString();
// em size for a word so that long ones still fit across a phone (about 13 characters at 1em)
const fitEm = (text, max) => Math.min(max, 13 / Math.max(1, text.length)).toFixed(3) + 'em';

export function createTossHud({ calm = false, touch = () => true } = {}) {
  if (!document.getElementById('c9t-style')) {
    const style = document.createElement('style');
    style.id = 'c9t-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const root = el('div', 'c9t' + (calm ? ' c9t-calm' : ''));
  root.hidden = true;
  const canvas = el('canvas', 'c9t-trail');
  canvas.setAttribute('aria-hidden', 'true');
  const squadEl = el('div', 'c9t-squad');
  squadEl.hidden = true;
  const countEl = el('div', 'c9t-count');
  const top = el('div', 'c9t-top');
  const sub = el('div', 'c9t-sub');
  const gaugeEl = el('div', 'c9t-gauge');
  gaugeEl.hidden = true;
  gaugeEl.setAttribute('aria-hidden', 'true');
  const fill = el('i', 'c9t-fill');
  const goal = el('i', 'c9t-goal');
  const alt = el('span', 'c9t-alt');
  gaugeEl.append(fill, goal, alt);
  const hintEl = el('div', 'c9t-hint');
  hintEl.hidden = true;
  const legendEl = el('div', 'c9t-legend');
  legendEl.hidden = true;
  const card = el('div', 'c9t-card');
  card.hidden = true;
  root.append(canvas, squadEl, countEl, top, gaugeEl, hintEl, legendEl, card);
  document.body.appendChild(root);

  let current = null; // the trick word on show
  let currentT = 0;
  let bannerEl = null;
  let legendMode = null;
  let legendTouch = null;
  let onAgain = null;

  function retire(w) {
    if (!w) return;
    w.classList.add('c9t-out');
    setTimeout(() => w.remove(), calm ? 30 : 320);
  }

  // ------------------------------------------------------------ the finger's sparkle line
  const ctx = canvas.getContext('2d');
  const strokes = new Map();
  let dpr = 1;
  let cw = 0;
  let ch = 0;
  let painted = false;
  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = Math.max(1, window.innerWidth);
    ch = Math.max(1, window.innerHeight);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  fit();
  window.addEventListener('resize', fit);
  const LIFE = calm ? 0.25 : 0.38;
  let clock = 0;
  function drawTrails() {
    if (!strokes.size) {
      if (painted) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        painted = false;
      }
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    painted = true;
    for (const [id, s] of strokes) {
      while (s.pts.length && clock - s.pts[0][2] > LIFE) s.pts.shift();
      if (!s.pts.length) {
        if (s.ended) strokes.delete(id);
        continue;
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < s.pts.length; i++) {
          const a = s.pts[i - 1];
          const b = s.pts[i];
          const k = Math.max(0, 1 - (clock - b[2]) / LIFE);
          ctx.strokeStyle = pass ? `rgba(255,255,255,${(0.95 * k).toFixed(3)})` : `rgba(255,122,209,${(0.55 * k).toFixed(3)})`;
          ctx.lineWidth = (pass ? 5 : 16) * (0.5 + 0.5 * k);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      }
      if (!calm) {
        for (let i = 2; i < s.pts.length; i += 4) {
          const p = s.pts[i];
          const k = Math.max(0, 1 - (clock - p[2]) / LIFE);
          const r = 7 * k + 2;
          ctx.fillStyle = i % 8 === 2 ? PALETTE.rhinestonePurple : '#ffffff';
          ctx.globalAlpha = k;
          ctx.beginPath();
          ctx.moveTo(p[0], p[1] - r);
          ctx.lineTo(p[0] + r * 0.28, p[1] - r * 0.28);
          ctx.lineTo(p[0] + r, p[1]);
          ctx.lineTo(p[0] + r * 0.28, p[1] + r * 0.28);
          ctx.lineTo(p[0], p[1] + r);
          ctx.lineTo(p[0] - r * 0.28, p[1] + r * 0.28);
          ctx.lineTo(p[0] - r, p[1]);
          ctx.lineTo(p[0] - r * 0.28, p[1] - r * 0.28);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function buildLegend(mode) {
    const isTouch = !!touch();
    if (mode === legendMode && isTouch === legendTouch) return;
    legendMode = mode;
    legendTouch = isTouch;
    legendEl.replaceChildren();
    legendEl.hidden = !mode;
    if (!mode) return;
    legendEl.classList.toggle('c9t-apex', mode === 'apex');
    const chip = (glyph, label) => {
      const c = el('span', 'c9t-chip');
      c.append(el('b', null, glyph), document.createTextNode(label));
      legendEl.appendChild(c);
    };
    const spin = isTouch ? GESTURES.circle.glyph : 'Space';
    if (mode === 'apex') {
      legendEl.appendChild(el('span', 'c9t-chip c9t-tag', 'APEX!'));
      for (const g of ['up', 'down', 'left', 'right']) chip(GESTURES[g].glyph, TRICKS[GESTURES[g].apex].name);
      chip(spin, TRICKS[GESTURES.circle.apex].name);
    } else {
      chip(GESTURES.up.glyph, TRICKS.toeTouch.name);
      chip(GESTURES.down.glyph, TRICKS.pike.name);
      chip(GESTURES.left.glyph + ' ' + GESTURES.right.glyph, TRICKS.kickDouble.name);
      chip(spin, TRICKS.twist.name);
    }
  }

  return {
    root,
    show(on) {
      root.hidden = !on;
      if (!on) {
        strokes.clear();
        drawTrails();
      }
    },
    count(label) {
      countEl.replaceChildren();
      if (!label) return;
      countEl.appendChild(word(label, label.includes('!') ? 'c9t-gold' : 'c9t-plain', label.includes('!') ? 5 : 0));
    },
    trick(name, { mult = 1, apex = false } = {}) {
      retire(current);
      sub.remove();
      const text = name.toUpperCase() + '!';
      current = word(text, apex ? 'c9t-gold' : '');
      current.style.fontSize = fitEm(text, 1);
      currentT = 0;
      top.append(current);
      sub.replaceChildren();
      if (apex) sub.appendChild(el('span', 'c9t-chipx c9t-apexchip', 'APEX ✦'));
      if (mult > 1) sub.appendChild(el('span', 'c9t-chipx', 'COMBO ' + fmtMult(mult)));
      top.append(sub);
    },
    points(points) {
      if (!current) return;
      sub.prepend(el('span', 'c9t-pts', '+' + points));
      currentT = Math.min(currentT, 0.3);
    },
    legend(mode) {
      buildLegend(mode || null);
    },
    gauge(g) {
      gaugeEl.hidden = !g;
      if (!g) return;
      const max = Math.max(4, g.apex + 1.5);
      const f = Math.max(0, Math.min(1, g.height / max));
      fill.style.height = `calc(${(f * 100).toFixed(1)}% - 4px)`;
      goal.style.bottom = `calc(${((Math.max(0, g.target) / max) * 100).toFixed(1)}% - 2px)`;
      alt.style.bottom = `${(f * 100).toFixed(1)}%`;
      alt.textContent = Math.max(0, Math.round(g.height)) + ' m';
    },
    squad(count, names = []) {
      squadEl.hidden = !(count > 0);
      if (!(count > 0)) return;
      squadEl.replaceChildren(el('b', null, 'SQUAD LIFT ×' + count + '  ✦ HIGHER!'));
      if (names.length) squadEl.appendChild(el('span', null, 'Based by ' + names.join(', ')));
    },
    banner(text, kind = 'stuck') {
      if (bannerEl) bannerEl.remove();
      bannerEl = null;
      if (!text) return;
      retire(current);
      current = null;
      sub.remove();
      bannerEl = word(text, kind === 'stuck' ? 'c9t-gold' : '', 6);
      bannerEl.style.fontSize = fitEm(text, 1.18);
      top.append(bannerEl);
    },
    result(r, opts = {}) {
      onAgain = opts.onAgain || null;
      card.replaceChildren();
      card.hidden = !r;
      root.classList.toggle('c9t-hascard', !!r);
      if (!r) return;
      if (r.line) card.appendChild(el('div', 'c9t-line', r.line));
      const ul = el('ul', 'c9t-rows');
      for (const [label, pts, dim] of r.rows || []) {
        const li = el('li', dim ? 'c9t-dim' : null);
        li.append(el('span', null, label), el('b', null, typeof pts === 'number' ? '+' + pts : pts));
        ul.appendChild(li);
      }
      card.appendChild(ul);
      const tot = el('div', 'c9t-total');
      const left = el('span', null, 'Score');
      if (r.newBest) left.appendChild(el('span', 'c9t-best', 'NEW BEST!'));
      else if (r.best) left.appendChild(document.createTextNode('  (best ' + r.best + ')'));
      tot.append(left, el('b', null, String(r.total)));
      card.appendChild(tot);
      if (onAgain) {
        const btn = el('button', 'c9t-again', r.againLabel || 'Toss again!');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          const fn = onAgain;
          onAgain = null;
          if (fn) fn();
        });
        card.appendChild(btn);
      }
    },
    hint(text) {
      hintEl.hidden = !text;
      if (text) hintEl.textContent = text;
    },
    trail(x, y, id) {
      let s = strokes.get(id);
      if (!s || s.ended) {
        s = { pts: [], ended: false };
        strokes.set(id, s);
      }
      s.pts.push([x, y, clock]);
      if (s.pts.length > 90) s.pts.shift();
    },
    trailEnd(id) {
      const s = strokes.get(id);
      if (s) s.ended = true;
    },
    update(dt) {
      clock += dt;
      if (current) {
        currentT += dt;
        if (currentT > 1.35) {
          retire(current);
          current = null;
          sub.remove();
        }
      }
      if (!root.hidden) drawTrails();
    },
    dispose() {
      window.removeEventListener('resize', fit);
      root.remove();
    },
  };
}
