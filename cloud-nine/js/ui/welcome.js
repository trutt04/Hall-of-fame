// First-time welcome on a device: My cheerleader opens once, right after the welcome splash of her
// first arrival on the island (when no look was ever saved here), and the two icon-only corner
// buttons wear a little word bubble ("Games!" by the star, "Menu" by the three lines) until she has
// tapped each one once. Remembered in the store's progress object, under `welcome`.
//
//   const welcome = createWelcome({ hud, store, force })
//       force: show the first-time things again on this visit (the ?welcome=1 test switch)
//   welcome.creatorDue(hasSavedLook) -> boolean    open the creator now? (then call creatorShown())
//   welcome.creatorShown()                          never again on this device
//   welcome.used(name)                              'games' | 'menu': that bubble goes for good
//   welcome.flags                                   { creator, games, menu } (tests)
//
// Pure: cleanWelcome(raw) -> { creator, games, menu } (true = done)

import { el } from './dom.js';

export const TIP_WORDS = Object.freeze({ games: 'Games!', menu: 'Menu' });

export function cleanWelcome(raw) {
  const ok = raw && typeof raw === 'object' && !Array.isArray(raw);
  return { creator: !!(ok && raw.creator), games: !!(ok && raw.games), menu: !!(ok && raw.menu) };
}

export function createWelcome({ hud, store, force = false } = {}) {
  const flags = force ? cleanWelcome(null) : cleanWelcome(store.progress.welcome);
  const save = () => store.patchProgress({ welcome: { creator: flags.creator ? 1 : 0, games: flags.games ? 1 : 0, menu: flags.menu ? 1 : 0 } });
  const tips = {};

  // the bubble lives inside its button, so a tap on the word is a tap on the button
  for (const name of Object.keys(TIP_WORDS)) {
    if (flags[name]) continue;
    const b = hud.el && hud.el.querySelector ? hud.el.querySelector('.c9-round-' + name) : null;
    if (!b) continue;
    const tip = el('span', 'c9w-tip c9w-tip-' + name, TIP_WORDS[name]);
    tip.setAttribute('aria-hidden', 'true');
    b.classList.add('c9w-has-tip');
    b.appendChild(tip);
    tips[name] = { b, tip };
    hud.onButton(name, () => used(name));
  }

  function used(name) {
    if (!(name in TIP_WORDS) || flags[name]) return;
    flags[name] = true;
    save();
    const t = tips[name];
    if (!t) return;
    delete tips[name];
    t.tip.classList.add('c9w-out');
    setTimeout(() => {
      t.tip.remove();
      t.b.classList.remove('c9w-has-tip');
    }, 300);
  }

  return {
    used,
    creatorDue(hasSavedLook) {
      if (flags.creator) return false;
      if (hasSavedLook && !force) {
        // she dressed up already (an earlier visit): nothing to welcome her into
        flags.creator = true;
        save();
        return false;
      }
      return true;
    },
    creatorShown() {
      if (flags.creator) return;
      flags.creator = true;
      save();
    },
    get flags() { return Object.assign({}, flags); },
  };
}
