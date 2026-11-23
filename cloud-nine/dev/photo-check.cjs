// The photo wall in a real browser (PHOTOS): photos added through the file input go on the wall, stay
// after a reload, open in the scrapbook viewer and the slideshow (with the family's notes as cards),
// and come off again; and nothing about them ever goes over the network. Needs the repo served over HTTP:
//   python3 -m http.server 8131 --bind 127.0.0.1        (from the repo root)
//   node cloud-nine/dev/photo-check.cjs [baseUrl] [screenshotDir]
// Screenshots are written as photowall-*.png (deviceScaleFactor 2) when a directory is given (never
// commit them: they are made of test pictures, but still).
//
// What it proves about privacy, across the whole run:
//   - every HTTP request is a GET to this server, none carries a body, and no URL holds image data
//     (data:, blob:, base64 JPEG or PNG) or a caption; no WebSocket is ever opened
//   - in a local room of two tabs (the BroadcastChannel transport; the second tab keeps its photos
//     in its own database, as a second device would), the friend's wall shows 0 photos after the
//     host adds some, and no room message holds image data, a caption, a photo count or any
//     photo wall key
// The test pictures are drawn in the page on a canvas (bright colours and shapes, no people) and the
// gift link uses made-up names.

const { chromium } = require('playwright');
const path = require('path');

const BASE = (process.argv[2] || process.env.PHOTO_URL || 'http://127.0.0.1:8131/cloud-nine/').replace(/index\.html$/, '');
const SHOTS = (process.argv[3] || '').replace(/\/$/, '');
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log((ok ? 'ok - ' : 'NOT OK - ') + msg);
};

// the test pictures: [name, mime, width, height, background, shape]
const PICTURES = [
  ['red-circle.jpg', 'image/jpeg', 1200, 1600, '#e53935', 'circle'],
  ['teal-triangle.png', 'image/png', 1600, 1000, '#00897b', 'triangle'],
  ['gold-star.jpg', 'image/jpeg', 1000, 1000, '#fbc02d', 'star'],
];
const CAPTION_A = 'Me & Pip';
const CAPTION_B = 'Beach day';
const CAPTION_ROOM = 'Me & Mom'; // no gift link in the room: the plain chips
// as long as a family note can be (280 characters): it has to fit the page, even sideways
const LONG_NOTE = 'Zuzu, I love watching you fly at every competition. You work so hard, you cheer for your whole team and you make everyone smile. I hope this year brings new stunts, sparkly bows, lots of giggles with Pip and Biscuit, and the very best birthday ever. Love you to the moon and back!';

// ------------------------------------------------------------------------------------------ helpers

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const near = (a, b, tol = 40) => a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

// Everything a page sends: HTTP requests and WebSocket frames, and its errors.
function watch(page, log, errors) {
  page.on('request', (r) => {
    let body = null;
    try {
      body = r.postData();
    } catch (err) {
      body = '(unreadable)';
    }
    log.http.push({ method: r.method(), url: r.url(), body, type: r.resourceType() });
  });
  page.on('websocket', (ws) => {
    log.ws.push(ws.url());
    ws.on('framesent', (f) => log.wsFrames.push(String(f.payload).slice(0, 200)));
  });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'warning' && /GL Driver Message|GPU stall/.test(t)) return; // SwiftShader noise
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
}

async function ready(page) {
  await page.waitForFunction(() => window.__c9 && window.__c9.mode === 'play' && window.__c9.photoWall, null, { timeout: 45000 });
  await page.evaluate(() => window.__c9.photoWall.ready);
  await page.evaluate(() => window.__c9.hud.hideHint());
}

// Draws the test pictures in the page and hands them back as files for setInputFiles.
async function makePictures(page, list = PICTURES) {
  const out = await page.evaluate(async (pics) => {
    const res = [];
    for (const [name, mime, w, h, bg, shape] of pics) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const m = Math.min(w, h);
      // a little scene: sky in the picture's colour, a sun, clouds, rolling hills, confetti
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.arc(w * 0.82, h * 0.2, m * 0.11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (const [cx, cy, s] of [[0.5, 0.12, 1], [0.58, 0.1, 0.8], [0.43, 0.13, 0.7]]) {
        g.beginPath();
        g.ellipse(w * cx, h * cy, m * 0.09 * s, m * 0.045 * s, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(40,120,60,0.55)';
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, h * 0.8);
      g.quadraticCurveTo(w * 0.3, h * 0.66, w * 0.6, h * 0.8);
      g.quadraticCurveTo(w * 0.85, h * 0.9, w, h * 0.76);
      g.lineTo(w, h);
      g.closePath();
      g.fill();
      for (let k = 0; k < 40; k++) {
        g.fillStyle = ['#ffffff', '#ffd36e', '#ff8cc6', '#17121c'][k % 4];
        const x = ((k * 97) % 100) / 100;
        const y = 0.66 + (((k * 53) % 30) / 100);
        g.fillRect(w * x, h * y, m * 0.012, m * 0.02);
      }
      g.fillStyle = '#ffffff';
      const r = Math.min(w, h) * 0.22;
      g.beginPath();
      if (shape === 'circle') g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      else if (shape === 'triangle') {
        g.moveTo(w / 2, h / 2 - r);
        g.lineTo(w / 2 + r, h / 2 + r);
        g.lineTo(w / 2 - r, h / 2 + r);
      } else if (shape === 'heart') {
        g.moveTo(w / 2, h / 2 + r * 0.95);
        g.bezierCurveTo(w / 2 - r * 1.45, h / 2 - r * 0.05, w / 2 - r * 0.7, h / 2 - r * 1.15, w / 2, h / 2 - r * 0.42);
        g.bezierCurveTo(w / 2 + r * 0.7, h / 2 - r * 1.15, w / 2 + r * 1.45, h / 2 - r * 0.05, w / 2, h / 2 + r * 0.95);
      } else {
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? r * 0.45 : r;
          g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr);
        }
      }
      g.closePath();
      g.fill();
      // a dark band along the top, so up and down can be told apart
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 0, w, Math.round(h * 0.06));
      const blob = await new Promise((resolve) => c.toBlob(resolve, mime, 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      res.push({ name, mimeType: mime, b64: btoa(bin) });
    }
    return res;
  }, list);
  return out.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.b64, 'base64') }));
}

