// The in-world HUD (Contract 1: world.hud). DOM over the canvas; the overlay itself never eats
// touches, only its controls do, so the joystick (core/input.js, on the canvas) works anywhere else.
// Every piece of text is set with textContent.
//
// Contract 1:
//   hud.toast(text, { icon, ms })            icon: an emoji or an icon name from ui/dom.js
//   hud.prompt(label, onUse, { icon }) -> clear()   the big use button; wins over interact's suggestion
//   hud.clearPrompt(onUse?)                  clears the prompt (only if it is still that onUse, when given)
//   hud.big(text, sub, { ms, color }) -> Promise    centre splash, never blocks input
//   hud.setGameUI(game.ui(meId) | null)      title, line, timer, role badge, scoreboard (and `big` splashes)
// Also:
//   hud.setAction({ label, icon } | null) / hud.onAction(fn)    interact.js's suggestion channel
//   hud.usePrompt() -> boolean               what the use button does (keyboard E / Enter / Space)
//   hud.hasPrompt / hud.actionLabel
//   hud.onButton('menu' | 'sound' | 'games' | 'emote' | 'jump' | 'people', fn) -> off
//   hud.setButton(name, { hidden, pressed, label })
//   hud.setPlayers([{ id, nick, color, host, bot, me }]) / hud.setRoom(code | null)
//   hud.openWheel(emotes, onPick) / hud.closeWheel() / hud.pickWheel(n) / hud.wheelOpen
//   hud.openCard({ kicker, title, lines, contentEl, actions: [{ label, onClick, primary, keepOpen, icon }], onClose, accent })
//   hud.closeCard() / hud.openPanel({ title, contentEl, onClose }) / hud.closePanel() / hud.closeAll()
//   hud.isModalOpen() / hud.on('modal', fn(open))    main.js suspends world input while one is open
//   hud.escape() -> boolean                  closes the top-most wheel, card or panel
//   hud.setPlaying(bool)                     shows or hides the in-world controls (menus hide them)
//   hud.showHint(text) / hud.hideHint() / hud.fade(on, ms) -> Promise / hud.setDebug(text)
//   hud.setLoading(progress01, text) / hud.hideLoading()
//   hud.stick                                { show, move, hide } for core/input.js

import { emitter } from '../core/util.js';
import { el, icon, onTap, starSvg, cssColor, wait, reducedMotion } from './dom.js';
import { normalizeGameUI } from './gameui.js';

const ICON_NAMES = new Set(['menu', 'sound', 'mute', 'games', 'emote', 'jump', 'close', 'back', 'people', 'dice', 'play', 'plus', 'key', 'home', 'star', 'check', 'hand', 'bow', 'map', 'door', 'sparkle', 'robot', 'crown', 'eyes', 'snow', 'ball', 'music', 'flag']);

function iconOrText(v, className) {
  if (typeof v !== 'string' || !v) return null;
  if (ICON_NAMES.has(v)) return icon(v, className === 'c9-icon' ? 'c9-icon' : 'c9-icon ' + className);
  if (v.length <= 4) return el('span', className + ' c9-emoji', v);
  return null;
}

