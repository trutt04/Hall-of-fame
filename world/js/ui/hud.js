// The DOM overlay: status chip, round buttons, the contextual action button, cards, panels,
// toasts, the big arrival stamp, the loading veil and the virtual joystick visual.
//
// Every piece of text is set with textContent. Team names are untrusted.
//
//   const hud = createHud(rootEl, { veil })
//   hud.setStatus({ rankText, teamName, recordText, tierName, color, line2 } | null)
//   hud.onButton('map' | 'standings' | 'sound' | 'menu' | 'status', fn)
//   hud.setButton(name, { pressed?, hidden?, label? })
//   hud.setAction({ label, icon? } | null) / hud.onAction(fn)
//   hud.openCard({ kicker, title, stats: [[k, v]], lines: [], jab, actions: [{ label, onClick | href, primary?, keepOpen? }], accentColor, onClose })
//   hud.closeCard()
//   hud.openPanel({ title, contentEl, onClose }) / hud.closePanel()
//   hud.toast(text, { ms })
//   hud.stamp({ big, sub, line, ms })      -> Promise, resolves when the stamp leaves
//   hud.setLoading(progress01, text) / hud.hideLoading()
//   hud.setRibbon(text | null)
//   hud.showHint(text) / hud.hideHint()
//   hud.fade(on, ms)                        -> Promise (teleport fade)
//   hud.isModalOpen() / hud.on('modal', fn(open))   world input is suspended while a card or panel is open
//   hud.stick                               { show(x, y), move(ox, oy, dx, dy), hide() } for core/input.js

import { emitter } from '../core/util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  map: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4zM9 4v13.5M15 6.5V20',
  standings: 'M4 20h16M6 20v-6h4v6M10 20V7h4v13M14 20v-9h4v9',
  sound: 'M4 9.5v5h3.5l4.5 4V5.5l-4.5 4H4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10',
  mute: 'M4 9.5v5h3.5l4.5 4V5.5l-4.5 4H4zM16 9.5l5 5M21 9.5l-5 5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.2 6-5.5 6S6 18 5 15.5L3.7 12.6a1.4 1.4 0 0 1 2.5-1.2L8 14',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('lw-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.hand);
  svg.appendChild(path);
  return svg;
}

