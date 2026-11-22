// The screens around the world: title, main menu, the join keypad, the room lobby, the cheerleader
// placeholder and friendly messages, plus the in-world menu and the host's game picker (those two
// are built here and shown in HUD panels). Big, friendly, pastel with hot pink and black, and the
// star-bow everywhere. Works in a portrait phone and a landscape tablet. Text is textContent only.
//
//   const menu = createMenu(rootEl)
//   menu.title({ onPlay })
//   menu.main({ nick, onSolo, onMake, onJoin, onCheerleader, onNewName, sound, onSound }) -> { setNick(n) }
//   menu.join({ onSubmit(code) -> Promise<{ ok, reason }>, onBack, initial })
//   menu.lobby({ code, onStart, onLeave, onExplore, onLock(on), onSendHome(id) })
//                       -> { update({ players, isHost, hostNick, status, locked }) }
//                       the host gets a "Lock the room" toggle and a "Send home" button on each friend
//                       (two taps, so a slip of the thumb never sends anyone home)
//   menu.closet({ nick, onNewName, onSurprise, onDone }) -> { setNick(n) }     (no creator.js yet)
//   menu.message({ title, lines, icon, actions: [{ label, onClick, primary }] })
//   menu.busy(text) / menu.hide() / menu.current / menu.setSound(on)
//   buildPauseMenu({ code, isHost, canPick, places, sound, quality, sticks: { count, total }, notes (count), onClose,
//                    onTravel, onPick, onCheerleader, onSticks, onNotes, onSound, onQuality, onLeave, leaveLabel,
//                    todo: { done, total }, onTodo }) -> element
//   buildPicker({ games, onPick }) -> element
//   JOIN_REASONS      friendly words for every joinRoom failure

import { GAME } from '../config.js';
import { el, icon, onTap, bowSvg, starSvg, button } from './dom.js';
import { createCodeEntry, keypadRows } from './codepad.js';

export const JOIN_REASONS = {
  'not-found': { title: 'Hmm, no room there', line: 'Check the letters with your friend and try again!' },
  full: { title: 'That room is full', line: 'A room holds ' + GAME.maxPlayers + ' cheerleaders. Maybe start your own?' },
  offline: { title: "Can't reach your friends", line: 'Rooms need the internet. You can still play by yourself!' },
  'bad-code': { title: 'That code looks funny', line: 'Room codes are 4 letters and numbers.' },
  locked: { title: 'This room is locked', line: 'Ask the host to unlock it!' },
  error: { title: 'Oops, a hiccup', line: 'Something went wobbly. Try again in a moment!' },
};

function logo() {
  const wrap = el('div', 'c9m-logo');
  const bow = bowSvg({ className: 'c9m-logo-bow' });
  const words = el('h1', 'c9m-logo-words');
  words.setAttribute('aria-label', GAME.title);
  const parts = GAME.title.split(' ');
  parts.forEach((p, i) => {
    const w = el('span', 'c9m-logo-word c9m-logo-word' + i, p);
    w.setAttribute('aria-hidden', 'true');
    words.appendChild(w);
  });
  wrap.append(bow, words);
  return wrap;
}

function bigButton(text, iconName, kind, onClick) {
  const b = button('c9m-btn c9m-btn-' + kind, text, onClick, { icon: iconName });
  return b;
}

function tiles(code, className = 'c9m-tiles') {
  const row = el('div', className);
  row.setAttribute('aria-label', 'Room code ' + String(code || '').split('').join(' '));
  for (const ch of String(code || '').padEnd(GAME.roomCodeLength, ' ').slice(0, GAME.roomCodeLength)) {
    const t = el('span', 'c9m-tile', ch.trim());
    t.setAttribute('aria-hidden', 'true');
    row.appendChild(t);
  }
  return row;
}

