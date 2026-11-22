// Cloud Nine's sound effects: cute, bouncy and sparkly, all synthesized (the "yay!" and "aww" are
// formant-filtered oscillators, not recordings). Never harsh: a dodgeball hit is a cartoon bonk.
//
//   SFX_NAMES                         every name in Contract 6
//   SFX[name](kit, out, t, pitch) -> end time   pitch is a multiplier (1 = as designed, 2 = an octave up)
//   triggerSfx(kit, mixer, name, t, { level, pan, pitch }) -> { end, nodes } | null
//       wires one effect into the mixer (volume, pan, its reverb send) and ducks the music under it.
//       The caller disconnects `nodes` once `end` has passed.

import { INSTRUMENTS, Voice, adsr, bellNote, blip, crowdCheer, formantVoice, mtof, noiseHit, perc } from './synth.js';
import { noteToMidi } from './theory.js';

const N = (name) => mtof(noteToMidi(name));
const semis = (p) => 12 * Math.log2(p);
const NOV = {}; // instrument calls from effects carry no voice params

// a crackle: one noise source clicked on and off by a gain full of tiny spikes
function crackle(k, out, t, dur, { f = 6000, f2 = null, level = 0.2, gap = [0.008, 0.035] } = {}) {
  const V = new Voice(k);
  const n = V.noise();
  const bp = V.filter('bandpass', f, 1);
  if (f2) {
    bp.frequency.setValueAtTime(f, t);
    bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
  }
  const g = V.gain(0);
  g.gain.setValueAtTime(0, t);
  let at = t + 0.002;
  while (at < t + dur) {
    const lv = level * (1 - (at - t) / (dur * 1.1)) * (0.35 + k.rng() * 0.65);
    g.gain.setValueAtTime(lv, at);
    g.gain.exponentialRampToValueAtTime(lv * 0.02 + 0.0001, at + 0.006);
    at += gap[0] + k.rng() * (gap[1] - gap[0]);
  }
  g.gain.setValueAtTime(0, at);
  V.chain(n, bp, g, out);
  return V.play(t, at + 0.02);
}

function panSweep(V, from, to, t, dur) {
  const p = V.pan(from);
  if (p.pan) {
    p.pan.setValueAtTime(from, t);
    p.pan.linearRampToValueAtTime(to, t + dur);
  }
  return p;
}

