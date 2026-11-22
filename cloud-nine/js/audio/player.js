// A playing track: the sequencer's steps turned into scheduled sound, a little ahead of time.
//
//   const track = createTrack({ ctx, mixer, kit, song, at, seed, from, fadeIn, solo, mute, onStep, onEnd })
//   track.scheduleUntil(ctxTime)   schedule every step that starts before ctxTime (call it often, with a
//                                  short lookahead: the live scheduler does it every 25 ms, 100 ms ahead)
//   track.stop(fade)               fade out and let go of the nodes
//   track.t0                       context time of song time 0 (the music clock's origin)
//   track.endTime                  context time the last step finishes (songs that don't loop), else null
//   onStep(step, when)             every step as it is scheduled (beats, sections), with its context time
//   onEnd(endTime)                 once, when a song that doesn't loop has scheduled its last step
//
// Each part gets a bus (volume, pan, reverb and delay sends) and the whole track goes through a
// highpass and a lowpass that sections can sweep (filtered intros, builds).

import { createSequence } from './sequencer.js';
import { INSTRUMENTS } from './synth.js';

export function createTrack({ ctx, mixer, kit, song, at, seed = 1, from = 0, fadeIn = 0, solo = null, mute = null, onStep = null, onEnd = null }) {
  const seq = createSequence(song, { seed });
  if (from > 0) seq.seek(from);
  const t0 = at - seq.step * seq.stepDur;
  const stepDur = seq.stepDur;

  const gain = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type, f) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = 0.7;
    return n;
  };

  // track buses: every node here is let go of in stop()
  const nodes = [];
  const keep = (n) => (nodes.push(n), n);
  const input = keep(gain(1));
  const hp = keep(filter('highpass', 10));
  const lp = keep(filter('lowpass', 20000));
  const fader = keep(gain(fadeIn > 0 ? 0 : 1));
  const revFader = keep(gain(fadeIn > 0 ? 0 : 1));
  const delFader = keep(gain(fadeIn > 0 ? 0 : 1));
  input.connect(hp);
  hp.connect(lp);
  lp.connect(fader);
  fader.connect(mixer.musicBus);
  revFader.connect(mixer.reverbIn);
  delFader.connect(mixer.delayIn);
  if (fadeIn > 0) {
    for (const f of [fader, revFader, delFader]) {
      f.gain.setValueAtTime(0, at);
      f.gain.linearRampToValueAtTime(1, at + fadeIn);
    }
  }

  const buses = new Map();
  function bus(part) {
    let b = buses.get(part);
    if (b) return b;
    const v = song.voices[part] || {};
    const g = keep(gain(v.vol ?? 0.5));
    let tail = g;
    if (v.pan && ctx.createStereoPanner) {
      const p = keep(ctx.createStereoPanner());
      p.pan.value = Math.max(-1, Math.min(1, v.pan));
      g.connect(p);
      tail = p;
    }
    tail.connect(input);
    if (v.rev) {
      const s = keep(gain(v.rev));
      tail.connect(s);
      s.connect(revFader);
    }
    if (v.del) {
      const s = keep(gain(v.del));
      tail.connect(s);
      s.connect(delFader);
    }
    b = g;
    buses.set(part, b);
    return b;
  }

  let pending = null;
  let stopped = false;
  let ended = false;
  let endTime = null;

  function playStep(step, when) {
    if (step.sectionStart) {
      const secEnd = when + step.sectionSteps * stepDur;
      const sw = step.sweep || {};
      for (const [node, key, rest] of [[lp, 'lp', 20000], [hp, 'hp', 10]]) {
        const fr = node.frequency;
        if (sw[key]) {
          fr.setValueAtTime(sw[key][0], when);
          fr.exponentialRampToValueAtTime(sw[key][1], secEnd);
        } else {
          fr.setValueAtTime(rest, when);
        }
      }
    }
    // A step that should already have sounded (the tab stalled) is skipped rather than played late
    // in a heap; the grid carries on in time.
    if (when < ctx.currentTime - 0.03) return;
    for (const ev of step.events) {
      if (solo && !solo.includes(ev.part)) continue;
      if (mute && mute.includes(ev.part)) continue;
      const inst = INSTRUMENTS[ev.inst];
      if (!inst) continue;
      const out = bus(ev.part);
      const notes = ev.notes || (ev.midi !== undefined ? [ev.midi] : []);
      const dur = ev.len * stepDur;
      const base = { notes, dur, vel: ev.vel, from: ev.from ?? null, glide: !!ev.glide, v: ev.v, chord: ev.chord };
      try {
        if (ev.roll) {
          inst(kit, out, when, { ...base, vel: ev.vel * 0.85, dur: dur / 2 });
          inst(kit, out, when + dur / 2, { ...base, vel: ev.vel, dur: dur / 2 });
        } else {
          inst(kit, out, when, base);
        }
      } catch (err) {
        // one bad note must never stop the music
        if (typeof console !== 'undefined') console.warn('[c9 audio] ' + ev.inst + ' failed', err);
      }
    }
  }

  function scheduleUntil(until) {
    if (stopped || ended) return;
    for (;;) {
      if (!pending) {
        pending = seq.next();
        if (!pending) {
          ended = true;
          endTime = t0 + seq.step * stepDur;
          if (onEnd) onEnd(endTime);
          return;
        }
      }
      const when = t0 + pending.t;
      if (when >= until) return;
      playStep(pending, when);
      if (onStep) onStep(pending, when);
      pending = null;
    }
  }

  function stop(fade = 0.5) {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    for (const f of [fader, revFader, delFader]) {
      if (f.gain.cancelAndHoldAtTime) {
        f.gain.cancelAndHoldAtTime(now);
      } else {
        f.gain.cancelScheduledValues(now);
        f.gain.setValueAtTime(f.gain.value, now);
      }
      f.gain.linearRampToValueAtTime(0, now + Math.max(0.02, fade));
    }
    const release = () => {
      for (const n of nodes) {
        try { n.disconnect(); } catch (e) { /* already gone */ }
      }
    };
    // Offline renders keep their nodes (the render reads them); live ones let go after the fade.
    if (typeof setTimeout === 'function' && !(typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext)) {
      setTimeout(release, (Math.max(0.02, fade) + 2.5) * 1000);
    }
  }

  return {
    scheduleUntil,
    stop,
    song,
    t0,
    stepDur,
    get endTime() { return endTime; },
    get ended() { return ended; },
    get stopped() { return stopped; },
    get pass() { return seq.pass; },
  };
}
