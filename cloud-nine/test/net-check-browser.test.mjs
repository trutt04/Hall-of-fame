// index.html?check=online in Chromium (through Playwright) on a 390x844 phone: the check card
// instead of the game, as the repo is now ("not set up yet"), and with tools/fake-firebase.mjs
// standing in for Google's SDK and a test config ("all good", "rules too open"). Also: without the
// switch, the game still starts. Skipped when Playwright is not installed. Set NET_SHOTS=/some/dir
// to keep the screenshots (netcheck-*.png).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, C9, TEST_CONFIG, rulesJson } from './net-kit.mjs';
import { SDK_BASE } from '../js/net/transport-firebase.js';

let playwright = null;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch (err) {
  playwright = null;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PLACEHOLDERS = {
  apiKey: 'PASTE-API-KEY-HERE',
  authDomain: 'PASTE-PROJECT-ID.firebaseapp.com',
  databaseURL: 'https://PASTE-PROJECT-ID-default-rtdb.firebaseio.com',
  projectId: 'PASTE-PROJECT-ID',
  appId: 'PASTE-APP-ID',
};
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const read = (p) => fs.readFileSync(path.join(C9, p), 'utf8');

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

// Google's three SDK files, answered by the fake (one simulated server and device per page), and
// js/net/firebase-config.js with test values. Nothing here is a real Firebase project.
async function fakeGoogle(page, rules) {
  const files = {
    'fake-firebase.mjs': read('tools/fake-firebase.mjs'),
    'rules-engine.mjs': read('tools/rules-engine.mjs'),
    'c9-fake.js': [
      "import { createFakeFirebase } from './fake-firebase.mjs';",
      'export const fb = createFakeFirebase({ rules: ' + JSON.stringify(rules) + ', latencyMs: 20 });',
      'export const dev = fb.device();',
      'window.__fake = fb;',
    ].join('\n'),
    'firebase-app.js': "import { dev } from './c9-fake.js';\nexport const { initializeApp, deleteApp } = dev.app;",
    'firebase-auth.js': "import { dev } from './c9-fake.js';\nexport const { initializeAuth, getAuth, signInAnonymously, deleteUser, inMemoryPersistence } = dev.auth;",
    'firebase-database.js':
      "import { dev } from './c9-fake.js';\nexport const { getDatabase, ref, child, set, update, remove, push, get, query, orderByKey, startAt, endAt, limitToFirst, onValue, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, serverTimestamp, goOffline, goOnline } = dev.database;",
  };
  await page.route(SDK_BASE + '*', (route) => {
    const body = files[route.request().url().slice(SDK_BASE.length)];
    if (body === undefined) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  const config = read('js/net/firebase-config.js').replace(/export const FIREBASE_CONFIG = \{[\s\S]*?\};/, 'export const FIREBASE_CONFIG = ' + JSON.stringify(TEST_CONFIG) + ';');
  assert.ok(config.includes(TEST_CONFIG.databaseURL), 'the test config is in');
  await page.route('**/cloud-nine/js/net/firebase-config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: config }));
}

async function openCheck(browser, origin, { rules = null, shot = null } = {}) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  const problems = [];
  const asked = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('request', (r) => asked.push(r.url()));
  if (rules) await fakeGoogle(page, rules);
  else {
    // the settings as firebase/SETUP.md first hands them out (the committed file has the real project)
    await page.route('https://www.gstatic.com/**', (route) => route.abort());
    const config = read('js/net/firebase-config.js').replace(/export const FIREBASE_CONFIG = \{[\s\S]*?\};/, 'export const FIREBASE_CONFIG = ' + JSON.stringify(PLACEHOLDERS) + ';');
    assert.ok(config.includes('PASTE-API-KEY-HERE'), 'the placeholders are in');
    await page.route('**/cloud-nine/js/net/firebase-config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: config }));
  }
  await page.goto(origin + '/cloud-nine/index.html?check=online');
  try {
    await page.waitForFunction(() => {
      const r = document.querySelector('.c9nc-result');
      return r && !r.hidden && document.querySelector('.c9nc-again') && !document.querySelector('.c9nc-again').disabled;
    }, null, { timeout: 20000, polling: 50 });
  } catch (err) {
    throw new Error('the check did not finish: ' + JSON.stringify(problems));
  }
  await page.waitForTimeout(400); // the last scroll settles
  const view = await page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector('.c9nc-title').textContent,
    lines: [...document.querySelectorAll('.c9nc-line')].map((li) => ({
      id: li.dataset.id,
      state: li.dataset.state,
      name: li.querySelector('.c9nc-name').textContent,
      text: li.querySelector('.c9nc-text').textContent,
    })),
    kind: document.querySelector('.c9nc-result').dataset.kind,
    result: document.querySelector('.c9nc-result').textContent,
    back: document.querySelector('.c9nc-back').getAttribute('href'),
    gameHidden: ['scene', 'veil', 'screens'].every((id) => document.getElementById(id).hidden),
    smallest: Math.min(...[...document.querySelectorAll('.c9nc *')].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => parseFloat(getComputedStyle(n).fontSize))),
    wide: document.documentElement.scrollWidth,
    world: !!window.__c9,
  }));
  // the whole card, top to bottom, at the phone's width (it scrolls on a real phone)
  if (shot && process.env.NET_SHOTS) await page.screenshot({ path: path.join(process.env.NET_SHOTS, shot), fullPage: true });
  return { page, context, view, problems, asked };
}

