// Touch, mouse and keyboard input for the world. Copied from League World; Cloud Nine adds the jump
// key and the emote keys. Existing signatures and events are unchanged.
//
// Touch (primary):
//   - a floating virtual joystick appears where the left thumb lands in the lower-left of the screen
//   - dragging anywhere else orbits the camera, two fingers pinch to zoom
//   - a quick tap (anywhere on the 3D view) is reported as 'tap' so the world can walk there
//   (the jump, use and emote buttons are DOM buttons in ui/hud.js, not part of this module)
// Mouse/keyboard: WASD/arrows move (Shift walks), Space jumps (or does the prompt when one is up:
//   main.js decides), E/Enter uses, Q/T opens the emote wheel, 1-9 pick an emote while it is open,
//   drag orbits, wheel zooms, M opens the menu, Esc closes things.
//
//   const input = createInput({ canvas, stick })     stick: { show(x, y), move(ox, oy, dx, dy), hide() }
//   input.getMove(out)        -> out { x, y } camera-relative, x right, y forward, length <= 1
//   input.consumeLook()       -> { dx, dy } pixels dragged since the last call
//   input.consumeZoom()       -> multiplier for the camera distance since the last call
//   input.on('tap' | 'use' | 'jump' | 'emote' | 'digit' | 'map' | 'escape' | 'any' | 'firstmove', fn)
//        'digit' gets the number 1..9; 'escape', 'map', 'emote' and 'digit' also arrive while suspended
//   input.setSuspended(bool)  world input off while a card or panel is open
//   input.release()           let go of held keys and pointers without changing suspended
//   input.isDown(code)        -> true while that key (KeyboardEvent.code) is held

import { clamp, emitter } from './util.js';

const STICK_RADIUS = 58;
const DEAD = 0.12;
const TAP_MS = 380;
const HOLD_MS = 170;

