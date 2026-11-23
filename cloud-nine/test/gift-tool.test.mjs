// tools/make-gift.mjs: a gift.json in, the private link out (only the link on stdout), with what was
// left out and why on stderr. Made-up names only; the files live in a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeGift, validateGift } from '../js/core/gift.js';
import { blockedEntries } from '../js/content/blocklist.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'make-gift.mjs');
const BASE = 'https://trutt04.github.io/Hall-of-fame/cloud-nine/';
const GIFT = {
  v: 1,
  to: 'Zuzu',
  from: 'Uncle Wobble',
  birthday: { month: 12, day: 3, year: 2015 },
  notes: [{ from: 'Grandpa Zork', text: 'Happy birthday, superstar flyer! 💖' }],
  friends: ['Pip', 'Grandpa Zork', 'Mary-Kate'],
  petNames: { cloudPuppy: 'Biscuit' },
};

function run(files, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c9-gift-'));
  try {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    const r = spawnSync(process.execPath, [TOOL, ...args.map((a) => (a in files ? path.join(dir, a) : a))], { encoding: 'utf8', timeout: 20000 });
    return { code: r.status, out: r.stdout, err: r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const payload = (link) => link.trim().split('#gift=')[1];

test('make-gift: a good gift.json gives one line on stdout, the link, at GitHub Pages by default', () => {
  const r = run({ 'gift.json': GIFT }, ['gift.json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split('\n').filter(Boolean).length, 1, 'only the link on stdout');
  assert.ok(r.out.startsWith(BASE + '#gift='), r.out.slice(0, 80));
  assert.deepEqual(decodeGift(payload(r.out)), validateGift(GIFT).gift, 'the link reads back the whole gift');
  assert.match(r.err, /to: Zuzu/);
  assert.match(r.err, /from: Uncle Wobble/);
  assert.match(r.err, /birthday: 12\/3\/2015/);
  assert.match(r.err, /notes: 1 \(from Grandpa Zork\)/);
  assert.match(r.err, /bot friends: Pip, Grandpa Zork, Mary-Kate/);
  assert.match(r.err, /share it privately, like a photo/);
  assert.doesNotMatch(r.err, /Left out/);
  assert.match(r.err, /"Mary-Kate" shows as "Mary Kate"/, 'the heads-up for a name a bot wears differently');
  // another base, for trying it locally
  const local = run({ 'gift.json': GIFT }, ['gift.json', 'http://localhost:8000/cloud-nine/']);
  assert.equal(local.code, 0);
  assert.ok(local.out.startsWith('http://localhost:8000/cloud-nine/#gift='));
});

test('make-gift: what was left out is listed with the reason, and the link still comes', () => {
  const rude = 'Zu' + blockedEntries().anywhere[0]; // decoded at run time, never written out here
  const raw = {
    v: 1, to: 'Zuzu', from: 'Great Grandma Fizz', mood: 'happy',
    notes: [{ from: 'Bo', text: 'I <3 you!' }, { from: 'Bo', text: 'Call 555 123 4567' }, { from: 'Bo', text: 'Fly high!' }],
    friends: ['Pip', rude, 'Wobblebottoms', 'Grandma Fizzle'],
    petNames: { dragon: 'Rex' },
    birthday: { month: 2, day: 30, year: 2015 },
  };
  const r = run({ 'gift.json': raw }, ['gift.json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(decodeGift(payload(r.out)), { v: 1, to: 'Zuzu', notes: [{ from: 'Bo', text: 'Fly high!' }], friends: ['Pip', 'Wobblebottoms', 'Grandma Fizzle'] });
  assert.match(r.err, /Left out \(fix these in the file and run it again\):/);
  for (const line of [
    /- mood "happy": unknown key/,
    /- from "Great Grandma Fizz": longer than 16 characters/,
    /- birthday .*: no such day: 2\/30\/2015/,
    /- notes\[0\] "Bo: I <3 you!": has < or > \(for a heart, use ❤️ instead of <3\)/,
    /- notes\[1\] .*: looks like a link, an email or a phone number/,
    /- friends\[1\]: the word filter refused it/,
    /- petNames\.dragon "Rex": unknown pet \(the pets are cloudPuppy, husky\)/,
    /"Wobblebottoms" is one word longer than 12 letters/,
    /"Grandma Fizzle" shows as "Fizzle"/,
  ]) assert.match(r.err, line);
  assert.ok(!r.err.includes(rude), 'a refused word is never echoed back');
});

test('make-gift: no link for a file that is not a gift, and a gentle word on why', () => {
  const notJson = run({ 'gift.json': '{ "v": 1, "to": "Zuzu" "from": "Bo" }' }, ['gift.json']);
  assert.equal(notJson.code, 1);
  assert.equal(notJson.out, '');
  assert.match(notJson.err, /gift\.json isn't valid JSON/);
  const noV = run({ 'gift.json': { to: 'Zuzu' } }, ['gift.json']);
  assert.equal(noV.code, 1);
  assert.equal(noV.out, '');
  assert.match(noV.err, /No gift link: "v" must be 1/);
  const big = run({ 'gift.json': { v: 1, notes: Array.from({ length: 12 }, () => ({ from: 'Bo', text: '💖'.repeat(200) })) } }, ['gift.json']);
  assert.equal(big.code, 1);
  assert.match(big.err, /bigger than 8 KB/);
  const missing = run({}, ['nope.json']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /Couldn't read nope\.json: no such file/);
  const bom = run({ 'gift.json': '﻿' + JSON.stringify(GIFT) }, ['gift.json']);
  assert.equal(bom.code, 0, 'a byte order mark from a Windows editor is fine');
});

test('make-gift: wrong arguments show the usage', () => {
  for (const args of [[], ['--help'], ['gift.json', BASE, 'extra'], ['gift.json', 'ftp://example.test/']]) {
    const r = run({ 'gift.json': GIFT }, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.out, '');
  }
});
