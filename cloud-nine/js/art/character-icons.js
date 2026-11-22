// Inline SVG icons for the character creator (js/ui/creator.js): hairstyles, bows, tops, bottoms, shoes, socks,
// sparkle levels and the tab icons. Pure strings (no DOM), so they can be unit tested.
//
//   optionIcon(slot, option, look) -> '<svg ...>'   look supplies the hair, skin and bow colours
//   tabIcon(id) -> '<svg ...>'
//
// Colours come from LOOK_OPTIONS (preset '#rrggbb' values), never from free text.
import { lookOption } from './character-looks.js';

let uid = 0;
const id = (p) => `c9c-${p}-${++uid}`;
const svg = (body, vb = '0 0 64 64') => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
const safe = (c, fallback = '#ff2e93') => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);
function shade(hex, f) {
  const n = parseInt(safe(hex).slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 1) { r *= f; g *= f; b *= f; } else { const k = Math.min(1, f - 1); r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
const star5 = (cx, cy, r, ri = r * 0.45) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 5, rr = i % 2 ? ri : r;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return d + 'Z';
};
const twinkle = (cx, cy, r) => `M${cx} ${cy - r}Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy}Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r}Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy}Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r}Z`;
const heart = (cx, cy, s) => `M${cx} ${cy + s * 0.9}C${cx - s * 1.4} ${cy - s * 0.1} ${cx - s * 0.7} ${cy - s * 1.1} ${cx} ${cy - s * 0.35}C${cx + s * 0.7} ${cy - s * 1.1} ${cx + s * 1.4} ${cy - s * 0.1} ${cx} ${cy + s * 0.9}Z`;

// ---- the bow -------------------------------------------------------------------------------------
const BOW_LOOPS = 'M32 31C25 17 5 13 5 27C5 41 24 41 32 35ZM32 31C39 17 59 13 59 27C59 41 40 41 32 35Z';
const BOW_TAILS = 'M30 35L19 54L25 51L28 57L34 37ZM34 35L45 54L39 51L36 57L30 37Z';
function bowSvg(bowOpt, patternId, scale = 1) {
  const col = safe(bowOpt.color), acc = safe(bowOpt.accent, '#17121c'), dark = shade(col, 0.82);
  const clip = id('clip'), grad = id('grad');
  let defs = `<clipPath id="${clip}"><path d="${BOW_LOOPS}"/><path d="${BOW_TAILS}"/></clipPath>`;
  let fill = col;
  if (bowOpt.rainbow) {
    defs += `<linearGradient id="${grad}" x1="0" y1="0" x2="1" y2="0">${bowOpt.rainbow.map((c, i, a) => `<stop offset="${(i / (a.length - 1)).toFixed(2)}" stop-color="${safe(c)}"/>`).join('')}</linearGradient>`;
    fill = `url(#${grad})`;
  } else if (bowOpt.glitter) {
    defs += `<linearGradient id="${grad}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${shade(col, 1.35)}"/><stop offset="0.55" stop-color="${col}"/><stop offset="1" stop-color="${shade(col, 0.8)}"/></linearGradient>`;
    fill = `url(#${grad})`;
  }
  let pattern = '';
  const spots = [[14, 25], [22, 30], [12, 33], [21, 22], [42, 25], [50, 30], [52, 22], [43, 33], [26, 46], [38, 46]];
  if (patternId === 'stars') pattern = spots.map(([x, y]) => `<path d="${star5(x, y, 3.4)}" fill="${acc}"/>`).join('');
  else if (patternId === 'polkaDots') pattern = spots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${acc}"/>`).join('');
  else if (patternId === 'rhinestones') {
    for (let y = 18; y <= 40; y += 5.5) for (let x = 6 + ((y / 5.5) % 2) * 2.75; x <= 58; x += 5.5) {
      if (Math.abs(x - 32) < 6) continue;
      pattern += `<path d="M${x} ${y - 2.2}L${x + 2.2} ${y}L${x} ${y + 2.2}L${x - 2.2} ${y}Z" fill="${(x + y) % 3 < 1 ? '#ffd0ea' : '#ffffff'}" stroke="#c9c3dc" stroke-width=".5"/>`;
    }
  } else if (patternId === 'rainbow') {
    const bands = ['#ff4f6d', '#ff9f43', '#ffe066', '#5fdd8b', '#4fb3ff', '#a46bff'];
    for (const cx of [17, 47]) pattern += bands.map((c, i) => `<path d="M${cx - 10 + i * 1.6} 34A${10 - i * 1.6} ${10 - i * 1.6} 0 0 1 ${cx + 10 - i * 1.6} 34" stroke="${c}" stroke-width="1.7" fill="none"/>`).join('');
  }
  else if (patternId === 'hearts') pattern = spots.map(([x, y]) => `<path d="${heart(x, y, 3)}" fill="${acc}"/>`).join('');
  else if (patternId === 'checker') {
    for (let y = 12; y < 60; y += 6) for (let x = 2; x < 62; x += 6) if (((x - 2) / 6 + (y - 12) / 6) % 2 === 0) pattern += `<rect x="${x}" y="${y}" width="6" height="6" fill="${acc}"/>`;
  } else if (patternId === 'glitter' || bowOpt.glitter) {
    const g = [[10, 24], [16, 30], [20, 21], [13, 35], [24, 27], [40, 27], [46, 21], [52, 31], [48, 35], [55, 25], [27, 44], [37, 47], [33, 52]];
    pattern += g.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.2 : 1.8}" fill="${i % 2 ? '#ffffff' : shade(col, 1.45)}"/>`).join('');
  }
  const t = scale === 1 ? '' : ` transform="translate(32 34) scale(${scale}) translate(-32 -34)"`;
  return `<defs>${defs}</defs><g${t}><path d="${BOW_TAILS}" fill="${fill}" stroke="${dark}" stroke-width="1.2" stroke-linejoin="round"/><path d="${BOW_LOOPS}" fill="${fill}" stroke="${dark}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<g clip-path="url(#${clip})">${pattern}</g><rect x="27" y="26" width="10" height="13" rx="4" fill="${shade(col, 0.9)}" stroke="${dark}" stroke-width="1.2"/>` +
    `<path d="M15 22C18 19 22 19 25 22" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
}

// ---- hairstyles: a little head with the hair in her colour ------------------------------------------
function hairSvg(style, hair, skin, bowCol) {
  const h = safe(hair, '#3f2618'), s = safe(skin, '#eebd98'), hd = shade(h, 0.78), b = safe(bowCol);
  const face = `<circle cx="32" cy="36" r="15" fill="${s}"/><circle cx="26.5" cy="37" r="2.2" fill="#231816"/><circle cx="37.5" cy="37" r="2.2" fill="#231816"/>` +
    `<circle cx="25.8" cy="36.2" r=".8" fill="#fff"/><circle cx="36.8" cy="36.2" r=".8" fill="#fff"/><path d="M28.5 43Q32 46 35.5 43" stroke="#8a3448" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="22.5" cy="41.5" rx="2.6" ry="1.5" fill="#ff7aa8" opacity=".55"/><ellipse cx="41.5" cy="41.5" rx="2.6" ry="1.5" fill="#ff7aa8" opacity=".55"/>`;
  const cap = `<path d="M16.5 34C16 22 23 16 32 16C41 16 48 22 47.5 34C44 27 38 25 32 25C26 25 20 27 16.5 34Z" fill="${h}"/>`;
  const miniBow = (x, y, sc = 0.32) => `<g transform="translate(${x} ${y}) scale(${sc}) translate(-32 -32)"><path d="${BOW_LOOPS}" fill="${b}"/><rect x="27" y="26" width="10" height="12" rx="4" fill="${shade(b, 0.85)}"/></g>`;
  let back = '', front = '';
  switch (style) {
    case 'highPony':
      back = `<path d="M38 15C50 8 60 16 57 30C55 40 50 46 47 52C49 42 51 33 47 24C45 20 42 18 38 18Z" fill="${h}"/>`;
      front = miniBow(40, 15);
      break;
    case 'braidPony':
      back = [[46, 20], [50, 27], [49, 34], [52, 41], [50, 48]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="${5 - i * 0.5}" ry="4" fill="${i % 2 ? hd : h}" transform="rotate(${i % 2 ? 25 : -25} ${x} ${y})"/>`).join('') +
        `<circle cx="50" cy="53" r="1.8" fill="${b}"/>`;
      front = miniBow(40, 15);
      break;
    case 'curlyPony':
      back = [[45, 17, 6], [52, 23, 6], [50, 31, 5.6], [54, 37, 5], [50, 43, 4.6], [53, 49, 3.8]].map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? hd : h}"/>`).join('');
      front = miniBow(40, 15);
      break;
    case 'spaceBuns':
      back = `<circle cx="19" cy="17" r="8" fill="${h}"/><circle cx="45" cy="17" r="8" fill="${h}"/><path d="M14 15Q19 11 24 15M40 15Q45 11 50 15" stroke="${hd}" stroke-width="1.5" fill="none"/>`;
      front = miniBow(32, 14, 0.26);
      break;
    case 'halfUp':
      back = `<path d="M16 32C14 44 15 54 19 58L26 54C22 46 21 38 22 32ZM48 32C50 44 49 54 45 58L38 54C42 46 43 38 42 32Z" fill="${h}"/><circle cx="32" cy="15" r="5" fill="${hd}"/>`;
      front = miniBow(32, 12, 0.28);
      break;
    case 'longDown':
      back = `<path d="M16 30C12 44 13 56 18 61L27 57C22 48 21 38 22 30ZM48 30C52 44 51 56 46 61L37 57C42 48 43 38 42 30Z" fill="${h}"/>`;
      front = miniBow(46, 19, 0.26);
      break;
    case 'bob':
      back = `<path d="M15 32C14 40 15 46 19 48L24 46C21 40 21 35 22 30ZM49 32C50 40 49 46 45 48L40 46C43 40 43 35 42 30Z" fill="${h}"/>`;
      front = `<path d="M17 32C17 22 23 17 32 17C41 17 47 22 47 32C42 30 38 28 32 28C26 28 22 30 17 32Z" fill="${h}"/>` + miniBow(41, 16, 0.26);
      return svg(back + face + front);
    default:
      break;
  }
  return svg(back + face + cap + front);
}

