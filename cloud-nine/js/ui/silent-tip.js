// The iPhone and iPad silent switch (or Silent Mode) mutes Web Audio, and Cloud Nine keeps
// respecting it: no audioSession 'playback'. So on those devices, the first time sound starts while
// the game's own sound is on, one gentle toast says where the sound might be. Once per device,
// remembered in the store's progress. No DOM of its own, so it runs under node --test.
//
//   const tip = createSilentTip({ hud, store, isOn, inPlay })
//       isOn()    -> true while the game's sound is on (checked again when the toast is due)
//       inPlay()  -> true on the island (the menus cover the toasts, so it waits for play)
//   tip.soundStarted() -> boolean   call when sound starts: the first unlock with sound on, or the
//                                   sound button switching it on. true when a toast is now on its way
//   tip.pending / tip.dispose()
//   isAppleTouch(navigator) -> boolean   iPhone, iPod or iPad (iPadOS says "Macintosh", with touch)
//   silentTipText(navigator) -> string
//   SILENT_TIP_KEY                       the store.progress field that remembers it was shown

export const SILENT_TIP_KEY = 'silentTip';

export function isAppleTouch(nav) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS asks for the desktop site and says Macintosh, but no Mac has a touch screen
  return /Macintosh/i.test(ua) && Number(nav.maxTouchPoints) > 1;
}

export function silentTipText(nav) {
  const ua = String((nav && nav.userAgent) || '');
  const device = /iPhone|iPod/i.test(ua) ? 'phone' : 'iPad';
  return "Can't hear anything? Make sure your " + device + " isn't on silent.";
}

export function createSilentTip({
  hud,
  store,
  isOn = () => true,
  inPlay = () => true,
  nav = typeof navigator !== 'undefined' ? navigator : null,
  delayMs = 2500, // after reaching the island: the welcome splash and toasts go first
  pollMs = 400,
  ms = 6000,
  now = () => Date.now(),
} = {}) {
  let pending = false;
  let timer = 0;
  let readyAt = 0;

  function seen() {
    try {
      return !!(store && store.progress && store.progress[SILENT_TIP_KEY]);
    } catch (err) {
      return false;
    }
  }

  function later(wait) {
    clearTimeout(timer);
    timer = setTimeout(tick, Math.max(0, wait));
  }

  function tick() {
    timer = 0;
    if (!pending) return;
    if (!isOn()) {
      // switched off again before the toast was due: wait for the next time sound starts
      pending = false;
      return;
    }
    if (!inPlay()) {
      readyAt = 0;
      later(pollMs);
      return;
    }
    if (!readyAt) readyAt = now() + delayMs;
    if (now() < readyAt) {
      later(Math.min(pollMs, readyAt - now()));
      return;
    }
    pending = false;
    if (seen()) return;
    try {
      if (store && typeof store.patchProgress === 'function') store.patchProgress({ [SILENT_TIP_KEY]: true });
    } catch (err) { /* storage blocked: it may show again next visit, which is fine */ }
    try {
      hud.toast(silentTipText(nav), { icon: 'sound', ms });
    } catch (err) { /* the HUD shows what it can */ }
  }

  return {
    soundStarted() {
      if (pending || !isAppleTouch(nav) || seen() || !isOn()) return false;
      pending = true;
      readyAt = 0;
      later(0);
      return true;
    },
    get pending() {
      return pending;
    },
    dispose() {
      clearTimeout(timer);
      pending = false;
    },
  };
}
