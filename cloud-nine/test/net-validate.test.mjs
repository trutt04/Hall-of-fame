import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/net/validate.js';

test('validate: ids', () => {
  for (const ok of ['a', 'abcDEF123_-', 'x'.repeat(64), 'uid0001-b1z']) assert.ok(V.isId(ok), ok);
  for (const bad of ['', 'x'.repeat(65), 'a b', 'a/b', 'a.b', '__proto__', 'constructor', 'prototype', 42, null, undefined, {}, ['a']]) {
    assert.equal(V.isId(bad), false, String(bad));
  }
});

test('validate: states are clamped to the island, headings wrapped, odd anims become idle', () => {
  assert.deepEqual(V.cleanState({ x: 1, y: 2, z: 3, h: 0.5, anim: 'walk' }), { x: 1, y: 2, z: 3, h: 0.5, anim: 'walk' });
  assert.deepEqual(V.cleanState({ x: 9999, y: -9999, z: 600, h: 0, anim: 'run' }), { x: 500, y: -500, z: 500, h: 0, anim: 'run' });
  const s = V.cleanState({ x: 0, y: 0, z: 0, h: Math.PI * 3, anim: 'idle' });
  assert.ok(Math.abs(s.h - Math.PI) < 1e-9 || Math.abs(s.h + Math.PI) < 1e-9);
  const w = V.cleanState({ x: 0, y: 0, z: 0, h: -7, anim: 'idle' });
  assert.ok(w.h > -Math.PI && w.h <= Math.PI);
  for (const anim of ['walk1', 'x'.repeat(17), '', 'hi there', '<b>', 5, null]) assert.equal(V.cleanState({ x: 0, y: 0, z: 0, h: 0, anim }).anim, 'idle', String(anim));
  assert.equal(V.cleanState({ x: 0, y: 0, z: 0, h: 0, a: 'toeTouch' }).anim, 'toeTouch', 'wire form');
  assert.equal(V.cleanState({ x: 0, y: 0, z: 0 }).h, 0, 'no heading is facing +Z');
});

test('validate: broken states are dropped', () => {
  for (const bad of [
    null,
    undefined,
    7,
    'x',
    [],
    [1, 2, 3],
    { x: NaN, y: 0, z: 0 },
    { x: Infinity, y: 0, z: 0 },
    { x: '1', y: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, y: 0, z: 0, h: 'north' },
    { x: 0, y: 0, z: 0, h: 1e9 },
    new Date(),
    Object.assign(Object.create({ evil: true }), { x: 0, y: 0, z: 0 }),
  ]) {
    assert.equal(V.cleanState(bad), null, JSON.stringify(bad));
  }
  assert.equal(V.cleanState({ x: 0, y: 0, z: 0, t: -5 }).t, undefined, 'a negative time is ignored');
  assert.equal(V.cleanState({ x: 0, y: 0, z: 0, t: 1.7e12 }).t, 1.7e12);
});

test('validate: the wire state is short and rounded', () => {
  const w = V.toWireState({ x: 1.23456, y: -0.004, z: 2, h: 3.14159265, anim: 'run' }, 1234.7);
  assert.deepEqual(w, { x: 1.23, y: 0, z: 2, h: 3.142, a: 'run', t: 1235 });
});

test('validate: nicknames keep letters, digits, spaces and dashes only', () => {
  assert.equal(V.shapeNick('  Sparkle   Comet '), 'Sparkle Comet');
  assert.equal(V.shapeNick('Zoë'), 'Zoe');
  assert.equal(V.shapeNick('Ana💖Star'), 'Ana Star');
  assert.equal(V.shapeNick('<script>alert(1)</script>'), 'script alert 1 script');
  assert.equal(V.shapeNick('x'.repeat(40)).length, 24);
  for (const bad of ['', '   ', '1234', '💖💖', null, 42, {}]) assert.equal(V.shapeNick(bad), null, String(bad));
  assert.ok(V.isWireNick('Bea 2'));
  assert.ok(!V.isWireNick('Bea!'));
  assert.ok(!V.isWireNick('x'.repeat(25)));
});

test('validate: the content module has the last word on nicknames', () => {
  const strict = (s) => (s.length <= 12 && !/bad/i.test(s) ? s : null);
  assert.equal(V.cleanNickWith('Bea', strict), 'Bea');
  assert.equal(V.cleanNickWith('Badword', strict), null);
  assert.equal(V.cleanNickWith('Bea', () => {
    throw new Error('oops');
  }), 'Bea', 'a broken checker falls back to the local one');
  assert.equal(V.cleanNickWith('Bea', () => 'Bea<3'), 'Bea 3', 'what comes back is still shaped');
  assert.equal(V.cleanNickWith('Bea!', null, { strict: true }), null, 'incoming names must already be clean');
  assert.equal(V.cleanNickWith('Bea', null, { strict: true }), 'Bea');
});

