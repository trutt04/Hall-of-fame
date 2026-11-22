// The character creator (Contract 3): a full-screen, kid-friendly dress-up screen.
//
//   openCreator({ look, nick, onDone(look, nick), onCancel, audio, locked, onChange, intro }) -> { el, close() }
//
//   look, nick   where to start (the look is cleaned; a missing nick starts empty)
//   onDone       gets a clean look and a nickname that passed cleanNick()
//   onCancel     she backed out (Cancel or Escape)
//   audio        optional Contract 6 audio object, for little taps and cheers
//   locked       optional { [slot]: { [optionId]: { name, hint, label } } }: options still to be
//                won (spirit sticks). They show a lock; tapping one shows its hint instead, and
//                "Surprise me!" never picks one. An option already worn is never locked. A lock with
//                its own `line` shows that line instead (the Gold bow: "Do all 8 Things to do...").
//   onChange     optional fn(look) on every change, for a live preview elsewhere
//   intro        optional short line under the title (her first time: "You can change it any time...")
//   close()      closes without calling either callback
//
// It saves nothing itself; the caller does. Tabs: Hair, Bow, Outfit, Shoes, Sparkle, Skin, Pet. The live
// 3D preview runs on its own small renderer, disposed on close: she turns slowly, you can drag to
// spin her, tap her for a trick, and she shows off every change (turning round for the bow, kicking
// up for the shoes). Her cloud puppy (js/art/pet.js), once won, sits beside her and spins when chosen. Nicknames come from "Pick for me" (js/content/names.js, loaded on demand, with a
// fallback list) or are typed: letters and spaces, at most 12, and they must pass cleanNick().
// Loads css/creator.css itself. Works in a portrait phone and a landscape tablet.
import * as THREE from '../../lib/three.module.min.js';
import { createCharacter, LOOK_OPTIONS, cleanLook, randomLook, lookOption, ANIM_INFO, trickSpin } from '../art/character.js';
import { optionIcon, tabIcon } from '../art/character-icons.js';
import { Geo } from '../art/geo.js';
import { glowMat } from '../art/materials.js';
import { createPuppy, petIcon, petTabIcon, PIVOT_Y } from '../art/pet.js';
import { FONT_STACK } from '../config.js';

const TABS = [
  { id: 'hair', label: 'Hair', frame: 'head', sections: [['hairStyle', 'Hairstyle', 'tiles'], ['hair', 'Hair color', 'dots']] },
  { id: 'bow', label: 'Bow', frame: 'bow', sections: [['bow', 'Bow color', 'tiles'], ['bowPattern', 'Pattern', 'tiles'], ['bowSize', 'Size', 'tiles']] },
  { id: 'outfit', label: 'Outfit', frame: 'body', sections: [['top', 'Top', 'tiles'], ['bottom', 'Bottom', 'tiles']] },
  { id: 'shoes', label: 'Shoes', frame: 'feet', sections: [['shoes', 'Shoes', 'tiles'], ['socks', 'Socks', 'tiles']] },
  { id: 'sparkle', label: 'Sparkle', frame: 'body', sections: [['sparkle', 'Sparkle', 'big']] },
  { id: 'skin', label: 'Skin', frame: 'face', sections: [['skin', 'Skin tone', 'dots']] },
  { id: 'pet', label: 'Pet', frame: 'pet', sections: [['pet', 'Pet', 'big']] },
];
// Where the camera looks for each tab: target height, distance, elevation.
const FRAMES = {
  body: { y: 0.8, dist: 3.7, el: 0.07 },
  head: { y: 1.06, dist: 2.45, el: 0.1 },
  face: { y: 1.02, dist: 2.5, el: 0.06 },
  bow: { y: 1.14, dist: 2.35, el: 0.3 },
  feet: { y: 0.62, dist: 3.3, el: 0.16 },
  pet: { x: 0.3, y: 0.62, dist: 3.5, el: 0.14 }, // her and the puppy beside her
};
// How she shows off a change: the move, and whether she turns round to show her back.
const REACT = {
  hairStyle: { anim: 'cheer', back: true, hold: 1.4 },
  hair: { anim: 'highV', back: true, hold: 1.2 },
  bow: { anim: 'touchdown', back: true, hold: 1.3 },
  bowPattern: { anim: 'clasp', back: true, hold: 1.3 },
  bowSize: { anim: 'cheer', back: true, hold: 1.6 },
  top: { anim: 'toeTouch' },
  bottom: { anim: 'toeTouch' },
  shoes: { anim: 'heelStretch', hold: 1.6 },
  socks: { anim: 'liberty', hold: 1.6 },
  sparkle: { anim: 'touchdown', hold: 1.4, burst: 2 },
  skin: { anim: 'wave', hold: 1.6 },
  pet: { anim: 'clap', hold: 1.4 },
};
const TRICKS = ['toeTouch', 'pike', 'kickDouble', 'twist', 'heelStretch', 'liberty', 'scorpion', 'bowArrow', 'arabesque'];

