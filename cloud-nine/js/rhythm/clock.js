// Hit Zero timing: from the music clock to song time, the player's latency offset, and the
// "tap to the beat" calibration math. Pure logic, no DOM, no audio.
//
// Judging runs on the music clock (Contract 6 `beat.time()`, seconds), never on frame time.
//
//   beatIndexOf({ n, count, eight })     -> 0-based beat of the track for a 'beat' event (n may be 0- or 1-based)
//   const clock = createBeatClock({ bpm, latencyMs })
//   clock.anchor(beatIndex, musicTime)   beat `beatIndex` of the routine sounds at `musicTime`
//   clock.hasAnchor
//   clock.song(musicTime)                -> song seconds: seconds since beat 0, minus the latency offset
//   clock.beat(musicTime)                -> the same in beats
//   clock.musicTimeOfBeat(b)             -> when beat b sounds on the music clock (no latency)
//   clock.setLatency(ms) / clock.latencyMs
//   clock.spb, clock.bpm
//
//   const sm = createSmoother()          AudioContext time moves in steps (and some browsers take
//   sm.sample(perfMs, musicSec)          big ones). The smoother maps performance.now() onto the
//   sm.at(perfMs) -> musicSec | null     music clock so taps and frames land between the steps.
//
//   LATENCY_RANGE                        { min: -200, max: 400 } ms
//   cleanLatency(raw)                    -> ms, a number in range (0 for junk): the localStorage value is untrusted
//   tapOffset(tapTime, origin, spb)      -> seconds from the nearest beat, in [-spb/2, spb/2)
//   calibrate(offsetsSec, { skip })      -> { ms, spread, n } | null   median of the taps, the first `skip` ignored

export const LATENCY_RANGE = { min: -200, max: 400 };

export function cleanLatency(raw) {
  const v = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(LATENCY_RANGE.min, Math.min(LATENCY_RANGE.max, v)));
}

export function beatIndexOf(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const n = Number(ev.n);
  const count = Number(ev.count);
  const hasCount = Number.isInteger(count) && count >= 1 && count <= 8;
  if (Number.isInteger(n) && n >= 0) {
    if (hasCount) {
      if (n % 8 === count - 1) return n; // 0-based
      if (n >= 1 && (n - 1) % 8 === count - 1) return n - 1; // 1-based
    }
    return n;
  }
  const eight = Number(ev.eight);
  if (Number.isInteger(eight) && eight >= 0 && hasCount) return eight * 8 + count - 1;
  return null;
}

export function createBeatClock({ bpm = 144, latencyMs = 0 } = {}) {
  bpm = Number(bpm) >= 40 && Number(bpm) <= 300 ? Number(bpm) : 144;
  const spb = 60 / bpm;
  let origin = 0; // music time of beat 0
  let has = false;
  let latency = cleanLatency(latencyMs) / 1000;
  return {
    bpm,
    spb,
    anchor(beatIndex, musicTime) {
      if (!Number.isFinite(beatIndex) || !Number.isFinite(musicTime)) return;
      origin = musicTime - beatIndex * spb;
      has = true;
    },
    get hasAnchor() { return has; },
    get origin() { return origin; },
    song(musicTime) {
      return musicTime - origin - latency;
    },
    beat(musicTime) {
      return (musicTime - origin - latency) / spb;
    },
    musicTimeOfBeat(b) {
      return origin + b * spb;
    },
    setLatency(ms) {
      latency = cleanLatency(ms) / 1000;
    },
    get latencyMs() { return Math.round(latency * 1000); },
  };
}

export function createSmoother({ window = 45, stallMs = 140, jump = 0.08 } = {}) {
  // A stepped clock reads late, never early, so the best guess of its offset from
  // performance.now() is the largest offset seen lately.
  const offs = [];
  let est = null;
  let lastMusic = null;
  let lastChange = 0;
  let stalled = false;
  return {
    sample(perfMs, musicSec) {
      if (!Number.isFinite(perfMs) || !Number.isFinite(musicSec)) return;
      if (lastMusic !== null && musicSec === lastMusic) {
        // the music clock stopped (a suspended context): stand still with it
        stalled = perfMs - lastChange > stallMs;
        return;
      }
      if (stalled || (lastMusic !== null && musicSec < lastMusic)) offs.length = 0;
      stalled = false;
      lastMusic = musicSec;
      lastChange = perfMs;
      const o = musicSec - perfMs / 1000;
      if (est !== null && Math.abs(o - est) > jump) offs.length = 0;
      offs.push(o);
      if (offs.length > window) offs.shift();
      est = Math.max(...offs);
    },
    at(perfMs) {
      if (est === null) return null;
      if (stalled) return lastMusic;
      const t = perfMs / 1000 + est;
      return lastMusic !== null && t < lastMusic ? lastMusic : t;
    },
    reset() {
      offs.length = 0;
      est = null;
      lastMusic = null;
      stalled = false;
    },
    get stalled() { return stalled; },
  };
}

export function tapOffset(tapTime, origin, spb) {
  const x = (tapTime - origin) / spb;
  let d = x - Math.round(x);
  if (d >= 0.5) d -= 1;
  return d * spb;
}

export function calibrate(offsets, { skip = 2 } = {}) {
  const xs = offsets.slice(skip).filter((v) => Number.isFinite(v));
  if (xs.length < 4) return null;
  const sorted = xs.slice().sort((a, b) => a - b);
  const med = median(sorted);
  const spread = median(sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
  return { ms: cleanLatency(med * 1000), spread: Math.round(spread * 1000), n: xs.length };
}

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