export function createMenu(root) {
  root.classList.add('c9m-root');
  let screen = null;
  let current = null;
  let soundBtn = null;
  let soundOn = false;
  let keyHandler = null;

  function clear() {
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    soundBtn = null;
    root.replaceChildren();
    screen = null;
  }

  function mount(name, node) {
    clear();
    current = name;
    screen = node;
    root.hidden = false;
    root.appendChild(node);
    node.classList.add('c9m-in');
    root.dataset.screen = name;
    const focus = node.querySelector('[data-autofocus]');
    if (focus && !matchMedia('(pointer: coarse)').matches) focus.focus({ preventScroll: true });
    return node;
  }

  function soundToggle(onSound) {
    const b = el('button', 'c9m-sound');
    b.type = 'button';
    soundBtn = b;
    paintSound();
    onTap(b, () => onSound && onSound());
    return b;
  }
  function paintSound() {
    if (!soundBtn) return;
    soundBtn.replaceChildren(icon(soundOn ? 'sound' : 'mute'), el('span', 'c9m-sound-label', soundOn ? 'Sound on' : 'Sound off'));
    soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    soundBtn.classList.toggle('c9m-on', soundOn);
  }

  function frame(className) {
    const s = el('section', 'c9m-screen ' + className);
    s.setAttribute('role', 'dialog');
    return s;
  }

  function card(title, sub) {
    const c = el('div', 'c9m-card');
    if (title) {
      const h = el('h2', 'c9m-title', title);
      c.appendChild(h);
    }
    if (sub) c.appendChild(el('p', 'c9m-sub', sub));
    return c;
  }

  function backButton(onBack, label = 'Back') {
    const b = button('c9m-back', label, onBack, { icon: 'back' });
    return b;
  }

  // ---------------------------------------------------------------- title
  function title({ onPlay, onSound, sound } = {}) {
    if (sound !== undefined) soundOn = !!sound;
    const s = frame('c9m-title-screen');
    s.setAttribute('aria-label', GAME.title);
    const center = el('div', 'c9m-title-center');
    center.appendChild(logo());
    center.appendChild(el('p', 'c9m-tagline', 'A sky island for cheerleaders who fly'));
    const play = bigButton('Play!', 'play', 'play', () => onPlay && onPlay());
    play.dataset.autofocus = '1';
    center.appendChild(play);
    s.appendChild(center);
    if (onSound) s.appendChild(soundToggle(onSound));
    for (let i = 0; i < 7; i++) s.appendChild(starSvg(i % 3 === 0 ? '#ff2e93' : i % 3 === 1 ? '#17121c' : '#ffffff', 'c9m-float-star c9m-float-star' + i));
    return mount('title', s);
  }

  // ---------------------------------------------------------------- main menu
  function main({ nick, onSolo, onMake, onJoin, onCheerleader, onNewName, sound, onSound, online = true } = {}) {
    if (sound !== undefined) soundOn = !!sound;
    const s = frame('c9m-main-screen');
    s.setAttribute('aria-label', 'Main menu');
    const c = card(null, null);
    c.classList.add('c9m-main-card');
    const hi = el('div', 'c9m-hi');
    const hiText = el('div', 'c9m-hi-text');
    hiText.appendChild(el('span', 'c9m-hi-small', 'Hi,'));
    const nickEl = el('span', 'c9m-hi-nick', nick || 'Cheerleader');
    hiText.appendChild(nickEl);
    hi.appendChild(hiText);
    if (onNewName) {
      const dice = button('c9m-dice', '', () => onNewName(), { icon: 'dice', label: 'New name' });
      dice.title = 'New name';
      hi.appendChild(dice);
    }
    c.appendChild(hi);
    const list = el('div', 'c9m-list');
    const solo = bigButton('Play by myself', 'star', 'primary', () => onSolo && onSolo());
    solo.dataset.autofocus = '1';
    list.appendChild(solo);
    if (online) {
      list.append(bigButton('Make a room', 'plus', 'white', () => onMake && onMake()), bigButton('Join a room', 'key', 'white', () => onJoin && onJoin()));
    }
    list.append(bigButton('My cheerleader', 'bow', 'lilac', () => onCheerleader && onCheerleader()));
    c.appendChild(list);
    s.appendChild(c);
    if (onSound) s.appendChild(soundToggle(onSound));
    mount('main', s);
    return {
      setNick(n) {
        nickEl.textContent = n || 'Cheerleader';
        nickEl.classList.remove('c9m-pop');
        void nickEl.offsetWidth;
        nickEl.classList.add('c9m-pop');
      },
    };
  }

  // ---------------------------------------------------------------- join: the keypad
  function join({ onSubmit, onBack, initial = '' } = {}) {
    const s = frame('c9m-join-screen');
    s.setAttribute('aria-label', 'Join a room');
    const c = card('Join a room', 'Type the code on your friend’s screen');
    c.classList.add('c9m-join-card');
    const slots = el('div', 'c9m-tiles c9m-slots');
    const slotEls = [];
    for (let i = 0; i < GAME.roomCodeLength; i++) {
      const t = el('span', 'c9m-tile c9m-slot');
      slotEls.push(t);
      slots.appendChild(t);
    }
    const msg = el('p', 'c9m-msg', '');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    const pad = el('div', 'c9m-pad');
    const keys = new Map();
    for (const ch of GAME.roomCodeAlphabet) {
      const k = el('button', 'c9m-key', ch);
      k.type = 'button';
      k.dataset.key = ch;
      onTap(k, () => press(ch));
      keys.set(ch, k);
      pad.appendChild(k);
    }
    const back = el('button', 'c9m-key c9m-key-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Delete');
    back.appendChild(icon('backspace'));
    onTap(back, () => {
      entry.back();
      msg.textContent = '';
    });
    pad.appendChild(back);
    const go = bigButton('Join!', 'check', 'primary', () => submit());
    go.classList.add('c9m-go');
    const row = el('div', 'c9m-row');
    row.append(backButton(() => onBack && onBack()), go);
    c.append(slots, msg, pad, row);
    s.appendChild(c);

    let busy = false;
    const entry = createCodeEntry({ onChange: paint });
    function paint() {
      const sl = entry.slots();
      sl.forEach((ch, i) => {
        slotEls[i].textContent = ch;
        slotEls[i].classList.toggle('c9m-filled', !!ch);
        slotEls[i].classList.toggle('c9m-next', !ch && (i === 0 || !!sl[i - 1]));
      });
      go.disabled = !entry.complete || busy;
      go.classList.toggle('c9m-ready', entry.complete && !busy);
    }
    function press(ch) {
      if (busy) return;
      if (entry.press(ch)) {
        msg.textContent = '';
        const k = keys.get(ch);
        if (k) {
          k.classList.remove('c9m-tapped');
          void k.offsetWidth;
          k.classList.add('c9m-tapped');
        }
      }
    }
    async function submit() {
      if (!entry.complete || busy) return;
      busy = true;
      paint();
      go.querySelector('.c9-btn-label').textContent = 'Joining...';
      msg.textContent = '';
      let res = null;
      try {
        res = await onSubmit(entry.value);
      } catch (err) {
        res = { ok: false, reason: 'error' };
      }
      busy = false;
      if (current !== 'join') return;
      go.querySelector('.c9-btn-label').textContent = 'Join!';
      if (!res || !res.ok) {
        const why = JOIN_REASONS[res && res.reason] || JOIN_REASONS.error;
        msg.textContent = why.title + '. ' + why.line;
        slots.classList.remove('c9m-shake');
        void slots.offsetWidth;
        slots.classList.add('c9m-shake');
      }
      paint();
    }
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        entry.back();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        if (onBack) onBack();
      } else if (e.key && e.key.length === 1) press(e.key);
    };
    if (initial) entry.set(initial);
    paint();
    mount('join', s);
    keyHandler = onKey; // after mount(), which drops the previous screen's handler
    window.addEventListener('keydown', keyHandler);
    return { press, submit, get value() { return entry.value; } };
  }

  // ---------------------------------------------------------------- lobby
  function lobby({ code, onStart, onLeave, onExplore, onLock, onSendHome } = {}) {
    const s = frame('c9m-lobby-screen');
    s.setAttribute('aria-label', 'Your room');
    const c = card(null, null);
    c.classList.add('c9m-lobby-card');
    c.appendChild(el('p', 'c9m-kicker', 'Room code'));
    c.appendChild(tiles(code, 'c9m-tiles c9m-tiles-huge'));
    const tell = el('p', 'c9m-sub', 'Friends tap “Join a room” and type this code.');
    c.appendChild(tell);
    const who = el('ul', 'c9m-who');
    c.appendChild(who);
    let locked = false;
    const lockNote = el('p', 'c9m-sub c9m-lock-note', '');
    // a double tap is one tap: the room answers fast, so its second half would unlock it again
    let lockTapAt = -1e9;
    const lockBtn = bigButton('Lock the room', 'key', 'white', () => {
      const now = performance.now();
      if (now - lockTapAt < 900) return;
      lockTapAt = now;
      if (onLock) onLock(!locked);
    });
    lockBtn.classList.add('c9m-lock');
    c.append(lockNote, lockBtn);
    const status = el('p', 'c9m-msg', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    c.appendChild(status);
    const start = bigButton('Start!', 'play', 'primary', () => onStart && onStart());
    start.dataset.autofocus = '1';
    const explore = bigButton('Explore while you wait', 'star', 'white', () => onExplore && onExplore());
    const row = el('div', 'c9m-row');
    row.append(backButton(() => onLeave && onLeave(), 'Leave'), start, explore);
    c.appendChild(row);
    s.appendChild(c);
    mount('lobby', s);
    let lastKey = '';
    return {
      update({ players = [], isHost = false, hostNick = '', status: st = '', locked: lk = false } = {}) {
        start.hidden = !isHost;
        explore.hidden = isHost;
        tell.textContent = isHost ? 'Friends tap “Join a room” and type this code.' : 'You’re in! Waiting for ' + (hostNick || 'the host') + ' to start.';
        if (isHost && lk) tell.textContent = 'The room is locked: only the friends here can play.';
        status.textContent = st || '';
        locked = !!lk;
        lockBtn.hidden = !isHost || !onLock;
        lockBtn.querySelector('.c9-btn-label').textContent = locked ? 'Unlock the room' : 'Lock the room';
        lockNote.textContent = locked && !isHost ? 'The host locked the room for this game.' : '';
        lockNote.hidden = !lockNote.textContent;
        const key = JSON.stringify([isHost, players.map((p) => [p.id, p.nick, p.host, p.me, p.color, p.bot])]);
        if (key === lastKey) return;
        lastKey = key;
        who.replaceChildren();
        for (const p of players) {
          const li = el('li', 'c9m-who-item' + (p.me ? ' c9m-me' : ''));
          const dot = el('span', 'c9m-who-dot');
          if (p.color) dot.style.background = p.color;
          li.append(dot, el('span', 'c9m-who-name', p.nick || 'Cheerleader'));
          if (p.host) li.appendChild(icon('crown', 'c9-icon c9m-who-crown'));
          if (p.me) li.appendChild(el('span', 'c9m-who-you', 'you'));
          if (isHost && onSendHome && !p.me && !p.bot) li.appendChild(homeButton(p, onSendHome));
          who.appendChild(li);
        }
        if (players.length < 2 && isHost) {
          const li = el('li', 'c9m-who-item c9m-who-wait', 'Waiting for friends...');
          who.appendChild(li);
        }
      },
    };
  }

  // "Send home" on a friend's name: the first tap asks, the second (within 3 s) sends. The second
  // half of a double tap is not the "Tap again": it has to be a tap of its own.
  function homeButton(p, onSendHome) {
    let sure = false;
    let timer = null;
    let askedAt = 0;
    const b = button('c9m-home', 'Send home', () => {
      if (sure) {
        if (performance.now() - askedAt < 450) return;
        clearTimeout(timer);
        b.disabled = true;
        onSendHome(p.id, p.nick);
        return;
      }
      sure = true;
      askedAt = performance.now();
      b.classList.add('c9m-sure');
      b.querySelector('.c9-btn-label').textContent = 'Tap again';
      timer = setTimeout(() => {
        sure = false;
        b.classList.remove('c9m-sure');
        b.querySelector('.c9-btn-label').textContent = 'Send home';
      }, 3000);
    }, { icon: 'home' });
    b.setAttribute('aria-label', 'Send ' + (p.nick || 'this friend') + ' home');
    return b;
  }

  // ---------------------------------------------------------------- the closet placeholder
  function closet({ nick, onNewName, onSurprise, onDone } = {}) {
    const s = frame('c9m-closet-screen');
    s.setAttribute('aria-label', 'My cheerleader');
    const c = card('My cheerleader', null);
    c.classList.add('c9m-closet-card');
    c.appendChild(el('p', 'c9m-sub', 'The big closet is still being decorated! For now, try a new name or a surprise look.'));
    const nameRow = el('div', 'c9m-hi');
    const nameText = el('div', 'c9m-hi-text');
    nameText.appendChild(el('span', 'c9m-hi-small', 'Name'));
    const nickEl = el('span', 'c9m-hi-nick', nick || 'Cheerleader');
    nameText.appendChild(nickEl);
    nameRow.appendChild(nameText);
    const dice = button('c9m-dice', '', () => onNewName && onNewName(), { icon: 'dice', label: 'New name' });
    nameRow.appendChild(dice);
    c.appendChild(nameRow);
    const list = el('div', 'c9m-list');
    const done = bigButton('Done', 'check', 'primary', () => onDone && onDone());
    done.dataset.autofocus = '1';
    list.append(bigButton('Surprise me!', 'sparkle', 'lilac', () => onSurprise && onSurprise()), done);
    c.appendChild(list);
    s.appendChild(c);
    mount('closet', s);
    return {
      setNick(n) {
        nickEl.textContent = n || 'Cheerleader';
        nickEl.classList.remove('c9m-pop');
        void nickEl.offsetWidth;
        nickEl.classList.add('c9m-pop');
      },
    };
  }

  // ---------------------------------------------------------------- messages and waiting
  function message({ title: t, lines = [], icon: ic = 'bow', actions = [] } = {}) {
    const s = frame('c9m-message-screen');
    const c = card(null, null);
    c.classList.add('c9m-message-card');
    const art = el('div', 'c9m-art');
    art.appendChild(ic === 'bow' ? bowSvg({ className: 'c9m-art-bow' }) : icon(ic));
    c.appendChild(art);
    c.appendChild(el('h2', 'c9m-title', t || ''));
    for (const l of lines) c.appendChild(el('p', 'c9m-sub', l));
    const list = el('div', 'c9m-list');
    actions.forEach((a, i) => {
      const b = bigButton(a.label, a.icon || null, a.primary || (i === 0 && a.primary !== false) ? 'primary' : 'white', () => a.onClick && a.onClick());
      if (i === 0) b.dataset.autofocus = '1';
      list.appendChild(b);
    });
    c.appendChild(list);
    s.appendChild(c);
    return mount('message', s);
  }

  function busy(text) {
    const s = frame('c9m-busy-screen');
    const c = card(null, null);
    c.classList.add('c9m-busy-card');
    const b = bowSvg({ className: 'c9m-spin-bow' });
    c.append(b, el('p', 'c9m-sub', text || 'One sec...'));
    s.appendChild(c);
    return mount('busy', s);
  }

  return {
    title,
    main,
    join,
    lobby,
    closet,
    message,
    busy,
    hide() {
      clear();
      current = null;
      root.hidden = true;
      delete root.dataset.screen;
    },
    setSound(on) {
      soundOn = !!on;
      paintSound();
    },
    get current() { return current; },
    get el() { return root; },
  };
}