// ---- clothes -------------------------------------------------------------------------------------
function topSvg(o) {
  const c = safe(o.color), t = safe(o.trim, shade(c, 0.8)), a = safe(o.accent, '#ffffff'), line = shade(c, 0.7);
  switch (o.style) {
    case 'crop': {
      const stones = (o.stones || []).map((x) => safe(x));
      const pts = [[25, 33, 4], [38, 30, 3], [32, 38, 2.6], [43, 38, 2.4], [20, 40, 2.2], [30, 28, 2]];
      return svg(`<path d="M22 16L26 16L28 24Q32 26 36 24L38 16L42 16L45 26L47 46L17 46L19 26Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>` +
        pts.map(([x, y, r], i) => `<path d="${twinkle(x, y, r)}" fill="${stones[i % stones.length] || '#ffffff'}"/>`).join('') +
        `<path d="M18 44H46" stroke="${stones[0] || '#ffffff'}" stroke-width="2" stroke-dasharray="2 3"/>`);
    }
    case 'shell':
      return svg(`<path d="M20 12L27 12Q32 26 37 12L44 12L47 22L47 54L17 54L17 22Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M26 12L32 28L38 12" stroke="${t}" stroke-width="3" fill="none"/><path d="M17 49H47" stroke="${t}" stroke-width="4"/>` +
        `<path d="${star5(24, 36, 4.2)}" fill="${a}"/><path d="M34 38L39 42L44 38M34 33L39 37L44 33" stroke="${t}" stroke-width="2.2" fill="none"/>`);
    case 'tee':
      return svg(`<path d="M22 12L28 12Q32 17 36 12L42 12L56 20L51 30L45 27L45 54L19 54L19 27L13 30L8 20Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M28 12Q32 17 36 12" stroke="${t}" stroke-width="2.4" fill="none"/><path d="${heart(32, 34, 6)}" fill="${a}"/><path d="${star5(32, 33, 2.4)}" fill="#ffffff"/>` +
        `<path d="M9 22L14 31M55 22L50 31" stroke="${t}" stroke-width="2"/>`);
    case 'hoodie':
    default:
      return svg(`<path d="M24 10Q32 4 40 10L44 13L55 22L57 52L50 52L48 32L46 56L18 56L16 32L14 52L7 52L9 22L20 13Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M24 12Q32 22 40 12" stroke="${line}" stroke-width="2" fill="none"/><path d="M29 18L28 30M35 18L36 30" stroke="${a}" stroke-width="2" stroke-linecap="round"/>` +
        `<path d="M23 40H41L39 50H25Z" fill="${t}"/><path d="M18 53H46" stroke="${t}" stroke-width="3"/>`);
  }
}
function bottomSvg(o) {
  const c = safe(o.color), t = safe(o.trim, shade(c, 0.8)), line = shade(c, 0.7);
  if (o.style === 'skirt') {
    let pleats = '';
    for (let x = 18; x <= 46; x += 7) pleats += `<path d="M${32 + (x - 32) * 0.55} 18L${x} 46" stroke="${line}" stroke-width="1.3"/>`;
    return svg(`<path d="M20 12H44L52 46H12Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>${pleats}<path d="M12.6 43H51.4" stroke="${t}" stroke-width="4"/><rect x="20" y="10" width="24" height="5" rx="2" fill="${shade(c, 0.85)}"/>`);
  }
  if (o.style === 'leggings') {
    const specks = (o.specks || []).map((x) => safe(x)).map((col, i) => `<path d="${twinkle([25, 40, 22, 42, 28][i % 5], [22, 30, 40, 46, 50][i % 5], 2.2)}" fill="${col}"/>`).join('');
    return svg(`<path d="M20 8H44L46 58H35L32 22L29 58H18Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>${specks}<rect x="20" y="8" width="24" height="5" rx="2" fill="${t}"/>`);
  }
  return svg(`<path d="M17 14H47L50 44H35L32 32L29 44H14Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/><rect x="17" y="12" width="30" height="6" rx="2" fill="${t}"/><path d="M14.4 41H29.4M34.6 41H49.6" stroke="${t}" stroke-width="3"/>`);
}
function shoeSvg(o) {
  const c = safe(o.color), sole = safe(o.sole, '#ffffff'), a = safe(o.accent), lace = safe(o.lace, '#ffffff'), line = shade(c, 0.6);
  const sneaker = o.style === 'sneaker';
  const body = sneaker
    ? `<path d="M8 40C8 30 12 22 20 22L28 22L34 30L52 34C58 36 58 44 56 46H8Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 46H57V50Q57 52 55 52H10Q8 52 8 50Z" fill="${sole}" stroke="#d8cfe0" stroke-width="1"/><path d="M44 33C50 34 56 37 56 44" stroke="${a}" stroke-width="3" fill="none"/>`
    : `<path d="M9 40C9 31 13 24 20 24L27 24L33 31L51 35C57 37 57 43 55 45H9Z" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 45H56V48Q56 50 54 50H11Q9 50 9 48Z" fill="${sole}" stroke="#d8cfe0" stroke-width="1"/><path d="M14 36L30 38" stroke="${a}" stroke-width="3" stroke-linecap="round"/>`;
  const laces = `<path d="M30 27L34 31M33 25L37 29M36 28L40 32" stroke="${lace}" stroke-width="2" stroke-linecap="round"/>`;
  const glitter = o.glitter ? [[16, 34], [22, 40], [44, 40], [48, 37], [26, 30]].map(([x, y]) => `<path d="${twinkle(x, y, 2.2)}" fill="#ffffff"/>`).join('') : '';
  return svg(body + laces + glitter);
}
function sockSvg(o) {
  const c = safe(o.color, '#ffffff'), line = '#cbbfd6';
  const path = 'M24 8H40V36L48 42C53 46 50 56 43 55L26 53C21 52 22 45 24 42Z';
  let deco = '';
  if (o.stripes) {
    const clip = id('sock');
    deco = `<defs><clipPath id="${clip}"><path d="${path}"/></clipPath></defs><g clip-path="url(#${clip})">` +
      o.stripes.map((s, i) => `<rect x="18" y="${8 + i * 8}" width="40" height="8" fill="${safe(s)}"/>`).join('') + '</g>';
  }
  if (o.specks) deco += [[30, 16], [35, 24], [29, 32], [36, 40], [42, 48], [31, 46]].map(([x, y], i) => `<path d="${twinkle(x, y, 2.4)}" fill="${safe(o.specks[i % o.specks.length])}"/>`).join('');
  return svg(`<path d="${path}" fill="${c}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>${deco}<rect x="23" y="8" width="18" height="5" rx="2" fill="${shade(c, 0.9)}"/>`);
}
function sparkleSvg(o) {
  if (o.gold) {
    return svg(`<circle cx="32" cy="32" r="22" fill="#fff1c2" opacity=".9"/><path d="${twinkle(32, 32, 17)}" fill="#ffc94a" stroke="#e0a21c" stroke-width="1"/>` +
      `<path d="${twinkle(14, 14, 7)}" fill="#ffd36e"/><path d="${twinkle(51, 15, 8)}" fill="#ffe7a3"/><path d="${twinkle(52, 50, 6)}" fill="#ffc94a"/><path d="${twinkle(12, 50, 6)}" fill="#ffe7a3"/><path d="${twinkle(32, 32, 6)}" fill="#ffffff"/>`);
  }
  if (o.level === 0) return svg(`<path d="${twinkle(32, 32, 16)}" fill="none" stroke="#c9b6dc" stroke-width="2.5"/>`);
  if (o.level === 1) return svg(`<path d="${twinkle(28, 34, 14)}" fill="#ff7ad1"/><path d="${twinkle(46, 18, 7)}" fill="#a96bff"/><path d="${twinkle(46, 46, 5)}" fill="#eae8f2" stroke="#c9b6dc"/>`);
  return svg(`<circle cx="32" cy="32" r="22" fill="#ffd6ea" opacity=".8"/><path d="${twinkle(32, 32, 17)}" fill="#ff2e93"/><path d="${twinkle(14, 14, 7)}" fill="#a96bff"/>` +
    `<path d="${twinkle(51, 15, 8)}" fill="#ff7ad1"/><path d="${twinkle(52, 50, 6)}" fill="#a96bff"/><path d="${twinkle(12, 50, 6)}" fill="#ff7ad1"/><path d="${twinkle(32, 32, 6)}" fill="#ffffff"/>`);
}

