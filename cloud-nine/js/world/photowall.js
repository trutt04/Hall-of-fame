// The photo wall in the west lawn: a big hot pink heart covered in polaroids of her favorite people
// (js/art/photowall-art.js), with real family photos added on this device. "Add photos" (the wall is
// empty) opens the manager (js/ui/photo-manager.js): add from the camera roll, captions with one-tap
// name chips, move them, pick the star photo. "Look at the photos" (it has some), or tapping the wall,
// opens the scrapbook viewer and slideshow (js/ui/photo-viewer.js).
//
// Privacy: the photos (js/core/photos.js) stay on this device. Nothing about them goes over the network
// (no bytes, no captions, no count, no "has photos" flag): this module never touches world.net. In a
// room every device shows its own photos, or empty frames.
//
//   import { installPhotoWall } from './world/photowall.js'
//   const wall = installPhotoWall(world, { name, gift, petName, notes, birthday })   once the world exists
//       name      her name from the gift link on this device: the banner says "<name>'s Favorite People"
//                 (null: "Favorite People")
//       gift, petName   the gift link and js/core/gift.js petName: the caption chips (js/core/photos.js
//                 nameChips). Used here only, on this device
//       notes()   the family notes for the slideshow's note cards      birthday() -> { isBirthday, name }
//   wall.open(slot?)       the prompt and a tap on the wall: the viewer (at the tapped photo) when there are
//                          photos, else the manager
//   wall.openManager()     wall.openViewer(index, { slideshow })
//   wall.close(why?)       back to free roam at once (a game or Hit Zero starting, the menu). why 'game' |
//                          'routine' only says who asked: nothing is lost, every photo is already saved
//   wall.active            the manager or the viewer is open (main.js keeps the menu and the wheel shut)
//   wall.ready             a Promise: the photos were read (after the first frame, so boot stays quick)
//   wall.count             photos on this device       wall.persistent   false: memory only (no IndexedDB)
//   wall.addFiles(files, onProgress({ i, n })) -> Promise<{ added, failed: [reason] }>
//   wall.importPhotos(photos, star) -> Promise<{ added }>   the family's photo pack from her gift link
//                          (js/core/photo-pack.js, opened by main.js): [{ caption, type, bytes }], saved on
//                          this device like any other photo, the star one in the middle. Then a toast.
//   wall.glowing           the beacon glows: photos added in an earlier visit she hasn't looked at yet
//   wall.store / wall.art / wall.plan / wall.stats { drawCalls, triangles } / wall.dispose()

import { buildPhotoWallArt, SLOTS } from '../art/photowall-art.js';
import { makePhotoWall, photoWallColliders } from '../art/island-layout.js';
import { openPhotoStore, processPhoto, askToPersist, blobOf, decodeImage, nameChips, PHOTO_LIMITS } from '../core/photos.js';
import { isAppleTouch } from '../ui/silent-tip.js';
import { loadCss, reducedMotion } from '../ui/dom.js';

export const WALL_TITLE = 'Favorite People';
export const NUDGE_LINE = 'Your photo wall has new photos!';
export const FAMILY_LINE = 'Your family filled your photo wall! Go take a look.';
export const PROMPTS = Object.freeze({ empty: 'Add photos', full: 'Look at the photos' });

// The banner: "<her name>'s Favorite People" with the gift link's name, else "Favorite People".
export function wallTitle(name) {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  return n ? n + "'s " + WALL_TITLE : WALL_TITLE;
}