// The colour in the middle of the top-left part of each polaroid's photo window in the wall's atlas
// (the test pictures' background shows there, round the white shape).
async function wallColours(page) {
  return page.evaluate(() => {
    const pw = window.__c9.photoWall;
    const { canvas } = pw.art.atlas;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0);
    return pw.art.layout.cells.map((cell) => {
      const p = cell.photo;
      const d = g.getImageData(Math.round(p.x + p.w * 0.2), Math.round(p.y + p.h * 0.3), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  });
}

async function until(page, fn, arg, ms = 15000) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
    return true;
  } catch (err) {
    return false;
  }
}

// How the card on screen sits on the page: inside the space between the bars, and how big its
// words look once a long note has shrunk to fit.
async function cardLook(page) {
  return page.evaluate(() => {
    const fig = document.querySelector('.c9pv-slide:last-child');
    const card = fig && fig.querySelector('.c9pv-card');
    const stage = document.querySelector('.c9pv-stage');
    if (!card || !stage) return null;
    const c = card.getBoundingClientRect();
    const r = stage.getBoundingClientRect();
    const words = card.querySelector('.c9pv-note-text, .c9pv-bday-line');
    const m = /scale\(([\d.]+)\)/.exec(fig.style.transform || '');
    const k = m ? Number(m[1]) : 1;
    const next = document.querySelector('.c9pv-next');
    return {
      fits: c.top >= r.top - 4 && c.bottom <= r.bottom + 4 && c.left >= -1 && c.right <= window.innerWidth + 1,
      px: words ? Math.round(parseFloat(getComputedStyle(words).fontSize) * k * 10) / 10 : 0,
      k,
      arrows: next ? getComputedStyle(next).visibility : 'none',
    };
  });
}

// A tap at a person's pace: the game's buttons drop a second tap on the same spot within 0.4 s (the
// ghost of a double tap), which back-to-back scripted clicks can be.
async function tap(locator) {
  await locator.click();
  await locator.page().waitForTimeout(450);
}

// A screenshot of the moment, without the arrival's title, toasts and hint in front of the wall.
const IN_FRONT = '.c9-toasts, .c9-big, .c9-hint';
async function shot(page, name, wait = 300) {
  if (!SHOTS) return;
  await page.waitForTimeout(wait);
  await page.evaluate((sel) => {
    window.__c9.hud.hideHint();
    for (const n of document.querySelectorAll(sel)) n.style.visibility = 'hidden';
  }, IN_FRONT);
  await page.screenshot({ path: path.join(SHOTS, 'photowall-' + name + '.png') });
  await page.evaluate((sel) => {
    for (const n of document.querySelectorAll(sel)) n.style.visibility = '';
  }, IN_FRONT);
}

// Stand her on the patio looking at the wall, the camera behind her.
async function lookAtWall(page, back = 0) {
  await page.evaluate((back) => {
    const w = window.__c9;
    const t = w.photoWall.plan.travel;
    const x = t.x - Math.sin(t.facing) * back;
    const z = t.z - Math.cos(t.facing) * back;
    w.teleport(x, z, t.facing);
    w.rig.snapBehind(t.facing);
    w.hud.hideHint();
  }, back);
  await page.waitForTimeout(900);
}

// ------------------------------------------------------------------------------------------ the run

