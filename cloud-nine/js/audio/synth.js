// The instruments: drums, basses, keys, leads and effects, each built from oscillators, noise and
// filters at the moment it plays. Works the same in an AudioContext and an OfflineAudioContext.
//
//   const kit = createKit(ctx, seed)           noise buffers and a seeded random source, one per context
//   INSTRUMENTS[name](kit, out, t, ev) -> end  schedules one note, chord or hit at time t into `out`
//       ev = { notes: [midi...], dur (seconds), vel 0..1, from (midi to glide from) | null, v (voice params), chord }
//   Building blocks the sound effects share:
//     blip(kit, out, t, { type, f, f2, glide, a, decay, level, detune }) -> end    a tone with a pitch sweep
//     noiseHit(kit, out, t, { type, f, f2, q, a, decay, level, color }) -> end      a filtered noise burst
//     bellNote(kit, out, t, f, level, decay) -> end                                 a glassy additive bell
//     Voice: collects the nodes of one sound and disconnects them when it ends (no leaks on iOS)
//
// Levels: each instrument is set so that the songs' part volumes (vol) mean the same thing everywhere
// (balanced by measuring soloed renders); the mixer's limiter does the rest.

import { mulberry32 } from '../core/util.js';
import { midiToFreq } from './theory.js';

export const mtof = midiToFreq;
const clampPan = (p) => Math.max(-1, Math.min(1, p));

// ---------------------------------------------------------------- the kit

export function createKit(ctx, seed = 1) {
  const rng = mulberry32(seed);
  const len = Math.floor(ctx.sampleRate * 2);
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const pink = ctx.createBuffer(1, len, ctx.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  // Paul Kellet's economy pink filter, for crowds and wind
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const x = rng() * 2 - 1;
    w[i] = x;
    b0 = 0.99765 * b0 + x * 0.099046;
    b1 = 0.963 * b1 + x * 0.2965164;
    b2 = 0.57 * b2 + x * 1.0526913;
    p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.22;
  }
  // the buffers loop, so blend the seam
  const fade = 1024;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    p[len - fade + i] = p[len - fade + i] * (1 - k) + p[i] * k;
    w[len - fade + i] = w[len - fade + i] * (1 - k) + w[i] * k;
  }
  return { ctx, white, pink, rng, rand: (a, b) => a + rng() * (b - a) };
}

// Soft saturation curves, shared (the shaper copies them).
function tanhCurve(drive) {
  const n = 1024;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}
const WARM = tanhCurve(1.6);

// ---------------------------------------------------------------- envelopes

// attack to peak, then an exponential fall to silence
export function perc(p, t, a, decay, peak) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + decay);
  return t + a + decay;
}

// attack, decay to sustain, hold until t + dur, release. Returns when it has gone quiet (-60 dB).
export function adsr(p, t, dur, a, d, s, r, peak) {
  const hold = Math.max(dur, a + 0.004);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (s < 0.999) p.setTargetAtTime(peak * s, t + a, Math.max(0.002, d / 3));
  p.setTargetAtTime(0, t + hold, Math.max(0.002, r / 5));
  return t + hold + r * 1.5;
}

// ---------------------------------------------------------------- voice bookkeeping

export class Voice {
  constructor(kit) {
    this.k = kit;
    this.ctx = kit.ctx;
    this.nodes = [];
    this.srcs = [];
  }
  osc(type, f, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    this.nodes.push(o);
    this.srcs.push(o);
    return o;
  }
  noise(color = 'white') {
    const s = this.ctx.createBufferSource();
    s.buffer = this.k[color];
    s.loop = true;
    s.offset0 = this.k.rng() * (s.buffer.duration - 0.05);
    this.nodes.push(s);
    this.srcs.push(s);
    return s;
  }
  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }
  filter(type, f, q = 0.7) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    this.nodes.push(n);
    return n;
  }
  pan(p) {
    if (!this.ctx.createStereoPanner) return this.gain(1);
    const n = this.ctx.createStereoPanner();
    n.pan.value = clampPan(p);
    this.nodes.push(n);
    return n;
  }
  shaper(curve) {
    const n = this.ctx.createWaveShaper();
    n.curve = curve;
    this.nodes.push(n);
    return n;
  }
  chain(...ns) {
    for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
    return ns[ns.length - 1];
  }
  // start every source at t (or its own .at) and stop them all at `end`; tidy up afterwards
  play(t, end) {
    for (const s of this.srcs) {
      const at = s.at ?? t;
      if (s.offset0 !== undefined) s.start(at, s.offset0);
      else s.start(at);
      s.stop(Math.max(at + 0.01, s.end ?? end));
    }
    const first = this.srcs[0];
    if (first) {
      const nodes = this.nodes;
      first.onended = () => {
        for (const n of nodes) {
          try { n.disconnect(); } catch (e) { /* already gone */ }
        }
      };
    }
    return end;
  }
}

// ---------------------------------------------------------------- building blocks

export function blip(k, out, t, { type = 'sine', f = 440, f2 = null, glide = 0.05, a = 0.003, decay = 0.2, level = 0.3, detune = 0, lp = 0 } = {}) {
  const V = new Voice(k);
  const o = V.osc(type, f, detune);
  if (f2) {
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + glide);
  }
  const g = V.gain(0);
  const end = perc(g.gain, t, a, decay, level);
  if (lp) V.chain(o, V.filter('lowpass', lp, 0.7), g, out);
  else V.chain(o, g, out);
  return V.play(t, end + 0.02);
}

