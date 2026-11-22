// Small DOM helpers shared by the HUD and the menus. Pure DOM: no three.js.
// Every piece of text goes in with textContent (nicknames come from other devices).
//
//   el(tag, className, text)            onTap(element, fn)     (League World's thumb-safe tap)
//   icon(name) -> <svg>                 bowSvg({ size, sparkle }) -> <svg>   the hot-pink star bow
//   starSvg(color) -> <svg>             button(className, text, onClick, { icon })
//   wait(ms)  reducedMotion()  coarsePointer()  cssColor(c)
//   loadCss(href) -> Promise            adds a stylesheet once (creator.css, rhythm.css)

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  sound: 'M4 9.5v5h3.5l4.5 4V5.5l-4.5 4H4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10',
  mute: 'M4 9.5v5h3.5l4.5 4V5.5l-4.5 4H4zM16 9.5l5 5M21 9.5l-5 5',
  games: 'M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  emote: 'M4 5.5h16v10H11l-4.5 4v-4H4zM9.2 9.6a1.4 1.4 0 0 1 2.8 0c0 1.5-2.8 2.9-2.8 2.9M14.8 9.6a1.4 1.4 0 0 0-2.8 0',
  jump: 'M6 15l6-6 6 6M6 20l6-6 6 6',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  people: 'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a2.8 2.8 0 1 0 0-5.6M18 14.3c1.8.8 3 2.6 3 4.7',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  play: 'M8 5.5v13l10.5-6.5z',
  plus: 'M12 5v14M5 12h14',
  key: 'M14.5 4a5.5 5.5 0 0 0-5.2 7.3L3 17.6V21h3.4v-2.2h2.2v-2.2h2.2l1.4-1.4A5.5 5.5 0 1 0 14.5 4zM16 8.5h.01',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  star: 'M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  backspace: 'M9 5h11v14H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.2 6-5.5 6S6 18 5 15.5L3.7 12.6a1.4 1.4 0 0 1 2.5-1.2L8 14',
  bow: 'M12 12c-3-4-8-6-8-2.5S9 14 12 12zm0 0c3-4 8-6 8-2.5S15 14 12 12zm-1.5 1.5L8 19m5.5-5.5L16 19',
  map: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20',
  door: 'M6 21V4h10v17M4 21h16M13 12.5h.01M16 4l3 1.5V21',
  sparkle: 'M12 3v6M12 15v6M3 12h6M15 12h6M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5',
  robot: 'M6 9h12v9H6zM12 5v4M9.5 13h.01M14.5 13h.01M10 16h4M4 12v3M20 12v3',
  crown: 'M4 18h16M5 16 4 7l5 4 3-6 3 6 5-4-1 9z',
  eyes: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
  snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9.5c5 1.5 12 1.5 17 0M3.5 14.5c5-1.5 12-1.5 17 0',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
};

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function icon(name, className = 'c9-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.star);
  svg.appendChild(path);
  if (name === 'star' || name === 'games') svg.classList.add('c9-icon-fill');
  return svg;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  return n;
}

function starPath(cx, cy, r, inner = 0.45) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return d + 'Z';
}

export function starSvg(color = '#17121c', className = 'c9-star') {
  const svg = svgEl('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true', class: className });
  svg.appendChild(svgEl('path', { d: starPath(10, 10.6, 9.4), fill: color }));
  return svg;
}

