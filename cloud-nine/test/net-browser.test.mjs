// Four real browser tabs on the local transport (dev/net-lab.html in Chromium, through Playwright):
// they share a room, move, see each other converge, and pick a new host when the host's tab closes.
// Skipped when Playwright is not installed. Set NET_SHOTS=/some/dir to keep screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, C9 } from './net-kit.mjs';

let playwright = null;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch (err) {
  playwright = null;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };

function serve(root) {
  const server = http.createServer((req, res) => {
    let file;
    try {
      file = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    } catch (err) {
      res.writeHead(400).end();
      return;
    }
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

// Modules other owners build. Until they exist the net layer falls back to its own checks, and the
// browser reports the 404 as a console error; once they exist, any error fails the test.
const NEIGHBORS = ['js/art/character.js', 'js/content/names.js', 'js/content/emotes.js'].filter((p) => !fs.existsSync(path.join(C9, p)));

async function until(page, fn, arg, what, timeout = 8000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
  } catch (err) {
    throw new Error('timed out waiting for ' + what);
  }
}

test('browser: four tabs share a room, converge, and re-elect a host when the host tab closes', { skip: !playwright && 'Playwright is not installed', timeout: 90000 }, async () => {
  const server = await serve(REPO);
  const base = 'http://127.0.0.1:' + server.address().port + '/cloud-nine/dev/net-lab.html?net=local&nick=';
  const browser = await playwright.chromium.launch();
  const problems = [];
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 1 });
    const names = ['Ava', 'Bea', 'Cat', 'Dot'];
    const pages = [];
    for (const name of names) {
      const page = await context.newPage();
      page.on('pageerror', (e) => problems.push(name + ': ' + e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(name + ': ' + m.text());
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && !NEIGHBORS.some((p) => r.url().endsWith('/cloud-nine/' + p))) problems.push(name + ': ' + r.status() + ' ' + r.url());
      });
      await page.goto(base + name);
      await until(page, () => window.__lab && window.__net, null, name + ' to load');
      pages.push(page);
    }
    const [a, b, c, d] = pages;

    // Ava makes the room with the button; Bea types the code; Cat and Dot join from code.
    await a.click('#create');
    await until(a, () => window.__net.room && window.__net.room.code, null, 'a room code');
    const code = await a.evaluate(() => window.__net.room.code);
    assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ2346789]{4}$/);
    assert.equal(await a.textContent('#code'), code, 'the code is on screen');
    await b.fill('#joinCode', code.toLowerCase());
    await b.click('#join');
    await until(b, () => window.__net.room && window.__net.players.size === 2, null, 'Bea to be in');
    for (const p of [c, d]) assert.deepEqual(await p.evaluate((k) => window.__lab.join(k), code), { ok: true });
    for (const p of pages) await until(p, () => window.__net.players.size === 4, null, 'four players');

    const view = (p) => p.evaluate(() => ({ me: window.__net.me.id, ids: [...window.__net.players.keys()], nicks: [...window.__net.players.values()].map((x) => x.nick), host: window.__net.room.hostId, status: window.__net.status }));
    const views = await Promise.all(pages.map(view));
    for (const v of views) {
      assert.deepEqual(v.ids, views[0].ids, 'everyone agrees on who is here, in the same order');
      assert.equal(v.host, views[0].me, 'Ava hosts');
      assert.equal(v.status, 'online');
    }
    assert.deepEqual(views[0].nicks, names);
    assert.equal(await a.isVisible('#host'), true, 'the host badge shows');
    assert.equal(await b.isVisible('#host'), false);

    // Everyone walks with the arrow keys, at the same time.
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const before = await Promise.all(pages.map((p) => p.evaluate(() => window.__lab.me())));
    await Promise.all(pages.map((p, i) => p.keyboard.down(keys[i])));
    await new Promise((r) => setTimeout(r, 700));
    await Promise.all(pages.map((p, i) => p.keyboard.up(keys[i])));
    const after = await Promise.all(pages.map((p) => p.evaluate(() => window.__lab.me())));
    after.forEach((m, i) => {
      const moved = (m.x - before[i].x) * dirs[i][0] + (m.z - before[i].z) * dirs[i][1];
      assert.ok(moved > 1, names[i] + ' walked with the arrow key: ' + moved.toFixed(2) + ' m');
    });
    // and Dot strolls to a spot
    await d.evaluate(() => window.__lab.walkTo(7, -5));
    await until(d, () => window.__lab.me().x === 7, null, 'Dot to arrive');
    await new Promise((r) => setTimeout(r, 600));
    const truth = {};
    for (const [i, p] of pages.entries()) truth[views[i].me] = await p.evaluate(() => window.__lab.me());
    for (const p of pages) {
      const seen = await p.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, window.__net.stateOf(id)])), views[0].ids);
      for (const id of views[0].ids) {
        assert.ok(seen[id], 'a position for everyone');
        assert.ok(Math.abs(seen[id].x - truth[id].x) < 0.05 && Math.abs(seen[id].z - truth[id].z) < 0.05, 'converged: ' + JSON.stringify([seen[id], truth[id]]));
      }
    }

    // The host adds a bot; emotes go round in one order.
    await a.click('#bot');
    for (const p of pages) await until(p, () => window.__net.players.size === 5, null, 'the bot');
    await Promise.all(pages.map((p) => p.evaluate(() => window.__lab.emoteIds.slice(0, 3).forEach((id) => window.__lab.emote(id)))));
    for (const p of pages) await until(p, () => window.__lab.events.filter((e) => e.type === 'emote').length === 12, null, 'twelve emotes');
    const orders = await Promise.all(pages.map((p) => p.evaluate(() => window.__lab.events.filter((e) => e.type === 'emote').map((e) => e.from + ':' + e.data.id))));
    for (const o of orders) assert.deepEqual(o, orders[0], 'the same order in every tab');
    await a.click('#game-btn');
    for (const p of pages) await until(p, () => window.__net.game && window.__net.game.round === 1, null, 'the game state');
    if (process.env.NET_SHOTS) await c.screenshot({ path: path.join(process.env.NET_SHOTS, 'net-browser-4tabs.png') });

    // Ava's tab closes: Bea, who joined next, hosts; Ava and her bot are gone everywhere.
    await a.close();
    for (const p of [b, c, d]) await until(p, (ids) => window.__net.players.size === 3 && window.__net.room.hostId === ids[1] && !window.__net.players.has(ids[0]), views.map((v) => v.me), 're-election', 10000);
    assert.equal(await b.evaluate(() => window.__net.isHost), true);
    await until(b, () => !document.getElementById('host').hidden, null, 'the badge to move to Bea');
    // the room keeps working under the new host
    await c.evaluate(() => window.__lab.emote(window.__lab.emoteIds[0]));
    for (const p of [b, d]) await until(p, (cid) => window.__lab.events.filter((e) => e.type === 'emote' && e.from === cid).length === 4, views[2].me, 'events after the switch');
    assert.ok(await b.evaluate(() => window.__lab.addBot()), 'the new host can add bots');
    for (const p of [c, d]) await until(p, () => window.__net.players.size === 4, null, 'the new bot');
    if (process.env.NET_SHOTS) await b.screenshot({ path: path.join(process.env.NET_SHOTS, 'net-browser-rehost.png') });
    assert.deepEqual(problems, [], 'no page errors and no console errors');
  } finally {
    await browser.close();
    server.close();
  }
});