const states = (view) => view.lines.map((l) => l.id + ':' + l.state).join(' ');

test('browser: ?check=online on a phone: the card, and none of the game', { skip: !playwright && 'Playwright is not installed', timeout: 90000 }, async () => {
  const server = await serve(REPO);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  try {
    // not set up yet: the PASTE-... placeholders
    const off = await openCheck(browser, origin, { shot: 'netcheck-not-set-up.png' });
    assert.deepEqual(off.problems, [], 'no page errors and no console errors');
    assert.equal(states(off.view), 'settings:fail sdk:skip signin:skip database:skip safety:skip cleanup:skip');
    assert.equal(off.view.lines[0].text, 'The game still has the PASTE-… placeholders. See step 7.');
    assert.match(off.view.result, /First thing to fix/);
    assert.match(off.view.result, /PASTE-… placeholders\. See step 7\./);
    assert.equal(off.view.heading, 'Online play check');
    assert.equal(off.view.back, './', 'a way back to the game');
    assert.equal(off.view.gameHidden, true);
    assert.equal(off.view.world, false, 'the game never started');
    assert.ok(off.view.smallest >= 16, 'no text under 16px: ' + off.view.smallest);
    assert.ok(off.view.wide <= 390, 'nothing wider than the phone');
    const loaded = off.asked.filter((u) => u.startsWith(origin)).map((u) => u.slice(origin.length).replace('/cloud-nine/', ''));
    for (const not of ['lib/three.module.min.js', 'js/main.js', 'js/world/', 'js/audio/', 'js/ui/hud.js', 'js/ui/menu.js']) {
      assert.ok(!loaded.some((u) => u.startsWith(not)), not + ' is not loaded: ' + loaded.join(' '));
    }
    assert.ok(!off.asked.some((u) => u.includes('gstatic')), 'no request to Google while the settings are placeholders');
    assert.ok(loaded.includes('js/net/check.js') && loaded.includes('css/netcheck.css'));
    await off.context.close();

    // set up right (the fake SDK, the real rules): every line passes, and the fake database is empty after
    const good = await openCheck(browser, origin, { rules: rulesJson(), shot: 'netcheck-all-good.png' });
    assert.deepEqual(good.problems, []);
    assert.equal(states(good.view), 'settings:pass sdk:pass signin:pass database:pass safety:pass cleanup:pass');
    assert.equal(good.view.kind, 'ok');
    assert.match(good.view.result, /Online play is ready!/);
    assert.match(good.view.result, /Make a room on one device and join it from another\./);
    assert.ok(good.asked.some((u) => u === SDK_BASE + 'firebase-database.js'), 'the SDK came from the pinned address');
    assert.equal(await good.page.evaluate(() => JSON.stringify(window.__fake.data())), 'null', 'nothing left in the database');
    assert.equal(await good.page.evaluate(() => window.__fake.users.size), 0, 'the test account is deleted');
    // and again, from the button
    await good.page.click('.c9nc-again');
    await good.page.waitForFunction(() => document.querySelector('.c9nc-again').disabled === false && document.querySelector('.c9nc-result').dataset.kind === 'ok', null, { timeout: 15000 });
    assert.equal(await good.page.evaluate(() => JSON.stringify(window.__fake.data())), 'null');
    await good.context.close();

    // Firebase's "test mode" rules: the loud warning
    const open = await openCheck(browser, origin, { rules: { rules: { '.read': true, '.write': true } }, shot: 'netcheck-too-open.png' });
    assert.deepEqual(open.problems, []);
    assert.equal(states(open.view), 'settings:pass sdk:pass signin:pass database:pass safety:fail cleanup:pass');
    assert.equal(open.view.kind, 'warn');
    assert.match(open.view.result, /Warning: the rules are too open\. Anyone could see every room and change other players\. Paste the rules again: see step 3\./);
    assert.equal(await open.page.evaluate(() => JSON.stringify(window.__fake.data())), 'null');
    await open.context.close();
  } finally {
    await browser.close();
    server.close();
  }
});

test('browser: without ?check=online the game still starts, through js/start.js', { skip: !playwright && 'Playwright is not installed', timeout: 90000 }, async () => {
  const server = await serve(REPO);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    const problems = [];
    const asked = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('request', (r) => asked.push(r.url()));
    await page.route('https://www.gstatic.com/**', (route) => route.abort());
    await page.goto(origin + '/cloud-nine/?noaudio=1');
    await page.waitForFunction(() => document.body.dataset.mode === 'title' && !!window.__c9, null, { timeout: 60000, polling: 100 });
    assert.deepEqual(problems, []);
    const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.getAttribute('href')));
    assert.ok(preloads.includes('lib/three.module.min.js') && preloads.includes('js/main.js'), 'the game modules are preloaded');
    assert.ok(!asked.some((u) => /netcheck|net\/check\.js/.test(u)), 'and the check is not loaded');
    assert.equal(await page.$('.c9nc'), null);
  } finally {
    await browser.close();
    server.close();
  }
});