export function noiseHit(k, out, t, { type = 'bandpass', f = 1000, f2 = null, q = 0.8, a = 0.002, decay = 0.1, level = 0.3, color = 'white', sweep = null } = {}) {
  const V = new Voice(k);
  const n = V.noise(color);
  const fl = V.filter(type, f, q);
  if (f2) {
    fl.frequency.setValueAtTime(f, t);
    fl.frequency.exponentialRampToValueAtTime(f2, t + (sweep ?? a + decay));
  }
  const g = V.gain(0);
  const end = perc(g.gain, t, a, decay, level);
  V.chain(n, fl, g, out);
  return V.play(t, end + 0.02);
}

// a glassy bell: a few partials, the high ones dying first
const BELL = [[1, 1, 1], [2.003, 0.32, 0.45], [3.01, 0.14, 0.28], [4.16, 0.08, 0.16]];
export function bellNote(k, out, t, f, level = 0.2, decay = 1.2, partials = BELL, pan = 0) {
  const V = new Voice(k);
  if (pan) {
    const p = V.pan(pan);
    p.connect(out);
    out = p;
  }
  let end = t;
  for (const [mul, amp, dk] of partials) {
    if (f * mul > 15000) continue;
    const o = V.osc('sine', f * mul);
    const g = V.gain(0);
    end = Math.max(end, perc(g.gain, t, 0.002, decay * dk, level * amp));
    V.chain(o, g, out);
  }
  return V.play(t, end + 0.02);
}

// ---------------------------------------------------------------- drums

function kickVoice(k, out, t, vel, { f0, f1, sweep, decay, click, drive = null, body = 0 }) {
  const V = new Voice(k);
  const o = V.osc('sine', f0);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  const g = V.gain(0);
  perc(g.gain, t, 0.0015, decay, vel * 0.95);
  if (drive) V.chain(o, g, V.shaper(drive), out);
  else V.chain(o, g, out);
  if (body) {
    // a triangle an octave up so small speakers hear the kick's pitch, not just its click
    const tr = V.osc('triangle', f0 * 2);
    tr.frequency.setValueAtTime(f0 * 2, t);
    tr.frequency.exponentialRampToValueAtTime(f1 * 2, t + sweep);
    const tg = V.gain(0);
    perc(tg.gain, t, 0.0015, decay * 0.45, vel * body);
    V.chain(tr, tg, out);
  }
  if (click) {
    const n = V.noise();
    const hp = V.filter('highpass', 1800, 0.7);
    const cg = V.gain(0);
    perc(cg.gain, t, 0.0008, 0.014, vel * click);
    V.chain(n, hp, cg, out);
  }
  return V.play(t, t + decay + 0.06);
}

function clapLayer(V, out, t, vel, freq, decay) {
  const n = V.noise();
  const hp = V.filter('highpass', 650, 0.7);
  const bp = V.filter('bandpass', freq, 1.1);
  const g = V.gain(0);
  const p = g.gain;
  p.setValueAtTime(0, t);
  [0, 0.011, 0.022].forEach((dt, i) => {
    const lv = vel * 3 * (1 - i * 0.12);
    p.setValueAtTime(lv, t + dt);
    p.exponentialRampToValueAtTime(lv * 0.08, t + dt + 0.009);
  });
  p.setValueAtTime(vel * 2.55, t + 0.031);
  p.exponentialRampToValueAtTime(0.0001, t + 0.031 + decay);
  V.chain(n, hp, bp, g, out);
  return t + 0.031 + decay;
}

function hatVoice(k, out, t, vel, decay, level = 1.6) {
  const V = new Voice(k);
  const n = V.noise();
  const g = V.gain(0);
  const end = perc(g.gain, t, 0.0008, decay, vel * level);
  V.chain(n, V.filter('highpass', 7200, 0.7), V.filter('bandpass', 10500, 0.7), g, out);
  return V.play(t, end + 0.02);
}

function tomVoice(k, out, t, vel, f, decay = 0.36) {
  const V = new Voice(k);
  const o = V.osc('sine', f * 1.6);
  o.frequency.setValueAtTime(f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
  const g = V.gain(0);
  perc(g.gain, t, 0.002, decay, vel * 0.8);
  V.chain(o, g, out);
  const tr = V.osc('triangle', f * 1.5);
  tr.frequency.setValueAtTime(f * 2.4, t);
  tr.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.04);
  const tg = V.gain(0);
  perc(tg.gain, t, 0.002, decay * 0.4, vel * 0.25);
  V.chain(tr, tg, out);
  const n = V.noise();
  const ng = V.gain(0);
  perc(ng.gain, t, 0.001, 0.05, vel * 0.22);
  V.chain(n, V.filter('lowpass', 2200, 0.7), ng, out);
  return V.play(t, t + decay + 0.05);
}

// ---------------------------------------------------------------- pitched helpers

function glideTo(param, t, from, to, time = 0.06) {
  if (from === null || from === undefined) {
    param.setValueAtTime(to, t);
    return;
  }
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(to, t + time);
}

