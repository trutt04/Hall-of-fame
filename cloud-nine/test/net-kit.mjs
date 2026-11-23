// Shared helpers for the net tests (cloud-nine/test/net-*.test.mjs). Not a test file itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNet } from '../js/net/index.js';
import { createFakeTabs } from '../tools/fake-tabs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const C9 = path.resolve(HERE, '..');
export const REPO = path.resolve(C9, '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(cond, { timeout = 4000, step = 10, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = await cond();
    } catch (err) {
      v = false;
    }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for ' + what);
    await sleep(step);
  }
}

export function rulesJson() {
  return JSON.parse(fs.readFileSync(path.join(C9, 'firebase', 'database.rules.json'), 'utf8'));
}

export const TEST_CONFIG = Object.freeze({
  apiKey: 'test-key',
  authDomain: 'cloud-nine-test.firebaseapp.com',
  databaseURL: 'https://cloud-nine-test-default-rtdb.firebaseio.com',
  projectId: 'cloud-nine-test',
  appId: '1:1:web:1',
});

// Test nets use the local checks, not the content and character modules, so these tests mean the
// same thing before and after those modules exist. Their effect is tested with fakes on purpose.
export const NO_HELPERS = Object.freeze({});

// Quick timings so host changes and tidy-ups happen in milliseconds, not seconds.
export const FAST = Object.freeze({ hostBeatMs: 200, hostGoneMs: 900, claimStepMs: 250, dutyMs: 100, healDelayMs: 50, joinWaitMs: 3000 });

// console.error during a test is a bug; warnings are collected so tests can look at them.
export function watchConsole() {
  const errors = [];
  const warnings = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...a) => {
    errors.push(a.map(String).join(' '));
  };
  console.warn = (...a) => {
    warnings.push(a.map(String).join(' '));
  };
  return {
    errors,
    warnings,
    restore() {
      console.error = origError;
      console.warn = origWarn;
    },
  };
}

// n simulated browser tabs on the local transport, sharing one private channel.
export function localTabs({ tuning = FAST } = {}) {
  const tabs = createFakeTabs();
  const channelName = 'c9-test-' + Math.random().toString(36).slice(2);
  const nets = [];
  function open() {
    const tab = tabs.open();
    const net = createNet({ mode: 'local', local: { channelName, locks: tab.locks, BroadcastChannel: tab.BroadcastChannel, tuning: { takeoverMs: 30 } }, tuning, helpers: NO_HELPERS });
    net.tab = tab;
    nets.push(net);
    return net;
  }
  // a tab that vanishes without a word (closed, crashed)
  function crash(net) {
    net.tab.crash();
    net.dispose();
  }
  function closeAll() {
    for (const n of nets) n.dispose();
  }
  return { open, crash, closeAll, nets, channelName };
}

export function record(net, kinds = ['join', 'leave', 'host', 'event', 'game', 'status', 'player']) {
  const log = [];
  for (const k of kinds) net.on(k, (x) => log.push({ k, x }));
  return log;
}

export const nicksOf = (net) => [...net.players.values()].map((p) => p.nick);
export const hostNick = (net) => (net.room && net.players.get(net.room.hostId) ? net.players.get(net.room.hostId).nick : null);
