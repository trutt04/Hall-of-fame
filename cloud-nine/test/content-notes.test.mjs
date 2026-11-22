import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILY_NOTES, NOTE_LIMITS, RELATIONS, cleanNote, familyNotes } from '../js/content/notes.js';
import { blockedEntries } from '../js/content/blocklist.js';

const TEXT = 'Happy birthday, sweet flyer! We are so proud of you. Fly high!';

test('notes: empty until the owner sends them', () => {
  assert.ok(Array.isArray(FAMILY_NOTES) && Object.isFrozen(FAMILY_NOTES));
  assert.equal(FAMILY_NOTES.length, 0);
  assert.deepEqual(familyNotes(), []);
  assert.deepEqual(familyNotes('nope'), []);
  assert.deepEqual(NOTE_LIMITS, { text: 160, from: 24 });
});

test('notes: signed with a first name or a relation', () => {
  const signed = (from) => {
    const n = cleanNote({ from, text: TEXT });
    return n && n.from;
  };
  assert.equal(signed('Grandma'), 'Grandma');
  assert.equal(signed('grandpa zork'), 'Grandpa Zork');
  assert.equal(signed('Aunt Zuzu'), 'Aunt Zuzu');
  assert.equal(signed('Great Grandma Fizz'), 'Great Grandma Fizz');
  assert.equal(signed('Mom and Dad'), 'Mom and Dad');
  assert.equal(signed('Nana & Papa'), 'Nana & Papa');
  assert.equal(signed('Ava, Mia and Leo'), 'Ava, Mia and Leo');
  assert.equal(signed('Zo\u00eb'), 'Zo\u00eb');
  assert.equal(signed('Mary-Kate'), 'Mary-Kate');
  assert.equal(signed('Coach'), 'Coach');
  assert.equal(signed('  your   cousins '), null, 'two words, the first not a relation');
  for (const bad of ['Zuzu Sparkleton', 'Pip Zork Sparkleton', 'Grandma Fizz Sparkleton', 'Aunt Zuzu Sparkleton', 'Mom 2', 'Dad!', '@grandma', '',
    '   ', 'A Very Long Name That Goes On', null, 42, 'Grandma and', 'and Grandpa', 'Mom,, Dad']) {
    assert.equal(signed(bad), null, `refuses ${JSON.stringify(bad)}`);
  }
  assert.ok(RELATIONS.includes('grandma') && RELATIONS.includes('cousins') && RELATIONS.includes('coach'));
});

test('notes: text is tidied, capped and kept free of links, contact details and blocked words', () => {
  const n = cleanNote({ from: 'Grandma', text: `  ${TEXT}\n\n  ` });
  assert.deepEqual({ ...n }, { from: 'Grandma', text: TEXT, clipped: false });
  assert.ok(Object.isFrozen(n));
  for (const bad of [
    'Visit https://example.com for a surprise', 'Look at www.example.com', 'Email me at grandma@example.com', 'Follow @grandma',
    'Call 5551234567', 'See example.com', '', '    ', null, 42,
  ]) {
    assert.equal(cleanNote({ from: 'Grandma', text: bad }), null, `refuses ${JSON.stringify(bad)}`);
  }
  for (const ok of ["She's hit zero!", 'We love you 1000!', 'Class act, kiddo!', 'Hello from Essex!']) {
    assert.ok(cleanNote({ from: 'Nana', text: ok }), `allows ${JSON.stringify(ok)}`);
  }
  const { words } = blockedEntries();
  words.forEach((w, i) => {
    assert.ok(cleanNote({ from: 'Nana', text: `You are the ${w} of the squad!` }) === null, `blocked word #${i} let through`);
  });
});

test('notes: long text is clipped at a word with "..."', () => {
  const long = 'We are so proud of you and every single toss you fly. '.repeat(6).trim();
  const n = cleanNote({ from: 'Uncle Wobble', text: long });
  assert.ok(n.clipped);
  assert.ok(n.text.length <= NOTE_LIMITS.text, `${n.text.length}`);
  assert.ok(n.text.endsWith('...'));
  assert.ok(long.startsWith(n.text.slice(0, -3)), 'cut at a word boundary');
  assert.ok(!/\s\.\.\.$/.test(n.text));
  assert.equal(cleanNote({ from: 'Uncle Wobble', text: 'x'.repeat(2500) }), null, 'absurd lengths are refused');
});

test('notes: familyNotes keeps the good ones in order', () => {
  const notes = [
    { from: 'Grandma', text: 'Fly high!' },
    { from: 'Zuzu Sparkleton', text: 'Hi!' },
    { from: 'Aunt Zuzu', text: 'Hit zero, superstar!' },
    'nope',
  ];
  assert.deepEqual(familyNotes(notes).map((n) => n.from), ['Grandma', 'Aunt Zuzu']);
});
