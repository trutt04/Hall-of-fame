// The photo booth's screens and picture art (js/world/photobooth.js runs the booth). DOM and 2D
// canvas only, no three.js. Every word goes in with textContent; nothing here is ever uploaded.
//
//   createBoothUi(parent) -> { viewfinder(rect | null, color), count(n | null, line), flash(calm), hide(), dispose() }
//                                the countdown layer over the island (never eats touches)
//   buildPicker({ frames, poses, frame, pose, onFrame(id), onPose(id) }) -> element   for hud.openCard
//   buildPolaroid(url, { calm, alt }) -> { el, note(text), clear() }                  the result
//   paintBack(ctx, layout, frame)            the frame's colours and pattern (before the scene)
//   paintScene(ctx, layout, source, sw, sh)  the rendered scene into the window, rounded
//   paintFront(ctx, layout, frame, { date }) outline, sparkles, the "Cloud Nine" title, the date, the frame's word
//   shareableFile(blob, name) -> File | null  a File the share sheet takes (navigator.canShare says so), else null
//   savePhoto(blob, name, { share }) -> Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'>
//       share: the share sheet (phones: "Save Image" puts it in Photos), else an <a download> PNG

import { FONT_STACK } from '../config.js';
import { el, onTap } from './dom.js';

// ---------------------------------------------------------------------------------- the overlay

