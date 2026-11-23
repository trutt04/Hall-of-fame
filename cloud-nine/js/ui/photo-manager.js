// The photo wall's manager (js/world/photowall.js opens it): "Add photos" from the camera roll (with
// "Adding 2 of 5..." while they go up), a grid of the photos on the wall, and for the one picked: a
// caption with one-tap name chips, Earlier / Later, "Make it the star", and Remove (after a check: it
// stays in the camera roll). Says plainly that photos stay on this device. On an iPhone or iPad in
// Safari, a tip for grown-ups to add Cloud Nine to the Home Screen, so the photos are kept.
// A sheet at the bottom on a phone (the wall shows above it), on the right when the screen is wide.
// Every word goes in with textContent: captions are typed on this device and only ever shown here.
//
//   import { openPhotoManager } from './ui/photo-manager.js'
//   const m = openPhotoManager({ store, title, chips, persistent, homeTip, calm, sfx, addFiles,
//                                onLook(index), onSlideshow(), onClose() })
//       store      js/core/photos.js store       chips   [{ id, label }] name chips
//       homeTip    'iPhone' | 'iPad' | null      addFiles(files, onProgress) -> Promise<{ added, failed }>
//   m.close()      takes it off the screen (photowall.js calls it; onClose is for its own Done / X / Escape)
//   m.el           its root element (tests)
//
// Pure (node tests): MANAGER_TEXT, ADD_PROBLEMS, captionParts(caption), toggleName(caption, name, max) -> { caption, ok }

import { el, icon, onTap, button } from './dom.js';
import { joinNames, cleanCaption, PHOTO_LIMITS, blobOf } from '../core/photos.js';

// Friendly words for what can go wrong adding a photo (photowall.js addFiles' reasons).
export const ADD_PROBLEMS = Object.freeze({
  decode: "That photo didn't open here. Try a JPG or PNG.",
  empty: "That photo didn't open here. Try a JPG or PNG.",
  big: 'That photo is too big to add. Try a smaller one.',
  full: 'The wall holds 12 photos. Remove one to add another.',
  storage: 'This device is out of room for photos.',
});

export const MANAGER_TEXT = Object.freeze({
  kicker: 'Photo wall',
  privacy: "Photos stay on this device. They're never uploaded, and no one in a room can see them.",
  memory: "This browser won't keep photos after it closes. They stay here until then.",
  empty: 'Add photos of your favorite people! They go on the big heart.',
  add: 'Add photos',
  adding: (i, n) => 'Adding ' + i + ' of ' + n + '...',
  added: (n) => (n === 1 ? 'Added 1 photo!' : 'Added ' + n + ' photos!'),
  full: 'The wall is full! Remove a photo to add another.',
  caption: 'Who is in it?',
  captionHint: 'Tap names, or type your own',
  tooLong: "That's a lot of names! Try fewer.",
  earlier: 'Earlier',
  later: 'Later',
  star: 'Make it the star',
  isStar: 'Star photo',
  remove: 'Remove',
  removeAsk: 'Remove this photo from the wall?',
  removeWhy: 'It stays in your camera roll.',
  keep: 'Keep it',
  look: 'Look at the photos',
  slideshow: 'Play slideshow',
  done: 'Done',
  clear: 'Remove all photos from this device',
  clearAsk: 'Remove all the photos from this device?',
  clearWhy: 'They stay in your camera roll.',
  clearYes: 'Remove all',
  clearNo: 'Keep them',
  tip: (device) => 'Tip for grown-ups: Safari can clear a website\'s photos after about a week without a visit. Add Cloud Nine to the Home Screen (tap Share, then Add to Home Screen) and add the photos there, so this ' + (device || 'device') + ' keeps them.',
});

// A caption as the names in it: "Me, Zuzu & Pip" -> ['Me', 'Zuzu', 'Pip'].
export function captionParts(caption) {
  const s = typeof caption === 'string' ? caption.trim() : '';
  return s ? s.split(/\s*,\s*|\s+&\s+/).map((p) => p.trim()).filter(Boolean) : [];
}

