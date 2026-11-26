// The online-play check (js/net/check.js) against tools/fake-firebase.mjs running the real
// firebase/database.rules.json: each way the setup can go wrong names the right SETUP.md step, the
// too-open rules are caught, and the check never leaves anything behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnlineCheck, settingsProblem, explainSignIn, tooOpenText, CHECK_LINES, SAY, TEST_NICK } from '../js/net/check.js';
import { FIREBASE_CONFIG } from '../js/net/firebase-config.js';
// js/net/firebase-config.js as firebase/SETUP.md first hands it out
const PLACEHOLDERS = {
  apiKey: 'PASTE-API-KEY-HERE',
  authDomain: 'PASTE-PROJECT-ID.firebaseapp.com',
  databaseURL: 'https://PASTE-PROJECT-ID-default-rtdb.firebaseio.com',
  projectId: 'PASTE-PROJECT-ID',
  appId: 'PASTE-APP-ID',
};
import { createFakeFirebase } from '../tools/fake-firebase.mjs';
import { rulesJson, TEST_CONFIG, watchConsole, sleep } from './net-kit.mjs';

const WAIT = 300; // how long each stage may wait for an answer here (10 s on a real device)

let con;
test.beforeEach(() => {
  con = watchConsole();
});
test.afterEach(() => {
  con.restore();
  assert.deepEqual(con.errors, [], 'no console errors');
});

const states = (r) => r.lines.map((l) => l.id + ':' + l.state).join(' ');
const lineOf = (r, id) => r.lines.find((l) => l.id === id);

// Runs the check on one simulated device; `history` is every state each line went through.
async function check(fb, { sdk, device = {}, config = TEST_CONFIG, ...opts } = {}) {
  const dev = sdk || (fb && fb.device(device));
  const history = {};
  const report = await runOnlineCheck({
    config,
    sdk: dev,
    loadSdk: () => Promise.reject(new Error('the tests never load the real SDK')),
    timeoutMs: WAIT,
    onChange(r) {
      for (const l of r.lines) {
        const h = (history[l.id] = history[l.id] || []);
        if (h[h.length - 1] !== l.state) h.push(l.state);
      }
    },
    ...opts,
  });
  if (fb) await fb.settle();
  return { report, history, dev };
}

function nothingLeft(fb) {
  assert.equal(JSON.stringify(fb.data()), 'null', 'nothing left in the database');
  assert.equal(fb.users.size, 0, 'the anonymous test account is deleted');
  assert.equal(fb.connections, 0, 'the connection is closed');
}

// Firebase's "Start in test mode" rules: anyone may read and write everything for 30 days.
const TEST_MODE_RULES = { rules: { '.read': 'now < 4102444800000', '.write': 'now < 4102444800000' } };
// What "Start in locked mode" leaves when the rules from step 3 were never pasted.
const LOCKED_RULES = { rules: { '.read': false, '.write': false } };

test('check: all good: every line passes, and nothing is left behind', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const { report, history } = await check(fb);
  assert.equal(states(report), 'settings:pass sdk:pass signin:pass database:pass safety:pass cleanup:pass');
  assert.equal(report.done, true);
  assert.equal(report.ok, true);
  assert.equal(report.first, null);
  assert.deepEqual(report.lines.map((l) => l.title), CHECK_LINES.map((l) => l.title));
  for (const l of report.lines) assert.ok(l.text.length > 5 && l.step === null && l.code === null, l.id);
  for (const id of ['settings', 'sdk', 'signin', 'database', 'safety', 'cleanup']) {
    assert.deepEqual(history[id], ['waiting', 'running', 'pass'], id + ' ran, then passed, in its turn');
  }
  // the only write the rules refused is the probe into someone else's entry
  assert.equal(fb.denied.length, 1, JSON.stringify(fb.denied));
  assert.match(fb.denied[0].path, /^rooms\/[A-Z0-9]{4}\/players\/[A-Za-z0-9]{28}$/);
  assert.notEqual(fb.denied[0].path.split('/').pop(), fb.denied[0].uid, 'into an entry that is not its own');
  nothingLeft(fb);
});

test('check: it goes through the game\'s own room code and sends nothing personal', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const writes = [];
  fb.deny = ({ path, value }) => {
    writes.push({ path, value });
    return false;
  };
  const { report } = await check(fb);
  assert.equal(report.ok, true);
  const room = writes.find((w) => /^rooms\/[A-Z0-9]{4}\/meta$/.test(w.path) && w.value);
  assert.ok(room, 'a room was made');
  assert.deepEqual(Object.keys(room.value).sort(), ['beat', 'createdAt', 'hostId', 'v']);
  const me = writes.find((w) => /\/players\/[^/]+$/.test(w.path) && w.value && w.value.nick === TEST_NICK);
  assert.ok(me, 'and joined, as "' + TEST_NICK + '"');
  assert.deepEqual(me.value, { nick: TEST_NICK, look: '{}', bot: false, joinedAt: me.value.joinedAt });
  const sent = JSON.stringify(writes);
  for (const word of ['Bailey', 'localStorage', 'c9.', TEST_CONFIG.apiKey]) assert.ok(!sent.includes(word), 'never sends ' + word);
});