test('browser: with Google out of reach, Firebase rooms say offline fast and nothing breaks', { skip: !playwright && 'Playwright is not installed', timeout: 60000 }, async () => {
  const server = await serve(REPO);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  const problems = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    let sdkAsked = 0;
    await page.route('https://www.gstatic.com/**', (route) => {
      sdkAsked++;
      route.abort();
    });
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text());
    });
    // no network needed until online play starts
    await page.goto(origin + '/cloud-nine/dev/net-lab.html?net=firebase&nick=Ava');
    await until(page, () => window.__net, null, 'the page');
    assert.equal(sdkAsked, 0, 'the Firebase SDK is not fetched until a room is wanted');
    assert.equal(await page.evaluate(() => window.__net.mode), 'firebase');
    const t0 = Date.now();
    assert.deepEqual(await page.evaluate(() => window.__lab.join('K7QZ')), { ok: false, reason: 'offline' });
    assert.ok(Date.now() - t0 < 10000, 'no long hang');
    assert.ok(sdkAsked > 0, 'it did try to load the SDK');
    assert.equal(await page.evaluate(() => window.__lab.create().then(() => 'made', (e) => e.reason)), 'offline');
    assert.equal(await page.evaluate(() => window.__net.status), 'offline');
    assert.ok((await page.textContent('#log')).includes("Can't reach the clouds"), 'a friendly message');
    if (process.env.NET_SHOTS) await page.screenshot({ path: path.join(process.env.NET_SHOTS, 'net-browser-offline-phone.png') });
    // and on localhost, 'auto' means tabs share rooms
    const page2 = await context.newPage();
    page2.on('pageerror', (e) => problems.push(e.message));
    await page2.goto(origin + '/cloud-nine/dev/net-lab.html?nick=Bea');
    await until(page2, () => window.__net, null, 'the second page');
    assert.equal(await page2.evaluate(() => window.__net.mode), 'local');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    server.close();
  }
});