// ---- nicknames -----------------------------------------------------------------------------------
const FALL_A = ['Sparkle', 'Glitter', 'Twinkle', 'Sunny', 'Starry', 'Bubbly', 'Dazzle', 'Jazzy', 'Zippy', 'Cosmic', 'Happy', 'Lucky', 'Peppy', 'Shiny', 'Bouncy'];
const FALL_B = ['Star', 'Comet', 'Bow', 'Pom', 'Flip', 'Kick', 'Spark', 'Cloud', 'Twirl', 'Jump', 'Gem', 'Wish', 'Beam', 'Glow', 'Dash'];
function fallbackNick(rng) {
  for (let i = 0; i < 30; i++) {
    const n = FALL_A[Math.floor(rng() * FALL_A.length)] + ' ' + FALL_B[Math.floor(rng() * FALL_B.length)];
    if (n.length <= 12) return n;
  }
  return 'Star Flip';
}
function fallbackClean(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').replace(/[^\p{L} ]/gu, '').replace(/ +/g, ' ').trim();
  return s.length >= 1 && s.length <= 16 ? s : null; // typed names are already cut to 12 as she types
}
// What can be typed: letters and spaces, at most 12. Generated names may be up to 16.
export function filterTypedNick(v) {
  return String(v).normalize('NFC').replace(/[^\p{L} ]/gu, '').replace(/ {2,}/g, ' ').replace(/^ +/, '').slice(0, 12);
}
let namesMod = null;
async function loadNames() {
  if (namesMod) return namesMod;
  try {
    const m = await import('../content/names.js');
    if (m && typeof m.randomNick === 'function') {
      namesMod = { randomNick: m.randomNick, cleanNick: typeof m.cleanNick === 'function' ? m.cleanNick : fallbackClean, real: true };
    }
  } catch (err) {
    // not there (or offline): the fallback list keeps "Pick for me" working
  }
  if (!namesMod) namesMod = { randomNick: fallbackNick, cleanNick: fallbackClean, real: false };
  return namesMod;
}
function tryClean(m, raw) {
  try {
    const r = m.cleanNick(raw);
    return typeof r === 'string' && r.trim() ? r : null;
  } catch (err) {
    return null;
  }
}

// ---- small DOM helpers -----------------------------------------------------------------------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function ensureCss() {
  let link = document.getElementById('c9-creator-css');
  if (!link) {
    link = document.createElement('link');
    link.id = 'c9-creator-css';
    link.rel = 'stylesheet';
    link.href = new URL('../../css/creator.css', import.meta.url).href;
    document.head.appendChild(link);
  }
  return new Promise((resolve) => {
    if (link.sheet) { resolve(); return; }
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    setTimeout(resolve, 1500);
  });
}
const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- the preview ------------------------------------------------------------------------------------
// A little cloud for her to stand on: unlit, white on top fading to lilac underneath.
function makeCloud() {
  const g = new Geo();
  const puffs = [[0, 0, 0, 0.62], [0.42, 0.02, 0.18, 0.4], [-0.44, 0.02, 0.14, 0.42], [0.18, 0.01, -0.36, 0.42], [-0.22, 0.0, -0.32, 0.38], [0.1, 0.02, 0.42, 0.36], [-0.16, 0.0, 0.4, 0.34]];
  g.jit = 0.03;
  puffs.forEach(([x, y, z, r]) => g.ico(x, y - 0.17, z, r, 0xffffff, { detail: 1, sy: 0.42 }));
  // lilac underneath, white on top
  for (let i = 0; i < g.c.length; i += 3) {
    const t = Math.min(1, Math.max(0, (g.p[i + 1] + 0.32) / 0.3));
    g.c[i] *= 0.86 + 0.14 * t; g.c[i + 1] *= 0.8 + 0.2 * t;
  }
  return g.mesh(glowMat);
}