test('check: placeholders still in the settings: step 7, and nothing is loaded or sent', async () => {
  let loads = 0;
  const report = await runOnlineCheck({ config: PLACEHOLDERS, loadSdk: () => (loads++, new Promise(() => {})), timeoutMs: WAIT });
  assert.equal(states(report), 'settings:fail sdk:skip signin:skip database:skip safety:skip cleanup:skip');
  assert.equal(report.first.id, 'settings');
  assert.equal(report.first.text, 'The game still has the PASTE-… placeholders. See step 7.');
  assert.equal(report.first.step, '7');
  assert.equal(loads, 0, 'the Firebase code is never fetched');
  assert.equal(lineOf(report, 'sdk').text, SAY.skipped);
  assert.equal(lineOf(report, 'cleanup').text, SAY.nothingToTidy);
  assert.equal(report.ok, false);
  // the file as SETUP.md hands it out has placeholders; the committed one has the family project in
  assert.deepEqual(settingsProblem(PLACEHOLDERS), { text: SAY.placeholders, step: '7' });
  assert.equal(settingsProblem(FIREBASE_CONFIG), null);
  assert.equal(settingsProblem(TEST_CONFIG), null);
  assert.match(settingsProblem({ ...TEST_CONFIG, appId: '', projectId: undefined }).text, /missing: projectId, appId\. See step 7/);
  assert.equal(settingsProblem({ ...TEST_CONFIG, databaseURL: 'https://console.firebase.google.com/project/x' }).step, '6 and 7');
});

test('check: the Firebase code does not arrive: the internet, or a network that blocks Google', async () => {
  for (const loadSdk of [() => new Promise(() => {}), () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))]) {
    const t0 = Date.now();
    const report = await runOnlineCheck({ config: TEST_CONFIG, loadSdk, timeoutMs: WAIT });
    assert.equal(states(report), 'settings:pass sdk:fail signin:skip database:skip safety:skip cleanup:skip');
    assert.equal(report.first.text, "Couldn't reach Google. Check the internet. Some school networks block it; try home Wi-Fi.");
    assert.ok(Date.now() - t0 < WAIT + 400, 'gives up after the time limit');
  }
});

test('check: anonymous sign-in switched off (both codes Firebase uses): step 4', async () => {
  for (const code of ['auth/admin-restricted-operation', 'auth/operation-not-allowed', 'auth/configuration-not-found']) {
    const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
    const { report } = await check(fb, { device: { signInFails: code } });
    assert.equal(states(report), 'settings:pass sdk:pass signin:fail database:skip safety:skip cleanup:skip', code);
    assert.equal(report.first.step, '4', code);
    assert.equal(report.first.text, SAY.signinOff);
    assert.equal(report.first.code, code, 'what Firebase said is shown too');
    assert.equal(fb.data(), null);
    assert.equal(fb.connections, 0);
  }
});

test('check: this web address not authorized: step 5', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const { report } = await check(fb, { device: { signInFails: 'auth/unauthorized-domain' } });
  assert.equal(lineOf(report, 'signin').state, 'fail');
  assert.equal(report.first.step, '5');
  assert.match(report.first.text, /authorized domains\. See step 5\.$/);
});

test('check: every sign-in failure names its step (the codes of firebase@10.14.1)', async () => {
  const cases = [
    ['auth/api-key-not-valid.-please-pass-a-valid-api-key.', '7'],
    ['auth/invalid-api-key', '7'],
    ['auth/api-key-expired.-please-renew-the-api-key.', '7'],
    ['auth/requests-from-referer-https://example.github.io/-are-blocked.', 'end'],
    ['auth/requests-to-this-api-identitytoolkit-method-google.cloud.identitytoolkit.v1.authenticationservice.signup-are-blocked.', 'end'],
    ['auth/network-request-failed', null],
    ['auth/too-many-requests', null],
    ['auth/internal-error', '4 and 7'],
  ];
  for (const [code, step] of cases) {
    const e = new Error('Firebase: Error (' + code + ').');
    e.code = code;
    assert.equal(explainSignIn(e).step, step, code);
  }
  assert.equal(explainSignIn(new Error('timed out signing in')).text, SAY.signinNet, 'no answer at all: the internet');
  // through the whole check: a wrong key is step 7, a dead network is the internet
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const bad = await check(fb, { device: { signInFails: 'auth/api-key-not-valid.-please-pass-a-valid-api-key.' } });
  assert.equal(bad.report.first.step, '7');
  assert.equal(bad.report.first.text, SAY.signinKey);
  const off = await check(fb, { device: { signInFails: true } });
  assert.equal(off.report.first.text, SAY.signinNet);
  assert.equal(off.report.first.step, null);
});

test('check: the rules were never pasted (locked mode): the database line says step 3', async () => {
  const fb = createFakeFirebase({ rules: LOCKED_RULES, latencyMs: 2 });
  const { report } = await check(fb);
  assert.equal(states(report), 'settings:pass sdk:pass signin:pass database:fail safety:skip cleanup:skip');
  assert.equal(report.first.text, "The database said no: the rules weren't pasted. See step 3.");
  assert.equal(report.first.step, '3');
  assert.match(report.first.code || '', /PERMISSION_DENIED/i);
  nothingLeft(fb);
});