function vibrato(V, oscs, t, rateHz, cents, delay = 0.15, ramp = 0.25) {
  const lfo = V.osc('sine', rateHz);
  const depth = V.gain(0);
  depth.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t + delay);
  depth.gain.linearRampToValueAtTime(cents, t + delay + ramp);
  lfo.connect(depth);
  for (const o of oscs) depth.connect(o.detune);
  return lfo;
}

const norm = (n) => 1 / Math.sqrt(Math.max(1, n));

// Several notes sharing one filter and envelope per side (left/right), so a 4-note supersaw chord
// costs a dozen oscillators but only a handful of other nodes.
function stereoStack(k, out, t, ev, { saws, cutoff, cutoffEnd, cutoffTime = 0.25, q = 0.7, a, d, s, r, level, type = 'sawtooth' }) {
  const V = new Voice(k);
  const sides = [-0.55, 0.55].map((pan) => {
    const f = V.filter('lowpass', cutoff, q);
    if (cutoffEnd) {
      f.frequency.setValueAtTime(cutoff, t);
      f.frequency.setTargetAtTime(cutoffEnd, t + 0.005, cutoffTime / 3);
    }
    const g = V.gain(0);
    V.chain(f, g, V.pan(pan), out);
    return { f, g };
  });
  const peak = level * ev.vel * norm(ev.notes.length);
  let end = t;
  for (const side of sides) end = adsr(side.g.gain, t, ev.dur, a, d, s, r, peak);
  for (const m of ev.notes) {
    const f = mtof(m);
    saws.forEach((det) => {
      const o = V.osc(type, f, det);
      if (ev.from !== null && ev.from !== undefined) glideTo(o.frequency, t, mtof(ev.from), f);
      const pick = det < 0 ? [0] : det > 0 ? [1] : [0, 1];
      for (const sIdx of pick) o.connect(sides[sIdx].f);
    });
  }
  return V.play(t, end);
}

// ---------------------------------------------------------------- the instruments