// A little padlock, drawn inline (no image files).
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
  + '<rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor"/><circle cx="12" cy="15.5" r="1.7" fill="#fff"/></svg>';

export function openCreator({ look, nick, onDone, onCancel, audio, locked, onChange, intro } = {}) {
  let state = cleanLook(look);
  const reduced = prefersReduced();
  const sfx = (name, o) => { try { if (audio && audio.sfx) audio.sfx(name, o); } catch (err) { /* sound is optional */ } };
  // what is still locked: never what she already wears
  const worn = cleanLook(look);
  const lockOf = (slot, id) => {
    const l = locked && typeof locked === 'object' && locked[slot] && typeof locked[slot] === 'object' ? locked[slot][id] : null;
    return l && worn[slot] !== id ? l : null;
  };
  const changed = () => {
    if (typeof onChange !== 'function') return;
    try { onChange(cleanLook(state)); } catch (err) { /* the preview elsewhere is a bonus */ }
  };
  const prevFocus = document.activeElement;

  // ---- DOM ----
  const root = el('div', 'c9c');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Make your cheerleader');
  root.style.visibility = 'hidden';
  root.style.setProperty('--c9c-font', FONT_STACK);

  const stage = el('div', 'c9c-stage');
  const canvas = el('canvas', 'c9c-canvas');
  canvas.setAttribute('aria-label', 'Your cheerleader. Drag to spin her, tap her for a trick.');
  const fx = el('div', 'c9c-fx');
  const title = el('h1', 'c9c-title', 'Make your cheerleader!');
  const cancel = el('button', 'c9c-btn c9c-cancel', 'Cancel');
  cancel.type = 'button';
  const hint = el('div', 'c9c-hint', 'Drag to spin her. Tap her for a trick!');
  stage.append(canvas, fx, title, cancel, hint);
  if (typeof intro === 'string' && intro) stage.appendChild(el('p', 'c9c-intro', intro.slice(0, 120)));

  const panel = el('div', 'c9c-panel');
  const nameRow = el('div', 'c9c-name');
  const nickLabel = el('label', 'c9c-name-label', 'Cheer name');
  const nickInput = el('input', 'c9c-nick');
  nickInput.id = 'c9c-nick-' + Math.floor(Math.random() * 1e6);
  nickLabel.htmlFor = nickInput.id;
  Object.assign(nickInput, { type: 'text', maxLength: 12, autocomplete: 'off', spellcheck: false, placeholder: 'Your cheer name' });
  nickInput.setAttribute('autocapitalize', 'words');
  nickInput.setAttribute('autocorrect', 'off');
  nickInput.setAttribute('enterkeyhint', 'done');
  const pick = el('button', 'c9c-btn c9c-pick', 'Pick for me');
  pick.type = 'button';
  const nameBox = el('div', 'c9c-namebox');
  nameBox.append(nickInput, pick);
  const nameNote = el('p', 'c9c-note');
  nameNote.setAttribute('aria-live', 'polite');
  nameRow.append(nickLabel, nameBox, nameNote);

  const tabs = el('div', 'c9c-tabs');
  tabs.setAttribute('role', 'tablist');
  const body = el('div', 'c9c-body');
  body.setAttribute('role', 'tabpanel');
  const foot = el('div', 'c9c-foot');
  const surprise = el('button', 'c9c-btn c9c-surprise');
  surprise.type = 'button';
  surprise.innerHTML = `<span class="c9c-bi">${tabIcon('dice')}</span><span>Surprise me!</span>`;
  const done = el('button', 'c9c-btn c9c-done', 'Done');
  done.type = 'button';
  foot.append(surprise, done);
  panel.append(nameRow, tabs, body, foot);
  root.append(stage, panel);
  document.body.appendChild(root);

  // ---- nickname ----
  if (typeof nick === 'string' && nick.trim()) nickInput.value = nick.trim().slice(0, 24);
  nickInput.addEventListener('input', () => {
    const v = filterTypedNick(nickInput.value);
    if (v !== nickInput.value) nickInput.value = v;
    nameNote.textContent = '';
    root.classList.remove('c9c-shake');
  });
  nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nickInput.blur(); });
  async function pickNick() {
    const m = await loadNames();
    for (let i = 0; i < 6; i++) {
      let n = null;
      try { n = m.randomNick(Math.random); } catch (err) { n = null; }
      if (typeof n !== 'string' || !n.trim()) continue;
      const ok = tryClean(m, n);
      if (ok) return ok;
    }
    return fallbackNick(Math.random);
  }
  pick.addEventListener('click', async () => {
    sfx('tap');
    pick.disabled = true;
    const n = await pickNick();
    pick.disabled = false;
    if (closed) return;
    nickInput.value = n;
    nameNote.textContent = '';
    nickInput.classList.remove('c9c-pop');
    void nickInput.offsetWidth;
    nickInput.classList.add('c9c-pop');
  });

  // ---- tabs and swatches ----
  let tab = TABS[0];
  const tabButtons = TABS.map((t) => {
    const b = el('button', 'c9c-tab');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.tab = t.id;
    b.innerHTML = `<span class="c9c-ti">${t.id === 'pet' ? petTabIcon() : tabIcon(t.id)}</span><span>${t.label}</span>`;
    b.addEventListener('click', () => selectTab(t.id));
    tabs.appendChild(b);
    return b;
  });
  function renderBody() {
    body.textContent = '';
    for (const [slot, name, kind] of tab.sections) {
      const sec = el('section', 'c9c-sec');
      const h = el('h2', 'c9c-sec-title');
      const strong = el('span', 'c9c-sec-name', name + ': ');
      const val = el('span', 'c9c-sec-val', lookOption(slot, state[slot]).label);
      val.dataset.val = slot;
      h.append(strong, val);
      const grid = el('div', 'c9c-grid c9c-grid-' + kind);
      for (const o of LOOK_OPTIONS[slot]) {
        const b = el('button', 'c9c-sw c9c-sw-' + kind);
        b.type = 'button';
        b.dataset.slot = slot;
        b.dataset.id = o.id;
        const lock = lockOf(slot, o.id);
        b.setAttribute('aria-label', lock ? o.label + ', locked. ' + (lock.line || 'Find the ' + lock.name + ' to unlock it.') : o.label);
        b.setAttribute('aria-pressed', String(state[slot] === o.id));
        if (o.id === 'ridiculous' || o.id === 'mega') b.classList.add('c9c-huge');
        const ic = el('span', 'c9c-ic');
        ic.innerHTML = slot === 'pet' ? petIcon(o.id) : optionIcon(slot, o, state);
        b.appendChild(ic);
        if (kind !== 'dots') b.appendChild(el('span', 'c9c-lb', o.label));
        if (lock) {
          b.classList.add('c9c-locked');
          const badge = el('span', 'c9c-lock');
          badge.innerHTML = LOCK_SVG;
          b.appendChild(badge);
        }
        grid.appendChild(b);
      }
      const tip = el('p', 'c9c-locknote');
      tip.dataset.tip = slot;
      tip.setAttribute('aria-live', 'polite');
      sec.append(h, grid, tip);
      body.appendChild(sec);
    }
    body.scrollTop = 0;
  }
  function refreshBody() {
    for (const b of body.querySelectorAll('.c9c-sw')) {
      const slot = b.dataset.slot, o = lookOption(slot, b.dataset.id);
      b.setAttribute('aria-pressed', String(state[slot] === o.id));
      b.querySelector('.c9c-ic').innerHTML = slot === 'pet' ? petIcon(o.id) : optionIcon(slot, o, state);
    }
    for (const v of body.querySelectorAll('[data-val]')) v.textContent = lookOption(v.dataset.val, state[v.dataset.val]).label;
  }
  function selectTab(id) {
    tab = TABS.find((t) => t.id === id) || TABS[0];
    for (const b of tabButtons) {
      const on = b.dataset.tab === tab.id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    renderBody();
    view.frame = FRAMES[tab.frame];
    sfx('tap');
  }
  body.addEventListener('click', (e) => {
    const b = e.target.closest('.c9c-sw');
    if (!b || !body.contains(b)) return;
    const slot = b.dataset.slot, id = b.dataset.id;
    if (!LOOK_OPTIONS[slot] || !LOOK_OPTIONS[slot].some((o) => o.id === id)) return;
    const lock = lockOf(slot, id);
    if (lock) {
      // still hidden on the island: say where to look
      b.classList.remove('c9c-nope');
      void b.offsetWidth;
      b.classList.add('c9c-nope');
      for (const n of body.querySelectorAll('.c9c-locknote')) n.textContent = '';
      const tip = body.querySelector('[data-tip="' + slot + '"]');
      if (tip) tip.textContent = lock.line || 'Find the ' + lock.name + ' to unlock this! Hint: ' + lock.hint;
      sfx('tap', { volume: 0.5, pitch: 0.8 });
      return;
    }
    for (const n of body.querySelectorAll('.c9c-locknote')) n.textContent = '';
    b.classList.remove('c9c-pop');
    void b.offsetWidth;
    b.classList.add('c9c-pop');
    if (state[slot] === id) { showOff(slot); return; }
    state = cleanLook(Object.assign({}, state, { [slot]: id }));
    refreshBody();
    if (preview) preview.character.setLook(state);
    changed();
    sfx('tap');
    showOff(slot);
  });
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(tab), n = TABS.length;
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
    selectTab(next.id);
    tabButtons[TABS.indexOf(next)].focus();
  });
  surprise.addEventListener('click', () => {
    const next = randomLook(Math.random);
    // never a locked option: keep what she has in that slot instead. Her pet stays too.
    for (const slot of Object.keys(next)) if (lockOf(slot, next[slot])) next[slot] = state[slot];
    next.pet = state.pet;
    state = cleanLook(next);
    refreshBody();
    if (preview) preview.character.setLook(state);
    changed();
    sfx('sparkle');
    play(Math.random() < 0.5 ? 'kickDouble' : 'toeTouch');
    burst(3);
  });

  // ---- the 3D preview ----
  let preview = null;
  const view = { yaw: 0.45, vel: 0, back: 0, frame: FRAMES.head, cam: { x: 0, y: 1.06, dist: 2.45, el: 0.1 }, dragging: false };
  let returnAt = 0, clock = 0;
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
    const hemi = new THREE.HemisphereLight(0xd6e6ff, 0xffd3e8, 1.35);
    const sun = new THREE.DirectionalLight(0xfff1de, 1.6);
    sun.position.set(2.5, 6, 6);
    scene.add(hemi, sun);
    const cloud = makeCloud();
    scene.add(cloud);
    const character = createCharacter(state, { quality: 'high' });
    character.shadow.visible = false;
    scene.add(character.group);
    // her cloud puppy sits beside her on the cloud (when she has one)
    let pet = null;
    try {
      pet = createPuppy({ shadow: false });
      pet.body.rotation.order = 'YXZ';
      pet.group.position.set(0.7, 0, 0.32);
      pet.group.visible = state.pet === 'cloudPuppy';
      scene.add(pet.group);
    } catch (err) {
      pet = null; // the pet is a bonus
    }
    preview = { renderer, scene, camera, character, cloud, pet };
  } catch (err) {
    stage.classList.add('c9c-no3d');
    const msg = el('p', 'c9c-no3d-msg', 'Your cheerleader will be waiting for you on the island!');
    stage.appendChild(msg);
    preview = null;
  }

  function play(name, hold) {
    if (!preview) return;
    const c = preview.character, info = ANIM_INFO[name];
    c.setAnim('idle', { air: false });
    c.setAnim(name, { restart: true, air: false });
    returnAt = clock + (info.loop ? hold || 1.4 : info.duration + 0.25);
  }
  function showOff(slot) {
    const r = REACT[slot] || { anim: 'cheer' };
    if (r.back) view.back = 2.4;
    if (!reduced) play(r.anim, r.hold);
    if (slot === 'pet' && preview && preview.pet) {
      // the puppy says hello with a poof of sparkles and a happy spin (or poofs off for a nap)
      if (state.pet !== 'none') {
        petView.spin = PET_SPIN;
        petView.happy = 2.2;
      }
      preview.pet.body.getWorldPosition(petAt);
      petAt.y += 0.25;
      burst(1, petAt);
      return;
    }
    burst(r.burst || 1);
  }
  // the preview puppy: sitting, wagging, looking at us, a curious head tilt now and then
  const PET_SPIN = 0.75;
  const petView = { spin: 0, happy: 0, tiltT: 2.5, tilt: 0 };
  const petAt = new THREE.Vector3();
  function updatePet(dt) {
    const p = preview && preview.pet;
    if (!p) return;
    p.group.visible = state.pet === 'cloudPuppy';
    if (!p.group.visible) return;
    petView.spin = Math.max(0, petView.spin - dt);
    petView.happy = Math.max(0, petView.happy - dt);
    const u = petView.spin > 0 ? 1 - petView.spin / PET_SPIN : 0;
    const yaw = petView.spin > 0 && !reduced ? Math.PI * 2 * u * u * (3 - 2 * u) : 0;
    const hop = petView.spin > 0 ? Math.sin(Math.PI * u) * 0.3 : 0;
    p.body.position.y = PIVOT_Y + 0.07 + (reduced ? 0 : Math.sin(clock * 2.3) * 0.03) + hop;
    p.body.rotation.set(-0.3, -0.45 + yaw, 0, 'YXZ');
    if ((petView.tiltT -= dt) <= 0) {
      petView.tiltT = 2.5 + Math.random() * 3;
      petView.tilt = Math.random() < 0.6 ? (Math.random() < 0.5 ? -0.32 : 0.32) : 0;
    }
    p.mood.sit = 1;
    p.mood.happy = petView.happy > 0 ? 1 : 0;
    p.mood.look = petView.spin > 0 ? 0 : 0.45;
    p.mood.tilt = petView.happy > 0 ? 0 : petView.tilt;
    p.update(dt, clock);
  }
  // A rhinestone burst over her, in DOM (cheap, crisp on any screen).
  const SPARK_COLORS = ['#ff2e93', '#ff7ad1', '#a96bff', '#ffffff', '#ffd36e'];
  function burst(power = 1, at = null) {
    if (reduced || !preview) return;
    const v = new THREE.Vector3();
    if (at) v.copy(at);
    else {
      preview.character.anchors.head.getWorldPosition(v);
      v.y -= 0.25;
    }
    v.project(preview.camera);
    const r = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const x = ((v.x + 1) / 2) * r.width + (r.left - sr.left), y = ((1 - v.y) / 2) * r.height + (r.top - sr.top);
    const n = 10 + power * 6;
    for (let i = 0; i < n; i++) {
      const s = el('span', 'c9c-spark');
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = 50 + Math.random() * 70 * power;
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      s.style.setProperty('--c', SPARK_COLORS[i % SPARK_COLORS.length]);
      s.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
      s.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
      s.addEventListener('animationend', () => s.remove(), { once: true });
      fx.appendChild(s);
    }
  }

  // drag to spin, tap for a trick
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
    view.dragging = true;
    view.vel = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    hint.classList.add('c9c-gone');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
    drag.y = e.clientY;
    view.yaw += dx * 0.012;
    view.vel = dx * 0.012 * 60;
    view.back = 0;
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const tap = drag.moved < 8 && performance.now() - drag.t < 450;
    drag = null;
    view.dragging = false;
    if (tap) {
      const trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
      play(trick, 1.8);
      burst(1);
      sfx('whoosh');
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- loop ----
  let raf = 0, last = performance.now(), closed = false, w = 0, h = 0;
  function size() {
    if (!preview) return;
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    preview.renderer.setSize(w, h, false);
    preview.camera.aspect = w / h;
    preview.camera.updateProjectionMatrix();
  }
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !preview) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;
    size();
    const c = preview.character;
    if (returnAt && clock > returnAt) { c.setAnim('idle'); returnAt = 0; }
    // turntable: inertia after a drag, a slow spin otherwise, and a turn to show off her back
    if (!view.dragging) {
      if (view.back > 0) {
        view.back -= dt;
        const target = Math.PI + 0.4, d = Math.atan2(Math.sin(target - view.yaw), Math.cos(target - view.yaw));
        view.yaw += d * (1 - Math.exp(-4 * dt));
        view.vel = 0;
      } else {
        view.yaw += view.vel * dt;
        view.vel *= Math.exp(-2.5 * dt);
        if (!reduced && Math.abs(view.vel) < 0.4) view.yaw += 0.3 * dt;
      }
    }
    // twists and kick doubles: the trick leaves turning her to us, like the toss does with heading
    const info = ANIM_INFO[c.anim];
    const turn = info && info.turns ? trickSpin(c.anim, Math.min(1, c.animTime / info.duration), true) : 0;
    c.group.rotation.y = view.yaw + turn;
    c.lookAt(preview.camera.position);
    c.update(dt, clock);
    updatePet(dt);
    // camera framing for the tab; tall, narrow stages pull back a little so a T motion fits
    const f = view.frame, aspect = w / Math.max(1, h), fit = aspect < 0.75 ? 0.75 / aspect : 1;
    view.cam.x = damp(view.cam.x, f.x || 0, 4, dt);
    view.cam.y = damp(view.cam.y, f.y, 4, dt);
    view.cam.dist = damp(view.cam.dist, f.dist * Math.min(1.6, fit), 4, dt);
    view.cam.el = damp(view.cam.el, f.el, 4, dt);
    const cam = preview.camera;
    cam.position.set(view.cam.x, view.cam.y + Math.sin(view.cam.el) * view.cam.dist, Math.cos(view.cam.el) * view.cam.dist);
    cam.lookAt(view.cam.x, view.cam.y, 0);
    preview.renderer.render(preview.scene, cam);
  }

  // ---- done / cancel ----
  async function finish() {
    if (closed) return;
    let raw = nickInput.value.trim();
    const m = await loadNames();
    let name = null;
    if (!raw) {
      name = await pickNick();
    } else {
      name = tryClean(m, raw); // every name, typed, picked or kept from before, passes cleanNick
    }
    if (!name) {
      nameNote.textContent = "Let's try a different name, or tap Pick for me!";
      root.classList.remove('c9c-shake');
      void root.offsetWidth;
      root.classList.add('c9c-shake');
      nickInput.focus();
      return;
    }
    const look = cleanLook(state);
    sfx('cheer');
    close();
    if (typeof onDone === 'function') {
      try { onDone(look, name); } catch (err) { console.error('[c9] creator onDone failed', err); }
    }
  }
  function cancelOut() {
    if (closed) return;
    sfx('close');
    close();
    if (typeof onCancel === 'function') {
      try { onCancel(); } catch (err) { console.error('[c9] creator onCancel failed', err); }
    }
  }
  done.addEventListener('click', finish);
  cancel.addEventListener('click', cancelOut);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelOut(); } };
  window.addEventListener('keydown', onKey);

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    if (preview) {
      preview.character.dispose();
      if (preview.pet) preview.pet.dispose();
      preview.cloud.geometry.dispose();
      preview.renderer.dispose();
      try { preview.renderer.forceContextLoss(); } catch (err) { /* already gone */ }
      preview = null;
    }
    root.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (err) { /* it may be gone */ }
    }
  }

  // ---- go ----
  selectTab('hair');
  ensureCss().then(() => {
    if (closed) return;
    root.style.visibility = '';
    root.classList.add('c9c-in');
    try { tabButtons[0].focus({ preventScroll: true }); } catch (err) { /* fine */ }
  });
  sfx('open');
  setTimeout(() => hint.classList.add('c9c-gone'), 6000);
  raf = requestAnimationFrame(frame);
  return { el: root, close };
}