// A name chip tapped: the name comes out of the caption if it is in it, else goes on the end.
// ok is false (and the caption unchanged) when it would be too long.
export function toggleName(caption, name, max = PHOTO_LIMITS.caption) {
  const parts = captionParts(caption);
  const i = parts.findIndex((p) => p.toLowerCase() === String(name).toLowerCase());
  if (i >= 0) parts.splice(i, 1);
  else parts.push(name);
  const next = joinNames(parts);
  if (Array.from(next).length > max) return { caption: typeof caption === 'string' ? caption : '', ok: false };
  return { caption: next, ok: true };
}

let opened = 0;

export function openPhotoManager(o = {}) {
  const { store } = o;
  const sfx = typeof o.sfx === 'function' ? o.sfx : () => {};
  const T = MANAGER_TEXT;
  const id = 'c9pw' + ++opened;
  const urls = new Map(); // photo id -> object URL of its small copy
  let selected = null; // photo id
  let busy = false;
  let confirm = null; // 'remove' | 'clear' | null
  let closed = false;
  let sayTimer = 0;
  let saveTimer = 0;
  let pending = null; // { pid, text }: a caption still being typed
  let capFor = null; // the photo the caption box shows

  // ---------------------------------------------------------------- the frame
  const root = el('div', 'c9pw');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', id + '-title');
  const sheet = el('div', 'c9pw-sheet');
  sheet.tabIndex = -1;
  const head = el('header', 'c9pw-head');
  const heads = el('div', 'c9pw-heads');
  heads.append(el('p', 'c9pw-kicker', T.kicker));
  const titleEl = el('h2', 'c9pw-title', o.title || 'Favorite People');
  titleEl.id = id + '-title';
  heads.append(titleEl);
  const x = button('c9pw-x', null, () => finish(), { icon: 'close', label: T.done });
  head.append(heads, x);
  const body = el('div', 'c9pw-body');
  sheet.append(head, body);
  root.append(sheet);

  // ---------------------------------------------------------------- privacy, memory, Home Screen
  const privacy = el('p', 'c9pw-privacy');
  privacy.append(lockIcon(), el('span', null, T.privacy));
  body.append(privacy);
  if (!o.persistent) body.append(el('p', 'c9pw-note', T.memory));
  if (o.homeTip) body.append(el('p', 'c9pw-tip', T.tip(o.homeTip)));

  // ---------------------------------------------------------------- add photos
  const addRow = el('div', 'c9pw-addrow');
  const file = el('input', 'c9pw-file');
  file.type = 'file';
  file.accept = 'image/*';
  file.multiple = true;
  file.id = id + '-file';
  file.tabIndex = -1;
  // a <label> opens the camera roll by itself on every phone (no script has to "click" the input)
  const add = el('label', 'c9pw-add c9-btn c9-btn-primary');
  add.htmlFor = file.id;
  add.tabIndex = 0;
  add.setAttribute('role', 'button');
  add.append(icon('plus'), el('span', 'c9-btn-label', T.add));
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!busy && !file.disabled) file.click();
    }
  });
  const countEl = el('span', 'c9pw-count', '');
  const status = el('p', 'c9pw-status', '');
  status.setAttribute('aria-live', 'polite');
  addRow.append(add, countEl, file);
  body.append(addRow, status);
  file.addEventListener('change', async () => {
    const files = file.files ? Array.from(file.files) : [];
    if (!files.length || busy) return;
    busy = true;
    file.disabled = true;
    add.classList.add('c9pw-busy');
    add.setAttribute('aria-disabled', 'true');
    const before = new Set(store.list().map((p) => p.id));
    let res = { added: 0, failed: [] };
    try {
      res = await o.addFiles(files, ({ i, n }) => say(T.adding(i, n), 'busy', 0));
    } catch (err) {
      res = { added: 0, failed: ['decode'] };
    }
    busy = false;
    file.disabled = false;
    file.value = ''; // the same photo can be picked again
    add.classList.remove('c9pw-busy');
    add.removeAttribute('aria-disabled');
    if (closed) return;
    const fresh = store.list().find((p) => !before.has(p.id));
    if (fresh) select(fresh.id);
    const problem = res.failed.length ? ADD_PROBLEMS[res.failed[res.failed.length - 1]] || ADD_PROBLEMS.decode : '';
    if (res.added && problem) say(T.added(res.added) + ' ' + problem, 'oops');
    else if (res.added) {
      say(T.added(res.added), 'yay');
      sfx('chime', { volume: 0.5 });
    } else if (problem) {
      say(problem, 'oops');
      sfx('aww', { volume: 0.35 });
    } else say('', '');
    render();
  });

  // ---------------------------------------------------------------- the grid
  const grid = el('ul', 'c9pw-grid');
  grid.setAttribute('aria-label', 'Photos on the wall');
  const emptyLine = el('p', 'c9pw-empty', T.empty);
  body.append(grid, emptyLine);

  // ---------------------------------------------------------------- the picked photo
  const edit = el('section', 'c9pw-edit');
  edit.setAttribute('aria-label', 'The photo you picked');
  const editTop = el('div', 'c9pw-edit-top');
  const editPic = el('div', 'c9pw-edit-pic');
  const editImg = el('img', 'c9pw-edit-img');
  editImg.alt = '';
  editPic.append(editImg);
  const capBox = el('div', 'c9pw-capbox');
  const capLabel = el('label', 'c9pw-cap-label', T.caption);
  const cap = el('input', 'c9pw-cap');
  cap.type = 'text';
  cap.id = id + '-cap';
  cap.maxLength = PHOTO_LIMITS.caption;
  cap.autocomplete = 'off';
  cap.spellcheck = false;
  cap.placeholder = T.captionHint;
  cap.setAttribute('enterkeyhint', 'done');
  capLabel.htmlFor = cap.id;
  capBox.append(capLabel, cap);
  editTop.append(editPic, capBox);
  const chips = el('div', 'c9pw-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Names');
  const chipEls = [];
  for (const c of Array.isArray(o.chips) ? o.chips : []) {
    const b = el('button', 'c9pw-chip', c.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    onTap(b, () => tapChip(c.label));
    chipEls.push({ el: b, label: c.label });
    chips.append(b);
  }
  const tools = el('div', 'c9pw-tools');
  const earlier = button('c9pw-tool', T.earlier, () => move(-1), { icon: 'back' });
  const later = button('c9pw-tool c9pw-tool-later', T.later, () => move(1), { icon: 'back' });
  const star = button('c9pw-tool c9pw-tool-star', T.star, () => makeStar(), { icon: 'star' });
  const remove = button('c9pw-tool c9pw-tool-remove', T.remove, () => ask('remove'), { icon: 'close' });
  tools.append(earlier, later, star, remove);
  const confirmBox = el('div', 'c9pw-confirm');
  confirmBox.setAttribute('role', 'alertdialog');
  edit.append(editTop, chips, tools, confirmBox);
  body.append(edit);

  // ---------------------------------------------------------------- look, slideshow, done, remove all
  const actions = el('div', 'c9pw-actions');
  const look = button('c9-btn c9pw-look', T.look, () => {
    const list = store.list();
    const i = Math.max(0, list.findIndex((p) => p.id === selected));
    o.onLook(i);
  }, { icon: 'eyes' });
  const show = button('c9-btn c9pw-show', T.slideshow, () => o.onSlideshow(), { icon: 'play' });
  const done = button('c9-btn c9pw-done', T.done, () => finish(), { icon: 'check' });
  actions.append(look, show, done);
  const clear = button('c9pw-clear', T.clear, () => ask('clear'));
  const clearBox = el('div', 'c9pw-confirm c9pw-confirm-all');
  clearBox.setAttribute('role', 'alertdialog');
  body.append(actions, clear, clearBox);

  document.body.appendChild(root);
  requestAnimationFrame(() => {
    if (closed) return;
    root.classList.add('c9pw-in');
    try {
      sheet.focus({ preventScroll: true });
    } catch (err) { /* old browsers */ }
  });

  // ---------------------------------------------------------------- behaviour
  function say(text, kind, ms = 4200) {
    clearTimeout(sayTimer);
    status.textContent = text || '';
    status.className = 'c9pw-status' + (kind ? ' c9pw-' + kind : '');
    if (text && ms) sayTimer = setTimeout(() => say('', ''), ms);
  }

  async function urlFor(p) {
    if (urls.has(p.id)) return urls.get(p.id);
    const bytes = await store.bytes(p.id, 'small');
    if (closed || !bytes) return null;
    if (urls.has(p.id)) return urls.get(p.id);
    const u = URL.createObjectURL(blobOf(bytes));
    urls.set(p.id, u);
    return u;
  }

  function select(pid) {
    flushSave();
    selected = pid;
    confirm = null;
    render();
  }

  function render() {
    if (closed) return;
    const list = store.list();
    // forget thumbnails of photos that are gone
    for (const [pid, u] of [...urls]) {
      if (!list.some((p) => p.id === pid)) {
        URL.revokeObjectURL(u);
        urls.delete(pid);
      }
    }
    if (selected && !list.some((p) => p.id === selected)) selected = list.length ? list[0].id : null;
    if (!selected && list.length) selected = list[0].id;
    const full = list.length >= PHOTO_LIMITS.max;
    countEl.textContent = list.length + ' of ' + PHOTO_LIMITS.max;
    add.classList.toggle('c9pw-off', full);
    file.disabled = full || busy;
    if (full && !busy && !status.textContent) say(T.full, 'oops', 0);
    if (!full && status.textContent === T.full) say('', '');
    // the grid: one tile per photo, the star first, and a "+" tile while there is room
    grid.replaceChildren();
    list.forEach((p, i) => {
      const li = el('li', 'c9pw-cell');
      const b = el('button', 'c9pw-tile' + (p.id === selected ? ' c9pw-picked' : '') + (i === 0 ? ' c9pw-tile-star' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', p.id === selected ? 'true' : 'false');
      b.setAttribute('aria-label', (i === 0 ? 'Star photo' : 'Photo ' + (i + 1)) + (p.caption ? ': ' + p.caption : ''));
      const img = el('img', 'c9pw-thumb');
      img.alt = '';
      img.decoding = 'async';
      urlFor(p).then((u) => {
        if (u && !closed) img.src = u;
      });
      b.append(img, el('span', 'c9pw-tile-cap', p.caption || ' '));
      if (i === 0) b.append(el('span', 'c9pw-badge', '\u2605'));
      onTap(b, () => {
        select(p.id);
        sfx('tap', { volume: 0.4 });
      });
      li.append(b);
      grid.append(li);
    });
    if (!full) {
      const li = el('li', 'c9pw-cell');
      const plus = el('label', 'c9pw-tile c9pw-tile-add');
      plus.htmlFor = file.id;
      plus.setAttribute('aria-label', T.add);
      plus.append(icon('plus'));
      li.append(plus);
      grid.append(li);
    }
    emptyLine.hidden = list.length > 0;
    look.hidden = !list.length;
    show.hidden = !list.length;
    clear.hidden = !list.length;
    // the picked photo
    const i = list.findIndex((p) => p.id === selected);
    edit.hidden = i < 0;
    if (i >= 0) {
      const p = list[i];
      urlFor(p).then((u) => {
        if (u && !closed && selected === p.id) editImg.src = u;
      });
      // the box is the one place captions change, so it only takes the store's caption when it
      // starts showing another photo (a save still on its way must not undo a chip just tapped)
      if (capFor !== p.id) {
        cap.value = p.caption;
        capFor = p.id;
      }
      paintChips(cap.value);
      earlier.disabled = i === 0;
      later.disabled = i === list.length - 1;
      star.disabled = i === 0;
      star.querySelector('.c9-btn-label').textContent = i === 0 ? T.isStar : T.star;
      star.classList.toggle('c9pw-is-star', i === 0);
    }
    paintConfirm();
  }

  function paintChips(caption) {
    const parts = captionParts(caption).map((s) => s.toLowerCase());
    for (const c of chipEls) c.el.setAttribute('aria-pressed', parts.includes(c.label.toLowerCase()) ? 'true' : 'false');
  }

  // captions save as she types (a moment after the last key), at once for a chip, and before anything
  // else is picked
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const p = pending;
    pending = null;
    if (p && p.pid) store.setCaption(p.pid, p.text);
  }
  function saveCaption(text, now) {
    if (pending && pending.pid !== capFor) flushSave();
    pending = { pid: capFor, text };
    clearTimeout(saveTimer);
    if (now) flushSave();
    else saveTimer = setTimeout(flushSave, 450);
  }

  function tapChip(label) {
    if (!selected) return;
    const r = toggleName(cap.value, label);
    if (!r.ok) {
      say(T.tooLong, 'oops');
      sfx('tap', { volume: 0.3, pitch: 0.7 });
      return;
    }
    cap.value = r.caption;
    paintChips(r.caption);
    saveCaption(r.caption, true);
    sfx('pop', { volume: 0.35, pitch: 1.2 });
  }
  cap.addEventListener('input', () => {
    paintChips(cap.value);
    saveCaption(cap.value, false);
  });
  cap.addEventListener('change', () => {
    cap.value = cleanCaption(cap.value);
    saveCaption(cap.value, true);
  });
  cap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') cap.blur();
  });

  async function move(delta) {
    if (!selected) return;
    await store.move(selected, delta);
    sfx('tap', { volume: 0.4 });
  }
  async function makeStar() {
    if (!selected) return;
    await store.makeStar(selected);
    sfx('sparkle', { volume: 0.5 });
    say('Star photo! It goes in the middle of the heart.', 'yay');
  }

  function ask(what) {
    confirm = confirm === what ? null : what;
    paintConfirm();
    sfx('tap', { volume: 0.4 });
  }
  function paintConfirm() {
    confirmBox.replaceChildren();
    clearBox.replaceChildren();
    confirmBox.hidden = confirm !== 'remove';
    clearBox.hidden = confirm !== 'clear';
    tools.hidden = confirm === 'remove';
    if (confirm === 'remove') {
      confirmBox.append(el('p', 'c9pw-ask', T.removeAsk), el('p', 'c9pw-why', T.removeWhy));
      const row = el('div', 'c9pw-confirm-row');
      row.append(
        button('c9-btn c9pw-yes', T.remove, async () => {
          const pid = selected;
          confirm = null;
          if (pid) await store.remove(pid);
          say('Removed from the wall.', '');
        }),
        button('c9-btn c9-btn-primary c9pw-no', T.keep, () => {
          confirm = null;
          paintConfirm();
        }),
      );
      confirmBox.append(row);
    } else if (confirm === 'clear') {
      clearBox.append(el('p', 'c9pw-ask', T.clearAsk), el('p', 'c9pw-why', T.clearWhy));
      const row = el('div', 'c9pw-confirm-row');
      row.append(
        button('c9-btn c9pw-yes', T.clearYes, async () => {
          confirm = null;
          await store.clear();
          say('All the photos are off this device.', '');
        }),
        button('c9-btn c9-btn-primary c9pw-no', T.clearNo, () => {
          confirm = null;
          paintConfirm();
        }),
      );
      clearBox.append(row);
    }
  }

  const onChange = () => render();
  store.on('change', onChange);
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (confirm) {
      confirm = null;
      paintConfirm();
    } else finish();
  };
  window.addEventListener('keydown', onKey, true);

  function finish() {
    if (closed) return;
    flushSave();
    if (typeof o.onClose === 'function') o.onClose();
    else close();
  }
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(sayTimer);
    flushSave();
    store.off('change', onChange);
    window.removeEventListener('keydown', onKey, true);
    root.remove();
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
  }

  render();
  return {
    el: root,
    close,
    get selected() { return selected; },
  };
}

function lockIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'c9-icon c9pw-lock');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M6.5 10.5h11v9.5h-11zM8.8 10.5V8a3.2 3.2 0 0 1 6.4 0v2.5M12 14.4v2.2');
  svg.append(p);
  return svg;
}