(async () => {
  const { validateGift, encodeGift } = await import(path.join(__dirname, '..', 'js', 'core', 'gift.js'));
  const gift = validateGift({
    v: 1,
    to: 'Zuzu',
    from: 'Uncle Wobble',
    notes: [
      { from: 'Grandma Fizzle', text: 'Happy birthday, superstar flyer! We love every photo of you.' },
      { from: 'Mom', text: LONG_NOTE },
    ],
    friends: ['Pip', 'Grandpa Zork'],
    petNames: { husky: 'Biscuit' },
  }).gift;
  const hash = '#gift=' + encodeGift(gift);
  const browser = await chromium.launch({ args: ARGS });
  const log = { http: [], ws: [], wsFrames: [] };
  const errors = [];

  // ---------------------------------------------------------------- one phone: add, reload, look, slideshow, remove
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // count the "please keep this site's data" asks (navigator.storage.persist)
  await ctx.addInitScript(() => {
    window.__persistAsks = 0;
    const sm = navigator.storage;
    if (sm && typeof sm.persist === 'function') {
      const persist = sm.persist.bind(sm);
      sm.persist = () => {
        window.__persistAsks++;
        return persist();
      };
    }
  });
  const page = await ctx.newPage();
  watch(page, log, errors);
  await page.goto(BASE + 'index.html?solo=1&noaudio=1' + hash);
  await ready(page);
  const first = await page.evaluate(() => ({ count: window.__c9.photoWall.count, title: window.__c9.photoWall.title, persistent: window.__c9.photoWall.persistent }));
  check(first.count === 0, 'a new device: the wall has no photos (' + first.count + ')');
  check(first.title === "Zuzu's Favorite People", 'the banner wears her name from the gift link: ' + first.title);
  check(first.persistent, 'IndexedDB keeps the photos here (persistent)');
  await lookAtWall(page);
  const label = await page.locator('.c9-use').innerText().catch(() => '');
  check(/Add photos/.test(label), 'the prompt by the empty wall says "Add photos" (' + label.replace(/\s+/g, ' ').trim() + ')');
  await shot(page, 'empty');

  // the manager, from the prompt
  await page.locator('.c9-use').click({ force: true });
  check(await until(page, () => !!document.querySelector('.c9pw') && window.__c9.photoWall.phase === 'manager'), 'the prompt opens the manager');
  const privacy = await page.locator('.c9pw-privacy').innerText().catch(() => '');
  check(/stay on this device/.test(privacy) && /never uploaded/.test(privacy) && /no one in a room/.test(privacy), 'the manager says photos stay on this device, never uploaded, not seen in rooms');
  const chips = await page.locator('.c9pw-chip').allInnerTexts();
  check(['Me', 'Zuzu', 'Pip', 'Grandpa Zork', 'Biscuit'].every((n) => chips.includes(n)), 'name chips from the gift link: ' + chips.join(', '));

  // three test pictures through the file input
  const files = await makePictures(page);
  await page.locator('.c9pw-file').setInputFiles(files);
  const progressSeen = await until(page, () => /Adding \d of 3/.test(document.querySelector('.c9pw-status').textContent), null, 8000);
  check(progressSeen, 'adding shows progress ("Adding 1 of 3...")');
  check(await until(page, () => window.__c9.photoWall.count === 3, null, 30000), 'three photos on the wall');
  check(await until(page, () => window.__c9.photoWall.painted && window.__c9.photoWall.slots.filter((s) => s !== 'empty').length === 3, null, 15000), 'the wall painted all three');
  let cols = await wallColours(page);
  const want = PICTURES.map((p) => rgb(p[4]));
  check(near(cols[0], want[0]) && near(cols[1], want[1]) && near(cols[2], want[2]), 'the wall shows them in order (atlas colours ' + JSON.stringify(cols.slice(0, 3)) + ')');
  check(!near(cols[3], want[0]) && !near(cols[3], want[1]) && !near(cols[3], want[2]), 'the frames after them still show placeholders');
  const stored = await page.evaluate(async () => {
    const s = window.__c9.photoWall.store;
    const list = s.list();
    const full = await s.bytes(list[0].id, 'full');
    const small = await s.bytes(list[0].id, 'small');
    const head = new Uint8Array(full.buffer.slice(0, 4));
    // a JPEG made by the canvas: starts FF D8, and no EXIF (APP1 "Exif") block anywhere in it
    const bytes = new Uint8Array(full.buffer);
    let exif = false;
    for (let i = 0; i < Math.min(bytes.length - 4, 4096); i++) if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x66) exif = true;
    return { w: list[0].w, h: list[0].h, type: full.type, jpeg: head[0] === 0xff && head[1] === 0xd8, exif, small: [small.w, small.h], isBuffer: full.buffer instanceof ArrayBuffer };
  });
  check(stored.jpeg && stored.type === 'image/jpeg' && stored.isBuffer, 'kept as a JPEG in an ArrayBuffer');
  check(Math.max(stored.w, stored.h) === 1600 && Math.max(stored.small[0], stored.small[1]) === 640, 'resized to 1600 px (and a 640 px copy): ' + stored.w + 'x' + stored.h);
  check(!stored.exif, 'no EXIF block in the saved photo');
  check(await page.evaluate(() => window.__persistAsks >= 1), 'the first photo asks the browser to keep the site\'s data (navigator.storage.persist)');
  // a photo this browser can't open (an iPhone HEIC on a computer), and one far too big
  const heic = Buffer.alloc(4096);
  heic.write('....ftypheic', 0, 'latin1');
  await page.locator('.c9pw-file').setInputFiles([{ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic }]);
  check(await until(page, () => /didn't open here\. Try a JPG or PNG/.test(document.querySelector('.c9pw-status').textContent), null, 10000),
    'a photo that won\'t open: "That photo didn\'t open here. Try a JPG or PNG."');
  await page.locator('.c9pw-file').setInputFiles([{ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(41 * 1024 * 1024) }]);
  check(await until(page, () => /too big to add/.test(document.querySelector('.c9pw-status').textContent), null, 20000), 'a file over 40 MB is skipped kindly');
  check(await page.evaluate(() => window.__c9.photoWall.count === 3), 'and neither went on the wall');

  // a caption with the name chips, one typed
  await tap(page.locator('.c9pw-tile').nth(0));
  await tap(page.locator('.c9pw-chip', { hasText: /^Me$/ }));
  await tap(page.locator('.c9pw-chip', { hasText: /^Pip$/ }));
  await tap(page.locator('.c9pw-tile').nth(1));
  await page.locator('.c9pw-cap').fill(CAPTION_B);
  await page.locator('.c9pw-cap').press('Enter');
  await page.waitForTimeout(600);
  let caps = await page.evaluate(() => window.__c9.photoWall.store.list().map((p) => p.caption));
  check(caps[0] === CAPTION_A, 'two chips make the caption "' + CAPTION_A + '" (' + caps[0] + ')');
  check(caps[1] === CAPTION_B, 'a typed caption is kept (' + caps[1] + ')');
  // the third one becomes the star, then moves: Earlier / Later
  await tap(page.locator('.c9pw-tile').nth(2));
  await tap(page.locator('.c9pw-tool-star'));
  await page.waitForTimeout(300);
  let order = await page.evaluate(() => window.__c9.photoWall.store.list().map((p) => p.caption || '-'));
  check(order.join('|') === ['-', CAPTION_A, CAPTION_B].join('|'), 'Make it the star puts it first (' + order.join(', ') + ')');
  await tap(page.locator('.c9pw-tile').nth(1));
  await tap(page.locator('.c9pw-tool-later'));
  await page.waitForTimeout(300);
  order = await page.evaluate(() => window.__c9.photoWall.store.list().map((p) => p.caption || '-'));
  check(order.join('|') === ['-', CAPTION_B, CAPTION_A].join('|'), 'Later moves it one along (' + order.join(', ') + ')');
  await tap(page.locator('.c9pw-tool').first()); // Earlier: back where it was
  await page.waitForTimeout(300);
  await tap(page.locator('.c9pw-tile').nth(0));
  check(await until(page, () => window.__c9.photoWall.painted, null, 15000), 'the wall repaints after the changes');
  cols = await wallColours(page);
  check(near(cols[0], want[2]) && near(cols[1], want[0]) && near(cols[2], want[1]), 'the star is in the middle of the heart now');
  await page.evaluate(() => {
    document.querySelector('.c9pw-body').scrollTop = 0;
  });
  await shot(page, 'manager', 500);
  await page.evaluate(() => document.querySelector('.c9pw-edit').scrollIntoView({ block: 'center' }));
  await shot(page, 'manager-caption', 400);

  // close, look at it
  await tap(page.locator('.c9pw-done'));
  check(await until(page, () => !window.__c9.photoWall.active && !document.querySelector('.c9pw'), null, 4000), 'Done closes the manager');
  await lookAtWall(page);
  const label2 = await page.locator('.c9-use').innerText().catch(() => '');
  check(/Look at the photos/.test(label2), 'with photos the prompt says "Look at the photos" (' + label2.replace(/\s+/g, ' ').trim() + ')');
  await shot(page, 'wall');
  await lookAtWall(page, -3.2);
  await shot(page, 'wall-close');

  // the phone budget for the whole scene (220 draw calls, 160k triangles): at the wall and from the plaza
  const budget = async (name, place) => {
    await page.evaluate((place) => {
      const w = window.__c9;
      const P = w.photoWall.plan;
      let x;
      let z;
      if (place === 'wall') {
        x = P.travel.x;
        z = P.travel.z;
      } else if (place === 'plaza') {
        x = 0;
        z = 2;
      } else {
        x = P.x - Math.sin(P.facing) * 9;
        z = P.z - Math.cos(P.facing) * 9;
      }
      const f = place === 'behind' ? P.facing : Math.atan2(P.x - x, P.z - z);
      w.teleport(x, z, f);
      w.rig.snapBehind(f);
    }, place);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const i = window.__c9.renderer.info.render;
      return { calls: i.calls, tris: i.triangles };
    });
    check(r.calls <= 220 && r.tris <= 160000, 'budget ' + name + ': ' + r.calls + ' draw calls, ' + r.tris + ' triangles');
    return r;
  };
  await budget('at the wall', 'wall');
  await budget('from the plaza, looking at the wall', 'plaza');
  await budget('behind the wall, looking at the plaza', 'behind');


  // the menu's Go to takes her there, onto the patio, looking at the heart
  await page.evaluate(() => {
    const w = window.__c9;
    w.teleport(0, 6, 0);
    w.openPauseMenu();
  });
  const goto = page.locator('.c9-place', { hasText: 'Photo wall' });
  check(await goto.count() === 1, 'the menu\'s Go to has a Photo wall');
  await goto.scrollIntoViewIfNeeded();
  await shot(page, 'goto', 300);
  await goto.click();
  const there = await until(page, () => {
    const w = window.__c9;
    const t = w.photoWall.plan.travel;
    return Math.hypot(w.player.position.x - t.x, w.player.position.z - t.z) < 0.6 && !w.hud.panelOpen;
  }, null, 6000);
  check(there, 'Go to: Photo wall puts her on its patio');

  // ---------------------------------------------------------------- reload: still there; the surprise nudge
  await page.goto(BASE + 'index.html?solo=1&noaudio=1');
  await ready(page);
  const again = await page.evaluate(() => ({ count: window.__c9.photoWall.count, caps: window.__c9.photoWall.store.list().map((p) => p.caption || '-') }));
  check(again.count === 3, 'after a reload the photos are still here (' + again.count + ')');
  check(again.caps.join('|') === ['-', CAPTION_A, CAPTION_B].join('|'), 'with their captions and order (' + again.caps.join(', ') + ')');
  check(await until(page, () => window.__c9.photoWall.painted && window.__c9.photoWall.slots.filter((s) => s !== 'empty').length === 3, null, 15000), 'and the wall paints them again');
  cols = await wallColours(page);
  check(near(cols[0], want[2]) && near(cols[1], want[0]) && near(cols[2], want[1]), 'in the same places');
  check(await page.evaluate(() => window.__c9.photoWall.glowing && window.__c9.beacons.glowing.includes('photoWall')), 'new photos from an earlier visit: the wall\'s beacon glows');
  const nudged = await until(page, () => [...document.querySelectorAll('.c9-toast')].some((t) => /photo wall has new photos/.test(t.textContent)), null, 20000);
  check(nudged, 'and a toast says "Your photo wall has new photos!"');

  // the phone takes the 3D view away (iOS does, in the background) and gives it back: the wall
  // still shows the photos, from the atlas canvas it kept
  await lookAtWall(page, -1.2);
  const starColour = () => page.evaluate(() => {
    const w = window.__c9;
    const THREE = w.THREE;
    const p = w.photoWall.art.slotWorld(0).project(w.camera);
    const W = w.renderer.domElement.width;
    const H = w.renderer.domElement.height;
    const rt = new THREE.WebGLRenderTarget(W, H);
    w.renderer.setRenderTarget(rt);
    w.renderer.render(w.scene, w.camera);
    const buf = new Uint8Array(4);
    // a little left of the photo's middle (the star shape there is white), in render target pixels
    w.renderer.readRenderTargetPixels(rt, Math.round((p.x * 0.5 + 0.5) * W - W * 0.035), Math.round((p.y * 0.5 + 0.5) * H), 1, 1, buf);
    w.renderer.setRenderTarget(null);
    rt.dispose();
    return [buf[0], buf[1], buf[2]];
  });
  const beforeLoss = await starColour();
  check(near(beforeLoss, want[2], 60), 'the star photo shows on the wall in 3D (' + beforeLoss + ')');
  await page.evaluate(() => {
    const ext = window.__c9.renderer.getContext().getExtension('WEBGL_lose_context');
    window.__lose = ext;
    ext.loseContext();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__lose.restoreContext());
  check(await until(page, () => window.__c9.engine.running, null, 8000), 'the 3D view comes back');
  await page.waitForTimeout(1200);
  const afterLoss = await starColour();
  check(near(afterLoss, want[2], 60), 'and the photos are still on the wall (' + afterLoss + ')');

  // tapping a polaroid on the wall opens the viewer at that photo (and that counts as looking)
  await lookAtWall(page, -1.2);
  const spot = await page.evaluate(() => {
    const w = window.__c9;
    const p = w.photoWall.art.slotWorld(1).project(w.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  });
  await page.mouse.click(spot.x, spot.y);
  check(await until(page, () => window.__c9.photoWall.phase === 'viewer', null, 8000), 'tapping a polaroid on the wall opens the viewer');
  const tappedAt = await page.evaluate(() => window.__c9.photoWall.ui && window.__c9.photoWall.ui.index);
  check(tappedAt === 1, 'at the photo that was tapped (' + tappedAt + ')');
  check(await page.evaluate(() => !window.__c9.photoWall.glowing && !window.__c9.beacons.glowing.includes('photoWall')), 'looking at them stops the glow');
  await page.keyboard.press('Escape');
  await until(page, () => !window.__c9.photoWall.active, null, 4000);

  // ---------------------------------------------------------------- the viewer
  await lookAtWall(page);
  await page.locator('.c9-use').click({ force: true });
  check(await until(page, () => window.__c9.photoWall.phase === 'viewer' && !!document.querySelector('.c9pv .c9pv-img'), null, 8000), '"Look at the photos" opens the viewer');
  check(await until(page, () => {
    const img = document.querySelector('.c9pv-slide:last-child .c9pv-img');
    return img && img.complete && img.naturalWidth > 0;
  }, null, 8000), 'the photo shows, uncropped, from the saved copy');
  const at = () => page.evaluate(() => {
    const v = window.__c9.photoWall.ui;
    return v ? { i: v.index, kind: v.slide && v.slide.kind, cap: v.slide && v.slide.caption } : null;
  });
  let v = await at();
  check(v && v.i === 0 && v.kind === 'photo', 'it starts on the star photo');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  v = await at();
  check(v && v.i === 1 && v.cap === CAPTION_A, 'the right arrow key goes to the next one (' + (v && v.cap) + ')');
  await shot(page, 'viewer', 400);
  // a swipe to the left
  const box = await page.locator('.c9pv-stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  v = await at();
  check(v && v.i === 2 && v.cap === CAPTION_B, 'a swipe goes on to the next (' + (v && v.cap) + ')');
  await tap(page.locator('.c9pv-prev'));
  await page.waitForTimeout(400);
  v = await at();
  check(v && v.i === 1, 'tapping the left edge\'s arrow goes back');
  // a tap anywhere near the right edge of the page (not on the arrow) turns it on
  await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.2);
  await page.waitForTimeout(500);
  v = await at();
  check(v && v.i === 2, 'a tap near the right edge goes on');
  await page.mouse.click(box.x + box.width * 0.06, box.y + box.height * 0.8);
  await page.waitForTimeout(500);
  v = await at();
  check(v && v.i === 1, 'and near the left edge, back');

  // the slideshow, with the family's notes as cards
  await tap(page.locator('.c9pv-play'));
  check(await until(page, () => window.__c9.photoWall.ui && window.__c9.photoWall.ui.playing, null, 3000), 'Play slideshow starts it');
  const slides = await page.evaluate(() => window.__c9.photoWall.ui.slides.map((s) => s.kind));
  check(slides.filter((k) => k === 'note').length === 2 && slides.filter((k) => k === 'photo').length === 3, 'the notes come in between the photos: ' + slides.join(', '));
  const noteShown = await until(page, () => !!document.querySelector('.c9pv-slide.c9pv-note:last-child .c9pv-note-from'), null, 20000);
  check(noteShown, 'a note card comes up in the slideshow');
  const noteText = await page.locator('.c9pv-slide.c9pv-note').last().innerText().catch(() => '');
  check(/From Grandma Fizzle/.test(noteText) || /From Mom/.test(noteText), 'signed "From ..." (' + noteText.replace(/\s+/g, ' ').trim().slice(0, 60) + ')');
  const noteLook = await cardLook(page);
  check(noteLook && noteLook.fits && noteLook.arrows === 'hidden', 'the note card fits the page and the arrows step aside for it (' + (noteLook && noteLook.arrows) + ')');
  await shot(page, 'note', 1400);
  await page.keyboard.press('Escape');
  check(await until(page, () => !window.__c9.photoWall.active && !document.querySelector('.c9pv'), null, 4000), 'Escape closes the viewer, back to the island');
  check(await page.evaluate(() => window.__c9.mode === 'play' && !window.__c9.player.controller && !window.__c9.input.suspended), 'she can walk again');
  check(await page.evaluate(() => !window.__c9.hud.panelOpen && !window.__c9.hud.isModalOpen()), 'and Escape did not open the menu behind it');

  // ---------------------------------------------------------------- on her birthday the slideshow ends on a card
  await page.evaluate(() => {
    window.__c9.birthday = Object.assign({}, window.__c9.birthday, { isBirthday: true, name: 'Zuzu' });
  });
  await page.evaluate(() => window.__c9.photoWall.openViewer(0, { slideshow: true }));
  check(await until(page, () => window.__c9.photoWall.ui && window.__c9.photoWall.ui.playing, null, 5000), 'the slideshow plays again');
  const bday = await page.evaluate(() => {
    const s = window.__c9.photoWall.ui.slides;
    return s.length && s[s.length - 1].kind === 'birthday' ? s[s.length - 1].name : null;
  });
  check(bday === 'Zuzu', 'on her birthday it ends on a birthday card');
  await page.evaluate(() => window.__c9.photoWall.ui.go(window.__c9.photoWall.ui.slides.length - 1));
  await page.waitForTimeout(500);
  const bdayText = await page.locator('.c9pv-birthday').last().innerText().catch(() => '');
  check(/Happy Birthday, Zuzu!/.test(bdayText), 'the card says Happy Birthday, Zuzu!');
  await shot(page, 'birthday', 600);
  await page.evaluate(() => window.__c9.photoWall.ui.stop());
  await page.waitForTimeout(500);
  const bdayLook = await cardLook(page);
  check(bdayLook && bdayLook.fits && bdayLook.arrows === 'hidden', 'paused on the birthday card, it fits and the arrows stay out of its way');
  await page.evaluate(() => window.__c9.photoWall.ui.next());
  await page.waitForTimeout(600);
  const backTo = await cardLook(page);
  check(backTo && backTo.arrows === 'visible', 'on a photo again, the arrows come back');
  // a game starting closes it, like the photo booth
  await page.evaluate(() => window.__c9.hostStartGame('freezeTag'));
  check(await until(page, () => !window.__c9.photoWall.active && !document.querySelector('.c9pv'), null, 6000), 'a game starting closes the viewer (like the photo booth)');
  await page.evaluate(() => window.__c9.play && window.__c9.play.end && window.__c9.play.end());
  await page.waitForTimeout(1500);

  // ---------------------------------------------------------------- remove one (after a check)
  await page.evaluate(() => window.__c9.photoWall.openManager());
  check(await until(page, () => window.__c9.photoWall.phase === 'manager' && !!document.querySelector('.c9pw-tile'), null, 8000), 'the manager opens again');
  await tap(page.locator('.c9pw-tile').nth(2));
  await tap(page.locator('.c9pw-tool-remove'));
  const ask = await page.locator('.c9pw-confirm').first().innerText().catch(() => '');
  check(/camera roll/.test(ask), 'Remove asks first: "It stays in your camera roll."');
  await tap(page.locator('.c9pw-yes').first());
  check(await until(page, () => window.__c9.photoWall.count === 2, null, 5000), 'one photo removed (2 left)');
  check(await until(page, () => window.__c9.photoWall.painted && window.__c9.photoWall.slots[2] === 'empty', null, 10000), 'its frame on the wall is empty again');

  // ---------------------------------------------------------------- the phone on its side
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1200);
  const fits = await page.evaluate(() => {
    const s = document.querySelector('.c9pw-sheet').getBoundingClientRect();
    return { right: s.right <= window.innerWidth + 1, left: s.left > window.innerWidth * 0.3, h: s.height };
  });
  check(fits.right && fits.left, 'sideways, the manager is a panel on the right with the wall beside it');
  await shot(page, 'landscape', 900);
  await tap(page.locator('.c9pw-look'));
  check(await until(page, () => window.__c9.photoWall.phase === 'viewer', null, 4000), 'and the viewer opens sideways too');
  await page.waitForTimeout(700);
  const inView = await page.evaluate(() => {
    const c = document.querySelector('.c9pv-slide:last-child .c9pv-card').getBoundingClientRect();
    return c.top >= 0 && c.bottom <= window.innerHeight && c.left >= 0 && c.right <= window.innerWidth;
  });
  check(inView, 'the photo fits the screen sideways');
  await shot(page, 'landscape-viewer', 500);
  await page.evaluate(() => window.__c9.photoWall.ui.play());
  const longAt = await page.evaluate(() => window.__c9.photoWall.ui.slides.findIndex((x) => x.kind === 'note' && x.text.length > 200));
  await page.evaluate((i) => window.__c9.photoWall.ui.go(i), longAt);
  await page.waitForTimeout(700);
  const longLook = await cardLook(page);
  check(longAt > 0 && longLook && longLook.fits && longLook.px >= 15.9, 'sideways, the longest note shrinks to fit the page, its words still ' + (longLook && longLook.px) + ' px (x' + (longLook && longLook.k) + ')');
  await shot(page, 'landscape-note', 300);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() => window.__c9.renderer.info.render);
  void sizes;
  await ctx.close();

  // ---------------------------------------------------------------- a full wall: twelve stand-in photos, captioned
  if (SHOTS) {
    const full = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const fp = await full.newPage();
    const errFull = [];
    watch(fp, log, errFull);
    await fp.goto(BASE + 'index.html?solo=1&noaudio=1' + hash);
    await ready(fp);
    await fp.evaluate(() => window.__c9.photoWall.openManager());
    await until(fp, () => window.__c9.photoWall.phase === 'manager', null, 8000);
    const hues = ['#ff7eb6', '#7ec8ff', '#ffd36e', '#b49cff', '#6fd6b0', '#ff9f7e', '#8fd3ff', '#ffb3e0', '#c9e86f', '#ffa8c5', '#9fb6ff', '#ffcf8a'];
    const shapes = ['heart', 'star', 'circle', 'triangle'];
    const twelve = hues.map((bg, i) => ['standin-' + (i + 1) + '.jpg', 'image/jpeg', i % 3 === 1 ? 1600 : 1200, i % 3 === 1 ? 1000 : 1600, bg, shapes[i % 4]]);
    await fp.locator('.c9pw-file').setInputFiles(await makePictures(fp, twelve));
    const filled = await until(fp, () => window.__c9.photoWall.count === 12 && window.__c9.photoWall.painted, null, 60000);
    check(filled, 'a full wall: twelve stand-in photos');
    const captions = ['Me & Pip', 'Grandpa Zork', 'Beach day', 'Me, Zuzu & Biscuit', 'Family', 'Competition day', 'Pip', 'Friends', 'Biscuit', 'Hit zero!', 'Me & Grandpa Zork', 'Sleepover'];
    await fp.evaluate(async (caps) => {
      const s = window.__c9.photoWall.store;
      const list = s.list();
      for (let i = 0; i < list.length; i++) await s.setCaption(list[i].id, caps[i]);
    }, captions);
    await fp.locator('.c9pw-x').click();
    await until(fp, () => window.__c9.photoWall.painted && !window.__c9.photoWall.active, null, 20000);
    await lookAtWall(fp);
    await shot(fp, 'wall-full', 600);
    await lookAtWall(fp, -2.6);
    await shot(fp, 'wall-full-close', 600);
    check(errFull.length === 0, 'no page errors with a full wall' + (errFull.length ? '\n    ' + errFull.slice(0, 4).join('\n    ') : ''));
    await full.close();
  }

  // ---------------------------------------------------------------- a browser that keeps nothing (no IndexedDB)
  const bare = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await bare.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });
  const bp = await bare.newPage();
  const errBare = [];
  watch(bp, log, errBare);
  await bp.goto(BASE + 'index.html?solo=1&noaudio=1');
  await ready(bp);
  check(await bp.evaluate(() => window.__c9.photoWall.persistent === false), 'no IndexedDB: the photos live in memory');
  await bp.evaluate(() => window.__c9.photoWall.openManager());
  await until(bp, () => window.__c9.photoWall.phase === 'manager', null, 8000);
  const note = await bp.locator('.c9pw-note').innerText().catch(() => '');
  check(/won't keep photos after it closes/.test(note), 'and the card says so gently: "' + note + '"');
  await bp.locator('.c9pw-file').setInputFiles(await makePictures(bp, PICTURES.slice(2)));
  check(await until(bp, () => window.__c9.photoWall.count === 1 && window.__c9.photoWall.painted, null, 20000), 'a photo still goes on the wall for now');
  check(errBare.length === 0, 'no page errors without IndexedDB' + (errBare.length ? '\n    ' + errBare.slice(0, 4).join('\n    ') : ''));
  await bare.close();

  // ---------------------------------------------------------------- a room of two: nothing about the photos goes over
  const room = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // every room message either tab posts or hears, as the transport sees it
  await room.addInitScript(() => {
    window.__bc = [];
    const BC = window.BroadcastChannel;
    if (!BC) return;
    const describe = (data) => {
      let binary = false;
      const seen = new Set();
      const walk = (v, depth) => {
        if (!v || typeof v !== 'object' || depth > 12 || seen.has(v)) return;
        seen.add(v);
        if (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (typeof Blob !== 'undefined' && v instanceof Blob)) {
          binary = true;
          return;
        }
        for (const k of Object.keys(v)) walk(v[k], depth + 1);
      };
      walk(data, 0);
      let text = '';
      try {
        text = JSON.stringify(data);
      } catch (err) {
        text = String(data);
      }
      return { binary, text };
    };
    const post = BC.prototype.postMessage;
    BC.prototype.postMessage = function (data) {
      window.__bc.push(Object.assign({ dir: 'out', channel: this.name }, describe(data)));
      return post.call(this, data);
    };
    const add = BC.prototype.addEventListener;
    BC.prototype.addEventListener = function (type, fn, o) {
      if (type === 'message') {
        const self = this;
        return add.call(this, type, function (e) {
          window.__bc.push(Object.assign({ dir: 'in', channel: self.name }, describe(e.data)));
          return fn.call(this, e);
        }, o);
      }
      return add.call(this, type, fn, o);
    };
    const desc = Object.getOwnPropertyDescriptor(BC.prototype, 'onmessage');
    if (desc && desc.set) {
      Object.defineProperty(BC.prototype, 'onmessage', {
        configurable: true,
        get: desc.get,
        set(fn) {
          const self = this;
          desc.set.call(this, fn ? (e) => {
            window.__bc.push(Object.assign({ dir: 'in', channel: self.name }, describe(e.data)));
            return fn(e);
          } : fn);
        },
      });
    }
  });
  const AB = 'BCDFGHJKLMNPQRSTVWXZ2346789';
  const code = 'PW' + AB[Math.floor(Math.random() * AB.length)] + AB[Math.floor(Math.random() * AB.length)];
  const tabA = await room.newPage();
  const errA = [];
  watch(tabA, log, errA);
  await tabA.goto(BASE + 'index.html?room=' + code + '&nick=Ava&noaudio=1');
  await ready(tabA);
  const tabB = await room.newPage();
  // the friend's tab keeps its photos in a database of its own, as her own phone would
  await tabB.addInitScript(() => {
    const idb = window.indexedDB;
    if (!idb) return;
    const open = idb.open.bind(idb);
    idb.open = (name, version) => open(name === 'c9-photos' ? 'c9-photos-friend' : name, version);
  });
  const errB = [];
  watch(tabB, log, errB);
  await tabB.goto(BASE + 'index.html?room=' + code + '&nick=Bea&noaudio=1');
  await ready(tabB);
  const inRoom = await until(tabA, () => window.__c9.net.players.size === 2, null, 15000) && await until(tabB, () => window.__c9.net.players.size === 2, null, 15000);
  check(inRoom, 'room: two friends in one room (' + code + ')');
  // the host adds two photos and captions one, standing at the wall in front of her friend
  await tabA.evaluate(() => window.__c9.photoWall.openManager());
  await until(tabA, () => window.__c9.photoWall.phase === 'manager', null, 8000);
  const roomFiles = await makePictures(tabA, PICTURES.slice(0, 2));
  await tabA.locator('.c9pw-file').setInputFiles(roomFiles);
  check(await until(tabA, () => window.__c9.photoWall.count === 2, null, 30000), 'room: the host adds two photos');
  await tap(tabA.locator('.c9pw-tile').nth(0));
  await tap(tabA.locator('.c9pw-chip', { hasText: /^Me$/ }));
  await tap(tabA.locator('.c9pw-chip', { hasText: /^Mom$/ }));
  await tabA.waitForTimeout(400);
  await tap(tabA.locator('.c9pw-look'));
  await tabA.waitForTimeout(600);
  await tabA.keyboard.press('Escape');
  // the friend walks up to the wall too; a few seconds of room traffic
  await lookAtWall(tabB);
  await tabB.waitForTimeout(4000);
  const friend = await tabB.evaluate(() => ({ count: window.__c9.photoWall.count, slots: window.__c9.photoWall.slots, painted: window.__c9.photoWall.painted }));
  const host = await tabA.evaluate(() => ({ count: window.__c9.photoWall.count, cap: window.__c9.photoWall.store.list()[0].caption }));
  check(host.count === 2 && host.cap === CAPTION_ROOM, 'room: the host\'s wall has her 2 photos (' + host.cap + ')');
  check(friend.count === 0 && friend.slots.every((s) => s === 'empty'), 'room: the friend\'s wall has 0 photos, only empty frames');
  if (SHOTS) {
    await tabB.screenshot({ path: path.join(SHOTS, 'photowall-room-friend.png') });
  }
  const msgs = [...await tabA.evaluate(() => window.__bc), ...await tabB.evaluate(() => window.__bc)];
  check(msgs.length > 20, 'room: the room really talked (' + msgs.length + ' messages seen)');
  const IMAGE = /data:image|blob:|\/9j\/|iVBORw0KGgo|image\/jpeg|image\/png/;
  const PHOTO_KEYS = /c9-photos|photoWall|caption|"photos?"|"count"\s*:/i;
  const leaks = msgs.filter((m) => m.binary || IMAGE.test(m.text) || m.text.includes(CAPTION_ROOM) || PHOTO_KEYS.test(m.text));
  check(leaks.length === 0, 'room: no message holds image data, a caption, a count or a photo wall key' + (leaks.length ? '\n    ' + leaks.slice(0, 3).map((m) => m.text.slice(0, 160)).join('\n    ') : ''));
  check(msgs.every((m) => m.channel === 'c9-net-v1'), 'room: every message is the room transport\'s own');
  check(errA.length === 0 && errB.length === 0, 'room: no page errors' + ([...errA, ...errB].length ? '\n    ' + [...errA, ...errB].slice(0, 6).join('\n    ') : ''));
  await room.close();

  // ---------------------------------------------------------------- the network, the whole run
  const origin = new URL(BASE).origin;
  const nonGet = log.http.filter((r) => r.method !== 'GET');
  check(nonGet.length === 0, 'no request but GET in the whole run (' + log.http.length + ' requests)' + (nonGet.length ? ': ' + nonGet.slice(0, 3).map((r) => r.method + ' ' + r.url).join(', ') : ''));
  const away = log.http.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  check(away.length === 0, 'every request stays on this server' + (away.length ? ': ' + away.slice(0, 3).map((r) => r.url).join(', ') : ''));
  const heavy = log.http.filter((r) => r.body || /data:image|\/9j\/|iVBORw0KGgo/.test(r.url) || r.url.includes(encodeURIComponent(CAPTION_A)) || r.url.includes(CAPTION_B.replace(' ', '%20')));
  check(heavy.length === 0, 'no request carries a body, image data or a caption');
  const blobs = log.http.filter((r) => r.url.startsWith('blob:') || r.url.startsWith('data:'));
  check(blobs.every((r) => r.type === 'image'), 'the photos only ever load from this device into <img> (' + blobs.length + ' blob loads)');
  check(log.ws.length === 0 && log.wsFrames.length === 0, 'no WebSocket was opened');
  check(errors.length === 0, 'no page errors on the phone' + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : ''));

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
