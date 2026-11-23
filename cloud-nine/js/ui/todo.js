// "Things to do": nine first goals that show a new cheerleader what there is to do on Cloud Nine,
// saved on this device (in the store's progress object, under `todo`). A chip in the HUD's top-left
// column ("To do 2/9") opens the list as a card; the in-world menu has a row for it too. Each goal
// ticks with a sparkle on the chip, a chime and a little hype; finishing them all is an ALL STAR
// celebration and wins the Gold bow in My cheerleader. Then the chip bows out (the menu row stays
// and shows the finished list).
// Goals marked `late` came after the first eight. A list won before one was added stays won (the
// Gold bow stays hers); the chip comes back to show the new goal, and ticking it is a plain goal.
//
//   const todo = createTodo(world, { onCreator, seed })
//       world: the Contract 1 world (hud, store, audio, player, net, toss, booth, spawnBurst, mode)
//       onCreator(): opens My cheerleader (the finished card's button)    seed: goal ids already met
//   todo.tick(id) -> true when that goal was just done      ids: TODO_IDS
//   todo.open()                    the card            todo.row -> { done, total } (the menu row)
//   todo.lock(locked) -> the creator's locked map, plus the Gold bow while the list is unfinished
//   todo.update(dt)                every frame: notices a booth photo and a game's results, and plays
//                                  the waiting celebrations once she is back in free roam
//   todo.gameEnded(activeGame)     main.js, as a game ends: a game played for a while counts
//   todo.state / todo.allDone / todo.chip / todo.pending (tests)
//
// Pure parts (node tests): TODO_GOALS, TODO_IDS, TODO_REWARD, cleanTodo(raw), tickTodo(state, id),
// todoCount(state), withTodoLock(locked, state).

import { el, icon, onTap } from './dom.js';

export const TODO_GOALS = Object.freeze([
  Object.freeze({ id: 'toss', label: 'Fly in a basket toss', tip: 'Hop on a glittery mat by the clouds.', yay: 'You flew!' }),
  Object.freeze({ id: 'land', label: 'Stick a landing', tip: 'Finish your trick before you land!', yay: 'Stuck it!' }),
  Object.freeze({ id: 'stage', label: 'Perform on the Hit Zero stage', tip: "Walk onto the stage's blue mat.", yay: 'What a routine!' }),
  Object.freeze({ id: 'game', label: 'Play a squad game', tip: 'Tap the star button. Pick a game!', yay: 'Squad game played!' }),
  Object.freeze({ id: 'photo', label: 'Take a photo at the booth', tip: 'Walk up to the booth by the plaza.', yay: 'Snap! Picture perfect!' }),
  Object.freeze({ id: 'stick', label: 'Find a spirit stick', tip: '12 are hidden. The menu has hints!', yay: 'Spirit stick spotted!' }),
  Object.freeze({ id: 'look', label: 'Change your look', tip: 'Menu, then My cheerleader.', yay: 'Your style, your way!' }),
  Object.freeze({ id: 'cheer', label: 'Send a cheer', tip: 'Tap the speech bubble button.', yay: 'Squad spirit!' }),
  Object.freeze({ id: 'ducks', label: 'Feed the ducks', tip: 'The duck pond is by the bridge path.', yay: 'Quack quack! Thank you!', late: true }),
]);
export const TODO_IDS = Object.freeze(TODO_GOALS.map((g) => g.id));

// What finishing the list wins. No spirit stick gives the gold bow (every option the sticks unlock is
// already one stick's prize), so it is locked in the creator until the list is done.
export const TODO_REWARD = Object.freeze({ slot: 'bow', id: 'gold', label: 'Gold bow' });

// Saved progress is untrusted (old versions, other tabs, a hand-edited store): known ids only, once
// each, in list order. `won` sticks when every goal but the late ones is done (a list won before a
// goal was added stays won).
export function cleanTodo(raw) {
  const ok = raw && typeof raw === 'object' && !Array.isArray(raw);
  const list = ok && Array.isArray(raw.done) ? raw.done.slice(0, 32) : [];
  const done = TODO_IDS.filter((id) => list.includes(id));
  const core = TODO_GOALS.every((g) => g.late || done.includes(g.id));
  return { done, seen: !!(ok && raw.seen), won: !!(ok && raw.won) && core };
}

export function todoCount(state) {
  return state && Array.isArray(state.done) ? state.done.length : 0;
}