// ------------------------------------------------------------------------------------ in-world pieces

function row(title, sub, iconName, onClick, extra = {}) {
  const b = el('button', 'c9-row' + (extra.className ? ' ' + extra.className : ''));
  b.type = 'button';
  const ic = el('span', 'c9-row-icon');
  ic.appendChild(icon(iconName || 'star'));
  const main = el('span', 'c9-row-main');
  main.appendChild(el('span', 'c9-row-title', title));
  if (sub) main.appendChild(el('span', 'c9-row-sub', sub));
  b.append(ic, main);
  if (extra.tag) b.appendChild(el('span', 'c9-row-tag', extra.tag));
  onTap(b, onClick);
  return b;
}

export function buildPauseMenu(o = {}) {
  const box = el('div', 'c9-menu');
  if (o.code) {
    const r = el('div', 'c9-menu-room');
    r.appendChild(el('span', 'c9-menu-room-label', 'Room code'));
    r.appendChild(tiles(o.code, 'c9m-tiles c9m-tiles-small'));
    box.appendChild(r);
  }
  const list = el('div', 'c9-list');
  list.appendChild(row('Keep playing', null, 'play', () => o.onClose && o.onClose(), { className: 'c9-row-primary' }));
  if (o.canPick) list.appendChild(row('Pick a game', o.isHost ? 'Everyone plays together' : 'Play with bot friends', 'games', () => o.onPick && o.onPick()));
  if (o.todo && o.todo.total) {
    const t = o.todo;
    list.appendChild(row('Things to do', t.done >= t.total ? 'All done. You are an all star!' : 'Fun things to try on Cloud Nine', 'check',
      () => o.onTodo && o.onTodo(), { tag: t.done + '/' + t.total, className: 'c9-row-todo' }));
  }
  if (o.code && o.isHost && o.onLock) {
    list.appendChild(o.locked
      ? row('Room is locked', 'Only the friends here can play. Tap to unlock.', 'key', () => o.onLock(false), { tag: 'LOCKED', className: 'c9-row-locked' })
      : row('Lock the room', 'Only the friends here now can play', 'key', () => o.onLock(true)));
  }
  if (o.code && o.isHost && o.onSendHome && o.friends > 0) list.appendChild(row('Send a friend home', 'They keep playing on their own island', 'home', () => o.onSendHome()));
  list.appendChild(row('My cheerleader', 'Change your look', 'bow', () => o.onCheerleader && o.onCheerleader()));
  if (o.notes > 0) {
    list.appendChild(row('Notes from your family', o.notes === 1 ? 'A note just for you' : o.notes + ' notes just for you', 'bow',
      () => o.onNotes && o.onNotes(), { className: 'c9-row-notes' }));
  }
  if (o.sticks && o.sticks.total) {
    const s = o.sticks;
    const all = s.count >= s.total;
    list.appendChild(row('Spirit sticks', all ? 'You found every one!' : s.count + ' of ' + s.total + ' found. Tap for a hint!', 'star',
      () => o.onSticks && o.onSticks(), { tag: s.count + '/' + s.total, className: 'c9-row-sticks' }));
  }
  list.appendChild(row(o.sound ? 'Sound is on' : 'Sound is off', 'Tap to turn it ' + (o.sound ? 'off' : 'on'), o.sound ? 'sound' : 'mute', () => o.onSound && o.onSound()));
  list.appendChild(row('Graphics', o.quality === 'low' ? 'Battery saver. Tap for automatic.' : 'Automatic. Tap for battery saver.', 'sparkle', () => o.onQuality && o.onQuality(), { tag: o.quality === 'low' ? 'SAVER' : 'AUTO' }));
  list.appendChild(row(o.leaveLabel || 'Back to the menu', null, 'door', () => o.onLeave && o.onLeave()));
  box.appendChild(list);
  if (o.places && o.places.length) {
    box.appendChild(el('h3', 'c9-h3', 'Go to'));
    const grid = el('div', 'c9-places');
    for (const p of o.places) {
      const b = el('button', 'c9-place');
      b.type = 'button';
      b.appendChild(icon(p.icon || 'star'));
      b.appendChild(el('span', 'c9-place-name', p.name));
      onTap(b, () => o.onTravel && o.onTravel(p));
      grid.appendChild(b);
    }
    box.appendChild(grid);
  }
  return box;
}

export function buildPicker({ games = [], onPick, note = '' } = {}) {
  const box = el('div', 'c9-picker');
  if (note) box.appendChild(el('p', 'c9-note', note));
  const grid = el('div', 'c9-games');
  for (const g of games) {
    const b = el('button', 'c9-game-tile');
    b.type = 'button';
    b.style.setProperty('--tile', g.color || '#ffd6ea');
    const art = el('span', 'c9-game-art');
    art.appendChild(icon(g.icon || 'star'));
    b.append(art, el('span', 'c9-game-name', g.title), el('span', 'c9-game-blurb', g.blurb || ''));
    onTap(b, () => onPick && onPick(g));
    grid.appendChild(b);
  }
  box.appendChild(grid);
  return box;
}