export function createInput({ canvas, stick = null }) {
  const events = emitter();
  const pointers = new Map();
  const keys = new Set();
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let pinch = null;
  let lookDX = 0;
  let lookDY = 0;
  let zoom = 1;
  let suspended = false;
  let moved = false;
  let usingTouch = false;
  const look = { dx: 0, dy: 0 };
  const now = () => performance.now();

  function inStickZone(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return h >= w ? x < w * 0.55 && y > h * 0.42 : x < w * 0.42 && y > h * 0.22;
  }

  function becomeStick(p) {
    p.role = 'joy';
    joy.id = p.id;
    joy.ox = p.sx;
    joy.oy = p.sy;
    joy.x = 0;
    joy.y = 0;
    if (stick) stick.show(joy.ox, joy.oy);
    updateStick(p);
  }

  function updateStick(p) {
    let vx = p.x - joy.ox;
    let vy = p.y - joy.oy;
    let len = Math.hypot(vx, vy);
    if (len > STICK_RADIUS) {
      // the base trails the thumb so the stick never runs out of travel
      const over = (len - STICK_RADIUS) / len;
      joy.ox += vx * over;
      joy.oy += vy * over;
      vx = p.x - joy.ox;
      vy = p.y - joy.oy;
      len = STICK_RADIUS;
    }
    const m = len / STICK_RADIUS;
    const mag = m <= DEAD ? 0 : (m - DEAD) / (1 - DEAD);
    joy.x = len > 0 ? (vx / len) * mag : 0;
    joy.y = len > 0 ? (-vy / len) * mag : 0;
    if (stick) stick.move(joy.ox, joy.oy, vx, vy);
  }

  function releaseStick() {
    joy.id = null;
    joy.x = 0;
    joy.y = 0;
    if (stick) stick.hide();
  }

  function pinchDistance() {
    const a = pointers.get(pinch.a);
    const b = pointers.get(pinch.b);
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function startPinch(a, b) {
    if (joy.id === a.id || joy.id === b.id) releaseStick();
    a.role = 'pinch';
    b.role = 'pinch';
    pinch = { a: a.id, b: b.id, dist: 0 };
    pinch.dist = pinchDistance();
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    usingTouch = e.pointerType !== 'mouse';
    events.emit('any', e);
    if (suspended) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) { /* older browsers */ }
    const p = {
      id: e.pointerId, type: e.pointerType, role: 'look',
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: now(), dragging: false, far: 0,
    };
    const fresh = p.type !== 'mouse';
    if (fresh && joy.id === null && !pinch && inStickZone(p.x, p.y)) {
      let waiting = false;
      for (const q of pointers.values()) if (q.role === 'joyWait') waiting = true;
      if (!waiting) p.role = 'joyWait';
    }
    pointers.set(p.id, p);
    if (fresh && !pinch) {
      const touches = [];
      for (const q of pointers.values()) if (q.type !== 'mouse') touches.push(q);
      if (touches.length === 2) {
        const other = touches[0] === p ? touches[1] : touches[0];
        const bothLooking = p.role === 'look' && other.role === 'look';
        const quickPair = other.role === 'joyWait' && now() - other.t0 < 260;
        if (bothLooking || quickPair) startPinch(other, p);
      }
    }
  }

  // A finger that was already down when world input came back (a card closed under the thumb):
  // pick it up as if it had just landed, so it works without lifting. It can never count as a tap.
  function adopt(e) {
    const p = {
      id: e.pointerId, type: e.pointerType, role: 'look',
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: now() - TAP_MS, dragging: true, far: 99,
    };
    if (joy.id === null && !pinch && inStickZone(p.x, p.y)) {
      let waiting = false;
      for (const q of pointers.values()) if (q.role === 'joyWait' || q.role === 'joy') waiting = true;
      if (!waiting) p.role = 'joyWait';
    }
    pointers.set(p.id, p);
    return p;
  }

  function onMove(e) {
    let p = pointers.get(e.pointerId);
    if (!p) {
      if (suspended || e.pointerType === 'mouse') return;
      if (!canvas.hasPointerCapture || !canvas.hasPointerCapture(e.pointerId)) return;
      p = adopt(e);
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (suspended) return;
    const far = Math.hypot(p.x - p.sx, p.y - p.sy);
    if (far > p.far) p.far = far;
    if (p.role === 'joyWait' && far > 8) becomeStick(p);
    else if (p.role === 'joy') updateStick(p);
    else if (p.role === 'look') {
      if (!p.dragging && far > (p.type === 'mouse' ? 4 : 9)) p.dragging = true;
      if (p.dragging) {
        lookDX += dx;
        lookDY += dy;
      }
    } else if (p.role === 'pinch' && pinch) {
      const d = pinchDistance();
      if (d > 8 && pinch.dist > 8) zoom *= pinch.dist / d;
      pinch.dist = d;
    }
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) { /* already released */ }
    if (p.role === 'pinch') {
      if (pinch) {
        const otherId = pinch.a === p.id ? pinch.b : pinch.a;
        const other = pointers.get(otherId);
        if (other) {
          other.role = 'look';
          other.dragging = true; // never a tap after a pinch
        }
      }
      pinch = null;
      return;
    }
    if (p.role === 'joy') releaseStick();
    if (suspended || e.type !== 'pointerup') return;
    // A quick touch that never travelled is a tap, even if it briefly became a joystick.
    if (!p.dragging && p.far < 10 && now() - p.t0 < TAP_MS) {
      events.emit('tap', { x: p.x, y: p.y, pointerType: p.type });
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', (e) => {
    if (pointers.has(e.pointerId)) onUp(e);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (suspended) return;
    const unit = e.deltaMode === 1 ? 32 : 1;
    zoom *= Math.exp(clamp(e.deltaY * unit, -240, 240) * 0.0013);
  }, { passive: false });

  // Keep the browser from scrolling, zooming or selecting while someone plays.
  const stop = (e) => e.preventDefault();
  canvas.addEventListener('touchstart', stop, { passive: false });
  canvas.addEventListener('touchmove', stop, { passive: false });
  canvas.addEventListener('contextmenu', stop);
  canvas.addEventListener('dblclick', stop);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  document.addEventListener('selectstart', (e) => {
    const t = e.target;
    if (!(t && t.closest && t.closest('input, textarea, [contenteditable]'))) e.preventDefault();
  });

  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  function onKeyDown(e) {
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    events.emit('any', e);
    if (e.code === 'Escape') {
      events.emit('escape');
      return;
    }
    // M toggles the menu, so it must also arrive while a panel has world input suspended.
    if (e.code === 'KeyM') {
      if (!e.repeat) events.emit('map');
      return;
    }
    // The emote wheel is a panel of its own: Q/T toggle it and digits pick from it.
    if (e.code === 'KeyQ' || e.code === 'KeyT') {
      if (!e.repeat) events.emit('emote');
      return;
    }
    if (/^Digit[1-9]$/.test(e.code) || /^Numpad[1-9]$/.test(e.code)) {
      if (!e.repeat) events.emit('digit', Number(e.code.slice(-1)));
      return;
    }
    if (suspended) return;
    if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      // Space is held down in play, so the page must never scroll or click a focused button with it.
      const a = document.activeElement;
      if (a && a !== document.body && a.closest && a.closest('button, a, [role="button"]')) return;
      e.preventDefault();
      if (!e.repeat) events.emit('jump');
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyE' || e.code === 'Enter') {
      const a = document.activeElement;
      if (a && a !== document.body && a.closest && a.closest('button, a, [role="button"]') && e.code !== 'KeyE') return;
      e.preventDefault();
      events.emit('use');
    }
  }
  const held = new Set(); // every key, for input.isDown (mini games poll arrows and Space)
  function onKeyUp(e) {
    keys.delete(e.code);
    held.delete(e.code);
  }
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) held.add(e.code);
  });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    keys.clear();
    held.clear();
  });

  function resetPointers() {
    pointers.clear();
    pinch = null;
    releaseStick();
    lookDX = 0;
    lookDY = 0;
    zoom = 1;
  }

  const api = {
    on: events.on.bind(events),
    getMove(out) {
      let x = 0;
      let y = 0;
      if (!suspended) {
        if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
        if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
        if (x || y) {
          const l = Math.hypot(x, y);
          const m = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.45 : 1;
          x = (x / l) * m;
          y = (y / l) * m;
        } else {
          x = joy.x;
          y = joy.y;
        }
      }
      out.x = x;
      out.y = y;
      if (!moved && Math.hypot(x, y) > 0.25) {
        moved = true;
        events.emit('firstmove');
      }
      return out;
    },
    consumeLook() {
      look.dx = lookDX;
      look.dy = lookDY;
      lookDX = 0;
      lookDY = 0;
      return look;
    },
    consumeZoom() {
      const z = zoom;
      zoom = 1;
      return z;
    },
    // Call once a frame: promotes a held thumb to a joystick even if it has not moved yet.
    update() {
      if (suspended) return;
      const t = now();
      for (const p of pointers.values()) {
        if (p.role === 'joyWait' && t - p.t0 > HOLD_MS) becomeStick(p);
      }
    },
    setSuspended(v) {
      v = !!v;
      if (v === suspended) return;
      suspended = v;
      keys.clear();
      resetPointers();
    },
    // Drop any held key, captured joystick or pinch, whatever the suspended state is.
    // setSuspended only clears when the value actually changes, so a mini game that runs
    // with input live (the joystick is its control) has no way to let go through it.
    release() {
      keys.clear();
      resetPointers();
    },
    isDown(code) {
      return held.has(code);
    },
    get suspended() { return suspended; },
    get usingTouch() { return usingTouch; },
    get stickActive() { return joy.id !== null; },
    get hasMoved() { return moved; },
  };
  return api;
}
