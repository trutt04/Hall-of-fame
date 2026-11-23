// The internal beat source for Hit Zero: used when there is no audio module, or when its beat
// clock is not running (sound off). Same shape as the Contract 6 `beat` object, plus controls.
// With sound on (standalone dev page only) it plays a small synthesized practice beat and runs
// on its own AudioContext clock; otherwise it is a silent clock on performance.now().
//
//   const m = createMetronome({ bpm = 144, rate = 1, structure = null })
//   m.bpm, m.playing, m.structure, m.time(), m.nextBeatTime()
//   m.on('beat', fn({ n, count, eight, time })) / m.off('beat', fn)   fires a little before each beat
//   m.start({ lead = 0.4 })        beat 0 lands `lead` seconds from now
//   m.stop()
//   m.unlock()                     from a user gesture: makes the practice beat possible
//   m.setSound(on), m.sound        the practice beat (needs unlock); takes effect at the next start()
//   m.usesAudioClock               true while it runs on its AudioContext clock
//   m.dispose()
//
// rate > 1 runs the silent clock fast (tests and the autoplay dev page only).

import { emitter } from '../core/util.js';
import { DEFAULT_BPM, DEFAULT_STRUCTURE } from './charts.js';

const LOOKAHEAD = 0.12;
const ROOTS = [48, 43, 45, 41]; // C, G, A, F: one chord per eight-count
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function createMetronome({ bpm = DEFAULT_BPM, rate = 1, structure = null } = {}) {
  const events = emitter();
  bpm = Number(bpm) >= 60 && Number(bpm) <= 220 ? Number(bpm) : DEFAULT_BPM;
  rate = Number(rate) > 0 && Number(rate) <= 16 ? Number(rate) : 1;
  const spb = 60 / bpm;
  const hasDoc = typeof document !== 'undefined';
  const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let wantSound = false;
  let useCtx = false;
  let playing = false;
  let t0 = 0;
  let nextN = 0;
  let timer = 0;

  // the silent clock stands still while the tab is hidden
  let hiddenAt = null;
  let hiddenTotal = 0;
  const perfClock = () => (((hiddenAt ?? perfNow()) - hiddenTotal) / 1000) * rate;
  const time = () => (useCtx && ctx ? ctx.currentTime : perfClock());

  function onVisibility() {
    if (document.hidden) {
      if (hiddenAt === null) hiddenAt = perfNow();
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    } else {
      if (hiddenAt !== null) hiddenTotal += perfNow() - hiddenAt;
      hiddenAt = null;
      if (ctx && ctx.state === 'suspended' && wantSound) ctx.resume().catch(() => {});
    }
  }
  if (hasDoc) document.addEventListener('visibilitychange', onVisibility);

  function unlock() {
    try {
      // browsers refuse sound before the first tap: wait for one rather than make a muted context
      const ua = typeof navigator !== 'undefined' && navigator.userActivation;
      if (!ctx && ua && !ua.hasBeenActive) return false;
      if (!ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    } catch (err) {
      ctx = null;
      return false;
    }
  }

  // ---------------------------------------------------------------- the practice beat
  function env(g, at, peak, decay) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  }
  function kick(at) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.13);
    env(g, at, 0.9, 0.22);
    o.connect(g);
    g.connect(master);
    o.start(at);
    o.stop(at + 0.25);
  }
  function noise(at, type, freq, peak, decay) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    env(g, at, peak, decay);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(at, Math.random() * 0.2);
    s.stop(at + decay + 0.02);
  }
  function tone(at, freq, type, peak, decay) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    env(g, at, peak, decay);
    o.connect(g);
    g.connect(master);
    o.start(at);
    o.stop(at + decay + 0.02);
  }
  function scheduleSound(n, at) {
    const count = (n % 8) + 1;
    const root = ROOTS[Math.floor(n / 8) % ROOTS.length];
    kick(at);
    if (count % 2 === 0) noise(at, 'bandpass', 1500, 0.5, 0.16); // clap on 2, 4, 6, 8
    noise(at + spb / 2, 'highpass', 7000, 0.16, 0.05); // hat on the "and"
    tone(at, hz(root), 'triangle', 0.32, spb * 0.8);
    if (count === 1) tone(at, hz(root + 24), 'sine', 0.16, 0.4); // a chime on every "1"
  }

  function tick() {
    const ahead = time() + LOOKAHEAD * (useCtx ? 1 : rate);
    while (t0 + nextN * spb <= ahead) {
      const n = nextN++;
      const when = t0 + n * spb;
      if (useCtx) {
        try {
          scheduleSound(n, when);
        } catch (err) { /* sound is a bonus */ }
      }
      events.emit('beat', { n, count: (n % 8) + 1, eight: Math.floor(n / 8), time: when });
    }
  }

  function start({ lead = 0.4 } = {}) {
    stop();
    useCtx = !!(wantSound && ctx && ctx.state === 'running' && rate === 1);
    t0 = time() + lead * (useCtx ? 1 : rate);
    nextN = 0;
    playing = true;
    tick();
    timer = setInterval(tick, 25);
  }

  function stop() {
    playing = false;
    if (timer) clearInterval(timer);
    timer = 0;
  }

  return {
    bpm,
    get playing() { return playing; },
    structure: structure || DEFAULT_STRUCTURE,
    time,
    nextBeatTime() {
      const now = time();
      if (now <= t0) return t0;
      return t0 + Math.ceil((now - t0) / spb) * spb;
    },
    on: (name, fn) => events.on(name, fn),
    off: (name, fn) => events.off(name, fn),
    start,
    stop,
    unlock,
    setSound(on) {
      wantSound = !!on;
      if (wantSound) unlock();
    },
    get sound() { return wantSound; },
    get usesAudioClock() { return useCtx; },
    dispose() {
      stop();
      if (hasDoc) document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
