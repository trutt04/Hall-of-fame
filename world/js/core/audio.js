// Sound in League World is synthesized with WebAudio. The one recording is the loudspeaker voice.
//
//   const audio = createAudio()
//   audio.enable()                 MUST be called from a user gesture (tap/click/key). Persists the choice.
//   audio.disable() / audio.toggle()
//   audio.enabled, audio.wanted    wanted: the visitor chose sound on a previous visit
//   audio.update(dt, zoneWeights, listener?)    call every frame; crossfades the neighborhood beds
//   audio.sfx(name, { volume?, position? })     one-shots, see SFX below
//   audio.clip(url, { volume?, position?, falloff?, delay? })   plays a recorded file (resolves true if it played)
//   audio.drone(name, { position, falloff?, range?, volume? })   a continuous sound tied to a place, see DRONES
//   audio.loop(url, { position, falloff?, range?, volume? })    the same, but looping a recorded file.
//                                                               The file is only fetched once somebody walks into range.
//                                                        returns { stop(), position } or null; safe before enable()
//   audio.on('change', fn)
//
// Everything fades in and out, nothing clicks, and the whole context sleeps while the tab is hidden.

import { STORAGE_KEYS } from '../config.js';
import { clamp, emitter, safeStorageGet, safeStorageSet } from './util.js';