let bowCount = 0;
// The signature motif: a big hot-pink cheer bow with small black stars and a rhinestone glint.
export function bowSvg({ className = 'c9-bow', sparkle = true } = {}) {
  const id = 'c9bow' + ++bowCount;
  const svg = svgEl('svg', { viewBox: '0 0 220 150', 'aria-hidden': 'true', class: className });
  const defs = svgEl('defs', {});
  const grad = svgEl('linearGradient', { id: id + 'g', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(svgEl('stop', { offset: '0', 'stop-color': '#ff6fb8' }), svgEl('stop', { offset: '0.55', 'stop-color': '#ff2e93' }), svgEl('stop', { offset: '1', 'stop-color': '#e0137c' }));
  defs.appendChild(grad);
  svg.appendChild(defs);
  const ink = '#17121c';
  const fill = 'url(#' + id + 'g)';
  const stroke = { stroke: ink, 'stroke-width': '6', 'stroke-linejoin': 'round' };
  // tails
  svg.appendChild(svgEl('path', Object.assign({ d: 'M100 78 L62 140 L82 132 L92 146 L108 82 Z', fill: '#e0137c' }, stroke)));
  svg.appendChild(svgEl('path', Object.assign({ d: 'M120 78 L158 140 L138 132 L128 146 L112 82 Z', fill: '#e0137c' }, stroke)));
  // loops
  svg.appendChild(svgEl('path', Object.assign({ d: 'M104 64 C 78 22, 26 2, 14 38 C 4 70, 46 104, 104 82 Z', fill }, stroke)));
  svg.appendChild(svgEl('path', Object.assign({ d: 'M116 64 C 142 22, 194 2, 206 38 C 216 70, 174 104, 116 82 Z', fill }, stroke)));
  // shine on the loops
  svg.appendChild(svgEl('path', { d: 'M30 34 C 40 20, 62 24, 78 40', fill: 'none', stroke: '#ffffff', 'stroke-width': '6', 'stroke-linecap': 'round', opacity: '0.55' }));
  svg.appendChild(svgEl('path', { d: 'M142 40 C 158 24, 180 20, 190 34', fill: 'none', stroke: '#ffffff', 'stroke-width': '6', 'stroke-linecap': 'round', opacity: '0.55' }));
  // small black stars
  for (const [x, y, r] of [[44, 56, 8.5], [70, 74, 6.5], [62, 44, 5.5], [176, 56, 8.5], [150, 74, 6.5], [158, 44, 5.5], [28, 74, 5]]) {
    svg.appendChild(svgEl('path', { d: starPath(x, y, r), fill: ink }));
  }
  svg.appendChild(svgEl('path', { d: starPath(192, 74, 5), fill: ink }));
  // knot
  svg.appendChild(svgEl('rect', Object.assign({ x: '92', y: '54', width: '36', height: '38', rx: '14', fill: '#ff4fa3' }, stroke)));
  svg.appendChild(svgEl('path', { d: 'M100 64 C 106 60, 114 60, 120 64', fill: 'none', stroke: '#ffffff', 'stroke-width': '4', 'stroke-linecap': 'round', opacity: '0.6' }));
  if (sparkle) {
    const g = svgEl('g', { class: 'c9-bow-glint' });
    g.appendChild(svgEl('path', { d: 'M196 6 L199 15 L208 18 L199 21 L196 30 L193 21 L184 18 L193 15 Z', fill: '#ffffff', stroke: ink, 'stroke-width': '2.5', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: 'M24 98 L26 104 L32 106 L26 108 L24 114 L22 108 L16 106 L22 104 Z', fill: '#eae8f2', stroke: ink, 'stroke-width': '2', 'stroke-linejoin': 'round' }));
    svg.appendChild(g);
  }
  return svg;
}

// Activate on the element's own pointerup (League World): browsers only synthesize `click` for the
// primary touch, so a button tapped while a thumb holds the joystick would otherwise never fire.
// The click that may follow is swallowed (one tap, one activation); keyboard clicks still work.
let ghostUntil = 0;
let ghostX = 0;
let ghostY = 0;
let ghostNode = null;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.detail !== 0 && performance.now() < ghostUntil && Math.hypot(e.clientX - ghostX, e.clientY - ghostY) < 44) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

export function onTap(node, fn) {
  let id = null;
  let sx = 0;
  let sy = 0;
  let last = -1e9;
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    id = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
  });
  node.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 18) return;
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return;
    // a double tap's second half, on a button the first half just put under the finger (the next
    // screen: "Play!" then "Make a room"), is not a tap on that button
    if (node !== ghostNode && performance.now() < ghostUntil - 250 && Math.hypot(e.clientX - ghostX, e.clientY - ghostY) < 24) return;
    last = performance.now();
    ghostUntil = last + 650;
    ghostX = e.clientX;
    ghostY = e.clientY;
    ghostNode = node;
    fn(e);
  });
  node.addEventListener('pointercancel', (e) => {
    if (e.pointerId === id) id = null;
  });
  node.addEventListener('click', (e) => {
    if (performance.now() - last < 800) return;
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') return;
    fn(e);
  });
}

export function button(className, text, onClick, opts = {}) {
  const b = el('button', className);
  b.type = 'button';
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (text !== undefined && text !== null && text !== '') b.appendChild(el('span', 'c9-btn-label', text));
  if (opts.label) b.setAttribute('aria-label', opts.label);
  if (onClick) onTap(b, onClick);
  return b;
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function reducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (err) {
    return false;
  }
}

export function coarsePointer() {
  try {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch (err) {
    return false;
  }
}

export function cssColor(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null;
}

const cssLoads = new Map();
export function loadCss(href) {
  if (cssLoads.has(href)) return cssLoads.get(href);
  const p = new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }
    for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (l.getAttribute('href') === href) {
        resolve(true);
        return;
      }
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.appendChild(link);
    setTimeout(() => resolve(false), 4000);
  });
  cssLoads.set(href, p);
  return p;
}
