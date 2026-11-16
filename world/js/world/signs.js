// Canvas text for the world: name tags, yard signs, plaques and building signs.
// Team names are untrusted and may hold emoji or symbols, so every font stack ends in the
// platform emoji fonts and every string is fitted (shrunk, then ellipsized) to its box.

export const FONT_BODY = '"Barlow Semi Condensed", "Arial Narrow", Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
export const FONT_DISPLAY = 'Bungee, "Arial Black", Impact, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function hex(c) {
  return '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

export function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

// Sets ctx.font so `text` fits in maxWidth, shrinking from `size` down to `min`, then cutting the
// text with an ellipsis. Returns the string to draw.
export function fit(ctx, text, maxWidth, size, min, family = FONT_BODY, weight = '700') {
  let s = size;
  const str = String(text == null ? '' : text);
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(str).width > maxWidth) {
    s -= Math.max(1, Math.round(s * 0.06));
    ctx.font = `${weight} ${s}px ${family}`;
  }
  if (ctx.measureText(str).width <= maxWidth) return str;
  const chars = Array.from(str);
  while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
  return chars.join('').trimEnd() + '…';
}

// Splits text into at most `lines` lines that fit maxWidth at the current font.
export function wrap(ctx, text, maxWidth, lines = 2) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const rest = out.slice(lines - 1).join(' ');
    out.length = lines - 1;
    out.push(rest);
  }
  return out;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'TH';
  return n + (['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
}

// Name tag above a home: a rank chip in the team color and the team name. 512 x 128.
export function drawNameTag(cv, rank, name, color) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(10,16,34,0.9)';
  roundRect(g, 4, 14, W - 8, H - 28, 26);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(245,197,66,0.75)';
  g.stroke();
  // rank chip
  g.fillStyle = hex(color);
  roundRect(g, 14, 24, 112, H - 48, 18);
  g.fill();
  g.strokeStyle = 'rgba(10,16,34,0.9)';
  g.lineWidth = 4;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.strokeStyle = 'rgba(10,16,34,0.85)';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.font = `52px ${FONT_DISPLAY}`;
  g.strokeText(String(rank), 70, H / 2 + 3);
  g.fillText(String(rank), 70, H / 2 + 3);
  // name
  g.textAlign = 'left';
  g.fillStyle = '#f3eedd';
  const text = fit(g, name, W - 160, 54, 30, FONT_BODY, '700');
  g.fillText(text, 140, H / 2 + 2);
  return cv;
}

// Yard sign: short roast copy, black on white, up to two lines. 384 x 256.
export function drawYardSign(cv, text) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  g.fillStyle = '#fbf8ee';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d7263d';
  g.lineWidth = 12;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#18213f';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 76;
  let lines = [];
  for (; size >= 34; size -= 6) {
    g.font = `${size}px ${FONT_DISPLAY}`;
    lines = wrap(g, String(text || '').toUpperCase(), W - 56, 3);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width), 0);
    if (lines.length * size * 1.05 <= H - 50 && widest <= W - 56) break;
  }
  const lh = size * 1.06;
  lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh + 3, W - 48));
  return cv;
}

// Brass plaque: a small heading, one big line, one line under it. 512 x 300.
export function drawPlaque(cv, head, big, sub, sample) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#3a2f16');
  grad.addColorStop(1, '#241c0c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#f5c542';
  g.lineWidth = 6;
  g.strokeRect(12, 12, W - 24, H - 24);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f5c542';
  g.font = `40px ${FONT_DISPLAY}`;
  g.fillText(head, W / 2, 62, W - 60);
  g.fillStyle = '#fff3cf';
  const name = fit(g, big, W - 64, 62, 30, FONT_BODY, '700');
  g.fillText(name, W / 2, 144);
  g.fillStyle = '#f5c542';
  g.font = `34px ${FONT_DISPLAY}`;
  g.fillText(sub, W / 2, 228, W - 60);
  if (sample) {
    g.font = `700 22px ${FONT_BODY}`;
    g.fillStyle = 'rgba(255,243,207,0.75)';
    g.fillText('SAMPLE HISTORY', W / 2, H - 30);
  }
  return cv;
}

// A lettered sign board: light text on a dark panel, sized to the sign's aspect ratio.
export function drawSign(text, aspect, o = {}) {
  const H = o.height || 128;
  const W = Math.min(1024, Math.max(64, Math.round(H * aspect)));
  const cv = makeCanvas(W, H);
  const g = cv.getContext('2d');
  g.fillStyle = o.bg || '#18213f';
  g.fillRect(0, 0, W, H);
  if (o.border !== false) {
    g.strokeStyle = o.borderColor || '#f5c542';
    g.lineWidth = Math.max(3, H * 0.06);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = o.color || '#f5c542';
  const lines = Array.isArray(text) ? text : [text];
  const pad = H * 0.16;
  const lh = (H - pad * 2) / lines.length;
  lines.forEach((line, i) => {
    const family = o.display === false || i > 0 && o.subBody ? FONT_BODY : FONT_DISPLAY;
    const str = fit(g, line, W - pad * 2, lh * 0.92, lh * 0.4, family, family === FONT_BODY ? '700' : '400');
    g.fillText(str, W / 2, pad + lh * (i + 0.5) + lh * 0.04);
  });
  return cv;
}