const ZONES = ['hill', 'heights', 'plaza', 'bubble', 'park', 'dump'];
const BED_LEVEL = { hill: 1, heights: 1, plaza: 0.9, bubble: 1, park: 1, dump: 1 };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function createAudio() {
  const events = emitter();
  let ctx = null;
  let master = null;
  let ambBus = null;
  let sfxBus = null;
  let white = null;
  let brown = null;
  let enabled = false;
  let wanted = safeStorageGet(STORAGE_KEYS.sound) === '1';
  let clock = 0;
  let suspendTimer = 0;
  const beds = {};
  const listener = { x: 0, z: 0, yaw: 0, has: false };

  // ---------------------------------------------------------------- tiny node helpers
  const gain = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type, freq, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const osc = (type, freq) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  };
  const noise = (buffer, loop = true) => {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    return s;
  };
  const chain = (...nodes) => {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  };
  // attack to peak, then exponential decay to silence
  const pluck = (param, t, attack, peak, decay) => {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const panner = (pan) => {
    if (!ctx.createStereoPanner) return gain(1);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return p;
  };
  // a short burst of filtered noise: the building block for ticks, crackles, drips and steps
  const burst = (out, t, dur, type, freq, q, peak, buf = white) => {
    const s = noise(buf, false);
    const f = filter(type, freq, q);
    const g = gain(0);
    pluck(g.gain, t, Math.min(0.004, dur * 0.3), peak, dur);
    chain(s, f, g, out);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  };

  function makeBuffers() {
    const len = ctx.sampleRate * 2;
    white = ctx.createBuffer(1, len, ctx.sampleRate);
    brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      last = (last + 0.02 * x) / 1.02;
      b[i] = last * 3.5;
    }
    // make the loop seamless
    const fade = 2000;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      b[len - fade + i] = b[len - fade + i] * (1 - k) + b[i] * k;
    }
  }

  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (err) {
      return false;
    }
    master = gain(0);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    chain(master, limiter, ctx.destination);
    ambBus = gain(0.55);
    sfxBus = gain(0.9);
    ambBus.connect(master);
    sfxBus.connect(master);
    makeBuffers();
    return true;
  }

  // ---------------------------------------------------------------- neighborhood beds
  // Each builder wires continuous sources into `out` and returns { stop(), tick(now) }.
  // tick schedules the occasional events (chimes, chirps, crackles) a little ahead of time.
  const AHEAD = 0.45;

  // ---------------------------------------------------------------- place drones
  // A bed belongs to a neighborhood, which is a band of the map. A drone belongs to one spot:
  // it gets quieter and pans as the listener walks away. Builders wire into `out` like beds do.
  const DRONES = {
    // An electrical substation. Mains hum is twice the line frequency, so 120 Hz with harmonics
    // above it, the pair detuned slightly so it beats the way a real transformer does. A thin
    // crackle sits on top for the insulators.
    substation(out) {
      const live = [];
      const partial = (freq, level, detune) => {
        const o = osc('sine', freq);
        o.detune.value = detune;
        chain(o, gain(level), out);
        live.push(o);
      };
      partial(120, 0.085, 0);
      partial(120, 0.055, 7); // beats against the first
      partial(240, 0.038, -4);
      partial(360, 0.017, 5);
      partial(600, 0.006, 0);
      // the breathing of a big iron core under load
      const body = osc('sine', 0.09);
      const bodyG = gain(0.02);
      const swell = gain(1);
      chain(body, bodyG, swell.gain);
      live.push(body);
      // insulator crackle: a whisper of filtered white noise, never loud enough to name
      const hiss = noise(white);
      chain(hiss, filter('highpass', 4200, 0.4), gain(0.0045), out);
      live.push(hiss);
      live.forEach((n) => n.start());
      return { stop: () => live.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } }) };
    },
  };

  const drones = new Set();

  /** Register a continuous sound at a place. Safe to call before the context exists. */
  function drone(name, opts = {}) {
    if (!DRONES[name]) return null;
    const d = {
      name,
      position: opts.position || { x: 0, z: 0 },
      falloff: opts.falloff || 18,
      range: opts.range || 0, // metres past which it is silent; 0 means no hard limit
      volume: opts.volume ?? 1,
      node: null,
      gain: null,
      idle: 0,
      stop() {
        tearDownDrone(d);
        drones.delete(d);
      },
    };
    drones.add(d);
    return d;
  }

  /**
   * A looping recorded file tied to a place. Nothing is downloaded until a listener is close
   * enough to hear it and sound is on, so a visitor who never walks over there never pays for it.
   */
  function loop(url, opts = {}) {
    if (!url) return null;
    const d = {
      name: opts.name || 'loop',
      url,
      position: opts.position || { x: 0, z: 0 },
      falloff: opts.falloff || 18,
      range: opts.range || 0,
      volume: opts.volume ?? 1,
      node: null,
      gain: null,
      idle: 0,
      buffer: null,
      loading: false,
      stop() {
        tearDownDrone(d);
        drones.delete(d);
      },
    };
    drones.add(d);
    return d;
  }

  // Build the looping source for a file drone, or start fetching it and come back next tick.
  function fileNode(d, out) {
    if (!d.buffer) {
      if (!d.loading) {
        d.loading = true;
        loadClip(d.url).then((buf) => {
          d.buffer = buf || null;
          d.loading = false;
        });
      }
      return null;
    }
    const src = ctx.createBufferSource();
    src.buffer = d.buffer;
    src.loop = true;
    src.connect(out);
    src.start();
    return { stop: () => { try { src.stop(); } catch (e) { /* already stopped */ } } };
  }

  function tearDownDrone(d) {
    if (!d.node) return;
    try {
      d.node.stop();
      d.gain.disconnect();
    } catch (e) { /* the context went away under us */ }
    d.node = null;
    d.gain = null;
  }

  function updateDrones(now) {
    for (const d of drones) {
      let level = 0;
      let pan = 0;
      const sp = spatial({ volume: d.volume, position: d.position }, d.falloff);
      if (sp) {
        level = sp.level;
        pan = sp.pan;
        // The inverse square tail never quite reaches zero, so without this a hum would still be
        // faintly on from the other side of town. Past `range` it is silent, and the last quarter
        // is taped off so it fades out rather than stopping dead.
        if (d.range) {
          const dist = Math.hypot(d.position.x - listener.x, d.position.z - listener.z);
          if (dist >= d.range) level = 0;
          else if (dist > d.range * 0.75) level *= 1 - (dist - d.range * 0.75) / (d.range * 0.25);
        }
      }
      if (!d.node) {
        if (level < 0.005) continue; // too far to be worth building
        const g = gain(0);
        const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pn) chain(g, pn, ambBus);
        else chain(g, ambBus);
        const node = d.url ? fileNode(d, g) : DRONES[d.name](g);
        if (!node) {
          // a file still downloading: drop the nodes and try again next tick
          try { g.disconnect(); if (pn) pn.disconnect(); } catch (e) { /* nothing wired yet */ }
          continue;
        }
        d.gain = g;
        d.pan = pn;
        d.idle = 0;
        d.node = node;
      }
      // Always steer the gain, so walking out of earshot fades it now rather than when the
      // nodes are eventually released.
      d.gain.gain.setTargetAtTime(level, now, 0.4);
      if (d.pan) d.pan.pan.setTargetAtTime(pan, now, 0.3);
      if (level < 0.005) {
        d.idle += 0.2;
        if (d.idle > 4) tearDownDrone(d);
      } else {
        d.idle = 0;
      }
    }
  }

  const builders = {
    // The Hill: soft wind and an occasional glassy chime.
    hill(out) {
      const src = noise(brown);
      const bp = filter('bandpass', 520, 0.5);
      const g = gain(0.42);
      const lfo = osc('sine', 0.11);
      const lfoG = gain(0.2);
      const lfo2 = osc('sine', 0.07);
      const lfo2G = gain(190);
      chain(lfo, lfoG, g.gain);
      chain(lfo2, lfo2G, bp.frequency);
      chain(src, bp, g, out);
      const hiss = noise(white);
      chain(hiss, filter('highpass', 5200, 0.3), gain(0.006), out);
      const live = [src, lfo, lfo2, hiss];
      live.forEach((n) => n.start());
      let next = ctx.currentTime + rand(2, 5);
      const notes = [1567.98, 1760, 2093, 2349.32, 2637.02, 3135.96];
      return {
        stop: () => live.forEach((n) => n.stop()),
        tick(now) {
          while (next < now + AHEAD) {
            const count = Math.random() < 0.4 ? 2 : 1;
            for (let i = 0; i < count; i++) {
              const t = Math.max(now, next) + i * rand(0.18, 0.4);
              const f = pick(notes);
              const p = panner(rand(-0.6, 0.6));
              p.connect(out);
              for (const [mul, level] of [[1, 0.05], [2.76, 0.016], [5.4, 0.006]]) {
                const o = osc('sine', f * mul);
                const og = gain(0);
                pluck(og.gain, t, 0.004, level, 2.4 / mul + 0.4);
                chain(o, og, p);
                o.start(t);
                o.stop(t + 3.2);
              }
            }
            next += rand(5, 11);
          }
        },
      };
    },

    // Playoff Heights: a fountain burbling and small birds showing off.
    heights(out) {
      const src = noise(white);
      const g = gain(0.05);
      chain(src, filter('highpass', 650, 0.5), filter('bandpass', 1700, 0.6), g, out);
      const l1 = osc('sine', 5.3);
      const l2 = osc('sine', 2.1);
      chain(l1, gain(0.014), g.gain);
      chain(l2, gain(0.016), g.gain);
      const low = noise(brown);
      const lg = gain(0.1);
      chain(low, filter('bandpass', 330, 1.2), lg, out);
      const l3 = osc('sine', 3.7);
      chain(l3, gain(0.05), lg.gain);
      const live = [src, l1, l2, low, l3];
      live.forEach((n) => n.start());
      let next = ctx.currentTime + rand(1, 3);
      return {
        stop: () => live.forEach((n) => n.stop()),
        tick(now) {
          while (next < now + AHEAD) {
            let t = Math.max(now, next);
            const p = panner(rand(-0.7, 0.7));
            p.connect(out);
            const base = rand(2300, 3900);
            const n = 2 + Math.floor(Math.random() * 4);
            for (let i = 0; i < n; i++) {
              const o = osc('sine', base);
              const og = gain(0);
              const d = rand(0.06, 0.11);
              o.frequency.setValueAtTime(base * rand(0.9, 1.1), t);
              o.frequency.exponentialRampToValueAtTime(base * rand(0.75, 1.35), t + d);
              pluck(og.gain, t, 0.012, 0.03, d);
              chain(o, og, p);
              o.start(t);
              o.stop(t + d + 0.08);
              t += d + rand(0.04, 0.09);
            }
            next += rand(2.2, 6.5);
          }
        },
      };
    },

    // The Plaza: open air, a light crowd murmur and a far-off PA chime now and then.
    plaza(out) {
      const a = noise(brown);
      const ag = gain(0.3);
      chain(a, filter('bandpass', 420, 0.8), ag, out);
      const b = noise(brown);
      const bg = gain(0.12);
      chain(b, filter('bandpass', 980, 1.1), bg, out);
      const l1 = osc('sine', 0.23);
      const l2 = osc('sine', 0.31);
      chain(l1, gain(0.09), ag.gain);
      chain(l2, gain(0.05), bg.gain);
      const air = noise(white);
      chain(air, filter('highpass', 4200, 0.3), gain(0.007), out);
      const live = [a, b, l1, l2, air];
      live.forEach((n) => n.start(0, Math.random()));
      let next = ctx.currentTime + rand(8, 16);
      return {
        stop: () => live.forEach((n) => n.stop()),
        tick(now) {
          while (next < now + AHEAD) {
            const t = Math.max(now, next);
            const pa = filter('bandpass', 1500, 1.6);
            pa.connect(out);
            [[659.25, 0], [523.25, 0.55]].forEach(([f, at]) => {
              const o = osc('triangle', f);
              const og = gain(0);
              pluck(og.gain, t + at, 0.02, 0.028, 1.1);
              chain(o, og, pa);
              o.start(t + at);
              o.stop(t + at + 1.4);
            });
            next += rand(18, 32);
          }
        },
      };
    },

    // The Bubble: a lawn sprinkler, a distant mower, and an uneasy quiet.
    bubble(out) {
      const mowA = osc('sawtooth', 87);
      const mowB = osc('sawtooth', 175.4);
      const mg = gain(0.012);
      const trem = osc('sine', 11);
      chain(trem, gain(0.005), mg.gain);
      const lp = filter('lowpass', 420, 0.7);
      mowA.connect(lp);
      mowB.connect(lp);
      chain(lp, mg, panner(-0.5), out);
      const live = [mowA, mowB, trem];
      live.forEach((n) => n.start());
      let next = ctx.currentTime + 0.3;
      const sp = panner(0.45);
      sp.connect(out);
      return {
        stop: () => live.forEach((n) => n.stop()),
        tick(now) {
          while (next < now + AHEAD) {
            let t = Math.max(now, next);
            // tick-tick-tick...
            for (let i = 0; i < 9; i++) {
              burst(sp, t, 0.014, 'highpass', 3200, 0.7, 0.05);
              t += 0.13;
            }
            // ...hiss as the head swings back
            const s = noise(white, false);
            const g = gain(0);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.03, t + 0.06);
            g.gain.setValueAtTime(0.03, t + 0.7);
            g.gain.linearRampToValueAtTime(0.0001, t + 0.95);
            chain(s, filter('highpass', 4300, 0.5), g, sp);
            s.start(t, Math.random(), 1.0);
            next = t + 1.25;
          }
        },
      };
    },

    // Waiver Wire Trailer Park: crickets, a failing light, a fire in a barrel.
    park(out) {
      const roar = noise(brown);
      const rg = gain(0.12);
      chain(roar, filter('lowpass', 260, 0.7), rg, out);
      const rl = osc('sine', 0.9);
      chain(rl, gain(0.04), rg.gain);
      const buzz = osc('sawtooth', 120);
      const bg = gain(0);
      chain(buzz, filter('highpass', 900, 0.7), filter('bandpass', 2600, 3), bg, panner(0.6), out);
      const live = [roar, rl, buzz];
      live.forEach((n) => n.start());
      const cp = [panner(-0.6), panner(0.3)];
      cp.forEach((p) => p.connect(out));
      let nextCricket = [ctx.currentTime + 0.4, ctx.currentTime + 0.75];
      let nextCrackle = ctx.currentTime + 0.2;
      let nextBuzz = ctx.currentTime + 0.5;
      return {
        stop: () => live.forEach((n) => n.stop()),
        tick(now) {
          for (let v = 0; v < 2; v++) {
            while (nextCricket[v] < now + AHEAD) {
              const t = Math.max(now, nextCricket[v]);
              const f = v === 0 ? 4300 : 3900;
              for (let i = 0; i < 3; i++) {
                const o = osc('sine', f);
                const og = gain(0);
                pluck(og.gain, t + i * 0.047, 0.006, 0.016, 0.026);
                chain(o, og, cp[v]);
                o.start(t + i * 0.047);
                o.stop(t + i * 0.047 + 0.06);
              }
              nextCricket[v] = t + rand(0.5, 0.95);
            }
          }
          while (nextCrackle < now + AHEAD) {
            const t = Math.max(now, nextCrackle);
            burst(out, t, rand(0.004, 0.014), 'bandpass', rand(1200, 4200), 1.5, rand(0.012, 0.055));
            nextCrackle = t + rand(0.03, 0.26);
          }
          while (nextBuzz < now + AHEAD) {
            const t = Math.max(now, nextBuzz);
            bg.gain.setTargetAtTime(Math.random() < 0.6 ? rand(0.004, 0.011) : 0, t, 0.01);
            nextBuzz = t + rand(0.06, 0.7);
          }
        },
      };
    },

    // The Dump: rain on tarp, a low rumble, flies, and a gull laughing somewhere.
    dump(out) {
      const rain = noise(white);
      const rg = gain(0.03);
      chain(rain, filter('highpass', 2300, 0.4), rg, out);
      const rl = osc('sine', 0.31);
      chain(rl, gain(0.008), rg.gain);
      const rum = noise(brown);
      const ug = gain(0.5);
      chain(rum, filter('lowpass', 75, 0.7), ug, out);
      const ul = osc('sine', 0.05);
      chain(ul, gain(0.2), ug.gain);
      const fly = osc('sawtooth', 212);
      const vib = osc('sine', 27);
      chain(vib, gain(15), fly.frequency);
      const fg = gain(0.006);
      const fl = osc('sine', 0.43);
      chain(fl, gain(0.005), fg.gain);
      chain(fly, filter('bandpass', 1100, 4), fg, panner(-0.35), out);
      const live = [rain, rl, rum, ul, fly, vib, fl];
      live.forEach((n) => n.start());
      let nextDrop = ctx.currentTime + 0.1;
      let nextGull = ctx.currentTime + rand(4, 9);
      return {
        stop: () => live.forEach((n) => n.stop()),
        tick(now) {
          while (nextDrop < now + AHEAD) {
            const t = Math.max(now, nextDrop);
            burst(out, t, 0.007, 'bandpass', rand(2800, 6200), 2, rand(0.008, 0.028));
            nextDrop = t + rand(0.02, 0.14);
          }
          while (nextGull < now + AHEAD) {
            let t = Math.max(now, nextGull);
            const p = panner(rand(-0.8, 0.8));
            const lp = filter('lowpass', 2600, 0.6);
            chain(lp, p, out);
            const cries = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < cries; i++) {
              const o = osc('triangle', 1250);
              const og = gain(0);
              const v = osc('sine', 14);
              chain(v, gain(28), o.frequency);
              o.frequency.setValueAtTime(1250, t);
              o.frequency.linearRampToValueAtTime(1780, t + 0.07);
              o.frequency.exponentialRampToValueAtTime(1120, t + 0.38);
              og.gain.setValueAtTime(0.0001, t);
              og.gain.linearRampToValueAtTime(0.022, t + 0.05);
              og.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
              chain(o, og, lp);
              o.start(t);
              v.start(t);
              o.stop(t + 0.5);
              v.stop(t + 0.5);
              t += rand(0.42, 0.6);
            }
            nextGull = t + rand(9, 20);
          }
        },
      };
    },
  };

  function setBed(zone, weight, now) {
    let bed = beds[zone];
    if (!bed) {
      if (weight < 0.02) return;
      const g = gain(0);
      g.connect(ambBus);
      bed = beds[zone] = Object.assign({ gain: g, idle: 0 }, builders[zone](g));
    }
    bed.gain.gain.setTargetAtTime(weight * BED_LEVEL[zone], now, 0.45);
    if (weight < 0.02) {
      bed.idle += 0.2;
      if (bed.idle > 8) {
        bed.stop();
        const g = bed.gain;
        setTimeout(() => g.disconnect(), 200);
        delete beds[zone];
      }
    } else {
      bed.idle = 0;
      bed.tick(now);
    }
  }

  function stopBeds() {
    for (const zone of Object.keys(beds)) {
      try {
        beds[zone].stop();
        beds[zone].gain.disconnect();
      } catch (err) { /* already stopped */ }
      delete beds[zone];
    }
    // Place drones hold nodes on the same context, so they go back at the same moment.
    // The registrations stay, so a drone rebuilds itself when sound comes back on.
    for (const d of drones) tearDownDrone(d);
  }

  // ---------------------------------------------------------------- one-shots
  // Each takes (t, out) and returns how long it rings, in seconds.
  const SFX = {
    step(t, out) {
      burst(out, t, rand(0.045, 0.07), 'lowpass', rand(700, 1500), 0.8, rand(0.1, 0.16));
      const o = osc('sine', rand(80, 110));
      const g = gain(0);
      pluck(g.gain, t, 0.004, 0.08, 0.05);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 0.09);
      return 0.15;
    },
    tick(t, out) {
      const o = osc('sine', 1760);
      const g = gain(0);
      pluck(g.gain, t, 0.002, 0.16, 0.05);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 0.08);
      burst(out, t, 0.006, 'highpass', 5000, 0.5, 0.05);
      return 0.12;
    },
    stamp(t, out) {
      const o = osc('sine', 120);
      const g = gain(0);
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
      pluck(g.gain, t, 0.004, 0.9, 0.34);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 0.5);
      burst(out, t, 0.09, 'lowpass', 600, 0.7, 0.5, brown);
      burst(out, t, 0.03, 'bandpass', 2400, 0.9, 0.16);
      return 0.6;
    },
    // short royal brass: three pickup notes and a held chord
    fanfare(t, out) {
      const lp = filter('lowpass', 900, 0.9);
      lp.connect(out);
      const note = (f, at, dur, level) => {
        for (const det of [-4, 4]) {
          const o = osc('sawtooth', f);
          o.detune.value = det;
          const g = gain(0);
          g.gain.setValueAtTime(0.0001, t + at);
          g.gain.linearRampToValueAtTime(level, t + at + 0.025);
          g.gain.setValueAtTime(level * 0.85, t + at + dur * 0.7);
          g.gain.linearRampToValueAtTime(0.0001, t + at + dur);
          chain(o, g, lp);
          o.start(t + at);
          o.stop(t + at + dur + 0.05);
        }
      };
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.linearRampToValueAtTime(2600, t + 0.5);
      lp.frequency.linearRampToValueAtTime(1500, t + 1.5);
      note(392.0, 0, 0.13, 0.07);
      note(523.25, 0.14, 0.13, 0.07);
      note(659.25, 0.28, 0.13, 0.07);
      note(783.99, 0.42, 1.0, 0.075);
      note(523.25, 0.42, 1.0, 0.045);
      note(659.25, 0.42, 1.0, 0.045);
      return 1.6;
    },
    // wah wah wah waaah
    sadTrombone(t, out) {
      const lp = filter('lowpass', 700, 2.5);
      lp.connect(out);
      const notes = [[233.08, 0.36], [220.0, 0.36], [207.65, 0.36], [196.0, 1.0]];
      let at = 0;
      notes.forEach(([f, dur], i) => {
        const o = osc('sawtooth', f);
        const g = gain(0);
        const last = i === notes.length - 1;
        o.frequency.setValueAtTime(f * 1.02, t + at);
        o.frequency.exponentialRampToValueAtTime(f * (last ? 0.9 : 0.97), t + at + dur);
        if (last) {
          const v = osc('sine', 5.5);
          chain(v, gain(4), o.frequency);
          v.start(t + at);
          v.stop(t + at + dur + 0.1);
        }
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.linearRampToValueAtTime(0.11, t + at + 0.04);
        g.gain.setValueAtTime(0.1, t + at + dur * 0.6);
        g.gain.linearRampToValueAtTime(0.0001, t + at + dur);
        lp.frequency.setValueAtTime(420, t + at);
        lp.frequency.linearRampToValueAtTime(1300, t + at + dur * 0.35);
        lp.frequency.linearRampToValueAtTime(480, t + at + dur);
        chain(o, g, lp);
        o.start(t + at);
        o.stop(t + at + dur + 0.05);
        at += dur + 0.03;
      });
      return at + 0.2;
    },
    thunder(t, out) {
      const s = noise(brown, false);
      s.loop = true;
      const lp = filter('lowpass', 500, 0.5);
      const g = gain(0);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.exponentialRampToValueAtTime(90, t + 2.2);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.9, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.35);
      g.gain.linearRampToValueAtTime(0.42, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      chain(s, lp, g, out);
      s.start(t, Math.random());
      s.stop(t + 2.7);
      burst(out, t, 0.05, 'highpass', 1800, 0.5, 0.18);
      return 2.8;
    },
    truckBeep(t, out) {
      const bp = filter('bandpass', 1050, 4);
      bp.connect(out);
      for (let i = 0; i < 3; i++) {
        const o = osc('square', 1040);
        const g = gain(0);
        const at = t + i * 0.42;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.07, at + 0.012);
        g.gain.setValueAtTime(0.07, at + 0.2);
        g.gain.linearRampToValueAtTime(0.0001, at + 0.23);
        chain(o, g, bp);
        o.start(at);
        o.stop(at + 0.26);
      }
      return 1.3;
    },
    truckDump(t, out) {
      const s = noise(brown, false);
      s.loop = true;
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      chain(s, filter('lowpass', 320, 0.8), g, out);
      s.start(t, Math.random());
      s.stop(t + 1.4);
      for (let i = 0; i < 8; i++) {
        const at = t + 0.12 + Math.random() * 0.9;
        const base = rand(280, 900);
        for (const mul of [1, 2.32, 3.9]) {
          const o = osc('square', base * mul);
          const og = gain(0);
          pluck(og.gain, at, 0.002, 0.035 / mul, rand(0.05, 0.12));
          chain(o, og, out);
          o.start(at);
          o.stop(at + 0.2);
        }
      }
      return 1.5;
    },
    whoosh(t, out) {
      const s = noise(white, false);
      const bp = filter('bandpass', 300, 1.1);
      const g = gain(0);
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.45);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.16);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      chain(s, bp, g, out);
      s.start(t, Math.random(), 0.55);
      return 0.55;
    },
    pop(t, out) {
      const o = osc('sine', 420);
      const g = gain(0);
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(920, t + 0.05);
      pluck(g.gain, t, 0.004, 0.22, 0.07);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 0.12);
      return 0.15;
    },
    // an electric zap for flickering lights
    flicker(t, out) {
      const hp = filter('highpass', 1800, 0.7);
      hp.connect(out);
      const o = osc('sawtooth', 110);
      const g = gain(0);
      chain(o, g, hp);
      let at = t;
      for (let i = 0; i < 5; i++) {
        const on = rand(0.012, 0.05);
        g.gain.setValueAtTime(0.11, at);
        g.gain.setValueAtTime(0.0001, at + on);
        burst(hp, at, on, 'bandpass', rand(3000, 6000), 1, 0.08);
        at += on + rand(0.01, 0.05);
      }
      g.gain.setValueAtTime(0.0001, at);
      o.start(t);
      o.stop(at + 0.02);
      return at - t + 0.1;
    },
    coin(t, out) {
      [[987.77, 0, 0.07], [1318.51, 0.07, 0.4]].forEach(([f, at, dur]) => {
        const o = osc('square', f);
        const g = gain(0);
        pluck(g.gain, t + at, 0.003, 0.07, dur);
        chain(o, filter('lowpass', 4200, 0.5), g, out);
        o.start(t + at);
        o.stop(t + at + dur + 0.08);
      });
      return 0.6;
    },
    // a football meeting a goalpost: a bright strike and a ringing, slightly sagging hum
    doink(t, out) {
      for (const [f, level, decay] of [[494, 0.2, 0.95], [1245, 0.1, 0.55], [2093, 0.05, 0.3]]) {
        const o = osc('sine', f);
        const g = gain(0);
        o.frequency.setValueAtTime(f * 1.03, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.975, t + decay);
        pluck(g.gain, t, 0.003, level, decay);
        chain(o, g, out);
        o.start(t);
        o.stop(t + decay + 0.1);
      }
      burst(out, t, 0.03, 'bandpass', 1700, 1, 0.22);
      return 1.2;
    },
    // the public address system clearing its throat: three notes through a tin horn
    chime(t, out) {
      const bp = filter('bandpass', 1500, 1.1);
      bp.connect(out);
      [[659.25, 0, 0.5], [523.25, 0.24, 0.5], [783.99, 0.48, 0.85]].forEach(([f, at, dur]) => {
        for (const [mul, level] of [[1, 0.16], [2.01, 0.05]]) {
          const o = osc('triangle', f * mul);
          const g = gain(0);
          pluck(g.gain, t + at, 0.006, level, dur);
          chain(o, g, bp);
          o.start(t + at);
          o.stop(t + at + dur + 0.08);
        }
      });
      burst(out, t, 0.05, 'highpass', 2600, 0.7, 0.03);
      return 1.5;
    },
    // a football meeting two hands: a leather thump with a tiny squeak of the laces
    catch(t, out) {
      burst(out, t, 0.075, 'lowpass', 520, 0.9, 0.75, brown);
      burst(out, t + 0.004, 0.035, 'bandpass', 1500, 1.4, 0.26);
      const o = osc('sine', 165);
      const g = gain(0);
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(92, t + 0.13);
      pluck(g.gain, t, 0.003, 0.5, 0.13);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 0.22);
      burst(out, t + 0.055, 0.03, 'highpass', 3400, 0.8, 0.07);
      return 0.35;
    },
    // the same ball meeting nobody: a dull bounce off the turf, then a smaller one
    drop(t, out) {
      for (const [at, level, freq] of [[0, 0.5, 300], [0.165, 0.2, 360], [0.27, 0.08, 420]]) {
        burst(out, t + at, 0.06, 'lowpass', freq, 0.8, level, brown);
        const o = osc('sine', 120);
        const g = gain(0);
        o.frequency.setValueAtTime(128, t + at);
        o.frequency.exponentialRampToValueAtTime(58, t + at + 0.1);
        pluck(g.gain, t + at, 0.003, level * 0.6, 0.1);
        chain(o, g, out);
        o.start(t + at);
        o.stop(t + at + 0.18);
      }
      return 0.5;
    },
    // an egg meeting siding: a wet slap, the shell cracking, one drip
    splat(t, out) {
      burst(out, t, 0.1, 'lowpass', 850, 0.8, 0.55, brown);
      burst(out, t, 0.035, 'bandpass', 2300, 1.3, 0.2);
      burst(out, t + 0.01, 0.03, 'highpass', 4300, 0.8, 0.07);
      const o = osc('sine', 190);
      const g = gain(0);
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
      pluck(g.gain, t, 0.004, 0.16, 0.12);
      chain(o, g, out);
      o.start(t);
      o.stop(t + 0.2);
      burst(out, t + 0.2, 0.05, 'bandpass', 1250, 3, 0.05);
      return 0.45;
    },
    // a roll of toilet paper unspooling through the air: paper flutter that slows as it goes
    tp(t, out) {
      const s = noise(white, false);
      const bp = filter('bandpass', 2300, 0.9);
      const g = gain(0);
      g.gain.setValueAtTime(0.0001, t);
      let at = t;
      for (let i = 0; i < 16; i++) {
        const step = 0.04 + i * 0.004;
        g.gain.linearRampToValueAtTime(0.1 - i * 0.004, at + step * 0.45);
        g.gain.linearRampToValueAtTime(0.015, at + step);
        at += step;
      }
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(900, at);
      chain(s, bp, g, out);
      s.start(t, Math.random(), at - t + 0.12);
      return at - t + 0.15;
    },
    // a spray can: three rattles, then the hiss
    spray(t, out) {
      for (let i = 0; i < 3; i++) burst(out, t + i * 0.075, 0.025, 'bandpass', 3100, 2, 0.09);
      const s = noise(white, false);
      const hp = filter('highpass', 5000, 0.6);
      const g = gain(0);
      const t0 = t + 0.26;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.05);
      g.gain.setValueAtTime(0.12, t0 + 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.78);
      chain(s, hp, g, out);
      s.start(t0, Math.random(), 0.82);
      return 1.1;
    },
    honk(t, out) {
      const lp = filter('lowpass', 1500, 1.2);
      lp.connect(out);
      for (const [at, dur] of [[0, 0.14], [0.2, 0.3]]) {
        for (const f of [330, 415.3]) {
          const o = osc('sawtooth', f);
          const g = gain(0);
          g.gain.setValueAtTime(0.0001, t + at);
          g.gain.linearRampToValueAtTime(0.06, t + at + 0.015);
          g.gain.setValueAtTime(0.06, t + at + dur - 0.03);
          g.gain.linearRampToValueAtTime(0.0001, t + at + dur);
          chain(o, g, lp);
          o.start(t + at);
          o.stop(t + at + dur + 0.03);
        }
      }
      return 0.6;
    },
  };

  // How loud, and from which side, something at opts.position sounds from where the visitor stands.
  function spatial(opts, falloff = 14) {
    let level = opts.volume ?? 1;
    let pan = opts.pan ?? 0;
    if (opts.position && listener.has) {
      const dx = opts.position.x - listener.x;
      const dz = opts.position.z - listener.z;
      const d = Math.hypot(dx, dz);
      level *= 1 / (1 + (d / falloff) * (d / falloff));
      if (level < 0.01) return null;
      // the listener looks along (-sin yaw, -cos yaw); its right hand is (cos yaw, -sin yaw)
      if (d > 0.5) pan = clamp(((dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / d) * 0.8, -1, 1);
    }
    return { level, pan };
  }

  let lastStep = 0;
  function sfx(name, opts = {}) {
    if (!enabled || !ctx || ctx.state !== 'running') return false;
    const make = SFX[name];
    if (!make) return false;
    const now = ctx.currentTime;
    if (name === 'step') {
      if (now - lastStep < 0.12) return false;
      lastStep = now;
    }
    const where = spatial(opts);
    if (!where) return false;
    const { level, pan } = where;
    const out = gain(level);
    const p = panner(pan);
    chain(out, p, sfxBus);
    const ring = make(now + 0.005, out) || 1;
    setTimeout(() => {
      try {
        out.disconnect();
        p.disconnect();
      } catch (err) { /* context closed */ }
    }, (ring + 0.4) * 1000);
    return true;
  }

  // ---------------------------------------------------------------- recorded clips
  // Fetched and decoded once, on first use. A failed load is forgotten so a later try can retry.
  // A data: URI (the single-file preview) is decoded right here instead of fetched, because pages
  // embedded in other sites are often not allowed to fetch() anything, data: URIs included.
  const clips = {};
  let lastClipError = null;
  function bytesOf(url) {
    if (url.slice(0, 5) !== 'data:') {
      return fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))));
    }
    return new Promise((resolve) => {
      const comma = url.indexOf(',');
      const bin = atob(url.slice(comma + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      resolve(out.buffer);
    });
  }
  function loadClip(url) {
    if (!clips[url]) {
      clips[url] = bytesOf(url)
        .then((data) => new Promise((resolve, reject) => {
          // older Safari only has the callback form; newer browsers return a promise as well
          const p = ctx.decodeAudioData(data, resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        }))
        .catch((err) => {
          lastClipError = String((err && err.message) || err);
          delete clips[url];
          return null;
        });
    }
    return clips[url];
  }

  async function clip(url, opts = {}) {
    if (!url || !enabled || !ctx) return false;
    const buffer = await loadClip(url);
    if (!buffer || !enabled || !ctx || ctx.state !== 'running') return false;
    const where = spatial(opts, opts.falloff ?? 14);
    if (!where) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const out = gain(where.level);
    const p = panner(where.pan);
    chain(src, out, p, sfxBus);
    src.onended = () => {
      try {
        src.disconnect();
        out.disconnect();
        p.disconnect();
      } catch (err) { /* context closed */ }
    };
    src.start(ctx.currentTime + Math.max(0, opts.delay || 0));
    return true;
  }

  // ---------------------------------------------------------------- lifecycle
  function fadeMaster(to, seconds) {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.linearRampToValueAtTime(Math.max(0.0001, to), now + seconds);
  }

  function enable() {
    if (!ensureContext()) return false;
    clearTimeout(suspendTimer);
    if (ctx.state !== 'running') {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    // iOS only unlocks audio once something has been started inside the gesture
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch (err) { /* fine */ }
    enabled = true;
    wanted = true;
    safeStorageSet(STORAGE_KEYS.sound, '1');
    fadeMaster(0.9, 0.7);
    events.emit('change', true);
    return true;
  }

  function disable(persist = true) {
    if (persist) {
      wanted = false;
      safeStorageSet(STORAGE_KEYS.sound, '0');
    }
    if (!enabled) {
      events.emit('change', false);
      return;
    }
    enabled = false;
    fadeMaster(0, 0.35);
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (enabled || !ctx) return;
      stopBeds();
      if (ctx.state === 'running') ctx.suspend();
    }, 500);
    events.emit('change', false);
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx || !enabled) return;
    if (document.hidden) {
      fadeMaster(0, 0.15);
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => {
        if (document.hidden && ctx.state === 'running') ctx.suspend();
      }, 220);
    } else {
      clearTimeout(suspendTimer);
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
      fadeMaster(0.9, 0.6);
    }
  });

  function update(dt, weights, listen) {
    if (listen) {
      listener.x = listen.x;
      listener.z = listen.z;
      listener.yaw = listen.yaw || 0;
      listener.has = true;
    }
    if (!enabled || !ctx || ctx.state !== 'running') return;
    clock += dt;
    if (clock < 0.2) return;
    clock = 0;
    const now = ctx.currentTime;
    for (const zone of ZONES) setBed(zone, weights ? weights[zone] || 0 : 0, now);
    updateDrones(now);
  }

  return {
    enable,
    disable,
    toggle() {
      if (enabled) disable();
      else enable();
      return enabled;
    },
    update,
    sfx,
    clip,
    drone,
    loop,
    on: events.on.bind(events),
    names: Object.keys(SFX),
    get enabled() { return enabled; },
    get wanted() { return wanted; },
    get context() { return ctx; },
    get state() { return ctx ? ctx.state : 'none'; },
    get activeBeds() { return Object.keys(beds); },
    // tests and the console: the drones that currently hold audio nodes, so a test can see
    // one come alive as the listener walks up and be given back as they walk away
    get activeDrones() { return [...drones].filter((d) => d.node).map((d) => d.name); },
    get lastClipError() { return lastClipError; },
  };
}