test('validate: looks are flat preset ids, checked slot by slot', () => {
  assert.deepEqual(V.shapeLook({ bow: 'pink', bowSize: 2, sparkle: true, hair: { evil: 1 }, top: 'x'.repeat(40), 'bad key': 'a' }), {
    bow: 'pink',
    bowSize: 2,
    sparkle: true,
  });
  assert.deepEqual(V.shapeLook(JSON.parse('{"__proto__":{"x":1},"bow":"pink"}')), { bow: 'pink' });
  assert.equal({}.x, undefined, 'nothing leaked into Object.prototype');
  const many = {};
  for (let i = 0; i < 40; i++) many['slot' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26))] = 'a';
  assert.equal(Object.keys(V.shapeLook(many)).length, 16);
  assert.equal(V.shapeLook('pink'), null);
  const DEFAULT = { bow: 'bigPink', hair: 'brown' };
  const cleanLook = (raw) => ({ ...DEFAULT, ...(raw && typeof raw.bow === 'string' && raw.bow.length < 10 ? { bow: raw.bow } : {}) });
  assert.deepEqual(V.cleanLookWith({ bow: 'red' }, cleanLook), { bow: 'red', hair: 'brown' });
  assert.deepEqual(V.cleanLookWith('garbage', cleanLook), DEFAULT);
  assert.deepEqual(V.cleanLookWith({ bow: 'red' }, () => {
    throw new Error('oops');
  }), { bow: 'red' });
  assert.deepEqual(V.decodeLook(V.encodeLook({ bow: 'red' }), null), { bow: 'red' });
  assert.deepEqual(V.decodeLook('{not json', null), {});
  assert.deepEqual(V.decodeLook('x'.repeat(700), cleanLook), DEFAULT, 'too long: the default look');
  assert.ok(V.encodeLook({ bow: 'x'.repeat(2000) }).length <= V.LIMITS.lookJson);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(V.encodeLook(cyclic), '{}');
});

test('validate: payloads must be small plain JSON', () => {
  const L = V.EVENT_LIMITS;
  assert.equal(V.encodeData({ id: 'woo' }, L), '{"id":"woo"}');
  assert.equal(V.encodeData(undefined, L), 'null');
  assert.equal(V.encodeData({ a: [1, 2, { b: true }] }, L), '{"a":[1,2,{"b":true}]}');
  assert.equal(V.encodeData({ text: 'x'.repeat(81) }, L), null, 'long strings are refused (no free text)');
  assert.equal(V.encodeData({ x: 'y'.repeat(60), z: 'y'.repeat(60), w: 'y'.repeat(60), v: 'y'.repeat(60), u: 'y'.repeat(60), q: 'y'.repeat(60), r: 'y'.repeat(60), s: 'y'.repeat(60), t: 'y'.repeat(60), o: 'y'.repeat(60), p: 'y'.repeat(60), n: 'y'.repeat(60), m: 'y'.repeat(60), l: 'y'.repeat(60), k: 'y'.repeat(60), j: 'y'.repeat(60) }, L), null, 'over 1 KB');
  let deep = 1;
  for (let i = 0; i < 10; i++) deep = { d: deep };
  assert.equal(V.encodeData(deep, L), null, 'too deep');
  assert.equal(V.encodeData({ 'bad key': 1 }, L), null);
  assert.equal(V.encodeData({ a: 1e16 }, L), null, 'numbers are capped');
  assert.equal(V.encodeData({ at: 1763800000000 }, L), '{"at":1763800000000}', 'shared clock times fit');
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(V.encodeData(cyclic, L), null);
  assert.equal(V.decodeData('{"__proto__":{"polluted":1}}', L), V.INVALID);
  assert.equal({}.polluted, undefined);
  assert.equal(V.decodeData('{oops', L), V.INVALID);
  assert.equal(V.decodeData(42, L), V.INVALID);
  assert.deepEqual(V.decodeData('[1,"a",null]', L), [1, 'a', null]);
});

