// APP: js/core/store.js. Look, nickname, sound, quality and progress survive in a fake
// localStorage, bad data is ignored, and blocked storage never throws.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, basicCleanNick, basicCleanLook, parseSound, cleanProgress, PROGRESS_MAX_BYTES, NICK_MAX, TYPED_NICK_MAX } from '../js/core/store.js';
import { STORAGE_KEYS } from '../js/config.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const blocked = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
};

test('fresh device: nothing remembered, sensible defaults', () => {
  const store = createStore({ storage: fakeStorage(), search: '' });
  assert.equal(store.look, null);
  assert.equal(store.nick, null);
  assert.equal(store.sound, null);
  assert.equal(store.quality, 'auto');
  assert.deepEqual(store.progress, {});
});

test('look round-trips through storage and is validated on the way in and out', () => {
  const storage = fakeStorage();
  const store = createStore({ storage, search: '' });
  const look = { hair: 'brown', bow: 'hotPink', top: 'starCrop' };
  assert.deepEqual(store.setLook(look), look);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEYS.look)), look);
  // a second visit reads it back
  assert.deepEqual(createStore({ storage, search: '' }).look, look);
  // junk in storage is ignored
  storage.setItem(STORAGE_KEYS.look, '{not json');
  assert.equal(createStore({ storage, search: '' }).look, null);
  storage.setItem(STORAGE_KEYS.look, JSON.stringify({ bow: '<script>alert(1)</script>' }));
  assert.equal(createStore({ storage, search: '' }).look, null);
  assert.equal(store.setLook(null), null);
  assert.equal(store.setLook('pink'), null);
});

test('the real cleaners can be swapped in later', () => {
  const store = createStore({ storage: fakeStorage(), search: '' });
  store.setCleaners({ cleanLook: (raw) => ({ fixed: true, bow: raw && raw.bow ? 'pink' : 'none' }), cleanNick: (n) => (n === 'Bad' ? null : String(n).toUpperCase()) });
  assert.deepEqual(store.setLook({ bow: 'x' }), { fixed: true, bow: 'pink' });
  assert.equal(store.setNick('Bad'), null);
  assert.equal(store.setNick('Sparkle'), 'SPARKLE');
  assert.equal(store.nick, 'SPARKLE');
  // a cleaner that throws counts as "not valid"
  store.setCleaners({ cleanNick: () => { throw new Error('boom'); } });
  assert.equal(store.setNick('Anything'), null);
});

test('nicknames: letters and spaces only, generated ones may run past the typed cap', () => {
  assert.equal(basicCleanNick('  Sparkle   Comet '), 'Sparkle Comet');
  assert.equal(basicCleanNick('Sparkle Comet!'), null);
  assert.equal(basicCleanNick('Glitter Twister'), 'Glitter Twister');
  assert.equal(basicCleanNick('A'.repeat(NICK_MAX + 1)), null);
  assert.ok(TYPED_NICK_MAX <= NICK_MAX);
  assert.equal(basicCleanNick(''), null);
  assert.equal(basicCleanNick(42), null);
  const store = createStore({ storage: fakeStorage(), search: '' });
  assert.equal(store.setNick('Bailey'), 'Bailey');
  assert.equal(store.nick, 'Bailey');
  assert.equal(store.setNick('x@y.com'), null);
  assert.equal(store.nick, 'Bailey');
});

test('basicCleanLook keeps only short preset ids', () => {
  assert.deepEqual(basicCleanLook({ bow: 'pink', hair: 'brown-dark', n: 3, evil: 'a b', 'bad key': 'x' }), { bow: 'pink', hair: 'brown-dark' });
  assert.equal(basicCleanLook([1, 2]), null);
  assert.equal(basicCleanLook({}), null);
});

test('sound reads every reasonable spelling and writes 1 or 0', () => {
  assert.equal(parseSound('1'), true);
  assert.equal(parseSound('true'), true);
  assert.equal(parseSound('on'), true);
  assert.equal(parseSound('0'), false);
  assert.equal(parseSound('off'), false);
  assert.equal(parseSound('maybe'), null);
  assert.equal(parseSound(null), null);
  const storage = fakeStorage();
  const store = createStore({ storage, search: '' });
  store.setSound(false);
  assert.equal(storage.map.get(STORAGE_KEYS.sound), '0');
  assert.equal(store.sound, false);
  store.setSound(true);
  assert.equal(store.sound, true);
});

test('quality: the URL wins, then the saved choice, then auto', () => {
  const storage = fakeStorage();
  const store = createStore({ storage, search: '' });
  assert.equal(store.setQuality('low'), 'low');
  assert.equal(store.quality, 'low');
  assert.equal(createStore({ storage, search: '?quality=high' }).quality, 'high');
  assert.equal(createStore({ storage, search: '?quality=ultra' }).quality, 'low');
  store.setQuality('auto');
  assert.equal(storage.map.has(STORAGE_KEYS.quality), false);
  assert.equal(store.setQuality('nonsense'), 'auto');
});

test('progress merges, survives a reload, and refuses to grow past the cap', () => {
  const storage = fakeStorage();
  const store = createStore({ storage, search: '' });
  store.patchProgress({ bestToss: 14.5 });
  store.patchProgress({ sticks: ['a', 'b'] });
  assert.deepEqual(createStore({ storage, search: '' }).progress, { bestToss: 14.5, sticks: ['a', 'b'] });
  const before = storage.map.get(STORAGE_KEYS.progress);
  assert.equal(store.patchProgress({ huge: 'x'.repeat(PROGRESS_MAX_BYTES) }), null);
  assert.equal(storage.map.get(STORAGE_KEYS.progress), before);
  assert.equal(store.patchProgress([1, 2]), null);
  assert.equal(cleanProgress({ f() {} }) && Object.keys(cleanProgress({ f() {} })).length, 0);
  // the copy handed out cannot change what is stored
  const p = store.progress;
  p.bestToss = 999;
  assert.equal(store.progress.bestToss, 14.5);
});

test('blocked storage never throws and the visit still remembers', () => {
  const store = createStore({ storage: blocked, search: '' });
  assert.equal(store.look, null);
  assert.equal(store.setNick('Comet'), 'Comet');
  assert.equal(store.nick, 'Comet');
  store.setSound(true);
  assert.equal(store.sound, true);
  assert.deepEqual(store.patchProgress({ a: 1 }), { a: 1 });
  assert.deepEqual(store.progress, { a: 1 });
});

test('no storage at all (node) is fine too', () => {
  const store = createStore({ storage: null, search: '?solo=1&room=KJ7P&debug' });
  assert.equal(store.flag('solo'), true);
  assert.equal(store.flag('debug'), true);
  assert.equal(store.flag('nope'), false);
  assert.equal(store.params.get('room'), 'KJ7P');
  assert.equal(store.setNick('Star'), 'Star');
});

test('shared state emitter: set emits key and change, on returns an unsubscribe', () => {
  const store = createStore({ storage: null, search: '' });
  const seen = [];
  const off = store.on('mode', (v, prev) => seen.push([v, prev]));
  store.set('mode', 'solo');
  store.set('mode', 'solo'); // unchanged: no event
  store.set('mode', 'room');
  off();
  store.set('mode', 'menu');
  assert.deepEqual(seen, [['solo', undefined], ['room', 'solo']]);
  let looked = null;
  store.on('look', (l) => { looked = l; });
  store.setLook({ bow: 'pink' });
  assert.deepEqual(looked, { bow: 'pink' });
});
