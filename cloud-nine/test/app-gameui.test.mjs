// APP: js/ui/gameui.js. The game panel and how-to cards accept whatever reasonable shape the
// game modes and content hand over, cap the text, and never throw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGameUI, formatTimer, normalizeHowto, GAME_CHOICES, gameTitle } from '../js/ui/gameui.js';
import { STANDIN_CONTENT } from '../js/ui/standins.js';
import { TEAMS } from '../js/config.js';

test('timers read as m:ss', () => {
  assert.equal(formatTimer(75), '1:15');
  assert.equal(formatTimer(9.2), '0:10');
  assert.equal(formatTimer(0), '0:00');
  assert.equal(formatTimer(-3), '0:00');
  assert.equal(formatTimer(90000), '1:30', 'big numbers are milliseconds');
  assert.equal(formatTimer('GO!'), 'GO!');
  assert.equal(formatTimer({ seconds: 5 }), '0:05');
  assert.equal(formatTimer(null), null);
  assert.equal(formatTimer(NaN), null);
});

test('a full game UI', () => {
  const ui = normalizeGameUI({
    title: 'Hide and seek', line: 'Find everyone before time runs out!', timer: 8, big: 'GO!',
    roleBadge: { text: 'SEEKER', color: '#ff2e93' },
    scoreboard: [{ name: 'Bailey', score: 2, me: true }, { nick: 'Glitter Gem', points: 1 }, { team: 1, score: 3 }],
  });
  assert.equal(ui.title, 'Hide and seek');
  assert.deepEqual(ui.timer, { text: '0:08', urgent: true });
  assert.equal(ui.big, 'GO!');
  assert.deepEqual(ui.role, { text: 'SEEKER', color: '#ff2e93' });
  assert.deepEqual(ui.scoreboard[0], { label: 'Bailey', value: '2', color: null, me: true });
  assert.equal(ui.scoreboard[1].label, 'Glitter Gem');
  assert.equal(ui.scoreboard[2].label, TEAMS[1].name);
  assert.equal(ui.scoreboard[2].color, TEAMS[1].color);
});

test('other spellings: string role, score maps, pairs', () => {
  const a = normalizeGameUI({ title: 'Dodgeball', role: 'Team Pink', scores: { 'Team Pink': 2, 'Team Purple': 1 } });
  assert.deepEqual(a.role, { text: 'Team Pink', color: null });
  assert.deepEqual(a.scoreboard.map((r) => [r.label, r.value]), [['Team Pink', '2'], ['Team Purple', '1']]);
  const b = normalizeGameUI({ scoreboard: [['Star', 4, 0, true]] });
  assert.deepEqual(b.scoreboard[0], { label: 'Star', value: '4', color: TEAMS[0].color, me: true });
});

test('junk in, nothing or something safe out', () => {
  assert.equal(normalizeGameUI(null), null);
  assert.equal(normalizeGameUI('hello'), null);
  assert.equal(normalizeGameUI({}), null);
  const long = normalizeGameUI({ title: 'x'.repeat(500), line: { evil: true }, scoreboard: [null, 5, { label: 'ok', value: 1 }], roleBadge: 42 });
  assert.equal(long.title.length, 32);
  assert.equal(long.line, '');
  assert.equal(long.role, null);
  assert.deepEqual(long.scoreboard, [{ label: 'ok', value: '1', color: null, me: false }]);
  const many = normalizeGameUI({ scoreboard: Array.from({ length: 30 }, (_, i) => ({ label: 'P' + i, value: i })) });
  assert.equal(many.scoreboard.length, 10);
});

test('how-to cards from any reasonable content shape', () => {
  assert.deepEqual(normalizeHowto(STANDIN_CONTENT, 'hideSeek'), STANDIN_CONTENT.HOWTO.hideSeek);
  assert.deepEqual(normalizeHowto({ HOWTO: { dodgeball: { title: 'Dodgeball!', lines: ['Throw', 'Catch'] } } }, 'dodgeball'), { title: 'Dodgeball!', steps: ['Throw', 'Catch'] });
  assert.deepEqual(normalizeHowto({ howTo: (k) => ({ name: 'Freeze', goal: 'Stay unfrozen!', tips: [{ text: 'Run' }] }) }, 'freezeTag'), { title: 'Freeze', steps: ['Stay unfrozen!', 'Run'] });
  assert.deepEqual(normalizeHowto({ captureBow: 'Grab the bow.' }, 'captureBow'), { title: 'Capture the Bow', steps: ['Grab the bow.'] });
  assert.equal(normalizeHowto({ HOWTO: {} }, 'hitZero'), null);
  assert.equal(normalizeHowto({ howTo() { throw new Error('nope'); } }, 'hitZero'), null);
  assert.equal(normalizeHowto(null, 'hitZero'), null);
});

test('the picker lists all five games with titles', () => {
  assert.deepEqual(GAME_CHOICES.map((g) => g.id), ['hideSeek', 'freezeTag', 'dodgeball', 'captureBow', 'hitZero']);
  assert.equal(gameTitle('captureBow'), 'Capture the Bow');
  assert.equal(gameTitle('nope'), 'Game');
  for (const g of GAME_CHOICES) assert.ok(STANDIN_CONTENT.HOWTO[g.id], g.id);
});