export function createBoothUi(parent) {
  const root = el('div', 'c9-booth');
  root.setAttribute('aria-hidden', 'true');
  const finder = el('div', 'c9-booth-finder');
  for (const c of ['tl', 'tr', 'bl', 'br']) finder.appendChild(el('span', 'c9-booth-corner c9-booth-' + c));
  const num = el('div', 'c9-booth-num');
  const line = el('div', 'c9-booth-line');
  finder.append(num, line);
  const flashEl = el('div', 'c9-booth-flash');
  root.append(finder, flashEl);
  finder.hidden = true;
  (parent || document.body).appendChild(root);
  let flashTimer = 0;

  return {
    viewfinder(rect, color) {
      if (!rect) {
        finder.hidden = true;
        return;
      }
      finder.hidden = false;
      finder.style.left = Math.round(rect.x) + 'px';
      finder.style.top = Math.round(rect.y) + 'px';
      finder.style.width = Math.round(rect.w) + 'px';
      finder.style.height = Math.round(rect.h) + 'px';
      if (color) finder.style.setProperty('--booth-accent', color);
    },
    count(n, text) {
      if (n === null || n === undefined) {
        num.textContent = '';
        line.textContent = '';
        return;
      }
      num.textContent = String(n);
      num.classList.remove('c9-booth-pop');
      void num.offsetWidth;
      num.classList.add('c9-booth-pop');
      if (text) line.textContent = text;
    },
    // a soft white flash; with reduced motion a slow, gentle fade instead (never a hard flash)
    flash(calm) {
      clearTimeout(flashTimer);
      flashEl.classList.remove('c9-booth-flash-on', 'c9-booth-fade-on');
      void flashEl.offsetWidth;
      flashEl.classList.add(calm ? 'c9-booth-fade-on' : 'c9-booth-flash-on');
      flashTimer = setTimeout(() => flashEl.classList.remove('c9-booth-flash-on', 'c9-booth-fade-on'), calm ? 1300 : 700);
    },
    hide() {
      finder.hidden = true;
      num.textContent = '';
      line.textContent = '';
    },
    dispose() {
      clearTimeout(flashTimer);
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------------- the picker

export function buildPicker({ frames, poses, frame, pose, onFrame, onPose }) {
  const box = el('div', 'c9-booth-picker');
  box.appendChild(el('p', 'c9-booth-label', 'Frame'));
  const frameRow = el('div', 'c9-booth-frames');
  const frameBtns = [];
  for (const f of frames) {
    const b = el('button', 'c9-booth-frame');
    b.type = 'button';
    b.setAttribute('aria-pressed', f.id === frame ? 'true' : 'false');
    const sw = el('span', 'c9-booth-swatch');
    sw.style.background = f.swatch;
    b.append(sw, el('span', 'c9-booth-frame-name', f.label));
    onTap(b, () => {
      for (const o of frameBtns) o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      onFrame(f.id);
    });
    frameBtns.push(b);
    frameRow.appendChild(b);
  }
  box.appendChild(frameRow);
  box.appendChild(el('p', 'c9-booth-label', 'Pose'));
  const poseRow = el('div', 'c9-booth-poses');
  const poseBtns = [];
  for (const p of poses) {
    const b = el('button', 'c9-booth-pose', p.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', p.id === pose ? 'true' : 'false');
    onTap(b, () => {
      for (const o of poseBtns) o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      onPose(p.id);
    });
    poseBtns.push(b);
    poseRow.appendChild(b);
  }
  box.appendChild(poseRow);
  return box;
}

// ---------------------------------------------------------------------------------- the result

export function buildPolaroid(url, { calm = false, alt = '' } = {}) {
  const wrap = el('div', 'c9-booth-polaroid' + (calm ? '' : ' c9-booth-develop'));
  const img = el('img', 'c9-booth-img');
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  if (url) img.src = url;
  wrap.appendChild(img);
  const noteEl = el('p', 'c9-booth-note', 'Only on this device until you save it.');
  const box = el('div', 'c9-booth-result-box');
  box.append(wrap, noteEl);
  return {
    el: box,
    note(text) {
      noteEl.textContent = text;
    },
    // let the decoded picture go (its object URL is revoked by the booth)
    clear() {
      img.removeAttribute('src');
    },
  };
}

// ---------------------------------------------------------------------------------- picture art

const C = {
  pink: '#ff2e93', pinkSoft: '#ff8cc6', pinkPale: '#ffd6ea', black: '#17121c', ink: '#2b2233', white: '#fff8fc',
  gemPink: '#ff7ad1', gemPurple: '#a96bff', silver: '#eae8f2', lilac: '#cdb4ff', baby: '#9fd8ff', mint: '#9be7c4',
  lemon: '#ffe68a', gold: '#ffd36e', purple: '#7b5cff', coral: '#ff8a8a',
};

// per frame: the sparkles' three tones, the window's outline, the words' fill and outline
const STYLE = {
  cloudNine: { tones: [C.white, C.gemPurple, C.silver], edge: C.white, ink: C.white, inkLine: C.black, date: C.white, plate: 'rgba(194,21,111,.55)' },
  flyer: { tones: [C.pink, C.silver, C.gemPink], edge: C.pink, ink: C.pink, inkLine: C.white, date: C.silver, plate: 'rgba(23,18,28,.92)' },
  squad: { tones: [C.pink, C.purple, C.white], edge: C.white, ink: C.purple, inkLine: C.white, date: C.ink, plate: 'rgba(255,248,252,.88)' },
  birthday: { tones: [C.pink, C.purple, C.white], edge: C.white, ink: C.pink, inkLine: C.white, date: C.ink, plate: 'rgba(255,248,252,.85)' },
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function star5(ctx, x, y, r, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// a rhinestone starburst: four long points and four short ones
function gem(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const rr = i % 4 === 0 ? r : i % 2 === 0 ? r * 0.42 : r * 0.16;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function heart(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.3, y, x - r * 0.75, y - r * 1.05, x, y - r * 0.35);
  ctx.bezierCurveTo(x + r * 0.75, y - r * 1.05, x + r * 1.3, y, x, y + r * 0.9);
  ctx.closePath();
}

export function paintBack(ctx, L, frame) {
  const { w, h } = L;
  const id = frame && frame.id;
  ctx.save();
  if (id === 'flyer') {
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, w, h);
    // her bow's little stars, all over
    let k = 0;
    for (let y = 22; y < h; y += 64) {
      for (let x = (k % 2) * 32 + 18; x < w; x += 64) {
        star5(ctx, x, y, 9);
        ctx.fillStyle = (x + y) % 3 ? 'rgba(255,46,147,.75)' : 'rgba(234,232,242,.55)';
        ctx.fill();
      }
      k++;
    }
  } else if (id === 'squad') {
    const cols = [C.lilac, C.baby, C.mint, C.pinkPale, C.lemon];
    const band = 70;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 4);
    const span = Math.hypot(w, h);
    for (let i = -Math.ceil(span / band); i < Math.ceil(span / band); i++) {
      ctx.fillStyle = cols[((i % cols.length) + cols.length) % cols.length];
      ctx.fillRect(i * band, -span, band, span * 2);
    }
  } else if (id === 'birthday') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, C.gold);
    g.addColorStop(0.55, C.pinkSoft);
    g.addColorStop(1, C.gemPink);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // confetti
    const cols = [C.pink, C.purple, C.white, C.baby, C.mint];
    for (let i = 0; i < 140; i++) {
      const x = (i * 197.3) % w;
      const y = (i * 311.7 + (i % 7) * 23) % h;
      ctx.fillStyle = cols[i % cols.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(i * 0.9);
      ctx.fillRect(-7, -3, 14, 6);
      ctx.restore();
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, C.pink);
    g.addColorStop(0.55, C.pinkSoft);
    g.addColorStop(1, C.gemPink);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // tiny white rhinestones scattered on the pink
    for (let i = 0; i < 120; i++) {
      const x = (i * 173.9) % w;
      const y = (i * 263.3 + (i % 5) * 31) % h;
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.55)' : 'rgba(169,107,255,.5)';
      ctx.beginPath();
      ctx.arc(x, y, 2.5 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function paintScene(ctx, L, source, sw, sh) {
  const { win } = L;
  ctx.save();
  roundRect(ctx, win.x, win.y, win.w, win.h, win.r);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sw, sh, win.x, win.y, win.w, win.h);
  ctx.restore();
}

function words(ctx, text, x, y, size, fill, line, weight = 900) {
  ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (line) {
    ctx.lineWidth = Math.max(4, size * 0.16);
    ctx.strokeStyle = line;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function paintFront(ctx, L, frame, { date = '' } = {}) {
  const st = STYLE[frame && frame.id] || STYLE.cloudNine;
  const { win } = L;
  ctx.save();
  // the window's outline
  roundRect(ctx, win.x, win.y, win.w, win.h, win.r);
  ctx.lineWidth = 10;
  ctx.strokeStyle = st.edge;
  ctx.stroke();
  roundRect(ctx, win.x - 5, win.y - 5, win.w + 10, win.h + 10, win.r + 5);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(23,18,28,.55)';
  ctx.stroke();
  // sparkles
  for (const s of L.sparkles) {
    const col = st.tones[s.tone % st.tones.length];
    if (s.kind === 'star') star5(ctx, s.x, s.y, s.r);
    else if (s.kind === 'heart') heart(ctx, s.x, s.y, s.r);
    else if (s.kind === 'confetti') star5(ctx, s.x, s.y, s.r, 0.6);
    else gem(ctx, s.x, s.y, s.r);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(23,18,28,.6)';
    ctx.stroke();
  }
  // the title and the date (never a name)
  words(ctx, 'Cloud Nine', L.title.x, L.title.y, L.title.size, st.ink, st.inkLine);
  // two little stars beside the title
  const tw = ctx.measureText('Cloud Nine').width;
  for (const side of [-1, 1]) {
    gem(ctx, L.title.x + side * (tw / 2 + L.title.size * 0.55), L.title.y, L.title.size * 0.32);
    ctx.fillStyle = st.tones[0];
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(23,18,28,.6)';
    ctx.stroke();
  }
  if (date) {
    // a little plate behind the date, so it reads on any pattern
    ctx.font = '800 ' + L.date.size + 'px ' + FONT_STACK;
    const dw = ctx.measureText(date).width + L.date.size * 1.2;
    const dh = L.date.size * 1.45;
    roundRect(ctx, L.date.x - dw / 2, L.date.y - dh / 2, dw, dh, dh / 2);
    ctx.fillStyle = st.plate;
    ctx.fill();
    words(ctx, date, L.date.x, L.date.y + 1, L.date.size, st.date, null, 800);
  }
  // the frame's word, on a sticker over the window's corner
  if (L.tag && frame && frame.tag) {
    ctx.save();
    ctx.translate(L.tag.x, L.tag.y);
    ctx.rotate(L.tag.angle);
    ctx.font = '900 ' + L.tag.size + 'px ' + FONT_STACK;
    const w = ctx.measureText(frame.tag).width + L.tag.size * 1.2;
    const h = L.tag.size * 1.5;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fillStyle = frame.id === 'flyer' ? C.pink : frame.id === 'birthday' ? C.pink : C.purple;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.black;
    ctx.stroke();
    words(ctx, frame.tag, 0, 2, L.tag.size, C.white, null);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------- saving

export function shareableFile(blob, name) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return null;
    const file = new File([blob], name, { type: 'image/png' });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch (err) {
    return null;
  }
}

export async function savePhoto(blob, name, { share = false } = {}) {
  if (!blob) return 'failed';
  if (share) {
    const file = shareableFile(blob, name);
    if (file) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
        // the share sheet said no (or isn't allowed here): a plain download instead
      }
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  } catch (err) {
    return 'failed';
  }
}
