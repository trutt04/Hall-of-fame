// The mixing desk: buses, shared reverb and delay, ducking, and the master chain that keeps the
// output clean. Works in an AudioContext or an OfflineAudioContext.
//
//   const mixer = createMixer(ctx)
//   mixer.musicBus, mixer.sfxBus      where tracks and sound effects plug in
//   mixer.reverbIn, mixer.delayIn     effect sends (the delay follows the music's tempo)
//   mixer.setTempo(bpm)               dotted-8th echoes for the current track
//   mixer.duck(amount, hold)          sound effects push the music down a little, then let it back
//   mixer.out                         the master fader (sound on/off and tab fades happen here)
//   mixer.analyser()                  an AnalyserNode on the output, made on first ask (dev board)
//
// Master chain: everything -> limiter -> trim -> soft clipper -> fader -> speakers. The limiter does
// the work; the clipper is a seatbelt whose ceiling is 0.92 (-0.7 dBFS), so the output can never clip.

import { mulberry32 } from '../core/util.js';

export const CEILING = 0.92;

export function softClipCurve(knee = 0.72, ceiling = CEILING, n = 4096) {
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

// A synthetic room: two decorrelated noise tails, a short pre-delay, a few early reflections, and a
// tail that darkens as it decays (one-pole lowpass whose cutoff falls with time).
function makeImpulse(ctx, seconds = 1.7, seed = 9) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const rng = mulberry32(seed);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr;
      const env = Math.exp((-6.9 * tt) / seconds);
      const k = 0.55 - 0.45 * (tt / seconds); // brightness falls over time
      lp += k * ((rng() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    // early reflections: a handful of taps that differ per side
    for (let r = 0; r < 6; r++) {
      const at = pre + Math.floor(sr * (0.006 + rng() * 0.04));
      if (at < len) d[at] += (rng() < 0.5 ? -1 : 1) * (0.5 - r * 0.06);
    }
  }
  return buf;
}

// connect a -> b -> c ... one by one (older Safari's connect() returns nothing to chain on)
function wire(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

export function createMixer(ctx, { reverbSeconds = 1.7 } = {}) {
  const gain = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type, f, q = 0.7) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };

  const sum = gain(1); // everything meets here
  const musicBus = gain(0.86);
  const duckGain = gain(1);
  const sfxBus = gain(1.05);
  musicBus.connect(duckGain);
  duckGain.connect(sum);
  sfxBus.connect(sum);

  // reverb: lows stay dry so the bass doesn't turn to mud
  const reverbIn = gain(1);
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, reverbSeconds);
  const revReturn = gain(0.5);
  wire(reverbIn, filter('highpass', 280, 0.6), conv, revReturn, sum);

  // delay: a stereo pair a little apart, darker with every repeat
  const delayIn = gain(1);
  const delays = [0, 1].map((side) => {
    const d = ctx.createDelay(2);
    d.delayTime.value = side ? 0.43 : 0.4;
    const fb = gain(0.32);
    const tone = filter('lowpass', 3200, 0.5);
    const out = gain(0.42);
    wire(delayIn, d, tone, fb, d);
    let tail = wire(tone, out);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = side ? 0.7 : -0.7;
      tail = wire(tail, p);
    }
    tail.connect(sum);
    tail.connect(reverbIn);
    return d;
  });

  // master: a fast, high-ratio compressor as the limiter, then a trim and the soft ceiling
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -7;
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.16;
  const trim = gain(0.88);
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = 'none'; // oversampling filters could ring past the ceiling
  const out = gain(0);
  wire(sum, limiter, trim, clip, out, ctx.destination);

  let analyserNode = null;

  return {
    ctx,
    musicBus,
    sfxBus,
    reverbIn,
    delayIn,
    out,
    limiter,
    setTempo(bpm) {
      const beat = 60 / Math.max(40, Math.min(220, bpm || 120));
      const now = ctx.currentTime;
      delays[0].delayTime.setTargetAtTime(beat * 0.75, now, 0.05);
      delays[1].delayTime.setTargetAtTime(beat * 0.75 + beat / 8, now, 0.05);
    },
    // Dip the music by `amount` (0..1) right away and come back after `hold` seconds. A new duck
    // cancels a pending recovery, so a burst of effects keeps the music down until it is over.
    duck(amount = 0.25, hold = 0.25, at = ctx.currentTime) {
      const g = duckGain.gain;
      g.cancelScheduledValues(at);
      g.setTargetAtTime(1 - amount, at, 0.02);
      g.setTargetAtTime(1, at + hold, 0.22);
    },
    analyser() {
      if (!analyserNode) {
        analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.75;
        out.connect(analyserNode);
      }
      return analyserNode;
    },
  };
}