export function optionIcon(slot, o, look = {}) {
  if (!o) return svg('');
  const hair = lookOption('hair', look.hair).color, skin = lookOption('skin', look.skin).color, bow = lookOption('bow', look.bow);
  switch (slot) {
    case 'hairStyle': return hairSvg(o.id, hair, skin, bow.color);
    case 'bow': return svg(bowSvg(o, look.bowPattern));
    case 'bowPattern': return svg(bowSvg(bow, o.id));
    case 'bowSize': return svg(bowSvg(bow, look.bowPattern, { big: 0.55, huge: 0.78, ridiculous: 1.08, mega: 1.45 }[o.id] || 0.6));
    case 'top': return topSvg(o);
    case 'bottom': return bottomSvg(o);
    case 'shoes': return shoeSvg(o);
    case 'socks': return sockSvg(o);
    case 'sparkle': return sparkleSvg(o);
    default: return svg(`<circle cx="32" cy="32" r="26" fill="${safe(o.color, '#cccccc')}"/><ellipse cx="24" cy="22" rx="9" ry="6" fill="#ffffff" opacity=".35"/>`);
  }
}

export function tabIcon(name) {
  switch (name) {
    case 'hair': return svg(`<circle cx="30" cy="34" r="13" fill="currentColor" opacity=".25"/><path d="M17 33C17 22 23 17 31 17C39 17 44 22 44 30C40 25 35 24 30 24C24 24 20 27 17 33Z" fill="currentColor"/><path d="M40 18C51 12 58 22 54 34C52 40 48 44 46 48C47 40 48 32 45 26Z" fill="currentColor"/>`);
    case 'bow': return svg(`<path d="${BOW_LOOPS}" fill="currentColor"/><path d="${BOW_TAILS}" fill="currentColor" opacity=".7"/><rect x="27" y="26" width="10" height="13" rx="4" fill="currentColor"/>`);
    case 'outfit': return svg(`<path d="M22 12L28 12Q32 17 36 12L42 12L54 20L49 29L44 26L44 54L20 54L20 26L15 29L10 20Z" fill="currentColor"/>`);
    case 'shoes': return svg(`<path d="M9 38C9 29 13 22 20 22L27 22L33 29L51 33C57 35 57 41 55 43H9Z" fill="currentColor"/><path d="M9 43H56V47Q56 49 54 49H11Q9 49 9 47Z" fill="currentColor" opacity=".6"/>`);
    case 'sparkle': return svg(`<path d="${twinkle(28, 34, 16)}" fill="currentColor"/><path d="${twinkle(48, 16, 8)}" fill="currentColor" opacity=".7"/>`);
    case 'skin': return svg(`<circle cx="24" cy="26" r="11" fill="currentColor" opacity=".45"/><circle cx="40" cy="26" r="11" fill="currentColor" opacity=".7"/><circle cx="32" cy="40" r="11" fill="currentColor"/>`);
    case 'dice': return svg(`<rect x="10" y="10" width="44" height="44" rx="10" fill="currentColor" opacity=".25"/><circle cx="22" cy="22" r="4" fill="currentColor"/><circle cx="42" cy="42" r="4" fill="currentColor"/><circle cx="32" cy="32" r="4" fill="currentColor"/><circle cx="42" cy="22" r="4" fill="currentColor"/><circle cx="22" cy="42" r="4" fill="currentColor"/>`);
    default: return svg('');
  }
}