export const INSTRUMENTS = {
  // ------------------------------------------------ drums
  kick: (k, out, t, ev) => kickVoice(k, out, t, ev.vel, { f0: 165, f1: 50, sweep: 0.055, decay: 0.38, click: 0.32, body: 0.22 }),
  softkick: (k, out, t, ev) => kickVoice(k, out, t, ev.vel, { f0: 120, f1: 52, sweep: 0.07, decay: 0.3, click: 0.1, body: 0.18 }),
  kick808: (k, out, t, ev) => kickVoice(k, out, t, ev.vel * 0.85, { f0: 110, f1: 46, sweep: 0.05, decay: 0.85, click: 0.18, drive: WARM, body: 0.25 }),

  snare(k, out, t, ev) {
    const V = new Voice(k);
    const vel = ev.vel;
    const n = V.noise();
    const ng = V.gain(0);
    perc(ng.gain, t, 0.001, 0.17, vel * 0.85);
    V.chain(n, V.filter('highpass', 1300, 0.7), ng, out);
    const snap = V.noise();
    const sg = V.gain(0);
    perc(sg.gain, t, 0.0008, 0.03, vel * 0.6);
    V.chain(snap, V.filter('bandpass', 4200, 1.2), sg, out);
    const o = V.osc('triangle', 240);
    o.frequency.setValueAtTime(250, t);
    o.frequency.exponentialRampToValueAtTime(175, t + 0.08);
    const og = V.gain(0);
    perc(og.gain, t, 0.001, 0.1, vel * 0.55);
    V.chain(o, og, out);
    return V.play(t, t + 0.24);
  },

  clap(k, out, t, ev) {
    const V = new Voice(k);
    const end = clapLayer(V, out, t, ev.vel * 0.9, 1250, 0.16);
    return V.play(t, end + 0.02);
  },

  // three claps a few milliseconds apart, spread left to right: a whole squad clapping
  bigclap(k, out, t, ev) {
    const V = new Voice(k);
    let end = t;
    [[0, 950, -0.55], [0.0065, 1450, 0], [0.013, 2150, 0.55]].forEach(([dt, f, pan]) => {
      const p = V.pan(pan);
      p.connect(out);
      end = Math.max(end, clapLayer(V, p, t + dt, ev.vel * 0.62, f, 0.2));
    });
    return V.play(t, end + 0.02);
  },

  snap(k, out, t, ev) {
    const V = new Voice(k);
    const n = V.noise();
    const g = V.gain(0);
    perc(g.gain, t, 0.0008, 0.05, ev.vel * 1.6);
    V.chain(n, V.filter('bandpass', 2300, 2.2), g, out);
    const o = V.osc('sine', 1900);
    const og = V.gain(0);
    perc(og.gain, t, 0.0008, 0.02, ev.vel * 0.12);
    V.chain(o, og, out);
    return V.play(t, t + 0.09);
  },

  hat: (k, out, t, ev) => hatVoice(k, out, t, ev.vel, 0.045),
  ohat: (k, out, t, ev) => hatVoice(k, out, t, ev.vel, 0.26, 1.35),

  shaker(k, out, t, ev) {
    const V = new Voice(k);
    const n = V.noise();
    const g = V.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(ev.vel * 1.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    V.chain(n, V.filter('bandpass', 6500, 1.4), V.filter('highpass', 3500, 0.7), g, out);
    return V.play(t, t + 0.1);
  },

  tom: (k, out, t, ev) => tomVoice(k, out, t, ev.vel, ev.v.freq || 110),

  crash(k, out, t, ev) {
    const V = new Voice(k);
    let end = t;
    for (const pan of [-0.5, 0.5]) {
      const n = V.noise();
      const g = V.gain(0);
      end = perc(g.gain, t, 0.002, 1.5, ev.vel * 0.9);
      V.chain(n, V.filter('highpass', 3200, 0.7), V.filter('bandpass', 7800, 0.45), g, V.pan(pan), out);
    }
    return V.play(t, end + 0.02);
  },

  // a cinematic boom: a falling sub, a burst of low noise and a little grit so phones hear it
  impact(k, out, t, ev) {
    const V = new Voice(k);
    const o = V.osc('sine', 80);
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.55);
    const g = V.gain(0);
    perc(g.gain, t, 0.002, 1.1, ev.vel * 0.85);
    V.chain(o, g, V.shaper(WARM), out);
    const n = V.noise('pink');
    const ng = V.gain(0);
    perc(ng.gain, t, 0.002, 0.45, ev.vel * 0.7);
    V.chain(n, V.filter('lowpass', 1100, 0.7), ng, out);
    return V.play(t, t + 1.2);
  },

  wood(k, out, t, ev) {
    const f = ev.v.freq || 1200;
    const V = new Voice(k);
    for (const [mul, amp, dk] of [[1, 1, 0.06], [2.3, 0.28, 0.03]]) {
      const o = V.osc('sine', f * mul);
      const g = V.gain(0);
      perc(g.gain, t, 0.0006, dk, ev.vel * 1.1 * amp);
      V.chain(o, g, out);
    }
    const n = V.noise();
    const ng = V.gain(0);
    perc(ng.gain, t, 0.0005, 0.006, ev.vel * 0.15);
    V.chain(n, V.filter('bandpass', f * 2, 1.5), ng, out);
    return V.play(t, t + 0.1);
  },

  // lub-dub, soft and low, with enough overtone that a tablet speaker carries it
  heartbeat(k, out, t, ev) {
    const V = new Voice(k);
    const lp = V.filter('lowpass', 320, 0.8);
    lp.connect(out);
    for (const [dt, lv, f] of [[0, 1, 62], [0.19, 0.7, 55]]) {
      const o = V.osc('triangle', f);
      o.frequency.setValueAtTime(f * 1.3, t + dt);
      o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.05);
      o.at = t + dt;
      const g = V.gain(0);
      perc(g.gain, t + dt, 0.006, 0.16, ev.vel * lv * 0.9);
      V.chain(o, g, lp);
    }
    return V.play(t, t + 0.45);
  },

  boing(k, out, t, ev) {
    const V = new Voice(k);
    const o = V.osc('sine', 300);
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
    const lfo = V.osc('sine', 15);
    const depth = V.gain(0);
    depth.gain.setValueAtTime(90, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.4);
    V.chain(lfo, depth, o.frequency);
    const g = V.gain(0);
    perc(g.gain, t, 0.004, 0.42, ev.vel * 0.5);
    V.chain(o, g, out);
    return V.play(t, t + 0.48);
  },

  // ------------------------------------------------ held effects
  riser(k, out, t, ev) {
    const V = new Voice(k);
    const dur = Math.max(0.3, ev.dur);
    const n = V.noise();
    const bp = V.filter('bandpass', 400, 1.3);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(7500, t + dur);
    const g = V.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(ev.vel * 0.55, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    V.chain(n, bp, g, out);
    const o = V.osc('sawtooth', mtof(50));
    o.frequency.setValueAtTime(mtof(50), t);
    o.frequency.exponentialRampToValueAtTime(mtof(86), t + dur);
    const og = V.gain(0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(ev.vel * 0.07, t + dur);
    og.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    V.chain(o, V.filter('lowpass', 3200, 0.7), og, out);
    return V.play(t, t + dur + 0.06);
  },

  // the short whoosh that lands on a hit: rises, sweeps across, cuts off clean
  swoosh(k, out, t, ev) {
    const V = new Voice(k);
    const dur = Math.max(0.15, ev.dur);
    const n = V.noise();
    const bp = V.filter('bandpass', 500, 1.1);
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    const g = V.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(ev.vel * 0.6, t + dur * 0.88);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = V.pan(-0.6);
    if (p.pan) {
      p.pan.setValueAtTime(-0.6, t);
      p.pan.linearRampToValueAtTime(0.6, t + dur);
    }
    V.chain(n, bp, g, p, out);
    return V.play(t, t + dur + 0.03);
  },

  // a quick glittery run up the current chord
  sparkle(k, out, t, ev) {
    const pcs = ev.chord ? ev.chord.pcs : [0, 4, 7];
    const notes = [];
    for (let m = 84; notes.length < 10 && m < 110; m++) if (pcs.includes(m % 12)) notes.push(m);
    let end = t;
    notes.forEach((m, i) => {
      const at = t + i * 0.034;
      end = Math.max(end, bellNote(k, out, at, mtof(m), ev.vel * 0.28, 0.7, BELL, -0.7 + (1.4 * i) / (notes.length - 1)));
    });
    return end;
  },

  hey: (k, out, t, ev) => heyVoices(k, out, t, ev.vel),
  cheer: (k, out, t, ev) => crowdCheer(k, out, t, { level: ev.vel, dur: 1.8, voices: 5 }),

  // ------------------------------------------------ basses
  bass(k, out, t, ev) {
    const V = new Voice(k);
    const f = mtof(ev.notes[0]);
    const lp = V.filter('lowpass', 900, 1);
    lp.frequency.setValueAtTime(380 + 1300 * ev.vel, t);
    lp.frequency.setTargetAtTime(520, t + 0.01, 0.1);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur * 0.92, 0.006, 0.25, 0.7, 0.07, ev.vel * 0.36);
    for (const [type, lv, det] of [['triangle', 0.7, 0], ['sawtooth', 0.26, 5], ['sine', 0.32, 0]]) {
      const o = V.osc(type, f, det);
      glideTo(o.frequency, t, ev.from !== null && ev.from !== undefined ? mtof(ev.from) : null, f);
      V.chain(o, V.gain(lv), lp);
    }
    V.chain(lp, g, out);
    return V.play(t, end);
  },

  pluckbass(k, out, t, ev) {
    const V = new Voice(k);
    const f = mtof(ev.notes[0]);
    const lp = V.filter('lowpass', 2400, 4);
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.setTargetAtTime(280, t + 0.004, 0.06);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur * 0.9, 0.003, 0.18, 0.55, 0.06, ev.vel * 0.34);
    const a = V.osc('sawtooth', f, -6);
    const b = V.osc('square', f, 6);
    V.chain(a, V.gain(0.6), lp);
    V.chain(b, V.gain(0.35), lp);
    V.chain(lp, g, out);
    const sub = V.osc('sine', f);
    const sg = V.gain(0);
    adsr(sg.gain, t, ev.dur * 0.9, 0.003, 0.3, 0.8, 0.06, ev.vel * 0.3);
    V.chain(sub, sg, out);
    return V.play(t, end);
  },

  // a tuned 808 that slides between notes, with a little drive and a top octave for small speakers
  sub808(k, out, t, ev) {
    const V = new Voice(k);
    const f = mtof(ev.notes[0]);
    const from = ev.from !== null && ev.from !== undefined ? mtof(ev.from) : null;
    const o = V.osc('sine', f);
    glideTo(o.frequency, t, from, f, 0.09);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur * 0.95, 0.003, 0.7, 0.45, 0.12, ev.vel * 0.75);
    V.chain(o, g, V.shaper(WARM), out);
    const top = V.osc('triangle', f * 2);
    glideTo(top.frequency, t, from ? from * 2 : null, f * 2, 0.09);
    const tg = V.gain(0);
    adsr(tg.gain, t, ev.dur * 0.95, 0.003, 0.3, 0.3, 0.1, ev.vel * 0.16);
    V.chain(top, tg, out);
    return V.play(t, end);
  },

  // ------------------------------------------------ keys and pads
  // FM electric piano: the modulator's index falls away, so each chord barks then glows
  epiano(k, out, t, ev) {
    const V = new Voice(k);
    const peak = ev.vel * 0.45 * norm(ev.notes.length);
    let end = t;
    for (const m of ev.notes) {
      const f = mtof(m);
      const car = V.osc('sine', f);
      const mod = V.osc('sine', f);
      const idx = V.gain(0);
      idx.gain.setValueAtTime(f * 2.1, t);
      idx.gain.setTargetAtTime(f * 0.25, t + 0.002, 0.18);
      V.chain(mod, idx, car.frequency);
      const g = V.gain(0);
      end = Math.max(end, adsr(g.gain, t, ev.dur, 0.003, 1.1, 0.35, 0.22, peak));
      V.chain(car, g, out);
      const bark = V.osc('sine', f * 2);
      const bg = V.gain(0);
      perc(bg.gain, t, 0.002, 0.18, peak * 0.22);
      V.chain(bark, bg, out);
    }
    return V.play(t, end);
  },

  pad: (k, out, t, ev) => stereoStack(k, out, t, ev, {
    saws: [-9, 9],
    cutoff: ev.v.cutoff || 1700,
    q: 0.5,
    a: ev.v.a ?? 0.4,
    d: ev.v.d ?? 0.6,
    s: ev.v.s ?? 0.8,
    r: ev.v.r ?? 0.9,
    level: 0.42,
  }),

  supersaw: (k, out, t, ev) => stereoStack(k, out, t, ev, {
    saws: [-15, 0, 15],
    cutoff: ev.v.cutoff || 5200,
    cutoffEnd: ev.v.cutoffEnd || 2300,
    cutoffTime: 0.25,
    q: 0.9,
    a: ev.v.a ?? 0.004,
    d: ev.v.d ?? 0.22,
    s: ev.v.s ?? 0.55,
    r: ev.v.r ?? 0.14,
    level: 0.34,
  }),

  strings(k, out, t, ev) {
    const V = new Voice(k);
    const lp = V.filter('lowpass', 2100, 0.6);
    const trem = V.gain(1);
    const lfo = V.osc('sine', 11);
    const depth = V.gain(0.42);
    V.chain(lfo, depth, trem.gain);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur, 0.22, 0.3, 0.85, 0.5, ev.vel * 0.6 * norm(ev.notes.length));
    V.chain(lp, trem, g, out);
    for (const m of ev.notes) {
      for (const det of [-7, 7]) V.osc('sawtooth', mtof(m), det).connect(lp);
    }
    return V.play(t, end);
  },

  // "aah": saws through the formants of an open vowel, with a slow shared vibrato
  choir(k, out, t, ev) {
    const V = new Voice(k);
    const sum = V.gain(1);
    const mix = V.gain(1);
    for (const [f, q, amp] of [[800, 5, 1], [1150, 7, 0.55], [2900, 10, 0.3]]) V.chain(sum, V.filter('bandpass', f, q), V.gain(amp), mix);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur, 0.32, 0.4, 0.9, 0.7, ev.vel * 1.35 * norm(ev.notes.length));
    V.chain(mix, g, out);
    const oscs = [];
    for (const m of ev.notes) {
      for (const det of [-8, 8]) {
        const o = V.osc('sawtooth', mtof(m), det);
        o.connect(sum);
        oscs.push(o);
      }
    }
    vibrato(V, oscs, t, 5, 14, 0.2, 0.4);
    return V.play(t, end);
  },

  // ------------------------------------------------ leads and plucks
  pluck(k, out, t, ev) {
    const V = new Voice(k);
    let end = t;
    const peak = ev.vel * 0.36 * norm(ev.notes.length);
    for (const m of ev.notes) {
      const f = mtof(m);
      const lp = V.filter('lowpass', Math.min(9000, f * 10), 2);
      lp.frequency.setValueAtTime(Math.min(9000, f * 10), t);
      lp.frequency.setTargetAtTime(Math.min(6000, f * 2.4), t + 0.002, 0.05);
      const g = V.gain(0);
      end = Math.max(end, adsr(g.gain, t, Math.min(ev.dur, 0.3), 0.002, 0.2, 0.18, 0.09, peak));
      V.chain(V.osc('sawtooth', f), V.gain(0.6), lp);
      V.chain(V.osc('square', f, 7), V.gain(0.35), lp);
      V.chain(lp, g, out);
    }
    return V.play(t, end);
  },

  bell(k, out, t, ev) {
    let end = t;
    for (const m of ev.notes) end = Math.max(end, bellNote(k, out, t, mtof(m), ev.vel * 0.42 * norm(ev.notes.length), Math.max(0.9, Math.min(1.8, ev.dur * 2))));
    return end;
  },

  glock(k, out, t, ev) {
    let end = t;
    for (const m of ev.notes) end = Math.max(end, bellNote(k, out, t, mtof(m), ev.vel * 0.28, 1.1, [[1, 1, 1], [2.76, 0.3, 0.3], [5.4, 0.12, 0.12]]));
    return end;
  },

  musicbox(k, out, t, ev) {
    let end = t;
    for (const m of ev.notes) {
      end = Math.max(end, bellNote(k, out, t, mtof(m), ev.vel * 0.34, 1.5, [[1, 1, 1], [2.0, 0.1, 0.4], [3.0, 0.24, 0.25], [5.97, 0.08, 0.1]]));
    }
    return end;
  },

  marimba(k, out, t, ev) {
    const V = new Voice(k);
    let end = t;
    for (const m of ev.notes) {
      const f = mtof(m);
      for (const [mul, amp, dk] of [[1, 1, 0.5], [3.99, 0.2, 0.08], [9.8, 0.05, 0.025]]) {
        const o = V.osc('sine', f * mul);
        const g = V.gain(0);
        end = Math.max(end, perc(g.gain, t, 0.0015, dk, ev.vel * 0.55 * amp));
        V.chain(o, g, out);
      }
    }
    const n = V.noise();
    const ng = V.gain(0);
    perc(ng.gain, t, 0.0005, 0.006, ev.vel * 0.06);
    V.chain(n, V.filter('bandpass', 2600, 1.4), ng, out);
    return V.play(t, end + 0.02);
  },

  flute(k, out, t, ev) {
    const V = new Voice(k);
    const f = mtof(ev.notes[0]);
    const from = ev.from !== null && ev.from !== undefined ? mtof(ev.from) : null;
    const lp = V.filter('lowpass', 3600, 0.6);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur * 0.94, 0.05, 0.15, 0.82, 0.12, ev.vel * 0.42);
    V.chain(lp, g, out);
    const a = V.osc('sine', f);
    const b = V.osc('triangle', f);
    glideTo(a.frequency, t, from, f, 0.07);
    glideTo(b.frequency, t, from, f, 0.07);
    a.connect(lp);
    V.chain(b, V.gain(0.25), lp);
    vibrato(V, [a, b], t, 5.2, 12, 0.14, 0.25);
    // breath: a puff at the start and a little air underneath
    const n = V.noise();
    const ng = V.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(ev.vel * 0.09, t + 0.015);
    ng.gain.setTargetAtTime(ev.vel * 0.016, t + 0.03, 0.04);
    ng.gain.setTargetAtTime(0, t + Math.max(0.05, ev.dur * 0.94), 0.03);
    V.chain(n, V.filter('bandpass', Math.min(9000, f * 2), 2.5), ng, out);
    return V.play(t, end);
  },

  lead(k, out, t, ev) {
    const V = new Voice(k);
    const f = mtof(ev.notes[0]);
    const from = ev.from !== null && ev.from !== undefined ? mtof(ev.from) : null;
    const lp = V.filter('lowpass', 4200, 1.4);
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.setTargetAtTime(3400, t + 0.005, 0.08);
    const g = V.gain(0);
    const end = adsr(g.gain, t, ev.dur * 0.9, 0.005, 0.16, 0.72, 0.09, ev.vel * 0.42);
    V.chain(lp, g, out);
    // saw and square a few cents apart for shine, a triangle underneath for body (no sub-octave:
    // it would blur which octave the tune is in on a small speaker)
    const oscs = [V.osc('sawtooth', f, -7), V.osc('square', f, 7), V.osc('triangle', f)];
    const lv = [0.5, 0.3, 0.35];
    oscs.forEach((o, i) => {
      glideTo(o.frequency, t, from, f, 0.05);
      V.chain(o, V.gain(lv[i]), lp);
    });
    if (ev.dur > 0.28) vibrato(V, oscs, t, 5.6, 16, 0.16, 0.2);
    return V.play(t, end);
  },

  brass(k, out, t, ev) {
    const V = new Voice(k);
    let end = t;
    const peak = ev.vel * 0.26 * norm(ev.notes.length);
    const a = ev.v.a ?? 0.025;
    for (const m of ev.notes) {
      const f = mtof(m);
      const lp = V.filter('lowpass', f * 1.2, 1.1);
      // the "blat": the filter opens hard as the note speaks, then settles
      lp.frequency.setValueAtTime(f * 1.2, t);
      lp.frequency.linearRampToValueAtTime(Math.min(9000, f * 6), t + 0.06);
      lp.frequency.setTargetAtTime(Math.min(7000, f * 3.6), t + 0.06, 0.08);
      const g = V.gain(0);
      end = Math.max(end, adsr(g.gain, t, ev.dur * 0.95, a, ev.v.d ?? 0.2, ev.v.s ?? 0.8, 0.14, peak));
      for (const det of [-7, 0, 7]) {
        const o = V.osc('sawtooth', f, det);
        if (ev.from !== null && ev.from !== undefined) glideTo(o.frequency, t, mtof(ev.from), f, 0.05);
        o.connect(lp);
      }
      V.chain(lp, g, out);
    }
    return V.play(t, end);
  },

  pizz(k, out, t, ev) {
    const V = new Voice(k);
    const f = mtof(ev.notes[0]);
    const decay = f < 140 ? 0.42 : 0.26;
    const lp = V.filter('lowpass', f * 7, 1.2);
    lp.frequency.setValueAtTime(Math.min(9000, f * 8), t);
    lp.frequency.setTargetAtTime(f * 1.8, t + 0.003, 0.04);
    const g = V.gain(0);
    const end = perc(g.gain, t, 0.003, decay, ev.vel * 0.8);
    V.chain(V.osc('triangle', f), V.gain(0.8), lp);
    V.chain(V.osc('sawtooth', f, 4), V.gain(0.3), lp);
    V.chain(lp, g, out);
    return V.play(t, end + 0.02);
  },
};