// Photos added in an earlier visit that she hasn't opened the viewer for since: the beacon glows, and
// one toast says so (once for each batch).
export function nudgeState(meta, count, sessionStart) {
  const m = meta || {};
  const fresh = count > 0 && m.addedAt > 0 && m.addedAt > (m.viewedAt || 0) && m.addedAt < sessionStart;
  return { glow: fresh, toast: fresh && m.nudgedAt !== m.addedAt };
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export function installPhotoWall(world, opts = {}) {
  const place = world && world.places && world.places.photoWall;
  if (!place || !fin(place.x) || !fin(place.z)) return null;
  const { scene, player, hud, interact, engine, renderer, camera, rig } = world;
  if (!scene || !player || !hud || !interact || !engine || !renderer || !camera || !rig) return null;
  const THREE = world.THREE;
  const plan = world.island && world.island.plan && world.island.plan.photoWall && world.island.plan.photoWall.board
    ? world.island.plan.photoWall
    : makePhotoWall({ x: place.x, z: place.z, facing: fin(place.facing) ? place.facing : 0, y: groundY(world, place.x, place.z) });
  const calm = reducedMotion();
  const sessionStart = Date.now();
  const sfx = (name, o) => {
    try {
      if (world.audio) world.audio.sfx(name, o);
    } catch (err) { /* a sound never stops the wall */ }
  };

  // ---------------------------------------------------------------- the wall itself
  const weak = world.quality === 'low' || (typeof navigator !== 'undefined' && fin(navigator.deviceMemory) && navigator.deviceMemory <= 2)
    || !!(renderer.capabilities && renderer.capabilities.maxTextureSize < 4096);
  let title = typeof opts.title === 'string' && opts.title ? opts.title : wallTitle(opts.name);
  const chips = Array.isArray(opts.chips) ? opts.chips : nameChips({ gift: opts.gift || null, petName: typeof opts.petName === 'function' ? opts.petName : null });
  const art = buildPhotoWallArt(plan, {
    quality: world.quality, yAt: (x, z) => groundY(world, x, z), title, atlasSize: weak ? 1024 : 2048, renderer,
  });
  scene.add(art.group);
  // solid things: the board, its legs and poles, the balloon stakes and the bench (the patio is walkable)
  const TAG = 'photoWall';
  if (world.colliders) {
    for (const c of photoWallColliders(plan)) {
      if (c.kind === 'circle') world.colliders.addCircle(c.x, c.z, c.r, TAG);
      else world.colliders.addBox(c.x, c.z, c.w, c.d, c.rot || 0, TAG);
    }
  }

  // ---------------------------------------------------------------- the prompt
  const entry = interact.register({
    id: 'photoWall', position: { x: plan.spot.x, y: plan.y, z: plan.spot.z }, radius: 3.8, label: PROMPTS.empty,
    icon: '\u{1F4F7}', priority: 1, object3D: art.pick, height: 2.5, onUse: () => open(tapped()),
  });
  function refreshPrompt() {
    entry.label = count() ? PROMPTS.full : PROMPTS.empty;
    entry.icon = count() ? '\u{1F5BC}\uFE0F' : '\u{1F4F7}';
  }

  // a tap on a polaroid opens the viewer at that photo: remember which one was under the last press
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let lastTap = { slot: -1, at: 0 };
  const canvas = renderer.domElement;
  const onPress = (e) => {
    if (!canvas || !canvas.getBoundingClientRect) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    lastTap = { slot: art.slotAt(ray.ray), at: performance.now() };
  };
  if (canvas && canvas.addEventListener) canvas.addEventListener('pointerdown', onPress);
  function tapped() {
    const t = lastTap;
    lastTap = { slot: -1, at: 0 };
    return t.slot >= 0 && performance.now() - t.at < 12000 ? t.slot : -1;
  }

  // ---------------------------------------------------------------- the photos (read after the first frame)
  let store = null;
  let resolveReady = null;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  let frames = 0;
  const count = () => (store ? store.count : 0);

  // what each polaroid shows: slot i holds the i-th photo (the first is the star), the rest are empty
  const shown = SLOTS.map(() => ({ key: 'empty' }));
  const want = SLOTS.map(() => ({ key: 'empty' }));
  let painting = false;
  function plan2wall(list) {
    for (let i = 0; i < SLOTS.length; i++) {
      const p = list[i];
      want[i] = p ? { key: 'photo:' + p.id + ':' + p.caption, id: p.id, caption: p.caption } : { key: 'empty' };
    }
  }
  async function decodeSmall(id) {
    const bytes = await store.bytes(id, 'small');
    if (!bytes) return null;
    const blob = blobOf(bytes);
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(blob);
        return { image: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
      } catch (err) { /* below */ }
    }
    const img = await decodeImage(blob);
    return { image: img.image, w: img.w, h: img.h, close: img.close };
  }
  // One polaroid at a time, a frame apart, so adding or moving photos never stalls the island.
  async function pump() {
    if (painting || !store) return;
    let empties = false;
    for (let i = 0; i < SLOTS.length; i++) {
      if (want[i].key === shown[i].key || want[i].key !== 'empty') continue;
      art.paintSlot(i, { kind: 'empty' });
      shown[i] = want[i];
      empties = true;
    }
    if (empties) art.flush();
    const i = want.findIndex((w, k) => w.key !== shown[k].key);
    if (i < 0) return;
    painting = true;
    const target = want[i];
    let pic = null;
    try {
      pic = await decodeSmall(target.id);
      if (pic && want[i].key === target.key) {
        art.paintSlot(i, { kind: 'photo', image: pic.image, w: pic.w, h: pic.h, caption: target.caption });
        art.flush();
        shown[i] = target;
      } else if (!pic) {
        shown[i] = target; // its bytes are gone: leave the frame as it is rather than trying forever
      }
    } catch (err) {
      shown[i] = target;
    } finally {
      if (pic) pic.close();
      painting = false;
    }
  }
  const onChange = (list) => {
    plan2wall(list);
    refreshPrompt();
  };

  async function load() {
    try {
      store = await openPhotoStore();
    } catch (err) {
      store = null;
    }
    if (store) {
      store.on('change', onChange);
      onChange(store.list());
      checkNudge();
    }
    resolveReady(!!store);
  }

  // ---------------------------------------------------------------- the surprise: new photos since her last look
  let glowing = false;
  let nudgeTries = 0;
  function setGlow(on) {
    glowing = !!on;
    const b = world.beacons;
    if (b && typeof b.setGlow === 'function') b.setGlow('photoWall', glowing);
  }
  function checkNudge() {
    const s = nudgeState(store.meta, store.count, sessionStart);
    setGlow(s.glow);
    if (s.toast) setTimeout(nudgeSoon, 6500);
  }
  function nudgeSoon() {
    if (!store || !nudgeState(store.meta, store.count, sessionStart).toast) return;
    if (!free() || hud.isModalOpen() || active()) {
      if (++nudgeTries < 40) setTimeout(nudgeSoon, 2000);
      return;
    }
    store.markNudged();
    hud.toast(NUDGE_LINE, { icon: '\u{1F496}', ms: 5600 });
    sfx('chime', { volume: 0.5 });
  }

  // ---------------------------------------------------------------- open and close
  let phase = 'idle'; // 'idle' | 'opening' | 'manager' | 'viewer'
  let run = 0;
  let release = null;
  let uiMods = null;
  let handle = null;
  const active = () => phase !== 'idle';
  const free = () => world.mode === 'play' && !player.controller && !player.rescuing && !(world.toss && world.toss.active)
    && !world.activeGame && !world.hitZero && !(world.booth && world.booth.active) && !(world.pond && world.pond.active);
  let uiLoading = null;
  function loadUi() {
    if (!uiLoading) {
      uiLoading = Promise.all([import('../ui/photo-manager.js'), import('../ui/photo-viewer.js'), loadCss('css/photowall.css')])
        .then(([m, v]) => {
          uiMods = { manager: m, viewer: v };
          return uiMods;
        })
        .catch((err) => {
          uiLoading = null;
          throw err;
        });
    }
    return uiLoading;
  }

  async function begin() {
    if (phase !== 'idle' || !free() || hud.isModalOpen()) return 0;
    phase = 'opening';
    const my = ++run;
    entry.enabled = false;
    if (typeof hud.closeWheel === 'function') hud.closeWheel();
    if (typeof hud.hideHint === 'function') hud.hideHint();
    release = player.takeControl('photoWall');
    player.setAnim('idle');
    hud.setBusy(true);
    if (world.input && typeof world.input.setSuspended === 'function') world.input.setSuspended(true);
    try {
      await Promise.all([loadUi(), ready]);
    } catch (err) {
      if (my === run) {
        close();
        hud.toast('The photo wall is still getting ready. Try again in a moment!', { icon: '\u{1F4F7}', ms: 3200 });
      }
      return 0;
    }
    return my === run ? my : 0;
  }

  async function open(slot = -1) {
    if (phase !== 'idle') return;
    if (!(await begin())) return;
    if (!store) {
      close();
      return;
    }
    const list = store.list();
    if (list.length) showViewer(slot >= 0 && slot < list.length ? slot : 0, false);
    else showManager();
  }
  async function openManager() {
    if (phase === 'viewer') {
      showManager();
      return;
    }
    if (phase !== 'idle') return;
    if (!(await begin())) return;
    if (store) showManager();
    else close();
  }
  async function openViewer(index = 0, o = {}) {
    if (phase === 'manager') {
      showViewer(index, !!o.slideshow);
      return;
    }
    if (phase !== 'idle') return;
    if (!(await begin())) return;
    if (store && store.count) showViewer(index, !!o.slideshow);
    else if (store) showManager();
    else close();
  }

  function dropHandle() {
    const h = handle;
    handle = null;
    if (h) {
      try {
        h.close();
      } catch (err) { /* already gone */ }
    }
  }

  // the camera frames the wall above (portrait) or beside (landscape) the manager's card
  const camPos = [0, 0, 0];
  const camLook = [0, 0, 0];
  const hold = { dur: 1e7, ease: 'linear', cut: true, fov: 50, pos: () => camPos, look: () => camLook };
  const swing = { dur: 0.9, ease: 'inOut', fov: 50, pos: () => camPos, look: () => camLook };
  // The part of the screen the manager's card leaves free: above it when it is a sheet at the
  // bottom (a phone held upright), beside it when it is a panel on the right (sideways, tablets).
  // Measured from its layout box, so its slide-in doesn't count.
  function freeArea(W, H) {
    let r = null;
    try {
      const sheet = handle && handle.el && handle.el.querySelector('.c9pw-sheet');
      if (sheet && sheet.offsetWidth > 0) r = { left: sheet.offsetLeft, top: sheet.offsetTop };
    } catch (err) {
      r = null;
    }
    if (r && r.left > W * 0.25) return { x: r.left / 2, y: H / 2, w: r.left * 0.92, h: H * 0.84, beside: true };
    const top = r ? Math.max(H * 0.2, r.top) : H * 0.34;
    return { x: W / 2, y: top / 2, w: W * 0.94, h: top * 0.9, beside: false };
  }
  // The camera slides sideways to put the wall beside the card (looking square at it, so there is
  // no wide-angle stretch at the screen's edge) and tips down to put it above the card, far enough
  // back that the heart, the banner and the balloons all fit the free part of the screen.
  function frameWall() {
    const W = Math.max(1, engine.width || window.innerWidth);
    const H = Math.max(1, engine.height || window.innerHeight);
    // where the wall should sit on screen, and how much room it has
    const area = freeArea(W, H);
    const fov = area.beside ? 48 : 60;
    const K = H / 2 / Math.tan((fov * Math.PI) / 360); // pixels per metre at 1 m
    const tall = 5.9; // the heart and the banner over it
    const wide = 6.6; // and the balloons beside it
    const tip = Math.atan((H / 2 - area.y) / K); // looking down this much puts it above the middle
    const stretch = 1 / (Math.cos(tip) * Math.cos(tip));
    const dist = Math.min(30, Math.max(7, ((tall * K) / area.h) * stretch, (wide * K) / area.w));
    const midY = plan.y + 3.05;
    const fx = Math.sin(plan.facing); // out of the wall's front
    const fz = Math.cos(plan.facing);
    const rx = Math.cos(plan.facing); // the wall's right as you face it (the screen's right)
    const rz = -Math.sin(plan.facing);
    const side = ((area.x - W / 2) * dist) / K; // the wall's middle this far off the screen's middle
    camPos[0] = plan.x + fx * dist - rx * side;
    camPos[1] = midY;
    camPos[2] = plan.z + fz * dist - rz * side;
    camLook[0] = camPos[0] - fx * Math.cos(tip);
    camLook[1] = camPos[1] - Math.sin(tip);
    camLook[2] = camPos[2] - fz * Math.cos(tip);
    hold.fov = fov;
    swing.fov = fov;
  }
  const onResize = () => {
    if (phase === 'manager') frameWall();
  };
  const offResize = typeof engine.on === 'function' ? engine.on('resize', onResize) : null;
  // she steps to the side of the patio, so she isn't standing in front of the photos
  function stepAside() {
    const c = Math.cos(plan.facing);
    const s = Math.sin(plan.facing);
    const lx = 2.9;
    const lz = 2.1;
    const x = plan.x + lx * c + lz * s;
    const z = plan.z - lx * s + lz * c;
    if (Math.hypot(player.position.x - x, player.position.z - z) > 0.4 && Number.isFinite(world.groundAt(x, z))) {
      player.place(x, z, Math.atan2(plan.x - x, plan.z - z));
    } else player.heading = Math.atan2(plan.x - player.position.x, plan.z - player.position.z);
  }

  function showManager() {
    dropHandle();
    phase = 'manager';
    stepAside();
    const persistent = !!(store && store.persistent);
    handle = uiMods && uiMods.manager.openPhotoManager({
      store,
      title,
      chips,
      persistent,
      homeTip: homeScreenTip(),
      calm,
      sfx,
      addFiles,
      onLook: (i) => showViewer(i, false),
      onSlideshow: () => showViewer(0, true),
      onClose: () => close(),
    });
    // the card is on the page now: frame the wall in the room it leaves
    frameWall();
    swing.dur = calm ? 0.01 : 0.9;
    rig.play([swing, hold], { skippable: false, handoff: calm ? 0.01 : 0.7 });
    sfx('open', { volume: 0.45 });
  }

  function showViewer(index, slideshow) {
    dropHandle();
    phase = 'viewer';
    if (store) {
      store.markViewed();
      setGlow(false);
    }
    handle = uiMods && uiMods.viewer.openPhotoViewer({
      store,
      title,
      start: index,
      slideshow,
      notes: () => {
        try {
          return typeof opts.notes === 'function' ? opts.notes() || [] : [];
        } catch (err) {
          return [];
        }
      },
      birthday: () => {
        try {
          return typeof opts.birthday === 'function' ? opts.birthday() || {} : {};
        } catch (err) {
          return {};
        }
      },
      calm,
      sfx,
      onManage: () => showManager(),
      onClose: () => close(),
    });
    sfx('open', { volume: 0.45 });
  }

  function close(why) {
    if (phase === 'idle') return;
    run++;
    phase = 'idle';
    dropHandle();
    if (release) {
      player.setAnim('idle');
      const r = release;
      release = null;
      r();
    }
    if (rig.isCinematic) {
      rig.yaw = player.heading + Math.PI;
      rig.skip();
    }
    hud.setBusy(false);
    if (world.input && typeof world.input.setSuspended === 'function') world.input.setSuspended(world.mode !== 'play' || hud.isModalOpen());
    entry.enabled = true;
    void why;
  }

  // ---------------------------------------------------------------- adding photos (from the manager)
  let everAdded = false;
  async function addFiles(files, onProgress) {
    const list = Array.from(files || []);
    const out = { added: 0, failed: [] };
    if (!store) {
      out.failed.push('storage');
      return out;
    }
    for (let i = 0; i < list.length; i++) {
      if (store.count >= PHOTO_LIMITS.max) {
        out.failed.push('full');
        break;
      }
      if (typeof onProgress === 'function') onProgress({ i: i + 1, n: list.length });
      const r = await processPhoto(list[i]);
      if (!r.ok) {
        out.failed.push(r.reason);
        continue;
      }
      const res = await store.add({ full: r.full, small: r.small, caption: '' });
      if (res.ok) {
        out.added++;
        if (!everAdded) {
          everAdded = true;
          askToPersist(); // best effort: "please keep this site's data"
        }
        sfx('sparkle', { volume: 0.45, pitch: 1 + 0.06 * out.added });
      } else out.failed.push(res.reason);
      await nextFrame(); // the wall paints it before the next one
    }
    return out;
  }

  // The family's photos from her gift link: saved here like any she adds herself (main.js fetched and
  // unlocked the pack; nothing goes out from here), with their captions, the star one in the middle.
  async function importPhotos(photos, star = 0) {
    const out = { added: 0 };
    if (!store || !Array.isArray(photos)) return out;
    let starId = null;
    for (let i = 0; i < photos.length && store.count < PHOTO_LIMITS.max; i++) {
      const p = photos[i];
      if (!p || !p.bytes) continue;
      const r = await processPhoto(new Blob([p.bytes], { type: p.type || 'image/jpeg' }));
      if (!r.ok) continue;
      const res = await store.add({ full: r.full, small: r.small, caption: typeof p.caption === 'string' ? p.caption : '' });
      if (res.ok) {
        out.added++;
        if (i === star) starId = res.id;
      }
      await nextFrame();
    }
    if (starId) await store.makeStar(starId);
    if (out.added) {
      if (!everAdded) {
        everAdded = true;
        askToPersist();
      }
      setGlow(true);
      setTimeout(familySoon, 2500);
    }
    return out;
  }
  let familyTries = 0;
  function familySoon() {
    if (!free() || hud.isModalOpen() || active()) {
      if (++familyTries < 60) setTimeout(familySoon, 2000);
      return;
    }
    hud.toast(FAMILY_LINE, { icon: '\u{1F496}', ms: 6000 });
    sfx('chime', { volume: 0.5 });
  }

  // On iPhone and iPad, Safari can clear a site's storage after about a week without a visit, unless
  // Cloud Nine is on the Home Screen (it keeps its own storage there).
  function homeScreenTip() {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!isAppleTouch(nav)) return null;
      const standalone = !!(nav && nav.standalone) || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (standalone) return null;
      return /iPhone|iPod/i.test(String(nav.userAgent || '')) ? 'iPhone' : 'iPad';
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------- per frame
  function update(dt, t) {
    if (!started && ++frames >= 2) {
      // after the first frame: the photos are read now, so the island comes up just as fast
      started = true;
      setTimeout(load, 40);
    }
    art.update(dt, t);
    if (phase !== 'idle') {
      const away = world.mode !== 'play' || world.activeGame || world.hitZero || (world.toss && world.toss.active)
        || (world.booth && world.booth.active) || player.rescuing;
      if (away) close('game');
    }
    if (store && !painting) pump();
  }
  const off = typeof world.onUpdate === 'function' ? world.onUpdate((dt, t) => update(dt, t)) : null;
  // a card or a panel of the game's own coming up (a room closing, say) takes the screen back
  const onModal = (openNow) => {
    if (openNow && phase !== 'idle') close();
  };
  if (typeof hud.on === 'function') hud.on('modal', onModal);

  return {
    open,
    openManager,
    openViewer,
    close,
    addFiles,
    importPhotos,
    update,
    get active() { return active(); },
    get phase() { return phase; },
    get ui() { return handle; }, // the open manager or viewer (tests)
    get ready() { return ready; },
    get count() { return count(); },
    get persistent() { return !!(store && store.persistent); },
    get glowing() { return glowing; },
    get store() { return store; },
    get title() { return title; },
    setTitle(next) {
      title = typeof next === 'string' && next ? next : WALL_TITLE;
      art.setTitle(title);
      art.flush();
    },
    // which photo each polaroid shows now (tests): 'empty' or the photo's id
    get slots() { return shown.map((s) => (s.id ? s.id : 'empty')); },
    get painted() { return shown.every((s, i) => s.key === want[i].key); },
    art,
    plan,
    get stats() { return { drawCalls: art.drawCalls, triangles: art.triangles }; },
    dispose() {
      close();
      if (typeof off === 'function') off();
      if (typeof hud.off === 'function') hud.off('modal', onModal);
      if (typeof offResize === 'function') offResize();
      if (canvas && canvas.removeEventListener) canvas.removeEventListener('pointerdown', onPress);
      if (store) store.off('change', onChange);
      interact.unregister('photoWall');
      if (world.colliders) world.colliders.removeGroup(TAG);
      art.dispose();
    },
  };
}

function groundY(world, x, z) {
  try {
    const y = world.groundAt(x, z);
    return Number.isFinite(y) ? y : 0;
  } catch (err) {
    return 0;
  }
}
