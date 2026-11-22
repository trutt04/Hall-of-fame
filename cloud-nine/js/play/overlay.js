// The game layer's own bits of screen (PLAY), on top of the APP's HUD: the seeker's blindfold while
// counting, and the game bar inside the HUD's game panel (Leave game / End game, Play again!, Join
// the game!). Plain DOM with textContent only; the styles are injected once from here (this layer
// owns no CSS file). It never eats touches outside its buttons, so the joystick works everywhere.
//
//   const ui = createOverlay(world, { onLeave, onAgain, onJoin })
//   ui.setBlind(on, count, line)           the seeker's screen covered, with the count (and a hype line)
//   ui.setBar({ leave, again, join })      leave: 'Leave game' | 'End game' | null; again, join: booleans
//   ui.confirm(copy, onYes)                a "Keep playing / Leave" card (copy from logic.leaveCopy)
//   ui.confirming                          true while that card is up
//   ui.reset()                             hide it all
//   ui.dispose()

import { el, icon, onTap, bowSvg } from '../ui/dom.js';
import { COPY } from './logic.js';

const STYLE_ID = 'c9p-style';
const CSS = `
.c9p-blind{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px 24px 215px;
  pointer-events:none;text-align:center;color:var(--ink,#2b2233);
  background:radial-gradient(120% 90% at 50% 40%,#ffe0f0 0%,#f3d2ff 55%,#cdb4ff 100%)}
.c9p-blind[hidden]{display:none}
.c9p-blind.c9p-in{animation:c9p-fade .35s ease-out both}
.c9p-blind .c9p-bow{width:min(34vw,150px);height:auto;filter:drop-shadow(0 6px 0 rgba(23,18,28,.18))}
@media (max-height:620px){.c9p-blind .c9p-bow{display:none}}
@media (min-width:700px){.c9p-blind{padding-bottom:120px}}
.c9p-blind-title{font-weight:900;font-size:clamp(34px,10vw,64px);line-height:1;letter-spacing:-.01em;color:#fff8fc;
  -webkit-text-stroke:3px #17121c;paint-order:stroke fill;text-shadow:0 5px 0 #17121c}
.c9p-blind-count{display:grid;place-items:center;width:clamp(100px,27vw,150px);height:clamp(100px,27vw,150px);border-radius:50%;
  background:#fff8fc;border:4px solid #17121c;box-shadow:0 6px 0 #17121c;font-weight:900;font-size:clamp(54px,16vw,84px);
  line-height:1;color:#ff2e93;font-variant-numeric:tabular-nums}
.c9p-blind-line{font-weight:800;font-size:clamp(17px,4.6vw,22px);padding:8px 18px;border-radius:999px;background:#17121c;color:#fff8fc;max-width:min(90vw,520px)}
.c9p-blind-star{position:absolute;width:26px;height:26px;opacity:.85;animation:c9p-twinkle 2.4s ease-in-out infinite}
.c9p-blind-star svg{width:100%;height:100%}
.c9p-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:4px}
.c9p-bar[hidden]{display:none}
.c9p-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:48px;padding:6px 11px;font-weight:900;font-size:16px;
  color:var(--ink,#2b2233);background:var(--white,#fff8fc);border:3px solid #17121c;border-radius:999px;box-shadow:0 4px 0 #17121c;
  pointer-events:auto;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;line-height:1.05}
.c9p-btn .c9-icon{width:20px;height:20px}
.c9p-btn-label{white-space:nowrap}
.c9p-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #17121c}
.c9p-btn-go{color:#fff8fc;background:var(--pink,#ff2e93)}
.c9p-btn-go.c9p-in{animation:c9p-pop .3s cubic-bezier(.2,1.5,.4,1) both,c9p-nudge 1.6s .4s ease-in-out infinite}
.c9p-btn[hidden]{display:none}
.c9-hud.c9-modal .c9p-bar{visibility:hidden}
@keyframes c9p-fade{from{opacity:0}to{opacity:1}}
@keyframes c9p-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes c9p-nudge{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes c9p-twinkle{0%,100%{transform:scale(.6) rotate(0);opacity:.35}50%{transform:scale(1.1) rotate(20deg);opacity:1}}
@media (prefers-reduced-motion:reduce){.c9p-blind.c9p-in,.c9p-btn-go.c9p-in,.c9p-blind-star{animation:none}}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function star(color) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 4 : 9.4;
    d += (i ? 'L' : 'M') + (10 + Math.cos(a) * r).toFixed(1) + ' ' + (10.6 + Math.sin(a) * r).toFixed(1);
  }
  p.setAttribute('d', d + 'Z');
  p.setAttribute('fill', color);
  svg.appendChild(p);
  return svg;
}

export function createOverlay(world, handlers = {}) {
  injectStyle();
  const hud = world.hud;
  const root = hud && hud.el ? hud.el : document.body;
  const call = (name) => {
    try {
      if (typeof handlers[name] === 'function') handlers[name]();
    } catch (err) {
      console.error('[c9 play] ' + name + ' failed', err);
    }
  };

  // ---------------------------------------------------------------- the seeker's blindfold
  const blind = el('div', 'c9p-blind');
  blind.hidden = true;
  blind.setAttribute('aria-live', 'polite');
  const stars = [[8, 14, '#ff2e93'], [84, 10, '#a96bff'], [14, 78, '#ffd36e'], [86, 72, '#ff7ad1'], [46, 8, '#fff8fc'], [70, 88, '#17121c']];
  for (const [x, y, c] of stars) {
    const s = el('span', 'c9p-blind-star');
    s.style.left = x + '%';
    s.style.top = y + '%';
    s.style.animationDelay = (x % 7) * 0.2 + 's';
    s.appendChild(star(c));
    blind.appendChild(s);
  }
  const bowArt = bowSvg({ className: 'c9p-bow', sparkle: true });
  const blindTitle = el('div', 'c9p-blind-title', COPY.noPeeking);
  const blindCount = el('div', 'c9p-blind-count', '');
  const blindLine = el('div', 'c9p-blind-line', COPY.eyesClosed);
  blind.append(bowArt, blindTitle, blindCount, blindLine);
  root.prepend(blind); // under the rest of the HUD: the timer and the buttons stay on top
  let blindOn = false;

  // ---------------------------------------------------------------- the game bar
  const bar = el('div', 'c9p-bar');
  bar.hidden = true;
  function btn(cls, ic, label, name) {
    const b = el('button', 'c9p-btn ' + cls);
    b.type = 'button';
    b.appendChild(icon(ic));
    const span = el('span', 'c9p-btn-label', label);
    b.appendChild(span);
    b.hidden = true;
    onTap(b, () => call(name));
    bar.appendChild(b);
    return { b, span };
  }
  const again = btn('c9p-btn-go', 'play', COPY.again, 'onAgain');
  const join = btn('c9p-btn-go', 'play', COPY.join, 'onJoin');
  const leave = btn('c9p-btn-leave', 'door', COPY.leaveGame, 'onLeave');
  let barKey = '';
  let confirming = false;

  function mountBar() {
    // inside the HUD's game panel, under the scoreboard; anywhere on the HUD if there is none
    const panel = root.querySelector('.c9-game');
    const host = panel || root;
    if (bar.parentNode !== host) host.appendChild(bar);
  }

  function show(part, on) {
    if (part.b.hidden === !on) return false;
    part.b.hidden = !on;
    if (on && part.b.classList.contains('c9p-btn-go')) {
      part.b.classList.remove('c9p-in');
      void part.b.offsetWidth;
      part.b.classList.add('c9p-in');
    }
    return true;
  }

  return {
    setBlind(on, count, line) {
      const want = !!on;
      if (want !== blindOn) {
        blindOn = want;
        blind.hidden = !want;
        if (want) {
          blind.classList.remove('c9p-in');
          void blind.offsetWidth;
          blind.classList.add('c9p-in');
        }
      }
      if (want) {
        const text = Number.isFinite(count) ? String(Math.max(0, Math.round(count))) : '';
        if (blindCount.textContent !== text) blindCount.textContent = text;
        blindCount.hidden = !text;
        const l = typeof line === 'string' && line ? line : COPY.eyesClosed;
        if (blindLine.textContent !== l) blindLine.textContent = l;
        // keep clear of the HUD's top stack (the chips, and the game panel: in that column on
        // phones, centred at the top on wider screens)
        try {
          let top = 24;
          for (const sel of ['.c9-left', '.c9-game']) {
            const n = root.querySelector(sel);
            if (n && !n.hidden) top = Math.max(top, Math.round(n.getBoundingClientRect().bottom) + 12);
          }
          const pad = top + 'px';
          if (blind.style.paddingTop !== pad) blind.style.paddingTop = pad;
        } catch (err) { /* centred is fine */ }
      }
    },
    setBar({ leave: leaveLabel = null, again: showAgain = false, join: showJoin = false } = {}) {
      const key = `${leaveLabel}|${showAgain}|${showJoin}`;
      mountBar();
      if (key === barKey) return;
      barKey = key;
      if (leaveLabel && leave.span.textContent !== leaveLabel) leave.span.textContent = leaveLabel;
      show(leave, !!leaveLabel);
      show(again, !!showAgain);
      show(join, !!showJoin);
      bar.hidden = !(leaveLabel || showAgain || showJoin);
    },
    confirm(copy, onYes) {
      if (!hud || typeof hud.openCard !== 'function') {
        onYes();
        return;
      }
      confirming = true;
      hud.openCard({
        icon: 'door',
        kicker: copy.kicker,
        title: copy.title,
        lines: copy.lines,
        accent: '#cdb4ff',
        onClose: () => {
          confirming = false;
        },
        actions: [
          { label: copy.no, icon: 'play', primary: true },
          { label: copy.yes, icon: 'door', primary: false, onClick: onYes },
        ],
      });
    },
    get confirming() {
      return confirming;
    },
    reset() {
      this.setBlind(false);
      this.setBar({});
      bar.hidden = true;
    },
    get blind() {
      return blindOn;
    },
    get bar() {
      return bar;
    },
    dispose() {
      blind.remove();
      bar.remove();
    },
  };
}