// -> { state, added, all }: added when this goal was not done before; all when the list is now done.
export function tickTodo(state, id) {
  const s = cleanTodo(state);
  if (!TODO_IDS.includes(id) || s.done.includes(id)) return { state: s, added: false, all: s.done.length === TODO_IDS.length };
  const next = cleanTodo(Object.assign({}, s, { done: s.done.concat(id) }));
  return { state: next, added: true, all: next.done.length === TODO_IDS.length };
}

// The creator's locked map (js/world/sticks.js lockedLooks), plus the Gold bow until every goal is
// done (or the list was won before). Never changes the map it was given.
export function withTodoLock(locked, state) {
  const out = {};
  if (locked && typeof locked === 'object') for (const k of Object.keys(locked)) out[k] = Object.assign({}, locked[k]);
  if (todoCount(state) >= TODO_IDS.length || cleanTodo(state).won) return out;
  const r = TODO_REWARD;
  const n = TODO_IDS.length;
  out[r.slot] = Object.assign({}, out[r.slot], {
    [r.id]: {
      name: 'Things to do list', label: r.label, hint: 'Do all ' + n + ' things on it. The list is in the menu!',
      line: 'Do all ' + n + ' Things to do to win the ' + r.label + '! The list is in the menu.',
    },
  });
  return out;
}

// ------------------------------------------------------------------------------------ the HUD part

const GAP_MS = 1500; // between two celebrations
const GAME_MIN_MS = 20000; // a game left before this did not really get played