test('validate: room records', () => {
  assert.deepEqual(V.cleanMeta({ hostId: 'abc', createdAt: 5, beat: 9, v: 1, extra: 'x' }), { hostId: 'abc', createdAt: 5, beat: 9, locked: false });
  assert.deepEqual(V.cleanMeta({ hostId: 'abc', createdAt: 5 }), { hostId: 'abc', createdAt: 5, beat: 5, locked: false });
  assert.equal(V.cleanMeta({ hostId: 'abc', createdAt: 5, locked: true }).locked, true);
  assert.equal(V.cleanMeta({ hostId: 'abc', createdAt: 5, locked: 'yes' }).locked, false, 'only true locks');
  for (const bad of [null, { hostId: 'a b', createdAt: 1 }, { hostId: 'abc' }, { hostId: 'abc', createdAt: -1 }, []]) assert.equal(V.cleanMeta(bad), null);

  const p = V.cleanPlayerEntry('p1', { nick: 'Bea', look: '{"bow":"pink"}', bot: false, joinedAt: 10 });
  assert.deepEqual(p, { id: 'p1', nick: 'Bea', look: { bow: 'pink' }, bot: false, joinedAt: 10, owner: null });
  assert.equal(V.cleanPlayerEntry('p1', { nick: 'Bea!!', look: '{}', bot: false, joinedAt: 10 }).nick, V.FALLBACK_NICK);
  assert.equal(V.cleanPlayerEntry('b1', { nick: 'Robo', look: '{}', bot: true, owner: 'p1', joinedAt: 10 }).owner, 'p1');
  for (const [id, raw] of [
    ['b1', { nick: 'Robo', look: '{}', bot: true, joinedAt: 10 }],
    ['b1', { nick: 'Robo', look: '{}', bot: true, owner: 'b1', joinedAt: 10 }],
    ['p1', { nick: 'Bea', look: '{}', bot: false, owner: 'x', joinedAt: 10 }],
    ['p1', { nick: 'Bea', look: '{}', bot: 'no', joinedAt: 10 }],
    ['p1', { nick: 'Bea', look: '{}', bot: false }],
    ['p1', { nick: 'Bea', look: '{}', bot: false, joinedAt: 'soon' }],
    ['__proto__', { nick: 'Bea', look: '{}', bot: false, joinedAt: 10 }],
    ['p1', null],
  ]) {
    assert.equal(V.cleanPlayerEntry(id, raw), null, JSON.stringify([id, raw]));
  }

  assert.deepEqual(V.cleanEventRecord({ from: 'p1', type: 'emote', data: '{"id":"woo"}', t: 5 }), { from: 'p1', type: 'emote', data: { id: 'woo' }, t: 5 });
  for (const bad of [
    { from: 'p1', type: 'chat', data: '"hi"', t: 5 },
    { from: 'p 1', type: 'emote', data: '{}', t: 5 },
    { from: 'p1', type: 'emote', data: '{"text":"' + 'x'.repeat(200) + '"}', t: 5 },
    { from: 'p1', type: 'emote', data: 'x'.repeat(2000), t: 5 },
    { from: 'p1', type: 'emote', data: { id: 'woo' }, t: 5 },
  ]) {
    assert.equal(V.cleanEventRecord(bad), null, JSON.stringify(bad).slice(0, 80));
  }

  assert.deepEqual(V.cleanGameRecord({ by: 'p1', json: '{"phase":"play"}', t: 1 }).state, { phase: 'play' });
  assert.equal(V.cleanGameRecord({ by: 'p1', json: 'null', t: 1 }).state, null);
  assert.equal(V.cleanGameRecord({ by: 'p1', json: '[1,2]', t: 1 }), null, 'the game state is an object');
  assert.equal(V.cleanGameRecord({ by: 'p1', json: '"x"'.padEnd(17000, ' '), t: 1 }), null);
});

test('validate: token buckets refill over time, per sender, and forget old senders', () => {
  let now = 0;
  const lim = V.createLimiter({ capacity: 3, perSecond: 2, now: () => now, maxKeys: 4 });
  assert.deepEqual([1, 2, 3, 4].map(() => lim.allow('a')), [true, true, true, false]);
  assert.equal(lim.allow('b'), true, 'each sender has its own bucket');
  now += 500;
  assert.equal(lim.allow('a'), true, 'one token back after half a second');
  assert.equal(lim.allow('a'), false);
  now -= 10000;
  assert.equal(lim.allow('a'), false, 'a clock going backwards gives nothing back');
  for (const k of ['c', 'd', 'e', 'f']) lim.allow(k);
  now += 100000;
  assert.equal(lim.allow('a'), true);
});
