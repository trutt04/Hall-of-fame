// The iPhone/iPad silent-switch tip (js/ui/silent-tip.js): Apple touch devices only, once per
// device, only while the game's sound is on, and only once she is on the island.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSilentTip, isAppleTouch, silentTipText, SILENT_TIP_KEY } from '../js/ui/silent-tip.js';

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
const IPAD_OLD = { userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', maxTouchPoints: 5 };
const IPADOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', maxTouchPoints: 5 };
const MAC = { userAgent: IPADOS.userAgent, maxTouchPoints: 0 };
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', maxTouchPoints: 5 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rig(nav, o = {}) {
  const toasts = [];
  let progress = o.progress || {};
  const store = {
    get progress() { return { ...progress }; },
    patchProgress(p) { progress = { ...progress, ...p }; return progress; },
  };
  const state = { on: o.on ?? true, play: o.play ?? true };
  const tip = createSilentTip({
    hud: { toast: (text, opts) => toasts.push({ text, opts }) },
    store,
    nav,
    isOn: () => state.on,
    inPlay: () => state.play,
    delayMs: 30,
    pollMs: 5,
  });
  return { tip, toasts, state, progress: () => progress };
}

test('only iPhones, iPods and iPads (including iPadOS dressed as a Mac)', () => {
  assert.equal(isAppleTouch(IPHONE), true);
  assert.equal(isAppleTouch(IPAD_OLD), true);
  assert.equal(isAppleTouch(IPADOS), true);
  assert.equal(isAppleTouch(MAC), false);
  assert.equal(isAppleTouch(ANDROID), false);
  assert.equal(isAppleTouch(null), false);
  assert.equal(silentTipText(IPHONE), "Can't hear anything? Make sure your phone isn't on silent.");
  assert.equal(silentTipText(IPADOS), "Can't hear anything? Make sure your iPad isn't on silent.");
});

test('an iPhone gets the toast once, a little after sound starts on the island', async () => {
  const r = rig(IPHONE);
  assert.equal(r.tip.soundStarted(), true);
  assert.equal(r.tip.soundStarted(), false, 'already on its way');
  assert.equal(r.toasts.length, 0, 'not straight away');
  await sleep(90);
  assert.equal(r.toasts.length, 1);
  assert.match(r.toasts[0].text, /isn't on silent/);
  assert.equal(r.progress()[SILENT_TIP_KEY], true, 'remembered on the device');
  assert.equal(r.tip.soundStarted(), false, 'never twice');
  await sleep(60);
  assert.equal(r.toasts.length, 1);
});

test('a device that already saw it, or an Android phone, or sound switched off: no toast', async () => {
  const seen = rig(IPHONE, { progress: { [SILENT_TIP_KEY]: true } });
  assert.equal(seen.tip.soundStarted(), false);
  const android = rig(ANDROID);
  assert.equal(android.tip.soundStarted(), false);
  const off = rig(IPHONE, { on: false });
  assert.equal(off.tip.soundStarted(), false);
  await sleep(60);
  assert.equal(seen.toasts.length + android.toasts.length + off.toasts.length, 0);
});

test('it waits for the island while a menu covers the toasts, and drops it if sound goes off', async () => {
  const r = rig(IPADOS, { play: false });
  r.tip.soundStarted();
  await sleep(80);
  assert.equal(r.toasts.length, 0, 'still in the menus');
  assert.equal(r.tip.pending, true);
  r.state.play = true;
  await sleep(90);
  assert.equal(r.toasts.length, 1);

  const q = rig(IPHONE, { play: false });
  q.tip.soundStarted();
  await sleep(20);
  q.state.on = false;
  q.state.play = true;
  await sleep(80);
  assert.equal(q.toasts.length, 0);
  assert.equal(q.tip.pending, false);
  assert.equal(q.progress()[SILENT_TIP_KEY], undefined, 'not marked: it can come the next time sound starts');
  q.state.on = true;
  assert.equal(q.tip.soundStarted(), true);
  await sleep(90);
  assert.equal(q.toasts.length, 1);
});
