// Things to do (js/ui/todo.js) and the first-time flags (js/ui/welcome.js): the pure parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TODO_GOALS, TODO_IDS, TODO_REWARD, cleanTodo, tickTodo, todoCount, withTodoLock } from '../js/ui/todo.js';
import { cleanWelcome, createWelcome, TIP_WORDS } from '../js/ui/welcome.js';
import { SPIRIT_STICKS } from '../js/content/collectibles.js';
import { LOOK_OPTIONS } from '../js/art/character-looks.js';
import { lockedLooks } from '../js/world/sticks.js';
import { createStore } from '../js/core/store.js';
import { copyProblems } from './content-copy-rules.mjs';

test('nine first goals, one for each thing to try', () => {
  assert.deepEqual([...TODO_IDS], ['toss', 'land', 'stage', 'game', 'photo', 'stick', 'look', 'cheer', 'ducks']);
  const problems = [];
  for (const g of TODO_GOALS) {
    problems.push(...copyProblems(g.label, g.id + '.label', { max: 32 }));
    problems.push(...copyProblems(g.tip, g.id + '.tip', { max: 40 }));
    problems.push(...copyProblems(g.yay, g.id + '.yay', { max: 28, praise: true }));
  }
  assert.deepEqual(problems, []);
});

test('the prize is a real creator option that no spirit stick gives', () => {
  assert.ok(LOOK_OPTIONS[TODO_REWARD.slot].some((o) => o.id === TODO_REWARD.id));
  assert.ok(!SPIRIT_STICKS.some((s) => s.unlock && s.unlock.slot === TODO_REWARD.slot && s.unlock.id === TODO_REWARD.id));
});

test('cleanTodo keeps known goals once, in list order, and survives junk', () => {
  assert.deepEqual(cleanTodo(null), { done: [], seen: false, won: false });
  assert.deepEqual(cleanTodo([1, 2]), { done: [], seen: false, won: false });
  assert.deepEqual(cleanTodo({ done: 'toss' }).done, []);
  const s = cleanTodo({ done: ['cheer', 'toss', 'toss', '__proto__', 7, 'nope'], seen: 1, won: 1 });
  assert.deepEqual(s.done, ['toss', 'cheer']);
  assert.equal(s.seen, true);
  assert.equal(s.won, false, 'won only counts with every goal done');
  assert.equal(cleanTodo({ done: [...TODO_IDS], won: 1 }).won, true);
});

test('tickTodo adds a goal once and says when the list is done', () => {
  let s = cleanTodo(null);
  let r = tickTodo(s, 'toss');
  assert.equal(r.added, true);
  assert.equal(todoCount(r.state), 1);
  r = tickTodo(r.state, 'toss');
  assert.equal(r.added, false);
  assert.equal(tickTodo(r.state, 'flyToTheMoon').added, false);
  s = r.state;
  for (const id of TODO_IDS) {
    r = tickTodo(s, id);
    s = r.state;
  }
  assert.equal(r.all, true);
  assert.equal(todoCount(s), 9);
});

test('the gold bow stays locked in the creator until all 8 are done', () => {
  const sticks = lockedLooks(SPIRIT_STICKS, []);
  const before = JSON.stringify(sticks);
  const open = withTodoLock(sticks, cleanTodo({ done: ['toss'] }));
  const lock = open[TODO_REWARD.slot][TODO_REWARD.id];
  assert.ok(lock && lock.name && lock.hint && lock.line);
  assert.ok(open.bowPattern && open.bowPattern.hearts, 'the spirit stick locks stay');
  assert.equal(JSON.stringify(sticks), before, 'the given map is not changed');
  const done = withTodoLock(sticks, cleanTodo({ done: [...TODO_IDS] }));
  assert.ok(!done.bow || !done.bow[TODO_REWARD.id]);
  assert.ok(withTodoLock(null, cleanTodo(null)).bow[TODO_REWARD.id]);
});

// a store on a fake localStorage
function fakeStore() {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  return createStore({ storage, search: '' });
}
const noHud = { el: null, onButton() {} };

test('the creator opens once per device, never when a look was saved before', () => {
  assert.deepEqual(cleanWelcome('x'), { creator: false, games: false, menu: false });
  const store = fakeStore();
  let w = createWelcome({ hud: noHud, store });
  assert.equal(w.creatorDue(false), true);
  w.creatorShown();
  assert.equal(createWelcome({ hud: noHud, store }).creatorDue(false), false, 'remembered');
  const dressed = fakeStore();
  w = createWelcome({ hud: noHud, store: dressed });
  assert.equal(w.creatorDue(true), false);
  assert.equal(createWelcome({ hud: noHud, store: dressed }).flags.creator, true);
  // ?welcome=1 shows it again on this visit
  assert.equal(createWelcome({ hud: noHud, store, force: true }).creatorDue(true), true);
});

test('each word bubble goes for good once its button is used', () => {
  assert.deepEqual(Object.keys(TIP_WORDS), ['games', 'menu']);
  const store = fakeStore();
  const w = createWelcome({ hud: noHud, store });
  w.used('games');
  w.used('nonsense');
  const again = createWelcome({ hud: noHud, store }).flags;
  assert.equal(again.games, true);
  assert.equal(again.menu, false);
  assert.ok(JSON.stringify(store.progress).length < 200, 'a tiny footprint in the progress object');
});
