// The photo wall's scrapbook (js/world/photowall.js opens it): full screen, on pink scrapbook paper,
// one photo at a time, large and uncropped (the 1600 px copy), in a polaroid with its caption. Swipe,
// the arrow keys, or a tap at either edge (where the big arrows sit) move through them. "Play
// slideshow" crossfades from one to the next with a gentle drift (Ken Burns), sparkles and a soft
// chime; the family's notes come in between the photos as handwritten cards ("From Grandma"), and on
// her birthday it ends on a birthday card. With reduced motion: no drift and no sparkles, only a fade.
// Words go in with textContent; every photo comes from this device's own store.
//
//   import { openPhotoViewer } from './ui/photo-viewer.js'
//   const v = openPhotoViewer({ store, title, start, slideshow, notes(), birthday(), calm, sfx, onManage(), onClose() })
//   v.next() / v.prev() / v.go(i)     v.play() / v.stop()     v.close() (photowall.js; onClose is its own X / Escape)
//   v.index, v.slide, v.slides, v.playing, v.el (tests)
//
// Pure (node tests): VIEWER_TEXT, buildSlides(photos, { notes, birthday, slideshow }), slideTime(slide, calm)

import { el, icon, onTap, button } from './dom.js';
import { blobOf } from '../core/photos.js';
import { HANDWRITING } from '../art/photowall-art.js';

export const VIEWER_TEXT = Object.freeze({
  close: 'Close',
  prev: 'Previous photo',
  next: 'Next photo',
  play: 'Play slideshow',
  pause: 'Pause',
  again: 'Play again',
  manage: 'Add or change photos',
  count: (i, n) => i + ' of ' + n,
  noCaption: 'A photo from your wall',
  from: (name) => (name ? 'From ' + name : 'With love'),
  birthday: (name) => (name ? 'Happy Birthday, ' + name + '!' : 'Happy Birthday!'),
  birthdayLine: 'Love, all your favorite people',
});

// The slides: the photos in wall order (the star first); for the slideshow, a family note after every
// second photo while there are notes, the rest of the notes after the last photo, and on her birthday a
// birthday card to end on.
export function buildSlides(photos, { notes = [], birthday = null, slideshow = false } = {}) {
  const list = (Array.isArray(photos) ? photos : []).map((p) => ({ kind: 'photo', id: p.id, caption: p.caption || '', w: p.w, h: p.h }));
  if (!slideshow) return list;
  const cards = (Array.isArray(notes) ? notes : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({ kind: 'note', text: n.text.trim(), from: typeof n.from === 'string' ? n.from.trim() : '' }));
  const out = [];
  list.forEach((p, i) => {
    out.push(p);
    if (i % 2 === 1 && cards.length) out.push(cards.shift());
  });
  out.push(...cards);
  if (birthday && birthday.isBirthday) out.push({ kind: 'birthday', name: typeof birthday.name === 'string' ? birthday.name : '' });
  return out;
}

// How long a slide stays in the slideshow (seconds): a note long enough to read.
export function slideTime(slide, calm = false) {
  if (!slide) return 5;
  if (slide.kind === 'note') return Math.min(11, Math.max(5.5, 3.5 + slide.text.length * 0.045));
  if (slide.kind === 'birthday') return 8;
  return calm ? 6 : 5;
}