export function createHud(root, opts = {}) {
  const events = emitter();
  const handlers = {};
  root.classList.add('c9-hud');

  function fire(name, arg) {
    const list = handlers[name];
    if (!list) return;
    for (const fn of [...list]) {
      try {
        fn(arg);
      } catch (err) {
        console.error('[c9] hud "' + name + '" handler failed', err);
      }
    }
  }

  // ---------------------------------------------------------------- top: room, people, buttons
  const top = el('div', 'c9-top');
  const left = el('div', 'c9-left');
  const room = el('div', 'c9-room');
  room.hidden = true;
  const roomLabel = el('span', 'c9-room-label', 'Room');
  const roomCode = el('span', 'c9-room-code', '');
  room.append(roomLabel, roomCode);
  const people = el('div', 'c9-people');
  people.hidden = true;
  const peopleBtn = el('button', 'c9-people-btn');
  peopleBtn.type = 'button';
  peopleBtn.setAttribute('aria-label', 'Who is here');
  peopleBtn.setAttribute('aria-expanded', 'false');
  const peopleCount = el('span', 'c9-people-count', '1');
  peopleBtn.append(icon('people'), peopleCount);
  const peopleList = el('ul', 'c9-people-list');
  people.append(peopleBtn, peopleList);
  let peopleOpen = null; // null: automatic (open on wide screens)
  onTap(peopleBtn, () => {
    peopleOpen = !isPeopleOpen();
    paintPeopleOpen();
    fire('people', peopleOpen);
  });
  // automatic: open on wide screens while the room is small, a tidy pill otherwise
  const isPeopleOpen = () => (peopleOpen === null ? window.innerWidth >= 700 && peopleList.children.length <= 5 : peopleOpen);
  function paintPeopleOpen() {
    const open = isPeopleOpen();
    people.classList.toggle('c9-open', open);
    peopleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (typeof layoutToasts === 'function') layoutToasts();
  }
  window.addEventListener('resize', paintPeopleOpen);
  const debug = el('pre', 'c9-debug');
  debug.hidden = true;
  left.append(room, people, debug);

  const buttons = el('div', 'c9-buttons');
  buttons.setAttribute('role', 'toolbar');
  buttons.setAttribute('aria-label', 'Game controls');
  const btn = {};
  for (const [name, label, ic] of [['games', 'Pick a game', 'games'], ['sound', 'Sound', 'sound'], ['menu', 'Menu', 'menu']]) {
    const b = el('button', 'c9-round c9-round-' + name);
    b.type = 'button';
    b.dataset.name = name;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(icon(ic));
    onTap(b, () => fire(name));
    buttons.appendChild(b);
    btn[name] = b;
  }
  btn.games.hidden = true;
  top.append(left, buttons);

  // ---------------------------------------------------------------- toasts, game panel, big splash, hint
  const toasts = el('div', 'c9-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');

  const game = el('div', 'c9-game');
  game.hidden = true;
  const gameHead = el('div', 'c9-game-head');
  const gameTitle = el('span', 'c9-game-title', '');
  const gameTimer = el('span', 'c9-game-timer', '');
  gameHead.append(gameTitle, gameTimer);
  const gameRole = el('div', 'c9-game-role', '');
  const gameLine = el('div', 'c9-game-line', '');
  const gameBoard = el('ol', 'c9-game-board');
  game.append(gameHead, gameRole, gameLine, gameBoard);
  left.prepend(game); // narrow screens: it stacks above the chips; wide screens: CSS centres it
  let lastBig = '';

  const bigEl = el('div', 'c9-big');
  bigEl.hidden = true;
  bigEl.setAttribute('aria-live', 'assertive');
  const bigText = el('div', 'c9-big-text', '');
  const bigSub = el('div', 'c9-big-sub', '');
  const bigStars = el('div', 'c9-big-stars');
  for (let i = 0; i < 6; i++) bigStars.appendChild(starSvg(i % 2 ? '#ff2e93' : '#17121c', 'c9-big-star c9-big-star' + i));
  bigEl.append(bigStars, bigText, bigSub);
  let bigTimer = 0;
  let bigDone = null;

  const hint = el('div', 'c9-hint');
  hint.hidden = true;

  // ---------------------------------------------------------------- controls: use, jump, emote
  const controls = el('div', 'c9-controls');
  const use = el('button', 'c9-use');
  use.type = 'button';
  use.hidden = true;
  const useIcon = el('span', 'c9-use-icon');
  const useLabel = el('span', 'c9-use-label', '');
  use.append(useIcon, useLabel);
  onTap(use, () => usePrompt());
  const jumpBtn = el('button', 'c9-jump');
  jumpBtn.type = 'button';
  jumpBtn.setAttribute('aria-label', 'Jump');
  jumpBtn.append(icon('jump'), el('span', 'c9-jump-label', 'Jump'));
  // jump fires on touch-down: it has to feel instant
  jumpBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    jumpBtn.classList.add('c9-down');
    fire('jump');
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) jumpBtn.addEventListener(type, () => jumpBtn.classList.remove('c9-down'));
  jumpBtn.addEventListener('click', (e) => {
    if (e.detail === 0) fire('jump'); // keyboard activation
  });
  const emoteBtn = el('button', 'c9-emote-btn');
  emoteBtn.type = 'button';
  emoteBtn.setAttribute('aria-label', 'Cheer and emotes');
  emoteBtn.appendChild(icon('emote'));
  onTap(emoteBtn, () => fire('emote'));
  controls.append(use, emoteBtn, jumpBtn);
  btn.jump = jumpBtn;
  btn.emote = emoteBtn;

  let explicit = null; // { label, onUse, icon } from hud.prompt
  let suggested = null; // { label, icon } from interact
  function paintUse() {
    const p = explicit || suggested;
    root.classList.toggle('c9-prompting', !!(p && p.label));
    if (!p || !p.label) {
      use.hidden = true;
      return;
    }
    useLabel.textContent = p.label;
    useIcon.replaceChildren(iconOrText(p.icon, 'c9-icon') || icon('hand'));
    if (use.hidden) {
      use.hidden = false;
      use.classList.remove('c9-in');
      void use.offsetWidth;
      use.classList.add('c9-in');
    }
  }
  function usePrompt() {
    if (explicit && typeof explicit.onUse === 'function') {
      try {
        explicit.onUse();
      } catch (err) {
        console.error('[c9] prompt failed', err);
      }
      return true;
    }
    if (suggested) {
      fire('action');
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- joystick visual
  const stickEl = el('div', 'c9-stick');
  const knob = el('div', 'c9-stick-knob');
  knob.appendChild(starSvg('#ffffff', 'c9-stick-star'));
  stickEl.appendChild(knob);
  stickEl.hidden = true;
  const stick = {
    show(x, y) {
      stickEl.hidden = false;
      stickEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      knob.style.transform = 'translate(0px,0px)';
    },
    move(ox, oy, dx, dy) {
      stickEl.style.transform = 'translate(' + ox + 'px,' + oy + 'px)';
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    },
    hide() {
      stickEl.hidden = true;
    },
  };

  // ---------------------------------------------------------------- emote wheel
  const wheel = el('div', 'c9-wheel');
  wheel.hidden = true;
  wheel.setAttribute('role', 'dialog');
  wheel.setAttribute('aria-label', 'Cheers and emotes');
  const wheelDisc = el('div', 'c9-wheel-disc');
  const wheelClose = el('button', 'c9-wheel-close');
  wheelClose.type = 'button';
  wheelClose.setAttribute('aria-label', 'Close');
  wheelClose.appendChild(icon('close'));
  onTap(wheelClose, () => closeWheel());
  wheel.appendChild(wheelDisc);
  wheel.addEventListener('pointerdown', (e) => {
    if (e.target === wheel) closeWheel();
  });
  let wheelState = null;

  function openWheel(emotes, onPick) {
    const list = (Array.isArray(emotes) ? emotes : []).filter((e) => e && typeof e.id === 'string').slice(0, 12);
    wheelDisc.replaceChildren(wheelClose);
    const n = list.length;
    wheel.classList.toggle('c9-wheel-many', n > 8); // one bigger ellipse, smaller chips
    list.forEach((e, i) => {
      const b = el('button', 'c9-wheel-item');
      b.type = 'button';
      const ic = iconOrText(e.icon, 'c9-wheel-icon');
      if (ic) b.appendChild(ic);
      b.appendChild(el('span', 'c9-wheel-text', String(e.text || e.id).slice(0, 18)));
      b.appendChild(el('span', 'c9-wheel-key', String(i + 1)));
      // around the ellipse, starting at the top; with many, two straddle the top instead
      const a = -Math.PI / 2 + ((i + (n > 8 ? 0.5 : 0)) / n) * Math.PI * 2;
      b.style.setProperty('--x', Math.cos(a).toFixed(3));
      b.style.setProperty('--y', Math.sin(a).toFixed(3));
      b.style.setProperty('--d', (i * 0.025).toFixed(3) + 's');
      onTap(b, () => {
        closeWheel();
        onPick(e);
      });
      wheelDisc.appendChild(b);
    });
    wheelState = { list, onPick };
    wheel.hidden = false;
    wheel.classList.remove('c9-in');
    void wheel.offsetWidth;
    wheel.classList.add('c9-in');
    modalChanged();
    const first = wheelDisc.querySelector('.c9-wheel-item');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }
  function closeWheel() {
    if (!wheelState) return;
    wheelState = null;
    wheel.hidden = true;
    modalChanged();
  }
  function pickWheel(n) {
    if (!wheelState) return false;
    const e = wheelState.list[n - 1];
    if (!e) return false;
    const fn = wheelState.onPick;
    closeWheel();
    fn(e);
    return true;
  }

  // ---------------------------------------------------------------- card and panel
  const cardWrap = el('div', 'c9-card-wrap');
  cardWrap.hidden = true;
  const card = el('section', 'c9-card');
  card.setAttribute('role', 'dialog');
  card.tabIndex = -1;
  cardWrap.appendChild(card);
  let cardState = null;
  cardWrap.addEventListener('pointerdown', (e) => {
    if (e.target === cardWrap && cardState && cardState.dismissable) closeCard();
  });

  function closeButton(onClick) {
    const x = el('button', 'c9-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.appendChild(icon('close'));
    onTap(x, onClick);
    return x;
  }

  function openCard(o = {}) {
    if (cardState) closeCard(true);
    card.replaceChildren();
    card.style.setProperty('--accent', cssColor(o.accent) || '');
    if (o.dismissable !== false) card.appendChild(closeButton(() => closeCard()));
    if (o.icon) {
      const art = el('div', 'c9-card-art');
      art.appendChild(iconOrText(o.icon, 'c9-icon') || icon('star'));
      card.appendChild(art);
    }
    if (o.kicker) card.appendChild(el('p', 'c9-kicker', o.kicker));
    const title = el('h2', 'c9-title', o.title || '');
    title.id = 'c9-card-title';
    card.setAttribute('aria-labelledby', title.id);
    card.appendChild(title);
    if (o.steps && o.steps.length) {
      const ol = el('ol', 'c9-steps');
      for (const s of o.steps) ol.appendChild(el('li', null, s));
      card.appendChild(ol);
    }
    for (const line of o.lines || []) if (line) card.appendChild(el('p', 'c9-line', line));
    if (o.contentEl) card.appendChild(o.contentEl);
    if (o.actions && o.actions.length) {
      const row = el('div', 'c9-actions');
      o.actions.forEach((a, i) => {
        if (!a) return;
        const b = el('button', 'c9-btn' + (a.primary || (i === 0 && a.primary !== false) ? ' c9-btn-primary' : ''));
        b.type = 'button';
        if (a.icon) b.appendChild(icon(a.icon));
        b.appendChild(el('span', 'c9-btn-label', a.label));
        onTap(b, () => {
          if (!a.keepOpen) closeCard();
          if (typeof a.onClick === 'function') a.onClick();
        });
        row.appendChild(b);
      });
      card.appendChild(row);
    }
    cardState = { onClose: o.onClose || null, dismissable: o.dismissable !== false };
    cardWrap.hidden = false;
    card.classList.remove('c9-in');
    void card.offsetWidth;
    card.classList.add('c9-in');
    modalChanged();
    return card;
  }

  function closeCard(silent) {
    if (!cardState) return;
    const state = cardState;
    cardState = null;
    cardWrap.hidden = true;
    if (!silent) modalChanged();
    if (state.onClose) {
      try {
        state.onClose();
      } catch (err) {
        console.error('[c9] card onClose failed', err);
      }
    }
  }

  const panel = el('section', 'c9-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const panelHead = el('header', 'c9-panel-head');
  const panelTitle = el('h2', 'c9-panel-title', '');
  panelTitle.id = 'c9-panel-title';
  panel.setAttribute('aria-labelledby', panelTitle.id);
  panelHead.append(panelTitle, closeButton(() => closePanel()));
  const panelBody = el('div', 'c9-panel-body');
  panel.append(panelHead, panelBody);
  let panelState = null;

  function openPanel(o = {}) {
    if (panelState) closePanel(true);
    panelTitle.textContent = o.title || '';
    panelBody.replaceChildren();
    if (o.contentEl) panelBody.appendChild(o.contentEl);
    panelState = { onClose: o.onClose || null };
    panel.hidden = false;
    root.classList.add('c9-panel-open');
    panelBody.scrollTop = 0;
    panel.classList.remove('c9-in');
    void panel.offsetWidth;
    panel.classList.add('c9-in');
    modalChanged();
    return panelBody;
  }

  function closePanel(silent) {
    if (!panelState) return;
    const state = panelState;
    panelState = null;
    panel.hidden = true;
    root.classList.remove('c9-panel-open');
    panelBody.replaceChildren();
    if (!silent) modalChanged();
    if (state.onClose) {
      try {
        state.onClose();
      } catch (err) {
        console.error('[c9] panel onClose failed', err);
      }
    }
  }

  // ---------------------------------------------------------------- veil and fade
  const veil = opts.veil || null;
  const veilFill = veil ? veil.querySelector('.c9-veil-bar i') : null;
  const veilLine = veil ? veil.querySelector('.c9-veil-line') : null;
  const fadeEl = el('div', 'c9-fade');

  root.append(top, toasts, hint, controls, stickEl, bigEl, wheel, cardWrap, panel, fadeEl);

  // Toasts go under whatever is up top (chips, the game panel), so they never cover it.
  function layoutToasts() {
    const narrow = window.innerWidth < 560;
    let y = 74;
    try {
      const lb = left.getBoundingClientRect().bottom;
      const gb = game.hidden ? 0 : game.getBoundingClientRect().bottom;
      y = Math.max(74, (narrow ? lb : Math.max(gb, room.hidden && people.hidden ? 0 : lb)) + 10);
    } catch (err) { /* layout not ready */ }
    toasts.style.top = Math.round(y) + 'px';
  }
  window.addEventListener('resize', () => requestAnimationFrame(layoutToasts));

  // ---------------------------------------------------------------- modal bookkeeping
  let modal = false;
  function isModalOpen() {
    return !!(cardState || panelState || wheelState);
  }
  function modalChanged() {
    const next = isModalOpen();
    root.classList.toggle('c9-modal', next);
    if (next === modal) return;
    modal = next;
    events.emit('modal', modal);
  }

  // Escape closes the top-most thing. main.js calls this from input's 'escape' (one listener,
  // so closing a panel never also reopens the menu in the same key press).
  function escape() {
    if (wheelState) closeWheel();
    else if (cardState && cardState.dismissable) closeCard();
    else if (panelState) closePanel();
    else return false;
    return true;
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------- the game panel
  function setGameUI(raw) {
    const ui = normalizeGameUI(raw);
    if (!ui) {
      if (!game.hidden) {
        game.hidden = true;
        root.classList.remove('c9-gaming');
        layoutToasts();
      }
      lastBig = '';
      return;
    }
    game.hidden = false;
    root.classList.add('c9-gaming');
    gameTitle.textContent = ui.title;
    gameTitle.hidden = !ui.title;
    gameTimer.textContent = ui.timer ? ui.timer.text : '';
    gameTimer.hidden = !ui.timer;
    gameTimer.classList.toggle('c9-urgent', !!(ui.timer && ui.timer.urgent));
    gameRole.textContent = ui.role ? ui.role.text : '';
    gameRole.hidden = !ui.role;
    gameRole.style.setProperty('--role', (ui.role && ui.role.color) || '');
    gameLine.textContent = ui.line;
    gameLine.hidden = !ui.line;
    // only rebuild the scoreboard when it changed
    const key = JSON.stringify(ui.scoreboard);
    if (gameBoard.dataset.key !== key) {
      gameBoard.dataset.key = key;
      gameBoard.replaceChildren();
      for (const r of ui.scoreboard) {
        const li = el('li', 'c9-score' + (r.me ? ' c9-me' : ''));
        if (r.color) li.style.setProperty('--team', r.color);
        li.append(el('span', 'c9-score-name', r.label), el('span', 'c9-score-value', r.value));
        gameBoard.appendChild(li);
      }
    }
    gameBoard.hidden = !ui.scoreboard.length;
    if (ui.big && ui.big !== lastBig) big(ui.big);
    lastBig = ui.big;
    layoutToasts();
  }

  // ---------------------------------------------------------------- big splash
  function big(text, sub, o = {}) {
    if (bigDone) {
      const d = bigDone;
      bigDone = null;
      d();
    }
    clearTimeout(bigTimer);
    bigText.textContent = String(text || '').slice(0, 40);
    bigSub.textContent = sub ? String(sub).slice(0, 90) : '';
    bigSub.hidden = !sub;
    bigEl.style.setProperty('--accent', cssColor(o.color) || '');
    bigEl.hidden = false;
    bigEl.classList.remove('c9-in', 'c9-out');
    void bigEl.offsetWidth;
    bigEl.classList.add('c9-in');
    return new Promise((resolve) => {
      bigDone = resolve;
      bigTimer = setTimeout(() => {
        bigEl.classList.add('c9-out');
        setTimeout(() => {
          if (bigDone !== resolve) return;
          bigEl.hidden = true;
          bigDone = null;
          resolve();
        }, 260);
      }, Math.max(500, o.ms ?? 1900));
    });
  }

  // ---------------------------------------------------------------- the people list
  function setPlayers(list) {
    const arr = Array.isArray(list) ? list.slice(0, 12) : [];
    people.hidden = arr.length <= 1 && room.hidden;
    peopleCount.textContent = String(arr.length);
    peopleList.replaceChildren();
    for (const p of arr) {
      const li = el('li', 'c9-person' + (p.me ? ' c9-me' : ''));
      const dot = el('span', 'c9-person-dot');
      if (cssColor(p.color)) dot.style.background = cssColor(p.color);
      li.appendChild(dot);
      li.appendChild(el('span', 'c9-person-name', String(p.nick || 'Cheerleader').slice(0, 20)));
      if (p.me) li.appendChild(el('span', 'c9-person-tag', 'you'));
      if (p.host) li.appendChild(icon('crown', 'c9-icon c9-person-icon'));
      if (p.bot) li.appendChild(el('span', 'c9-person-tag c9-bot', 'bot'));
      peopleList.appendChild(li);
    }
    paintPeopleOpen();
    layoutToasts();
  }

  const api = {
    el: root,
    stick,
    on: events.on.bind(events),
    onButton(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
      return () => {
        const i = handlers[name].indexOf(fn);
        if (i >= 0) handlers[name].splice(i, 1);
      };
    },
    setButton(name, state = {}) {
      const b = btn[name];
      if (!b) return;
      if (state.hidden !== undefined) b.hidden = !!state.hidden;
      if (state.label) {
        b.setAttribute('aria-label', state.label);
        b.title = state.label;
      }
      if (state.pressed !== undefined) {
        b.setAttribute('aria-pressed', state.pressed ? 'true' : 'false');
        b.classList.toggle('c9-on', !!state.pressed);
        if (name === 'sound') b.replaceChildren(icon(state.pressed ? 'sound' : 'mute'));
      }
    },

    // ---------------------------------------------------------------- Contract 1
    toast(text, o = {}) {
      const t = el('div', 'c9-toast');
      const ic = iconOrText(o.icon, 'c9-toast-icon');
      if (ic) t.appendChild(ic);
      t.appendChild(el('span', 'c9-toast-text', String(text || '').slice(0, 140)));
      toasts.appendChild(t);
      while (toasts.children.length > 3) toasts.firstChild.remove();
      const ms = o.ms ?? 2600;
      setTimeout(() => t.classList.add('c9-out'), ms);
      setTimeout(() => t.remove(), ms + 320);
      return t;
    },
    prompt(label, onUse, o = {}) {
      const entry = { label: String(label || '').slice(0, 40), onUse, icon: o.icon || null };
      explicit = entry;
      paintUse();
      return () => {
        if (explicit === entry) {
          explicit = null;
          paintUse();
        }
      };
    },
    clearPrompt(onUse) {
      if (!explicit) return;
      if (onUse && explicit.onUse !== onUse) return;
      explicit = null;
      paintUse();
    },
    big,
    setGameUI,

    // ---------------------------------------------------------------- interact's channel
    setAction(a) {
      suggested = a && a.label ? { label: String(a.label).slice(0, 40), icon: a.icon || null } : null;
      paintUse();
    },
    onAction(fn) {
      return api.onButton('action', fn);
    },
    usePrompt,
    get hasPrompt() { return !!(explicit || suggested); },
    get actionLabel() { return suggested ? suggested.label : null; },

    setPlayers,
    setRoom(code) {
      room.hidden = !code;
      roomCode.replaceChildren();
      if (code) for (const ch of String(code).slice(0, 6)) roomCode.appendChild(el('span', 'c9-room-tile', ch));
      layoutToasts();
    },

    openWheel,
    closeWheel,
    pickWheel,
    get wheelOpen() { return !!wheelState; },

    openCard,
    closeCard: () => closeCard(),
    get cardOpen() { return !!cardState; },
    openPanel,
    closePanel: () => closePanel(),
    get panelOpen() { return !!panelState; },
    isModalOpen,
    escape,
    closeAll() {
      closeWheel();
      closePanel();
      closeCard();
    },

    setPlaying(on) {
      root.classList.toggle('c9-playing', !!on);
      if (!on) {
        stick.hide();
        jumpBtn.classList.remove('c9-down');
      }
    },

    showHint(text) {
      hint.textContent = text;
      hint.hidden = false;
      hint.classList.remove('c9-out');
    },
    hideHint() {
      if (hint.hidden) return;
      hint.classList.add('c9-out');
      setTimeout(() => {
        hint.hidden = true;
      }, 420);
    },

    async fade(on, ms = 200) {
      if (reducedMotion()) ms = Math.min(ms, 80);
      fadeEl.style.transitionDuration = ms + 'ms';
      fadeEl.classList.toggle('c9-on', !!on);
      await wait(ms + 20);
    },

    setDebug(text) {
      debug.hidden = !text;
      debug.textContent = text || '';
    },

    setLoading(progress, text) {
      if (!veil) return;
      veil.hidden = false;
      veil.classList.remove('c9-out');
      if (veilFill && typeof progress === 'number') veilFill.style.transform = 'scaleX(' + Math.max(0.03, Math.min(1, progress)) + ')';
      if (veilLine && text) veilLine.textContent = text;
    },
    hideLoading() {
      if (!veil) return;
      if (veilFill) veilFill.style.transform = 'scaleX(1)';
      veil.classList.add('c9-out');
      setTimeout(() => {
        if (veil.classList.contains('c9-out')) veil.hidden = true;
      }, 560);
    },
    onTap,
  };
  return api;
}