// ---------------------------------------------------------------- voices (formant synthesis)
// A vowel is three resonances (formants). A sawtooth "voice box" through three bandpass filters at
// those frequencies, with a puff of noise for the h, sounds like a person shouting. No recordings.

export const VOWELS = {
  a: [[800, 1], [1200, 0.55], [2850, 0.3]], // ah
  ae: [[720, 1], [1850, 0.5], [2800, 0.3]], // the a in "yay"
  e: [[560, 1], [2150, 0.5], [2950, 0.32]], // eh
  I: [[420, 1], [2400, 0.45], [3150, 0.3]], // ih
  i: [[320, 1], [2750, 0.4], [3350, 0.3]], // ee
  o: [[520, 1], [920, 0.45], [2700, 0.18]], // oh
  u: [[360, 1], [860, 0.32], [2600, 0.12]], // oo
  aw: [[660, 1], [1020, 0.5], [2750, 0.2]], // aw
};

export function formantVoice(k, out, t, {
  f0 = 420, // pitch, Hz
  path = ['e', 'I'], // vowels, morphing in order
  dur = 0.32,
  level = 0.3,
  pan = 0,
  scale = 1, // formant scale: above 1 sounds younger
  contour = [0.92, 1.12, 0.86], // pitch at the start, a quarter of the way in, the end
  h = 0.045, // seconds of breathy "h" before the voice
  breath = 0.08,
} = {}) {
  const V = new Voice(k);
  const end = t + h + dur;
  const src = V.osc('sawtooth', f0 * contour[0]);
  src.frequency.setValueAtTime(f0 * contour[0], t);
  src.frequency.linearRampToValueAtTime(f0 * contour[1], t + h + dur * 0.25);
  src.frequency.exponentialRampToValueAtTime(f0 * contour[2], end);
  const jitter = V.osc('sine', 5.5 + k.rng() * 2);
  V.chain(jitter, V.gain(f0 * 0.012), src.frequency);
  const voiced = V.gain(0);
  voiced.gain.setValueAtTime(0, t);
  voiced.gain.setValueAtTime(0, t + h * 0.6);
  voiced.gain.linearRampToValueAtTime(1, t + h + 0.03);
  voiced.gain.setValueAtTime(1, end - dur * 0.35);
  voiced.gain.linearRampToValueAtTime(0, end);
  const n = V.noise();
  const air = V.gain(0);
  air.gain.setValueAtTime(0, t);
  air.gain.linearRampToValueAtTime(0.55, t + h * 0.5);
  air.gain.linearRampToValueAtTime(breath, t + h + 0.02);
  air.gain.linearRampToValueAtTime(0, end);
  const sum = V.gain(1);
  V.chain(src, voiced, sum);
  V.chain(n, air, sum);
  const mix = V.gain(level * 3.2);
  const vowels = path.map((p) => VOWELS[p] || VOWELS.a);
  for (let j = 0; j < 3; j++) {
    const first = vowels[0][j];
    const bp = V.filter('bandpass', first[0] * scale, j === 0 ? 5 : j === 1 ? 9 : 12);
    const amp = V.gain(first[1]);
    vowels.forEach((vw, i) => {
      if (i === 0) {
        bp.frequency.setValueAtTime(vw[j][0] * scale, t);
        amp.gain.setValueAtTime(vw[j][1], t);
        return;
      }
      const at = t + h + ((dur * i) / Math.max(1, vowels.length - 1)) * 0.85;
      bp.frequency.linearRampToValueAtTime(vw[j][0] * scale, at);
      amp.gain.linearRampToValueAtTime(vw[j][1], at);
    });
    V.chain(sum, bp, amp, mix);
  }
  V.chain(mix, V.pan(pan), out);
  return V.play(t, end + 0.03);
}