export function openPhotoViewer(o = {}) {
  const { store } = o;
  const T = VIEWER_TEXT;
  const calm = !!o.calm;
  const sfx = typeof o.sfx === 'function' ? o.sfx : () => {};
  const photos = () => store.list();
  let slides = buildSlides(photos());
  let index = Math.max(0, Math.min(slides.length - 1, Number(o.start) || 0));
  let playing = false;
  let ended = false;
  let timer = 0;
  let closed = false;
  let current = null; // the slide element on screen
  const urls = new Map(); // photo id -> object URL of its full copy

  // ---------------------------------------------------------------- the frame
  const root = el('div', 'c9pv');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', o.title || 'Photo wall');
  root.tabIndex = -1;
  const stage = el('div', 'c9pv-stage');
  const sparkles = el('div', 'c9pv-sparkles');
  sparkles.setAttribute('aria-hidden', 'true');
  const top = el('header', 'c9pv-top');
  const counter = el('p', 'c9pv-count', '');
  counter.setAttribute('aria-live', 'polite');
  const titleEl = el('p', 'c9pv-title', o.title || '');
  const x = button('c9pv-x', null, () => finish(), { icon: 'close', label: T.close });
  top.append(titleEl, counter, x);
  const prev = button('c9pv-edge c9pv-prev', null, () => step(-1, true), { icon: 'back', label: T.prev });
  const next = button('c9pv-edge c9pv-next', null, () => step(1, true), { icon: 'back', label: T.next });
  const bar = el('footer', 'c9pv-bar');
  const playBtn = button('c9-btn c9-btn-primary c9pv-play', T.play, () => (playing ? stop() : play()), { icon: 'play' });
  // its icon follows its word: a triangle to play, two bars to pause
  const playPath = playBtn.querySelector('svg path');
  const PLAY_D = playPath ? playPath.getAttribute('d') : '';
  const PAUSE_D = 'M9 6v12M15 6v12';
  const manage = button('c9-btn c9pv-manage', T.manage, () => {
    stop();
    if (typeof o.onManage === 'function') o.onManage();
  }, { icon: 'plus' });
  bar.append(playBtn, manage);
  root.append(stage, sparkles, top, prev, next, bar);
  document.body.appendChild(root);

  // ---------------------------------------------------------------- swipes
  let down = null;
  stage.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  stage.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1, true);
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      // a tap near either side of the page turns it that way
      const W = window.innerWidth || 390;
      if (e.clientX < W * 0.26) step(-1, true);
      else if (e.clientX > W * 0.74) step(1, true);
    }
  });
  stage.addEventListener('pointercancel', () => {
    down = null;
  });

  // ---------------------------------------------------------------- slides
  async function urlFor(id) {
    if (urls.has(id)) return urls.get(id);
    const bytes = await store.bytes(id, 'full');
    if (closed || !bytes) return null;
    if (urls.has(id)) return urls.get(id);
    const u = URL.createObjectURL(blobOf(bytes));
    urls.set(id, u);
    return u;
  }
  // keep the photos on either side ready, give the rest back
  function tidy() {
    const keep = new Set();
    for (const d of [-1, 0, 1]) {
      const s = slides[(index + d + slides.length) % Math.max(1, slides.length)];
      if (s && s.kind === 'photo') keep.add(s.id);
    }
    for (const [id, u] of [...urls]) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(u);
        urls.delete(id);
      }
    }
    for (const id of keep) urlFor(id);
  }

  // the room the photo has: the screen less the bars and the arrows
  function room() {
    const W = window.innerWidth || 390;
    const H = window.innerHeight || 844;
    const wide = W > H;
    const side = W < 520 ? 18 : wide ? 96 : 76;
    return { w: Math.max(120, W - side * 2), h: Math.max(120, H - (wide ? 150 : 200)) };
  }
  function sizePhoto(card, img, s) {
    const r = room();
    const pad = Math.round(Math.min(r.w, r.h) * 0.035) + 8;
    const capH = Math.round(Math.max(48, Math.min(84, r.h * 0.09)));
    const aw = r.w - pad * 2;
    const ah = r.h - pad - capH;
    const k = Math.min(aw / Math.max(1, s.w), ah / Math.max(1, s.h));
    const w = Math.max(40, Math.floor(s.w * k));
    const h = Math.max(40, Math.floor(s.h * k));
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    card.style.padding = pad + 'px ' + pad + 'px 0';
    card.style.setProperty('--cap', capH + 'px');
  }
  // A long note (or the birthday card on a short screen) shrinks to fit the page, words, lines and
  // all, but never so far that its words go under 16 px.
  function fitCard(fig, card) {
    fig.style.transform = '';
    const roomH = stage.clientHeight - 12;
    const h = card.offsetHeight;
    const k = roomH > 0 && h > roomH ? Math.max(0.73, roomH / h) : 1;
    if (k < 1) fig.style.transform = 'scale(' + k.toFixed(3) + ')';
  }

  function makeSlide(s, i) {
    const fig = el('figure', 'c9pv-slide c9pv-' + s.kind);
    if (s.kind === 'photo') {
      const card = el('div', 'c9pv-card c9pv-polaroid');
      const img = el('img', 'c9pv-img');
      img.alt = s.caption || T.noCaption;
      img.decoding = 'async';
      const cap = el('figcaption', 'c9pv-cap', s.caption || '');
      cap.style.fontFamily = HANDWRITING;
      if (!s.caption) cap.classList.add('c9pv-cap-none');
      card.append(img, cap);
      const first = photos()[0];
      if (first && first.id === s.id) card.append(el('span', 'c9pv-star', '\u2605')); // the star photo
      fig.append(card);
      sizePhoto(card, img, s);
      urlFor(s.id).then((u) => {
        if (u && !closed) img.src = u;
      });
      fig._resize = () => sizePhoto(card, img, s);
    } else if (s.kind === 'note') {
      const card = el('div', 'c9pv-card c9pv-notecard');
      const text = el('p', 'c9pv-note-text', s.text);
      text.style.fontFamily = HANDWRITING;
      card.append(el('span', 'c9pv-note-tape'), text);
      if (s.from) {
        const from = el('p', 'c9pv-note-from', T.from(s.from));
        from.style.fontFamily = HANDWRITING;
        card.append(from);
      }
      card.append(el('span', 'c9pv-note-heart', '\u2665'));
      fig.append(card);
      fig._resize = () => fitCard(fig, card);
    } else {
      const card = el('div', 'c9pv-card c9pv-bdaycard');
      card.append(el('p', 'c9pv-bday-kicker', '\u2605 \u2605 \u2605'), el('h2', 'c9pv-bday-title', T.birthday(s.name)));
      const line = el('p', 'c9pv-bday-line', T.birthdayLine);
      line.style.fontFamily = HANDWRITING;
      card.append(line);
      for (let k = 0; k < 14; k++) {
        const c = el('i', 'c9pv-confetti c9pv-confetti' + (k % 4));
        c.style.left = ((k * 37) % 100) + '%';
        c.style.animationDelay = ((k * 0.23) % 2.4).toFixed(2) + 's';
        card.append(c);
      }
      fig.append(card);
      fig._resize = () => fitCard(fig, card);
    }
    if (playing && !calm) fig.classList.add(i % 2 ? 'c9pv-drift-b' : 'c9pv-drift-a');
    if (playing) fig.style.setProperty('--hold', slideTime(s, calm) + 1.4 + 's');
    return fig;
  }

  function show(i, how = 'fade') {
    if (closed || !slides.length) return;
    index = ((i % slides.length) + slides.length) % slides.length;
    const s = slides[index];
    const fig = makeSlide(s, index);
    fig.classList.add(how === 'slow' ? 'c9pv-in-slow' : 'c9pv-in');
    const old = current;
    current = fig;
    stage.append(fig);
    // a card is laid out now: fit it to the page. The arrows step aside for cards (and the
    // slideshow), so they never sit over a note's words; swipes and edge taps still work.
    if (s.kind !== 'photo') fig._resize();
    root.classList.toggle('c9pv-on-card', s.kind !== 'photo');
    if (old) {
      old.classList.add(how === 'slow' ? 'c9pv-out-slow' : 'c9pv-out');
      setTimeout(() => old.remove(), how === 'slow' ? 1400 : 450);
    }
    paintBar();
    tidy();
  }
  function paintBar() {
    const s = slides[index];
    const n = photos().length;
    const pi = s && s.kind === 'photo' ? slides.slice(0, index + 1).filter((x) => x.kind === 'photo').length : 0;
    counter.textContent = pi ? T.count(pi, n) : '';
    const many = slides.length > 1;
    prev.hidden = !many;
    next.hidden = !many;
    const label = playing ? T.pause : ended ? T.again : T.play;
    playBtn.querySelector('.c9-btn-label').textContent = label;
    if (playPath) playPath.setAttribute('d', playing ? PAUSE_D : PLAY_D);
    playBtn.classList.toggle('c9pv-pausing', playing);
    playBtn.hidden = !photos().length;
  }

  function step(d, byHand) {
    if (!slides.length) return;
    if (byHand && playing) stop();
    if (byHand && !playing && slides.length !== photos().length) {
      // looking by hand: the photos only, from the one on screen
      const s = slides[index];
      slides = buildSlides(photos());
      const at = s && s.kind === 'photo' ? slides.findIndex((x) => x.id === s.id) : 0;
      index = Math.max(0, at);
    }
    show(index + d, 'fade');
    sfx('tap', { volume: 0.35, pitch: d > 0 ? 1.1 : 0.95 });
  }

  // ---------------------------------------------------------------- the slideshow
  function play() {
    if (!photos().length) return;
    const s = slides[index];
    slides = buildSlides(photos(), { notes: safe(o.notes, []), birthday: safe(o.birthday, null), slideshow: true });
    let at = 0;
    if (!ended && s && s.kind === 'photo') at = Math.max(0, slides.findIndex((x) => x.kind === 'photo' && x.id === s.id));
    ended = false;
    playing = true;
    root.classList.add('c9pv-playing');
    show(at, 'slow');
    cheer(slides[at]);
    schedule();
  }
  function stop() {
    clearTimeout(timer);
    timer = 0;
    if (!playing) return;
    playing = false;
    root.classList.remove('c9pv-playing');
    if (current) current.classList.remove('c9pv-drift-a', 'c9pv-drift-b');
    paintBar();
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!playing || closed) return;
      if (index >= slides.length - 1) {
        // the end: stay on the last slide
        ended = true;
        stop();
        return;
      }
      show(index + 1, 'slow');
      cheer(slides[index]);
      schedule();
    }, slideTime(slides[index], calm) * 1000);
  }
  function cheer(s) {
    if (!s) return;
    if (s.kind === 'birthday') sfx('tada', { volume: 0.5 });
    else if (s.kind === 'note') sfx('chime', { volume: 0.35 });
    else sfx('sparkle', { volume: 0.28, pitch: 0.9 + Math.random() * 0.25 });
    if (calm) return;
    // a few rhinestone sparkles round the card
    const n = s.kind === 'birthday' ? 14 : 7;
    for (let k = 0; k < n; k++) {
      const sp = el('i', 'c9pv-spark');
      sp.style.left = (8 + Math.random() * 84).toFixed(1) + '%';
      sp.style.top = (12 + Math.random() * 70).toFixed(1) + '%';
      sp.style.animationDelay = (k * 0.09).toFixed(2) + 's';
      sp.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
      sparkles.append(sp);
      setTimeout(() => sp.remove(), 1900 + k * 90);
    }
  }

  // ---------------------------------------------------------------- keys, resize, the store
  const onKey = (e) => {
    const k = e.key;
    let used = true;
    if (k === 'Escape') finish();
    else if (k === 'ArrowRight') step(1, true);
    else if (k === 'ArrowLeft') step(-1, true);
    else if (k === ' ' || k === 'Spacebar') {
      if (playing) stop();
      else play();
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);
  const onResize = () => {
    if (current && typeof current._resize === 'function') current._resize();
  };
  window.addEventListener('resize', onResize);
  const onChange = () => {
    if (playing) return; // the slideshow keeps its list; the next play picks up the change
    const s = slides[index];
    slides = buildSlides(photos());
    if (!slides.length) {
      finish();
      return;
    }
    const at = s && s.kind === 'photo' ? slides.findIndex((p) => p.id === s.id) : -1;
    show(at >= 0 ? at : Math.min(index, slides.length - 1), 'fade');
  };
  store.on('change', onChange);

  function finish() {
    if (closed) return;
    if (typeof o.onClose === 'function') o.onClose();
    else close();
  }
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    store.off('change', onChange);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    root.remove();
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
  }

  if (slides.length) show(index, 'fade');
  requestAnimationFrame(() => {
    if (closed) return;
    root.classList.add('c9pv-open');
    try {
      root.focus({ preventScroll: true });
    } catch (err) { /* old browsers */ }
  });
  if (o.slideshow) play();
  else paintBar();

  return {
    el: root,
    close,
    next: () => step(1, true),
    prev: () => step(-1, true),
    go: (i) => show(i, 'fade'),
    play,
    stop,
    get index() { return index; },
    get slide() { return slides[index] || null; },
    get slides() { return slides.slice(); },
    get playing() { return playing; },
  };
}

function safe(fn, fallback) {
  try {
    const v = typeof fn === 'function' ? fn() : fallback;
    return v === undefined ? fallback : v;
  } catch (err) {
    return fallback;
  }
}