function cssColor(c) {
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHud(root, opts = {}) {
  const events = emitter();
  const handlers = {};
  root.classList.add('lw-hud');

  // ---------------------------------------------------------------- top bar
  const top = el('div', 'lw-top');
  const left = el('div', 'lw-left');
  const chip = el('button', 'lw-chip');
  chip.type = 'button';
  chip.setAttribute('aria-label', 'Your team');
  const chipRank = el('span', 'lw-chip-rank', '');
  const chipBody = el('span', 'lw-chip-body');
  const chipTeam = el('span', 'lw-chip-team', 'League World');
  const chipMeta = el('span', 'lw-chip-meta', '');
  const chipLine = el('span', 'lw-chip-line', '');
  chipBody.append(chipTeam, chipMeta, chipLine);
  chip.append(chipRank, chipBody);
  chip.addEventListener('click', () => fire('status'));
  const ribbon = el('div', 'lw-ribbon');
  ribbon.hidden = true;
  const debug = el('pre', 'lw-debug');
  debug.hidden = true;
  left.append(chip, ribbon, debug);

  const buttons = el('div', 'lw-buttons');
  buttons.setAttribute('role', 'toolbar');
  buttons.setAttribute('aria-label', 'World controls');
  const btn = {};
  for (const [name, label] of [['map', 'Map'], ['standings', 'Standings'], ['sound', 'Sound'], ['menu', 'Menu']]) {
    const b = el('button', 'lw-round');
    b.type = 'button';
    b.dataset.name = name;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(icon(name === 'sound' ? 'mute' : name));
    b.addEventListener('click', () => fire(name));
    buttons.appendChild(b);
    btn[name] = b;
  }
  btn.sound.setAttribute('aria-pressed', 'false');
  top.append(left, buttons);

  function fire(name) {
    const list = handlers[name];
    if (!list) return;
    for (const fn of list) {
      try {
        fn(name);
      } catch (err) {
        console.error('[lw] hud button "' + name + '" failed', err);
      }
    }
  }

  // ---------------------------------------------------------------- action button, hint, toasts
  const action = el('button', 'lw-action');
  action.type = 'button';
  action.hidden = true;
  const actionIcon = el('span', 'lw-action-icon');
  const actionLabel = el('span', 'lw-action-label', '');
  action.append(actionIcon, actionLabel);
  action.addEventListener('click', () => fire('action'));
  let actionText = null;

  const hint = el('div', 'lw-hint');
  hint.hidden = true;
  const toasts = el('div', 'lw-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');

  // ---------------------------------------------------------------- joystick visual
  const stickEl = el('div', 'lw-stick');
  const knob = el('div', 'lw-stick-knob');
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

  // ---------------------------------------------------------------- card (bottom sheet / side card)
  const cardWrap = el('div', 'lw-card-wrap');
  cardWrap.hidden = true;
  const card = el('section', 'lw-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.tabIndex = -1;
  cardWrap.appendChild(card);
  let cardState = null;
  cardWrap.addEventListener('pointerdown', (e) => {
    if (e.target === cardWrap) closeCard();
  });

  function closeButton(onClick) {
    const x = el('button', 'lw-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.appendChild(icon('close'));
    x.addEventListener('click', onClick);
    return x;
  }

  function openCard(o = {}) {
    if (cardState) closeCard(true);
    card.replaceChildren();
    const accent = cssColor(o.accentColor);
    card.style.setProperty('--accent', accent || '');
    card.appendChild(closeButton(() => closeCard()));
    if (o.kicker) card.appendChild(el('p', 'lw-kicker', o.kicker));
    const title = el('h2', 'lw-title', o.title || '');
    title.id = 'lw-card-title';
    card.setAttribute('aria-labelledby', title.id);
    card.appendChild(title);
    if (o.stats && o.stats.length) {
      const dl = el('dl', 'lw-stats');
      for (const row of o.stats) {
        if (!row) continue;
        dl.append(el('dt', null, row[0]), el('dd', null, row[1]));
      }
      card.appendChild(dl);
    }
    for (const line of o.lines || []) {
      if (line !== null && line !== undefined && line !== '') card.appendChild(el('p', 'lw-line', line));
    }
    if (o.jab) card.appendChild(el('p', 'lw-jab', o.jab));
    if (o.contentEl) card.appendChild(o.contentEl);
    if (o.actions && o.actions.length) {
      const row = el('div', 'lw-actions');
      o.actions.forEach((a, i) => {
        if (!a) return;
        let node;
        if (a.href) {
          node = el('a', 'lw-btn', a.label);
          node.href = a.href;
          if (a.newTab) {
            node.target = '_blank';
            node.rel = 'noopener';
          }
        } else {
          node = el('button', 'lw-btn', a.label);
          node.type = 'button';
          node.addEventListener('click', () => {
            if (!a.keepOpen) closeCard();
            if (typeof a.onClick === 'function') a.onClick();
          });
        }
        if (a.primary || (i === 0 && a.primary !== false)) node.classList.add('lw-btn-primary');
        row.appendChild(node);
      });
      card.appendChild(row);
    }
    cardState = { onClose: o.onClose || null };
    cardWrap.hidden = false;
    card.scrollTop = 0;
    card.classList.remove('lw-in');
    void card.offsetWidth; // restart the slide-in
    card.classList.add('lw-in');
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
        console.error('[lw] card onClose failed', err);
      }
    }
  }

  // ---------------------------------------------------------------- full-screen panel
  const panel = el('section', 'lw-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const panelHead = el('header', 'lw-panel-head');
  const panelTitle = el('h2', 'lw-panel-title', '');
  panelTitle.id = 'lw-panel-title';
  panel.setAttribute('aria-labelledby', panelTitle.id);
  panelHead.append(panelTitle, closeButton(() => closePanel()));
  const panelBody = el('div', 'lw-panel-body');
  panel.append(panelHead, panelBody);
  let panelState = null;

  function openPanel(o = {}) {
    if (panelState) closePanel(true);
    panelTitle.textContent = o.title || '';
    panelBody.replaceChildren();
    if (o.contentEl) panelBody.appendChild(o.contentEl);
    panelState = { onClose: o.onClose || null };
    panel.hidden = false;
    panelBody.scrollTop = 0;
    panel.classList.remove('lw-in');
    void panel.offsetWidth;
    panel.classList.add('lw-in');
    modalChanged();
    return panelBody;
  }

  function closePanel(silent) {
    if (!panelState) return;
    const state = panelState;
    panelState = null;
    panel.hidden = true;
    panelBody.replaceChildren();
    if (!silent) modalChanged();
    if (state.onClose) {
      try {
        state.onClose();
      } catch (err) {
        console.error('[lw] panel onClose failed', err);
      }
    }
  }

  // ---------------------------------------------------------------- the big stamp
  const stampEl = el('div', 'lw-stamp');
  stampEl.hidden = true;
  const stampBig = el('div', 'lw-stamp-big', '');
  const stampSub = el('div', 'lw-stamp-sub', '');
  const stampLine = el('div', 'lw-stamp-line', '');
  stampEl.append(stampBig, stampSub, stampLine);
  let stampDone = null;
  let stampTimer = 0;

  function endStamp() {
    if (!stampDone) return;
    const done = stampDone;
    stampDone = null;
    clearTimeout(stampTimer);
    stampEl.classList.add('lw-out');
    setTimeout(() => {
      stampEl.hidden = true;
      stampEl.classList.remove('lw-out', 'lw-in');
      modalChanged();
      done();
    }, 220);
  }
  stampEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (performance.now() - stampAt > 500) endStamp();
  });
  let stampAt = 0;

  function stamp(o = {}) {
    if (stampDone) endStamp();
    stampBig.textContent = o.big || '';
    stampSub.textContent = o.sub || '';
    stampLine.textContent = o.line || '';
    stampSub.hidden = !o.sub;
    stampLine.hidden = !o.line;
    const accent = cssColor(o.color);
    stampEl.style.setProperty('--accent', accent || '');
    stampEl.hidden = false;
    stampEl.classList.remove('lw-out', 'lw-in');
    void stampEl.offsetWidth;
    stampEl.classList.add('lw-in');
    stampAt = performance.now();
    modalChanged();
    return new Promise((resolve) => {
      stampDone = resolve;
      stampTimer = setTimeout(endStamp, o.ms ?? 3400);
    });
  }

  // ---------------------------------------------------------------- veil and fade
  let veil = opts.veil || null;
  if (!veil) {
    veil = el('div', 'lw-veil');
    veil.append(el('div', 'lw-veil-title', 'League World'), el('div', 'lw-veil-bar'), el('div', 'lw-veil-line', 'Loading'));
    veil.querySelector('.lw-veil-bar').appendChild(el('i'));
  }
  const veilFill = veil.querySelector('.lw-veil-bar i');
  const veilLine = veil.querySelector('.lw-veil-line');
  const fadeEl = el('div', 'lw-fade');

  root.append(top, toasts, hint, action, stickEl, cardWrap, panel, stampEl, fadeEl);
  if (!veil.parentNode) root.appendChild(veil);

  // ---------------------------------------------------------------- modal bookkeeping
  let modal = false;
  function isModalOpen() {
    return !!(cardState || panelState || stampDone);
  }
  function modalChanged() {
    const next = isModalOpen();
    root.classList.toggle('lw-modal', next);
    if (next === modal) return;
    modal = next;
    events.emit('modal', modal);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (stampDone) endStamp();
    else if (panelState) closePanel();
    else if (cardState) closeCard();
  });

  // Keep taps on HUD controls from doing anything else (selection, double-tap zoom).
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  const api = {
    el: root,
    stick,
    on: events.on.bind(events),

    setStatus(s) {
      if (!s) {
        chip.hidden = true;
        return;
      }
      chip.hidden = false;
      chipRank.textContent = s.rankText || '';
      chipRank.hidden = !s.rankText;
      chipTeam.textContent = s.teamName || '';
      chipMeta.textContent = [s.recordText, s.tierName].filter(Boolean).join(' · ');
      chipMeta.hidden = !chipMeta.textContent;
      chipLine.textContent = s.line2 || '';
      chipLine.hidden = !s.line2;
      chip.style.setProperty('--accent', cssColor(s.color) || '');
    },

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
        b.classList.toggle('lw-on', !!state.pressed);
        if (name === 'sound') b.replaceChildren(icon(state.pressed ? 'sound' : 'mute'));
      }
    },

    setAction(a) {
      if (!a || !a.label) {
        action.hidden = true;
        actionText = null;
        return;
      }
      actionText = a.label;
      actionLabel.textContent = a.label;
      actionIcon.replaceChildren(icon(a.icon && ICONS[a.icon] ? a.icon : 'hand'));
      if (action.hidden) {
        action.hidden = false;
        action.classList.remove('lw-in');
        void action.offsetWidth;
        action.classList.add('lw-in');
      }
    },
    onAction(fn) {
      return api.onButton('action', fn);
    },
    get actionLabel() { return actionText; },

    openCard,
    closeCard: () => closeCard(),
    get cardOpen() { return !!cardState; },
    openPanel,
    closePanel: () => closePanel(),
    get panelOpen() { return !!panelState; },
    isModalOpen,
    closeAll() {
      if (stampDone) endStamp();
      closePanel();
      closeCard();
    },

    toast(text, o = {}) {
      const t = el('div', 'lw-toast', text);
      toasts.appendChild(t);
      while (toasts.children.length > 3) toasts.firstChild.remove();
      const ms = o.ms ?? 2800;
      setTimeout(() => t.classList.add('lw-out'), ms);
      setTimeout(() => t.remove(), ms + 320);
      return t;
    },

    stamp,

    setLoading(progress, text) {
      veil.hidden = false;
      veil.classList.remove('lw-out');
      if (veilFill && typeof progress === 'number') veilFill.style.transform = 'scaleX(' + Math.max(0.02, Math.min(1, progress)) + ')';
      if (veilLine && text) veilLine.textContent = text;
    },
    hideLoading() {
      if (veilFill) veilFill.style.transform = 'scaleX(1)';
      veil.classList.add('lw-out');
      setTimeout(() => {
        if (veil.classList.contains('lw-out')) veil.hidden = true;
      }, 520);
    },

    setRibbon(text) {
      ribbon.hidden = !text;
      ribbon.textContent = text || '';
    },

    showHint(text) {
      hint.textContent = text;
      hint.hidden = false;
      hint.classList.remove('lw-out');
    },
    hideHint() {
      if (hint.hidden) return;
      hint.classList.add('lw-out');
      setTimeout(() => {
        hint.hidden = true;
      }, 420);
    },

    async fade(on, ms = 200) {
      fadeEl.style.transitionDuration = ms + 'ms';
      fadeEl.classList.toggle('lw-on', !!on);
      await wait(ms + 20);
    },

    setDebug(text) {
      debug.hidden = !text;
      debug.textContent = text || '';
    },
  };
  return api;
}
