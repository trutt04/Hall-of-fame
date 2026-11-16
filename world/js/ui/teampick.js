// The team picker: "Who are you?" over the live town, then "Enter with sound" or "Enter quietly".
//
//   const choice = await openTeamPicker(ctx, { canCancel })
//   choice = { teamId: number | null, sound: boolean }     teamId null means "Just looking"
//          | { cancelled: true }                           only when canCancel (switching teams)
//
// The picker is only DOM. The flow starts and stops the aerial camera behind it.

import { el, button, hex, tierName, teamName, rankBig, weekLabel, flowRoot, TIER_CSS } from './dom.js';
import { modelOf } from './seam.js';

export function openTeamPicker(ctx, opts = {}) {
  const { hud, audio } = ctx;
  const model = modelOf(ctx);
  const meta = (model && model.meta) || {};

  return new Promise((resolve) => {
    const root = el('div', 'lwf-pick');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Choose your team');
    root.tabIndex = -1;

    // ------------------------------------------------------------ hero: the town shows through here
    const hero = el('div', 'lwf-pick-hero');
    hero.append(
      el('p', 'lwf-pick-league', meta.leagueName || 'Fantasy league'),
      el('h1', 'lwf-pick-title', 'League World'),
      el('p', 'lwf-pick-week', weekLabel(meta) || 'Preseason'),
    );

    // ------------------------------------------------------------ step 1: the list
    const sheet = el('div', 'lwf-pick-sheet');
    const stepList = el('div', 'lwf-pick-step');
    const q = el('h2', 'lwf-pick-q', 'Who are you?');
    q.id = 'lwf-pick-q';
    const list = el('div', 'lwf-pick-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-labelledby', q.id);
    const rows = [];
    const rowById = new Map();

    for (const id of (model && model.order) || []) {
      const t = model.teams[id];
      if (!t) continue;
      const row = button('lwf-pick-row', null, () => showConfirm(t));
      row.style.setProperty('--team', hex(t.color));
      row.style.setProperty('--tier', TIER_CSS[t.tier] || TIER_CSS.hill);
      const main = el('span', 'lwf-pick-main');
      main.append(
        el('span', 'lwf-pick-name', teamName(t)),
        el('span', 'lwf-pick-sub', [t.owner, tierName(t.tier)].filter(Boolean).join(' · ')),
      );
      row.append(el('span', 'lwf-pick-rank', t.rank), el('span', 'lwf-pick-chip'), main, el('span', 'lwf-pick-rec', t.record.text));
      row.setAttribute('aria-label', rankBig(t.rank) + ' place, ' + teamName(t) + ', ' + t.record.text);
      list.appendChild(row);
      rows.push(row);
      rowById.set(t.id, row);
    }
    const visitor = button('lwf-pick-row lwf-pick-visitor', null, () => showConfirm(null));
    const vmain = el('span', 'lwf-pick-main');
    vmain.append(el('span', 'lwf-pick-name', 'Just looking'), el('span', 'lwf-pick-sub', 'Walk around as a visitor. No house, no judgment.'));
    visitor.appendChild(vmain);
    list.appendChild(visitor);
    rows.push(visitor);
    const head = el('div', 'lwf-pick-head');
    head.appendChild(q);
    if (opts.canCancel) {
      // switching teams from the menu: the way back out sits in the header, always in reach
      const cancel = button('lwf-pick-link lwf-pick-cancel', 'Never mind', () => finish({ cancelled: true }));
      head.appendChild(cancel);
      rows.push(cancel);
    }
    stepList.append(head, list);

    // ------------------------------------------------------------ step 2: confirm and choose sound
    const stepConfirm = el('div', 'lwf-pick-step lwf-pick-confirm');
    stepConfirm.hidden = true;
    const cKicker = el('p', 'lwf-pick-kicker');
    const cName = el('h2', 'lwf-pick-cname');
    const cLine = el('p', 'lwf-pick-cline');
    let chosen = null;
    const withSound = button('lwf-big lwf-big-primary', 'Enter with sound', () => {
      // Sound can only start inside a tap, so it starts right here.
      try {
        audio.enable();
      } catch (err) {
        console.warn('[lw] sound did not start', err);
      }
      finish({ teamId: chosen ? chosen.id : null, sound: true });
    });
    const quietly = button('lwf-big', 'Enter quietly', () => {
      try {
        audio.disable();
      } catch (err) { /* already quiet */ }
      finish({ teamId: chosen ? chosen.id : null, sound: false });
    });
    const back = button('lwf-pick-link', 'Not you? Go back', showList);
    stepConfirm.append(cKicker, cName, cLine, withSound, quietly, back);

    function showConfirm(t) {
      // the tap that opened the picker (from a card or the menu) must never land on a row beneath it
      if (performance.now() - openedAt < 350) return;
      chosen = t;
      if (t) {
        cKicker.textContent = rankBig(t.rank) + ' place · ' + tierName(t.tier);
        cName.textContent = teamName(t);
        cLine.textContent = [t.owner, t.record.text].filter(Boolean).join(' · ');
        stepConfirm.style.setProperty('--team', hex(t.color));
      } else {
        cKicker.textContent = 'Visitor';
        cName.textContent = 'Just looking';
        cLine.textContent = 'You start at the Plaza. Everybody else has a house.';
        stepConfirm.style.setProperty('--team', TIER_CSS.plaza);
      }
      stepList.hidden = true;
      stepConfirm.hidden = false;
      root.classList.add('lwf-pick-confirming');
      withSound.focus({ preventScroll: true });
    }

    function showList() {
      stepConfirm.hidden = true;
      stepList.hidden = false;
      root.classList.remove('lwf-pick-confirming');
      ((chosen ? rowById.get(chosen.id) : visitor) || rows[0]).focus({ preventScroll: true });
    }

    // ------------------------------------------------------------ keyboard
    root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the world behind must not walk or skip while this is open
      const key = e.key;
      if (key === 'Escape' && !stepConfirm.hidden) {
        e.preventDefault();
        showList();
        return;
      }
      const set = stepConfirm.hidden ? rows : [withSound, quietly, back];
      const at = set.indexOf(document.activeElement);
      let next = -1;
      if (key === 'ArrowDown' || key === 'ArrowRight') next = at < 0 ? 0 : Math.min(set.length - 1, at + 1);
      else if (key === 'ArrowUp' || key === 'ArrowLeft') next = at < 0 ? 0 : Math.max(0, at - 1);
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = set.length - 1;
      if (next >= 0) {
        e.preventDefault();
        set[next].focus();
        set[next].scrollIntoView({ block: 'nearest' });
      }
    });
    root.addEventListener('keyup', (e) => e.stopPropagation());

    const openedAt = performance.now();
    let closed = false;
    function finish(result) {
      if (closed) return;
      closed = true;
      root.classList.add('lwf-out');
      hud.el.classList.remove('lwf-picking');
      setTimeout(() => root.remove(), 260);
      resolve(result);
    }

    sheet.append(stepList, stepConfirm);
    root.append(hero, sheet);
    hud.el.classList.add('lwf-picking');
    flowRoot(hud).appendChild(root);
    root.focus({ preventScroll: true });
  });
}
