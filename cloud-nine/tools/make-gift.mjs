// Makes the family's private gift link for Cloud Nine (README: "Personal touches").
//
//   node cloud-nine/tools/make-gift.mjs <gift.json> [baseUrl]
//
// Reads the family's details from a JSON file that stays on your computer (keep it outside the
// repo and never commit it: it holds real names), checks them with the same rules the game uses
// (js/core/gift.js), says what it had to leave out and why, and prints the link. Only the link goes
// to standard output (so `... | pbcopy` copies just the link); everything else goes to standard
// error. The default base is the game on GitHub Pages; pass another, like
// http://localhost:8000/cloud-nine/, to try it locally. Nothing is sent anywhere.
//
// gift.json (every key but "v" is optional; made-up names here):
//   {
//     "v": 1,
//     "to": "Zuzu",
//     "from": "Uncle Wobble",
//     "birthday": { "month": 12, "day": 3, "year": 2015 },
//     "notes": [{ "from": "Grandpa Zork", "text": "Happy birthday, superstar flyer! 💖" }],
//     "friends": ["Pip", "Grandpa Zork", "Mary-Kate"],
//     "petNames": { "cloudPuppy": "Biscuit" }
//   }
//
// Exit codes: 0 the link was printed (maybe with some parts left out), 1 no link (the file can't be
// read or isn't a gift), 2 wrong arguments.

import fs from 'node:fs';
import path from 'node:path';
import { validateGift, giftLink, decodeGift, botNickFor, GIFT_LIMITS } from '../js/core/gift.js';

const DEFAULT_BASE ='https://trutt04.github.io/Hall-of-fame/cloud-nine/';
const LONG_LINK = 2000;

const say = (line = '') => process.stderr.write(line + '\n');

function preview(value, reason) {
  if (/word filter/.test(reason)) return ''; // never echo a refused word
  let v = value;
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.text === 'string') v = (typeof v.from === 'string' ? v.from + ': ' : '') + v.text;
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch (err) {
    s = String(v);
  }
  if (typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ');
  return ' ' + JSON.stringify(Array.from(s).length > 48 ? Array.from(s).slice(0, 45).join('') + '...' : s);
}

function fail(message, code = 1) {
  say(message);
  process.exit(code);
}

function main(argv) {
  const [file, base0, extra] = argv;
  if (!file || extra !== undefined || file === '-h' || file === '--help') {
    fail('usage: node cloud-nine/tools/make-gift.mjs <gift.json> [baseUrl]\n(the JSON format is in the comment at the top of this file and in the README)', 2);
  }
  const base = base0 || DEFAULT_BASE;
  if (!/^https?:\/\/[^\s#]+$/.test(base.replace(/#.*$/, ''))) fail('The base address should start with https:// (or http://), like ' + DEFAULT_BASE, 2);

  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (err) {
    fail("Couldn't read " + file + ': ' + (err && err.code === 'ENOENT' ? 'no such file' : err && err.message));
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    fail(path.basename(file) + " isn't valid JSON: " + (err && err.message) + '\n(check for a missing comma or quote; every name and note goes in "double quotes")');
  }

  const { gift, dropped } = validateGift(raw);
  if (!gift) fail('No gift link: ' + dropped.map((d) => (d.path ? d.path + ': ' : '') + d.reason).join('; '));

  say('Checked ' + path.basename(file) + ':');
  say('  to: ' + (gift.to || '(not set: the game uses its own BIRTHDAY name)'));
  if (gift.from) say('  from: ' + gift.from);
  if (gift.birthday) say('  birthday: ' + gift.birthday.month + '/' + gift.birthday.day + (gift.birthday.year ? '/' + gift.birthday.year : ' (no year: no candle count)') + ' (month/day/year)');
  if (gift.notes) say('  notes: ' + gift.notes.length + ' (from ' + gift.notes.map((n) => n.from).join(', ') + ')');
  if (gift.friends) say('  bot friends: ' + gift.friends.join(', '));
  if (gift.petNames) say('  pet names: ' + Object.keys(gift.petNames).map((k) => k + ' ' + gift.petNames[k]).join(', '));

  if (dropped.length) {
    say('');
    say('Left out (fix these in the file and run it again):');
    for (const d of dropped) say('  - ' + d.path + preview(d.value, d.reason) + ': ' + d.reason);
  }
  const heads = [];
  (gift.friends || []).forEach((name, i) => {
    const nick = botNickFor(name);
    if (!nick) heads.push('friends[' + i + '] "' + name + '" is one word longer than ' + GIFT_LIMITS.botNick + ' letters, so no bot can wear it (game names are ' + GIFT_LIMITS.botNick + ' letters at most)');
    else if (nick !== name) heads.push('friends[' + i + '] "' + name + '" shows as "' + nick + '" over its bot (game names are letters and spaces, ' + GIFT_LIMITS.botNick + ' at most)');
  });
  if (heads.length) {
    say('');
    say('Heads-up:');
    for (const h of heads) say('  - ' + h);
  }

  const link = giftLink(gift, base);
  const back = decodeGift(link.slice(link.indexOf('#gift=') + 6));
  if (JSON.stringify(back) !== JSON.stringify(gift)) fail('Something went wrong: the link does not read back the same. Nothing printed.');
  say('');
  say('The gift link (' + link.length + ' characters). It holds the family\'s names: share it privately, like a photo, and never commit it.');
  if (link.length > LONG_LINK) say('It is long: if a messaging app cuts it off, shorten the notes.');
  process.stdout.write(link + '\n');
}

main(process.argv.slice(2));
