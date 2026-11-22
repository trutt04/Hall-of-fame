// Swipes for basket toss tricks. classifyStroke is pure (node tests); createSwipeInput binds it to
// pointer events and also reports the finger's path, so the overlay can draw a sparkle trail.
//
//   classifyStroke(points, { size, maxMs }) -> { gesture, dir? } | null
//       points: [[x, y, ms], ...] in screen pixels (y grows downward). size: the screen's short side.
//       gesture: 'up' | 'down' | 'left' | 'right' | 'circle' | 'tap'. dir (circles): 1 clockwise, -1 not.
//       maxMs: a straight stroke slower than this is not a swipe (a held joystick, a camera drag).
//   createSwipeInput({ target, onGesture(gesture, info), onTrail(x, y, id), onTrailEnd(id), maxMsAt(x, y) })
//       -> { reset(), dispose() }

export function classifyStroke(points, { size = 400, maxMs = 1100 } = {}) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const n = points.length;
  const first = points[0];
  const last = points[n - 1];
  const dur = last[2] - first[2];
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const disp = Math.hypot(dx, dy);
  const minDist = Math.max(16, size * 0.045);
  if (len < minDist) return dur <= 400 ? { gesture: 'tap' } : null;

  // A loop: the stroke winds most of the way around its own middle, ends near where it began and is
  // roughly round (a tall narrow U-turn is not a loop).
  if (n >= 5 && len >= Math.max(60, size * 0.16)) {
    let cx = 0;
    let cy = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      cx += p[0];
      cy += p[1];
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    const round = Math.min(x1 - x0, y1 - y0) / Math.max(1, x1 - x0, y1 - y0);
    cx /= n;
    cy /= n;
    let prev = Math.atan2(first[1] - cy, first[0] - cx);
    let swept = 0;
    let rSum = 0;
    for (let i = 1; i < n; i++) {
      const a = Math.atan2(points[i][1] - cy, points[i][0] - cx);
      let d = a - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      swept += d;
      prev = a;
      rSum += Math.hypot(points[i][0] - cx, points[i][1] - cy);
    }
    const rMean = rSum / (n - 1);
    if (Math.abs(swept) >= Math.PI * 1.35 && round >= 0.45 && rMean >= size * 0.03 && disp < len * 0.5) {
      return { gesture: 'circle', dir: swept > 0 ? 1 : -1 };
    }
  }

  if (dur > maxMs || disp < minDist) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return { gesture: dx < 0 ? 'left' : 'right' };
  return { gesture: dy < 0 ? 'up' : 'down' };
}

// Buttons and fields keep their own taps.
function isUi(node) {
  return !!(node && node.closest && node.closest('button, a, input, select, textarea, [role="button"], [contenteditable]'));
}

export function createSwipeInput({ target, onGesture, onTrail = null, onTrailEnd = null, maxMsAt = null }) {
  const host = target || window;
  const strokes = new Map();
  const now = () => performance.now();
  const size = () => Math.max(200, Math.min(window.innerWidth || 400, window.innerHeight || 400));

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isUi(e.target)) return;
    const t = now();
    strokes.set(e.pointerId, { pts: [[e.clientX, e.clientY, t]], x0: e.clientX, y0: e.clientY });
    if (onTrail) onTrail(e.clientX, e.clientY, e.pointerId);
  }
  function move(e) {
    const s = strokes.get(e.pointerId);
    if (!s) return;
    s.pts.push([e.clientX, e.clientY, now()]);
    if (s.pts.length > 240) s.pts.splice(1, 1); // keep where it began
    if (onTrail) onTrail(e.clientX, e.clientY, e.pointerId);
  }
  function up(e) {
    const s = strokes.get(e.pointerId);
    if (!s) return;
    strokes.delete(e.pointerId);
    s.pts.push([e.clientX, e.clientY, now()]);
    if (onTrailEnd) onTrailEnd(e.pointerId);
    const r = classifyStroke(s.pts, { size: size(), maxMs: maxMsAt ? maxMsAt(s.x0, s.y0) : 1100 });
    if (r && r.gesture !== 'tap' && onGesture) onGesture(r.gesture, r);
  }

  host.addEventListener('pointerdown', down, { passive: true });
  host.addEventListener('pointermove', move, { passive: true });
  host.addEventListener('pointerup', up, { passive: true });
  host.addEventListener('pointercancel', up, { passive: true });
  return {
    reset() {
      for (const id of strokes.keys()) if (onTrailEnd) onTrailEnd(id);
      strokes.clear();
    },
    dispose() {
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      strokes.clear();
    },
  };
}