export function createTodo(world, opts = {}) {
  const { hud, store } = world;
  const sfx = (name, o) => {
    try {
      if (world.audio) world.audio.sfx(name, o);
    } catch (err) { /* sound is a bonus */ }
  };
  const total = TODO_IDS.length;
  let state = cleanTodo(store.progress.todo);
  const queue = []; // celebrations waiting for free roam: { id, n } or { all: true }
  let nextAt = 0;
  let lastPhoto = world.booth ? world.booth.lastPhoto : null;
  let poll = 0;

  function save() {
    store.patchProgress({ todo: { done: state.done.slice(), seen: state.seen ? 1 : 0, won: state.won ? 1 : 0 } });
  }
  // goals met before this list existed (a spirit stick already found...) count, quietly
  if (Array.isArray(opts.seed)) {
    let changed = false;
    for (const id of opts.seed) {
      const r = tickTodo(state, id);
      if (r.added) {
        state = r.state;
        changed = true;
      }
    }
    if (todoCount(state) >= total && !state.won) state.won = true;
    if (changed) save();
  }

  // ---------------------------------------------------------------- the chip
  const chip = el('button', 'c9do-chip');
  chip.type = 'button';
  const chipCount = el('span', 'c9do-chip-count', '');
  chip.append(icon('check', 'c9-icon c9do-chip-icon'), el('span', 'c9do-chip-label', 'To do'), chipCount);
  onTap(chip, () => open());
  const left = hud.el && hud.el.querySelector ? hud.el.querySelector('.c9-left') : null;
  (left || hud.el).appendChild(chip);
  let shownN = todoCount(state); // the chip counts up as each celebration plays, not before
  function paintChip() {
    const n = shownN;
    chipCount.textContent = n + '/' + total;
    chip.setAttribute('aria-label', 'Things to do: ' + n + ' of ' + total + ' done');
    // gone once everything is done and celebrated (the menu row keeps the list)
    chip.hidden = state.won && todoCount(state) >= total && !queue.length;
    chip.classList.toggle('c9do-new', !state.seen);
  }
  paintChip();

  function popChip() {
    chip.classList.remove('c9do-pop');
    void chip.offsetWidth;
    chip.classList.add('c9do-pop');
    for (let i = 0; i < 5; i++) {
      const s = el('span', 'c9do-spark');
      s.style.setProperty('--a', (i * 72 - 90) + 'deg');
      s.style.setProperty('--d', (i * 0.03).toFixed(2) + 's');
      chip.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  // ---------------------------------------------------------------- ticking
  function tick(id) {
    const r = tickTodo(state, id);
    if (!r.added) return false;
    state = Object.assign(r.state, { seen: state.seen, won: state.won });
    queue.push({ id, n: todoCount(state) });
    if (r.all && !state.won) {
      state.won = true;
      queue.push({ all: true });
    }
    save();
    paintChip();
    return true;
  }

  const free = () => world.mode === 'play' && !hud.isModalOpen() && !(world.toss && world.toss.active) && !(world.booth && world.booth.active)
    && !(world.player && world.player.controller) && !(typeof document !== 'undefined' && document.hidden);

  function celebrate(c) {
    const p = world.player ? world.player.position : null;
    if (c.all) {
      sfx('tada', { volume: 0.9 });
      sfx('crowd', { volume: 0.5 });
      hud.big('ALL STAR!', 'All ' + total + ' things to do, done! You won the ' + TODO_REWARD.label + '!', { ms: 3200, color: '#ffd36e' });
      if (p) {
        world.spawnBurst(p.x, p.y + 1.6, p.z, { count: 60, speed: 7 });
        setTimeout(() => world.spawnBurst(p.x, p.y + 2.4, p.z, { count: 40, speed: 5, colors: [0xffd36e, 0xff2e93, 0xffffff] }), 450);
      }
      if (world.player && world.player.emote) world.player.emote('cheer', 2.4);
      hud.toast('Unlocked: ' + TODO_REWARD.label + '! Try it on in My cheerleader.', { icon: 'bow', ms: 5200 });
      chip.classList.add('c9do-bye');
      setTimeout(paintChip, 900);
      return;
    }
    const g = TODO_GOALS.find((x) => x.id === c.id);
    if (!g) return;
    sfx('chime', { volume: 0.8, pitch: 1 + c.n * 0.05 });
    sfx('sparkle', { volume: 0.6, pitch: 1.2 });
    shownN = Math.max(shownN, c.n);
    paintChip();
    popChip();
    if (p) world.spawnBurst(p.x, p.y + 1.9, p.z, { count: 16, speed: 3, size: 0.35 });
    hud.toast(g.yay + ' To do: ' + c.n + ' of ' + total + ' done!', { icon: 'check', ms: 3000 });
  }

  function update(dt) {
    poll += dt || 0;
    if (poll >= 0.25) {
      poll = 0;
      // a picture at the booth
      const photo = world.booth ? world.booth.lastPhoto : null;
      if (photo && photo !== lastPhoto) tick('photo');
      lastPhoto = photo;
      // a game round reached its results: she played one (the game layer's state; in a room the
      // shared one is the same)
      const ag = world.activeGame;
      const g = ag ? (world.play && world.play.state) || (world.net ? world.net.game : null) : null;
      if (ag && g && g.kind === ag.kind && g.phase === 'results') tick('game');
    }
    if (queue.length && performance.now() >= nextAt && free()) {
      celebrate(queue.shift());
      nextAt = performance.now() + GAP_MS;
    }
  }

  // ---------------------------------------------------------------- the card
  function listEl() {
    const all = todoCount(state) >= total;
    const box = el('div', 'c9do-card');
    const ul = el('ul', 'c9do-list');
    for (const g of TODO_GOALS) {
      const done = state.done.includes(g.id);
      const li = el('li', 'c9do-item' + (done ? ' c9do-done' : ''));
      const mark = el('span', 'c9do-mark');
      if (done) mark.appendChild(icon('check'));
      const main = el('span', 'c9do-main');
      main.appendChild(el('span', 'c9do-label', g.label));
      if (!done) main.appendChild(el('span', 'c9do-tip', g.tip));
      li.append(mark, main);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const prize = el('p', 'c9do-prize' + (all ? ' c9do-won' : ''));
    prize.appendChild(icon('bow', 'c9-icon c9do-prize-icon'));
    const won = all || state.won;
    prize.appendChild(el('span', null, won ? 'You won the ' + TODO_REWARD.label + '! Try it on in My cheerleader.' : 'Do all ' + total + ' to win a ' + TODO_REWARD.label + ' for your cheerleader!'));
    box.appendChild(prize);
    return box;
  }
  function open() {
    const n = todoCount(state);
    const all = n >= total;
    if (!state.seen) {
      state.seen = true;
      save();
      paintChip();
    }
    sfx('open', { volume: 0.5 });
    hud.openCard({
      kicker: 'Things to do',
      title: all ? 'ALL STAR!' : n ? n + ' of ' + total + ' done!' : 'Fun things to try!',
      contentEl: listEl(),
      accent: '#ffd36e',
      actions: all && typeof opts.onCreator === 'function'
        ? [{ label: 'My cheerleader', icon: 'bow', primary: true, onClick: () => opts.onCreator() }, { label: 'Yay!', primary: false }]
        : [{ label: "Let's go!", icon: 'play', primary: true }],
    });
  }

  return {
    tick,
    open,
    update,
    gameEnded(ag) {
      if (ag && Number.isFinite(ag.startedAt) && Date.now() - ag.startedAt >= GAME_MIN_MS) tick('game');
    },
    lock: (locked) => withTodoLock(locked, state),
    get row() { return { done: todoCount(state), total }; },
    get state() { return cleanTodo(state); },
    get allDone() { return todoCount(state) >= total; },
    get pending() { return queue.length; },
    chip,
  };
}