// A squad shouting "HEY!": several voices, slightly apart in time, pitch and size.
export function heyVoices(k, out, t, vel = 0.8, { count = null, f0 = [300, 560] } = {}) {
  const n = count ?? (vel >= 0.95 ? 7 : vel >= 0.7 ? 4 : 1);
  let end = t;
  for (let i = 0; i < n; i++) {
    end = Math.max(end, formantVoice(k, out, t + k.rand(0, 0.032), {
      f0: k.rand(f0[0], f0[1]),
      path: ['e', 'e', 'I'],
      dur: k.rand(0.2, 0.3),
      level: (vel * 0.42) / Math.sqrt(n),
      pan: n === 1 ? 0 : k.rand(-0.7, 0.7),
      scale: k.rand(0.98, 1.18),
      contour: [0.95, 1.16, 0.8],
      h: k.rand(0.03, 0.05),
    }));
  }
  return end;
}

// A crowd cheering: babble-shaped pink noise swelling up, applause, and a few "woo!"s on top.
export function crowdCheer(k, out, t, { level = 0.6, dur = 2.2, voices = 6, claps = true } = {}) {
  const V = new Voice(k);
  const end = t + dur;
  const bed = V.gain(0);
  bed.gain.setValueAtTime(0, t);
  bed.gain.linearRampToValueAtTime(level * 0.55, t + 0.28);
  bed.gain.setTargetAtTime(level * 0.38, t + 0.3, 0.4);
  bed.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.12);
  // babble: the noise flutters the way many overlapping voices do
  const flutter = V.gain(1);
  for (const [hz, depth] of [[3.3, 0.22], [5.9, 0.16], [8.7, 0.1]]) V.chain(V.osc('sine', hz + k.rng()), V.gain(depth), flutter.gain);
  for (const [f, q, amp, pan] of [[480, 1.4, 1, -0.4], [1100, 1.6, 0.8, 0.35], [2400, 1.8, 0.45, 0]]) {
    const n = V.noise('pink');
    V.chain(n, V.filter('bandpass', f, q), V.gain(amp * 2.2), V.pan(pan), flutter);
  }
  V.chain(flutter, bed, out);
  // applause: one noise source per side, clapped by a gain full of tiny spikes
  if (claps) {
    for (const pan of [-0.6, 0.6]) {
      const n = V.noise();
      const g = V.gain(0);
      g.gain.setValueAtTime(0, t);
      let at = t + 0.05;
      while (at < end - 0.1) {
        const fade = 1 - (at - t) / dur;
        const lv = level * 0.32 * fade * (0.6 + k.rng() * 0.4);
        g.gain.setValueAtTime(lv, at);
        g.gain.exponentialRampToValueAtTime(lv * 0.03 + 0.0001, at + 0.018);
        at += 0.024 + k.rng() * 0.05;
      }
      g.gain.setValueAtTime(0, at);
      V.chain(n, V.filter('bandpass', 1900, 0.9), g, V.pan(pan), out);
    }
  }
  V.play(t, end + 0.05);
  // woo! and yay! from a few people in the crowd
  for (let i = 0; i < voices; i++) {
    const woo = k.rng() < 0.55;
    formantVoice(k, out, t + k.rand(0.05, Math.min(0.9, dur * 0.4)), {
      f0: k.rand(380, 620),
      path: woo ? ['u', 'u', 'o'] : ['i', 'e', 'ae', 'I'],
      dur: k.rand(0.35, 0.6),
      level: level * 0.2,
      pan: k.rand(-0.8, 0.8),
      scale: k.rand(1, 1.18),
      contour: woo ? [0.8, 1.45, 1.2] : [1, 1.3, 1.15],
      h: woo ? 0.01 : 0.02,
    });
  }
  return end + 0.1;
}