test('check: rules that are too open (test mode) get the warning, and the probe entry is removed', async () => {
  const fb = createFakeFirebase({ rules: TEST_MODE_RULES, latencyMs: 2 });
  const { report } = await check(fb);
  assert.equal(states(report), 'settings:pass sdk:pass signin:pass database:pass safety:fail cleanup:pass');
  assert.equal(report.first.id, 'safety');
  assert.equal(report.first.step, '3');
  assert.equal(report.first.text, 'Warning: the rules are too open. Anyone could see every room and change other players. Paste the rules again: see step 3.');
  assert.equal(report.ok, false);
  nothingLeft(fb);
});

test('check: each of the two safety probes catches its own loosened rule', async () => {
  // listing: someone added a read rule on all of rooms
  const listable = rulesJson();
  listable.rules.rooms['.read'] = 'auth != null';
  let fb = createFakeFirebase({ rules: listable, latencyMs: 2 });
  let { report } = await check(fb);
  assert.equal(lineOf(report, 'safety').state, 'fail');
  assert.equal(report.first.text, tooOpenText(true, false));
  assert.match(report.first.text, /Anyone could see every room\./);
  nothingLeft(fb);
  // writing: any signed-in device may write any player entry
  const writable = rulesJson();
  const pid = writable.rules.rooms.$code.players.$pid;
  pid['.write'] = 'auth != null';
  pid['.validate'] = "newData.hasChildren(['nick', 'look', 'bot', 'joinedAt'])";
  fb = createFakeFirebase({ rules: writable, latencyMs: 2 });
  ({ report } = await check(fb));
  assert.equal(lineOf(report, 'safety').state, 'fail');
  assert.equal(report.first.text, tooOpenText(false, true));
  assert.match(report.first.text, /Anyone could change other players\./);
  nothingLeft(fb);
});

test('check: a database address that never answers: steps 2 and 7, after the time limit', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const dev = fb.device();
  // signs in fine, but the database connection never comes up (a typo, or no database made in step 2)
  const sdk = { app: dev.app, auth: dev.auth, database: { ...dev.database, getDatabase(app) { const db = dev.database.getDatabase(app); dev.database.goOffline(db); return db; } } };
  const t0 = Date.now();
  const { report } = await check(fb, { sdk });
  assert.equal(states(report), 'settings:pass sdk:pass signin:pass database:fail safety:skip cleanup:skip');
  assert.equal(report.first.step, '2 and 7');
  assert.equal(report.first.text, SAY.noAnswer);
  assert.ok(Date.now() - t0 >= WAIT - 20 && Date.now() - t0 < WAIT * 3, 'waited for the time limit, then said so');
  assert.equal(fb.data(), null);
});

test('check: cleanup that fails is reported, with the code of the room to delete', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  fb.deny = ({ path, value }) => /^rooms\/[A-Z0-9]{4}(\/meta)?$/.test(path) && value === null; // the room may not be removed
  const { report } = await check(fb);
  assert.equal(states(report), 'settings:pass sdk:pass signin:pass database:pass safety:pass cleanup:fail');
  assert.equal(report.ok, false);
  assert.equal(report.first.id, 'cleanup');
  const code = Object.keys(fb.data('rooms'))[0];
  assert.match(code, /^[A-Z0-9]{4}$/);
  assert.equal(report.first.text.includes("Couldn't remove the test room " + code + '.'), true, report.first.text);
  assert.match(report.first.text, /Data tab, rooms, [A-Z0-9]{4}, then the bin icon\. If this keeps happening, paste the rules again \(step 3\)\.$/);
  assert.deepEqual(Object.keys(fb.data('rooms/' + code)), ['meta'], 'only the code and an anonymous id are left: the player is gone');
});

test('check: if the page closes half way, Firebase removes the test room by itself', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const dev = fb.device();
  let killed = false;
  const report = await runOnlineCheck({
    config: TEST_CONFIG,
    sdk: dev,
    timeoutMs: WAIT,
    onChange(r) {
      if (!killed && lineOf(r, 'database').state === 'pass') {
        killed = true;
        dev.kill(); // the tab is closed
      }
    },
  });
  await fb.settle();
  await sleep(10);
  assert.equal(killed, true);
  assert.equal(lineOf(report, 'safety').state, 'fail', 'nothing answers after the tab is gone');
  assert.equal(JSON.stringify(fb.data()), 'null', 'the disconnect jobs removed the player and the room together');
});

test('check: running it again starts afresh (a new anonymous id, a new room)', async () => {
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 2 });
  const ids = new Set();
  fb.deny = ({ uid }) => {
    ids.add(uid);
    return false;
  };
  const a = await check(fb);
  const b = await check(fb);
  assert.equal(a.report.ok && b.report.ok, true);
  assert.equal(ids.size, 2, 'two different anonymous ids');
  nothingLeft(fb);
});
