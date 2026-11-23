// The private gift link in Chromium (through Playwright) on a 390x844 phone: open the game with a
// made-up gift, then the unwrap card, the address without the fragment, the notes in the menu, and
// the family as bot friends in a quick solo game; after a reload, no second card. Skipped when
// Playwright is not installed. Set GIFT_SHOTS=/some/dir to keep the screenshots (gift-*.png).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodeGift, validateGift } from '../js/core/gift.js';

let playwright = null;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch (err) {
  playwright = null;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.GIFT_SHOTS || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

// Made-up names only.
const GIFT = {
  v: 1,
  to: 'Zuzu',
  from: 'Uncle Wobble',
  notes: [
    { from: 'Grandpa Zork', text: 'Happy birthday, superstar flyer! We love you to the moon and back 🌙💖' },
    { from: 'Mom and Dad', text: 'Eleven looks amazing on you. Keep flying high! 🎀✨' },
  ],
  friends: ['Pip', 'Grandpa Zork', 'Mary-Kate', 'Grandma Fizzle', 'Bo', 'Tig'],
  petNames: { cloudPuppy: 'Biscuit' },
};

function serve(root) {
  const server = http.createServer((req, res) => {
    let file;
    try {
      file = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    } catch (err) {
      res.writeHead(400).end();
      return;
    }
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : null);

test('browser: a gift link on a phone: the unwrap card, a clean address, the notes and bot friends', { skip: !playwright && 'Playwright is not installed', timeout: 180000 }, async () => {
  assert.deepEqual(validateGift(GIFT).dropped, [], 'the test gift is valid');
  const server = await serve(REPO);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const context = await browser.newContext(PHONE);
    // a device that dressed up on an earlier visit, so My cheerleader doesn't open over the island
    await context.addInitScript(() => {
      try {
        if (!localStorage.getItem('c9.look.v1')) localStorage.setItem('c9.look.v1', '{}');
      } catch (err) { /* private mode */ }
    });
    const page = await context.newPage();
    const problems = [];
    const asked = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    page.on('request', (r) => asked.push(r.url()));
    await page.route('https://**', (route) => route.abort()); // nothing leaves the machine

    // ---- first open: the unwrap card, and the fragment is gone
    await page.goto(origin + '/cloud-nine/index.html?noaudio=1#gift=' + encodeGift(GIFT));
    await page.waitForFunction(() => !!window.__c9 && !!document.querySelector('.c9-gift-card'), null, { timeout: 60000, polling: 100 });
    await page.waitForTimeout(1100); // the confetti is on its way down
    const card = await page.evaluate(() => ({
      title: document.querySelector('.c9-gift-card .c9m-title').textContent,
      lines: [...document.querySelectorAll('.c9-gift-card .c9m-sub')].map((p) => p.textContent),
      button: document.querySelector('.c9-gift-card button').textContent,
      confetti: !!document.querySelector('canvas.c9-confetti'),
      href: location.href,
      hash: location.hash,
      saved: JSON.parse(localStorage.getItem('c9.gift.v1')),
      mode: document.body.dataset.mode,
      wide: document.documentElement.scrollWidth,
    }));
    await shot(page, 'gift-unwrap-phone.png');
    assert.equal(card.title, 'A gift for you, Zuzu!');
    assert.deepEqual(card.lines, ['From Uncle Wobble', 'Cloud Nine was made just for you. Happy birthday!']);
    assert.equal(card.button, 'Open it!');
    assert.equal(card.confetti, true, 'confetti falls');
    assert.equal(card.hash, '', 'no fragment left');
    assert.equal(card.href, origin + '/cloud-nine/index.html?noaudio=1', 'the address is clean');
    assert.equal(card.saved.seen, true, 'shown once');
    assert.deepEqual(card.saved.gift, validateGift(GIFT).gift, 'kept on this device');
    assert.equal(card.mode, 'title');
    assert.ok(card.wide <= 390, 'nothing wider than the phone');
    assert.ok(asked.every((u) => !u.includes('gift=')), 'the gift never went to the server');

    // ---- "Open it!" -> the title; "Play!" -> "Play by myself" -> the island
    await page.locator('.c9-gift-card button').tap();
    await page.waitForSelector('.c9m-title-screen', { timeout: 10000 });
    await page.waitForTimeout(700); // past the double-tap guard
    await page.locator('.c9m-title-screen button', { hasText: 'Play!' }).tap();
    await page.locator('button', { hasText: 'Play by myself' }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    await page.locator('button', { hasText: 'Play by myself' }).tap();
    await page.waitForFunction(() => document.body.dataset.mode === 'play' && window.__c9.session && window.__c9.session.kind === 'solo', null, { timeout: 20000 });
    await page.waitForTimeout(4500); // the arrival splash and toasts

    // ---- the notes, from the menu
    await page.locator('.c9-round-menu').tap();
    await page.locator('.c9-row-notes').waitFor({ timeout: 10000 });
    await page.locator('.c9-row-notes').tap();
    await page.locator('.c9-note-card').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const notes = await page.evaluate(() => ({
      kicker: document.querySelector('.c9-card .c9-kicker').textContent,
      title: document.querySelector('.c9-card .c9-title').textContent,
      cards: [...document.querySelectorAll('.c9-note-card')].map((n) => n.querySelector('.c9-note-text').textContent + ' | ' + n.querySelector('.c9-note-from').textContent),
    }));
    await shot(page, 'gift-notes-phone.png');
    assert.equal(notes.kicker, 'Notes from your family');
    assert.equal(notes.title, '2 notes for you!');
    assert.deepEqual(notes.cards, [
      'Happy birthday, superstar flyer! We love you to the moon and back 🌙💖 | From Grandpa Zork',
      'Eleven looks amazing on you. Keep flying high! 🎀✨ | From Mom and Dad',
    ]);
    await page.locator('.c9-card button', { hasText: 'Thank you!' }).tap();

    // ---- a quick solo game: the family are the bot friends, in order
    await page.waitForTimeout(600);
    await page.locator('.c9-round-games').tap();
    await page.locator('button', { hasText: 'Hide and seek' }).first().waitFor({ timeout: 10000 });
    await page.locator('button', { hasText: 'Hide and seek' }).first().tap();
    await page.locator('.c9-card button', { hasText: "Let's go!" }).waitFor({ timeout: 10000 });
    await page.locator('.c9-card button', { hasText: "Let's go!" }).tap();
    await page.waitForFunction(() => [...window.__c9.net.players.values()].filter((p) => p.bot).length >= 5, null, { timeout: 20000 });
    const bots = await page.evaluate(() => ({
      me: window.__c9.nick,
      nicks: [...window.__c9.net.players.values()].filter((p) => p.bot).map((p) => p.nick),
    }));
    assert.deepEqual(bots.nicks, ['Pip', 'Grandpa Zork', 'Mary Kate', 'Fizzle', 'Bo'], 'the gift\'s friends, in order (made fit for the game\'s 12-letter names)');
    assert.ok(!bots.nicks.includes(bots.me), 'never her own name');
    await page.waitForTimeout(2500);
    await shot(page, 'gift-bots-phone.png');

    // ---- a reload without the link: the touches stay, the card doesn't come back
    await page.goto(origin + '/cloud-nine/index.html?noaudio=1');
    await page.waitForFunction(() => document.body.dataset.mode === 'title' && !!window.__c9, null, { timeout: 60000, polling: 100 });
    await page.waitForTimeout(500);
    assert.equal(await page.$('.c9-gift-card'), null, 'no second unwrap card');
    assert.equal(await page.evaluate(() => window.__c9.birthday.name), 'Zuzu');
    assert.deepEqual(await page.evaluate(() => [window.__c9.petName('cloudPuppy'), window.__c9.petName('husky')]), ['Biscuit', null], 'her pet\'s name, for its label');
    assert.deepEqual(problems, [], 'no page errors and no console errors');
    assert.ok(asked.every((u) => u.startsWith(origin)), 'no requests to anywhere else');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});