export const SFX = {
  // ---------------------------------------------------------------- interface
  tap(k, out, t, p) {
    blip(k, out, t, { f: 1250 * p, f2: 940 * p, glide: 0.03, a: 0.001, decay: 0.07, level: 0.3 });
    noiseHit(k, out, t, { type: 'highpass', f: 4500, a: 0.001, decay: 0.008, level: 0.07 });
    return t + 0.12;
  },

  open(k, out, t, p) {
    bellNote(k, out, t, N('G5') * p, 0.18, 0.6);
    bellNote(k, out, t + 0.075, N('C6') * p, 0.2, 0.8);
    noiseHit(k, out, t, { f: 1500, f2: 6000, q: 1.2, a: 0.06, decay: 0.12, level: 0.07, sweep: 0.16 });
    return t + 0.9;
  },

  close(k, out, t, p) {
    bellNote(k, out, t, N('C6') * p, 0.15, 0.5);
    bellNote(k, out, t + 0.075, N('G5') * p, 0.15, 0.6);
    noiseHit(k, out, t, { f: 5000, f2: 1400, q: 1.2, a: 0.04, decay: 0.12, level: 0.06, sweep: 0.16 });
    return t + 0.75;
  },

  // ---------------------------------------------------------------- the basket toss
  // the bases' "hup!", a whoosh that climbs as you fly, a "wheee" and a twinkle at the top
  toss(k, out, t, p) {
    blip(k, out, t, { f: 150 * p, f2: 70 * p, glide: 0.09, a: 0.003, decay: 0.16, level: 0.55 });
    noiseHit(k, out, t, { type: 'lowpass', f: 700, decay: 0.09, level: 0.3, color: 'pink' });
    const V = new Voice(k);
    const n = V.noise();
    const bp = V.filter('bandpass', 300, 1.2);
    bp.frequency.setValueAtTime(300, t + 0.04);
    bp.frequency.exponentialRampToValueAtTime(5500 * Math.min(1.4, p), t + 0.85);
    const g = V.gain(0);
    g.gain.setValueAtTime(0, t + 0.04);
    g.gain.linearRampToValueAtTime(0.42, t + 0.55);
    g.gain.linearRampToValueAtTime(0, t + 1.0);
    V.chain(n, bp, g, panSweep(V, -0.4, 0.4, t, 1), out);
    const o = V.osc('triangle', 262 * p);
    o.frequency.setValueAtTime(262 * p, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(1046 * p, t + 0.8);
    V.chain(V.osc('sine', 7), V.gain(18), o.detune);
    const og = V.gain(0);
    og.gain.setValueAtTime(0, t + 0.05);
    og.gain.linearRampToValueAtTime(0.12, t + 0.3);
    og.gain.linearRampToValueAtTime(0, t + 0.9);
    V.chain(o, V.filter('lowpass', 3000, 0.7), og, out);
    V.play(t, t + 1.05);
    ['C7', 'E7', 'G7'].forEach((nm, i) => bellNote(k, out, t + 0.72 + i * 0.05, N(nm) * p, 0.07, 0.5));
    return t + 1.4;
  },

  whoosh(k, out, t, p) {
    const V = new Voice(k);
    const n = V.noise();
    const bp = V.filter('bandpass', 400, 1.4);
    bp.frequency.setValueAtTime(380 * p, t);
    bp.frequency.exponentialRampToValueAtTime(3200 * p, t + 0.18);
    bp.frequency.exponentialRampToValueAtTime(700 * p, t + 0.42);
    const g = V.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    V.chain(n, bp, g, panSweep(V, -0.5, 0.5, t, 0.45), out);
    return V.play(t, t + 0.48);
  },

  // a glittery pentatonic arpeggio with a shimmer of noise
  sparkle(k, out, t, p) {
    const names = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7', 'G7'];
    names.forEach((nm, i) => {
      const f = N(nm) * p * (1 + (k.rng() - 0.5) * 0.004);
      bellNote(k, out, t + i * 0.028, f, 0.12, 0.55, undefined, (i % 2 ? 0.55 : -0.55) * (0.3 + i / names.length));
    });
    const V = new Voice(k);
    const n = V.noise();
    const g = V.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    const trem = V.gain(1);
    V.chain(V.osc('square', 23), V.gain(0.5), trem.gain);
    V.chain(n, V.filter('highpass', 7000, 0.7), trem, g, out);
    V.play(t, t + 0.62);
    return t + 0.95;
  },

  // landing on a cloud: a pillowy thump (slower than a kick) and a twinkling chord
  land(k, out, t, p) {
    blip(k, out, t, { f: 125 * p, f2: 58 * p, glide: 0.1, a: 0.007, decay: 0.26, level: 0.6 });
    noiseHit(k, out, t, { type: 'lowpass', f: 380, a: 0.006, decay: 0.16, level: 0.35, color: 'pink' });
    ['E6', 'G6', 'C7', 'E7', 'G7'].forEach((nm, i) => bellNote(k, out, t + 0.03 + i * 0.016, N(nm) * p, 0.07, 0.7, undefined, (i - 2) * 0.25));
    noiseHit(k, out, t + 0.02, { type: 'highpass', f: 6500, a: 0.04, decay: 0.45, level: 0.05 });
    return t + 1.0;
  },

  // caught! two arms, a cushioned settle, and a sweet "you're safe" two-note
  cradle(k, out, t, p) {
    blip(k, out, t, { f: 110 * p, f2: 60 * p, glide: 0.08, a: 0.005, decay: 0.16, level: 0.45 });
    blip(k, out, t + 0.055, { f: 100 * p, f2: 55 * p, glide: 0.08, a: 0.005, decay: 0.18, level: 0.4 });
    noiseHit(k, out, t, { type: 'lowpass', f: 520, a: 0.04, decay: 0.3, level: 0.22, color: 'pink' });
    bellNote(k, out, t + 0.12, N('C6') * p, 0.12, 0.7);
    bellNote(k, out, t + 0.24, N('E6') * p, 0.14, 0.9);
    return t + 1.15;
  },

  // ---------------------------------------------------------------- people
  // a little squad going "yay!" with a clap
  cheer(k, out, t, p) {
    let end = t;
    for (let i = 0; i < 4; i++) {
      end = Math.max(end, formantVoice(k, out, t + k.rand(0, 0.05), {
        f0: k.rand(400, 600) * p,
        path: ['i', 'e', 'ae', 'e', 'I'],
        dur: k.rand(0.42, 0.55),
        level: 0.2,
        pan: k.rand(-0.6, 0.6),
        scale: k.rand(1.02, 1.2),
        contour: [0.95, 1.3, 1.18],
        h: 0.012,
      }));
    }
    INSTRUMENTS.bigclap(k, out, t + 0.03, { vel: 0.42, v: NOV });
    INSTRUMENTS.bigclap(k, out, t + 0.24, { vel: 0.38, v: NOV });
    return end + 0.05;
  },

  // the stands: babble swelling up, applause, and "woo!"s
  crowd(k, out, t, p) {
    return crowdCheer(k, out, t, { level: 0.8 * Math.min(1.2, p), dur: 2.6, voices: 8 });
  },

  clap(k, out, t) {
    INSTRUMENTS.bigclap(k, out, t, { vel: 0.95, v: NOV });
    return t + 0.3;
  },

  // ---------------------------------------------------------------- games
  // a referee's pea whistle: a bright tone with the pea's rattle in it
  whistle(k, out, t, p) {
    const V = new Voice(k);
    const f = 2900 * p;
    const o = V.osc('sine', f);
    o.frequency.setValueAtTime(f * 0.92, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.03);
    const trill = V.osc('sine', 34);
    V.chain(trill, V.gain(f * 0.05), o.frequency);
    const am = V.gain(0.8);
    V.chain(trill, V.gain(0.2), am.gain);
    const g = V.gain(0);
    const end = adsr(g.gain, t, 0.38, 0.012, 0.05, 0.9, 0.06, 0.16);
    V.chain(o, am, g, out);
    const n = V.noise();
    const ng = V.gain(0);
    adsr(ng.gain, t, 0.38, 0.01, 0.05, 0.8, 0.05, 0.06);
    V.chain(n, V.filter('bandpass', f, 6), ng, out);
    return V.play(t, end);
  },

  count(k, out, t, p) {
    const V = new Voice(k);
    const f = 880 * p;
    const g = V.gain(0);
    const end = adsr(g.gain, t, 0.11, 0.004, 0.08, 0.7, 0.06, 0.3);
    V.chain(V.osc('triangle', f), g, out);
    V.chain(V.osc('sine', f * 2), V.gain(0.25), g);
    return V.play(t, end);
  },

  go(k, out, t, p) {
    const V = new Voice(k);
    const lp = V.filter('lowpass', 5000, 0.7);
    const g = V.gain(0);
    const end = adsr(g.gain, t, 0.38, 0.005, 0.2, 0.7, 0.25, 0.22);
    V.chain(lp, g, out);
    for (const nm of ['A5', 'C#6', 'E6']) {
      V.chain(V.osc('square', N(nm) * p), V.gain(0.3), lp);
      V.chain(V.osc('triangle', N(nm) * p * 2), V.gain(0.15), lp);
    }
    V.play(t, end);
    noiseHit(k, out, t, { f: 800, f2: 6000, q: 1.2, a: 0.12, decay: 0.15, level: 0.12, sweep: 0.25 });
    ['A6', 'C#7', 'E7'].forEach((nm, i) => bellNote(k, out, t + 0.1 + i * 0.04, N(nm) * p, 0.05, 0.5));
    return Math.max(end, t + 0.8);
  },

  bounce(k, out, t, p) {
    const V = new Voice(k);
    const o = V.osc('sine', 260 * p);
    o.frequency.setValueAtTime(240 * p, t);
    o.frequency.exponentialRampToValueAtTime(440 * p, t + 0.08);
    const depth = V.gain(0);
    depth.gain.setValueAtTime(70 * p, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.38);
    V.chain(V.osc('sine', 16), depth, o.frequency);
    const g = V.gain(0);
    perc(g.gain, t, 0.004, 0.4, 0.36);
    V.chain(o, g, out);
    return V.play(t, t + 0.46);
  },

  throw(k, out, t, p) {
    noiseHit(k, out, t, { f: 900 * p, f2: 3600 * p, q: 1.3, a: 0.07, decay: 0.12, level: 0.65, sweep: 0.16 });
    blip(k, out, t, { f: 480 * p, f2: 920 * p, glide: 0.07, a: 0.004, decay: 0.08, level: 0.14 });
    return t + 0.3;
  },

  // a cartoon bonk with a silly wobble: it reads as funny, never sore
  hit(k, out, t, p) {
    blip(k, out, t, { f: 560 * p, f2: 190 * p, glide: 0.11, a: 0.002, decay: 0.18, level: 0.48 });
    noiseHit(k, out, t, { type: 'lowpass', f: 1100, decay: 0.06, level: 0.36, color: 'pink' });
    const V = new Voice(k);
    const o = V.osc('triangle', 340 * p);
    V.chain(V.osc('sine', 24), V.gain(30 * p), o.frequency);
    const g = V.gain(0);
    perc(g.gain, t + 0.04, 0.005, 0.22, 0.12);
    V.chain(o, g, out);
    V.play(t, t + 0.3);
    return t + 0.36;
  },

  catch(k, out, t, p) {
    noiseHit(k, out, t, { type: 'lowpass', f: 700, decay: 0.07, level: 0.5, color: 'pink' });
    blip(k, out, t, { f: 210 * p, f2: 120 * p, glide: 0.08, a: 0.002, decay: 0.1, level: 0.4 });
    bellNote(k, out, t + 0.04, N('G5') * p, 0.12, 0.5);
    bellNote(k, out, t + 0.1, N('D6') * p, 0.14, 0.7);
    return t + 0.85;
  },

  pop(k, out, t, p) {
    blip(k, out, t, { f: 380 * p, f2: 980 * p, glide: 0.045, a: 0.002, decay: 0.07, level: 0.5 });
    noiseHit(k, out, t, { type: 'highpass', f: 3000, a: 0.001, decay: 0.006, level: 0.12 });
    return t + 0.12;
  },

  // found you! a quick "ta-da" run and a boing
  found(k, out, t, p) {
    const st = semis(p);
    ['C5', 'E5', 'G5', 'C6'].forEach((nm, i) => {
      INSTRUMENTS.pluck(k, out, t + i * 0.055, { notes: [noteToMidi(nm) + st], dur: i === 3 ? 0.3 : 0.08, vel: 0.9, v: NOV });
    });
    SFX.bounce(k, out, t + 0.24, p * 1.3);
    ['E7', 'G7'].forEach((nm, i) => bellNote(k, out, t + 0.2 + i * 0.05, N(nm) * p, 0.06, 0.5));
    return t + 0.8;
  },

  // ice crystals forming: glassy notes tumbling down, a crackle, a chilly sweep
  freeze(k, out, t, p) {
    [3136, 2794, 2349, 1976, 1661, 1397].forEach((f, i) => {
      bellNote(k, out, t + i * 0.04, f * p, 0.11, 0.6, [[1, 1, 1], [1.006, 0.8, 0.9], [2.41, 0.2, 0.3]], i % 2 ? 0.4 : -0.4);
    });
    crackle(k, out, t, 0.5, { f: 8000, f2: 2500, level: 0.25 });
    blip(k, out, t + 0.25, { f: 3520 * p, a: 0.002, decay: 0.7, level: 0.07 });
    noiseHit(k, out, t, { f: 6000, f2: 1500, q: 2, a: 0.05, decay: 0.5, level: 0.14, sweep: 0.55 });
    return t + 1.05;
  },

  // thawing out: the same glass, rising and warm, and a little pop of freedom
  unfreeze(k, out, t, p) {
    ['B5', 'D6', 'F#6', 'A6', 'C#7', 'E7'].forEach((nm, i) => bellNote(k, out, t + i * 0.035, N(nm) * p, 0.12, 0.6, undefined, (i - 2.5) * 0.2));
    blip(k, out, t + 0.22, { f: 300 * p, f2: 640 * p, glide: 0.06, a: 0.003, decay: 0.1, level: 0.4 });
    noiseHit(k, out, t, { f: 1500, f2: 7000, q: 1.5, a: 0.1, decay: 0.2, level: 0.1, sweep: 0.3 });
    return t + 0.95;
  },

  // Capture the Bow: the ribbon swish, "ding-ding!" and a little magic
  bowGrab(k, out, t, p) {
    noiseHit(k, out, t, { f: 1200 * p, f2: 4500 * p, q: 1.4, a: 0.05, decay: 0.14, level: 0.25, sweep: 0.2 });
    bellNote(k, out, t + 0.05, N('E6') * p, 0.16, 0.6);
    bellNote(k, out, t + 0.13, N('A6') * p, 0.18, 0.9);
    const V = new Voice(k);
    const o = V.osc('sine', 660 * p);
    o.frequency.setValueAtTime(660 * p, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(1320 * p, t + 0.3);
    V.chain(V.osc('sine', 9), V.gain(25), o.detune);
    const g = V.gain(0);
    perc(g.gain, t + 0.05, 0.02, 0.35, 0.08);
    V.chain(o, g, out);
    V.play(t, t + 0.45);
    return t + 1.1;
  },

  score(k, out, t, p) {
    const st = semis(p);
    [['C6', 0], ['E6', 0.07], ['G6', 0.14], ['C7', 0.21]].forEach(([nm, dt], i) => {
      INSTRUMENTS.pluck(k, out, t + dt, { notes: [noteToMidi(nm) + st], dur: i === 3 ? 0.4 : 0.1, vel: 0.85, v: NOV });
    });
    bellNote(k, out, t + 0.21, N('C7') * p, 0.12, 1.0);
    bellNote(k, out, t + 0.21, N('G6') * p, 0.08, 0.9);
    INSTRUMENTS.bigclap(k, out, t + 0.21, { vel: 0.55, v: NOV });
    ['E7', 'G7', 'C8'].forEach((nm, i) => bellNote(k, out, t + 0.3 + i * 0.04, N(nm) * p, 0.04, 0.4));
    return t + 1.25;
  },

  // a magician's reveal: a pickup and a big bright brass chord with a cymbal shimmer
  tada(k, out, t, p) {
    const st = semis(p);
    INSTRUMENTS.brass(k, out, t, { notes: [noteToMidi('G4') + st], dur: 0.09, vel: 0.8, v: NOV, from: null });
    INSTRUMENTS.brass(k, out, t + 0.11, { notes: ['C5', 'E5', 'G5', 'C6'].map((nm) => noteToMidi(nm) + st), dur: 0.75, vel: 0.8, v: NOV, from: null });
    noiseHit(k, out, t + 0.11, { type: 'highpass', f: 4000, a: 0.002, decay: 0.9, level: 0.08 });
    INSTRUMENTS.sparkle(k, out, t + 0.12, { vel: 0.8, v: NOV, chord: { pcs: [0, 4, 7] } });
    return t + 1.45;
  },

  // a sweet "awww" (so close!), then a tiny bright boop that says it's okay
  aww(k, out, t, p) {
    let end = t;
    for (let i = 0; i < 3; i++) {
      end = Math.max(end, formantVoice(k, out, t + i * 0.03, {
        f0: k.rand(360, 470) * p,
        path: ['ae', 'aw', 'aw', 'o'],
        dur: 0.7,
        level: 0.2,
        pan: (i - 1) * 0.5,
        scale: k.rand(1.02, 1.15),
        contour: [1.12, 1.0, 0.78],
        h: 0.012,
        breath: 0.12,
      }));
    }
    blip(k, out, end - 0.02, { f: 660 * p, f2: 880 * p, glide: 0.05, a: 0.004, decay: 0.12, level: 0.12 });
    return end + 0.2;
  },

  // a rising whistle, a bang with a soft boom, then crackling sparks and twinkles
  firework(k, out, t, p) {
    const V = new Voice(k);
    const o = V.osc('sine', 500 * p);
    o.frequency.setValueAtTime(500 * p, t);
    o.frequency.exponentialRampToValueAtTime(1700 * p, t + 0.7);
    const og = V.gain(0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.07, t + 0.1);
    og.gain.linearRampToValueAtTime(0, t + 0.72);
    V.chain(o, og, out);
    const fz = V.noise();
    const fg = V.gain(0);
    fg.gain.setValueAtTime(0, t);
    fg.gain.linearRampToValueAtTime(0.06, t + 0.1);
    fg.gain.linearRampToValueAtTime(0, t + 0.72);
    V.chain(fz, V.filter('bandpass', 3000, 1), fg, out);
    V.play(t, t + 0.75);
    const b = t + 0.75;
    noiseHit(k, out, b, { type: 'lowpass', f: 2600, f2: 400, a: 0.002, decay: 0.7, level: 0.55, color: 'pink', sweep: 0.6 });
    blip(k, out, b, { f: 90, f2: 34, glide: 0.5, a: 0.002, decay: 0.9, level: 0.5 });
    crackle(k, out, b + 0.12, 0.9, { f: 5000, level: 0.14, gap: [0.01, 0.05] });
    for (let i = 0; i < 6; i++) {
      bellNote(k, out, b + 0.15 + k.rng() * 0.8, k.rand(1800, 3600) * p, 0.035, 0.5, undefined, k.rand(-0.7, 0.7));
    }
    return b + 1.7;
  },

  chime(k, out, t, p) {
    [['E6', 0], ['G6', 0.13], ['C7', 0.26]].forEach(([nm, dt]) => bellNote(k, out, t + dt, N(nm) * p, 0.16, 1.3));
    return t + 1.75;
  },

  // ---------------------------------------------------------------- moving
  step(k, out, t, p) {
    noiseHit(k, out, t, { type: 'lowpass', f: k.rand(900, 1500) * p, a: 0.002, decay: 0.045, level: 0.22, color: 'pink' });
    blip(k, out, t, { f: k.rand(95, 125) * p, a: 0.002, decay: 0.04, level: 0.14 });
    return t + 0.1;
  },

  jump(k, out, t, p) {
    blip(k, out, t, { type: 'square', f: 300 * p, f2: 760 * p, glide: 0.1, a: 0.003, decay: 0.13, level: 0.2, lp: 2600 });
    noiseHit(k, out, t, { type: 'lowpass', f: 900, decay: 0.05, level: 0.16, color: 'pink' });
    return t + 0.2;
  },

  // pom-poms: two rustly shakes of a hundred crinkly strands, and a glint
  poms(k, out, t, p) {
    for (const [dt, pan] of [[0, -0.35], [0.17, 0.35]]) {
      const V = new Voice(k);
      const t1 = t + dt;
      const n = V.noise();
      const g = V.gain(0);
      g.gain.setValueAtTime(0, t1);
      let at = t1 + 0.001;
      while (at < t1 + 0.14) {
        const lv = 0.85 * (0.35 + k.rng() * 0.65) * (1 - (0.5 * (at - t1)) / 0.14);
        g.gain.setValueAtTime(lv, at);
        g.gain.exponentialRampToValueAtTime(lv * 0.01 + 0.0001, at + 0.006);
        at += 0.007 + k.rng() * 0.009;
      }
      g.gain.setValueAtTime(0, at);
      V.chain(n, V.filter('bandpass', 4200 * p, 0.8), V.filter('highpass', 2400, 0.7), g, V.pan(pan), out);
      V.play(t1, at + 0.02);
    }
    bellNote(k, out, t + 0.05, N('E7') * p, 0.05, 0.4);
    bellNote(k, out, t + 0.22, N('A7') * p, 0.05, 0.4);
    return t + 0.5;
  },
};

export const SFX_NAMES = Object.keys(SFX);

// How much of each effect goes to the reverb, and how it ducks the music: [amount, share of its length].
const REVERB = { sparkle: 0.3, chime: 0.35, land: 0.2, cradle: 0.15, firework: 0.3, crowd: 0.25, cheer: 0.2, tada: 0.25, score: 0.2, whistle: 0.15, freeze: 0.3, unfreeze: 0.25, bowGrab: 0.2, open: 0.15, close: 0.12, aww: 0.2, toss: 0.15, found: 0.15, go: 0.15, step: 0, tap: 0.04 };
const DUCK = {
  toss: [0.3, 0.6], land: [0.3, 0.5], cradle: [0.3, 0.5], cheer: [0.3, 0.6], crowd: [0.3, 0.6], whistle: [0.3, 0.8],
  go: [0.3, 0.6], score: [0.3, 0.5], tada: [0.32, 0.6], found: [0.25, 0.6], firework: [0.25, 0.6], freeze: [0.25, 0.5],
  unfreeze: [0.25, 0.5], bowGrab: [0.25, 0.5], aww: [0.3, 0.7], sparkle: [0.18, 0.5], chime: [0.2, 0.5], catch: [0.18, 0.5],
  hit: [0.18, 0.6], open: [0.12, 0.4], close: [0.1, 0.4], count: [0.2, 1], whoosh: [0.12, 0.6], bounce: [0.12, 0.6],
  throw: [0.12, 0.6], clap: [0.12, 0.6], poms: [0.12, 0.6], pop: [0.08, 0.8], jump: [0.08, 0.8],
};

export function triggerSfx(kit, mixer, name, t, { level = 1, pan = 0, pitch = 1 } = {}) {
  const make = SFX[name];
  if (!make) return null;
  const ctx = kit.ctx;
  const out = ctx.createGain();
  out.gain.value = level;
  const nodes = [out];
  let tail = out;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p);
    tail = p;
    nodes.push(p);
  }
  tail.connect(mixer.sfxBus);
  const rv = REVERB[name] ?? 0.08;
  if (rv > 0) {
    const send = ctx.createGain();
    send.gain.value = rv;
    tail.connect(send);
    send.connect(mixer.reverbIn);
    nodes.push(send);
  }
  const end = make(kit, out, t, pitch) || t + 1;
  const d = DUCK[name];
  if (d) mixer.duck(d[0] * Math.min(1, level), Math.min(1.5, Math.max(0.08, (end - t) * d[1])), t);
  return { end, nodes };
}
