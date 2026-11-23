// Cloud Nine's audio (Contract 6): music and sound effects, all synthesized live with WebAudio.
// No samples, no recordings, no copyrighted melodies ("Happy Birthday to You" is public domain).
//
//   const audio = createAudio()
//   audio.unlock()                          call from the first user gesture; safe to call again
//   audio.enabled, audio.setEnabled(on)     the player's choice, remembered in localStorage (on by default)
//   audio.music(id | null, { fade = 1 })    'island' 'game' 'tense' 'routine' 'birthday' 'victory'; null fades out.
//       The track already playing is left alone. A looping track asked for before unlock (or while
//       sound is off or the tab is hidden) starts as soon as sound can play. The one-shots (routine,
//       birthday, victory) go back to the last looping track when they end, and a looping track asked
//       for during the five-second victory sting waits for the sting to finish.
//   audio.sfx(name, { volume = 1, pitch = 1, x, z })   unknown names are ignored. pitch multiplies
//       every frequency (2 is an octave up). With x and z (meters) the sound sits in the world: quieter
//       with distance from the listener and panned to its side.
//   audio.setListener(x, z, heading)       heading in the blueprint's convention (0 faces +Z). For the
//       camera rig pass rig.yaw + Math.PI: its yaw points from the player back to the camera.
//   audio.beat                              the music clock
//       bpm, playing                        playing is false while nothing plays (and while sound is off)
//       time()                              song seconds being heard right now (output latency included;
//                                           a little below 0 just before the first beat)
//       nextBeatTime()                      song time of the next beat
//       structure                           the current track's sections in order, an array like
//                                           [{ name: 'intro', eights: 2, ... }, ...] (fields: trackStructure)
//       on('beat', fn({ n, count, eight, time, section, pass }))   fired as each beat is heard. Every
//           track starts again from its first downbeat: n 0, count 1, eight 1. n counts beats from 0,
//           count (1..8) and eight (1, 2, 3...) count from 1 like a coach does, and time is n beats in
//           seconds, the same clock as time(). section is the section's name.
//       on('section', fn({ name, title, time, energy, pass })), on('end', fn({ id })), off(evt, fn)
//   audio.dispose()
//
// Extras: audio.unlocked, audio.state, audio.current (track id), audio.tracks, audio.sfxNames,
// audio.structureOf(id), audio.context, audio.analyser(), audio.on('change' | 'track', fn) / off.
//
// Timing: a 25 ms timer schedules notes about 100 ms ahead on the audio clock, so the music stays tight
// even when a frame stalls. Mixing: a limiter and a soft ceiling on the master (peaks stay under -0.7 dBFS)
// and the music dips a little under sound effects. The whole context sleeps while the tab is hidden.

import { STORAGE_KEYS } from '../config.js';
import { clamp, emitter, safeStorageGet, safeStorageSet } from '../core/util.js';
import { createMixer } from './mixer.js';
import { createTrack } from './player.js';
import { songStructure } from './sequencer.js';
import { SFX_NAMES, triggerSfx } from './sfx.js';
import { SONGS, TRACK_IDS } from './songs.js';
import { createKit } from './synth.js';

export const MUSIC_IDS = TRACK_IDS;
export { SFX_NAMES, SONGS };

export const LOOKAHEAD = 0.1; // seconds scheduled ahead of the audio clock
const TICK_MS = 25;
const FALLOFF = 14; // meters: at this distance a sound is at half volume
const MAX_LIVE_SFX = 24;
const MIN_GAP = { step: 0.07, tap: 0.04, count: 0.05 }; // seconds between repeats of one sound

// A track's shape, as the rhythm game and the sound board read it: its sections in order, an array of
//   { name (the section id: 'intro', 'opening', ...), eights, title (to show), start, end (song seconds),
//     firstEight (counting from 1, like the beat event), beats, bars, energy (0..1) }
// with the whole track's facts on the array itself: .id .title .bpm .beatsPerEight .duration (seconds,
// without the ring-out) .beats .eights .loop .loopStart .tail (ring-out seconds) and
// .cues [{ beat, time, eight (from 1), count, kind: 'hey' | 'hit' | 'crash' | 'whoosh' }].
const structures = new Map();
export function trackStructure(id) {
  if (!Object.prototype.hasOwnProperty.call(SONGS, id)) return null;
  if (!structures.has(id)) {
    const s = songStructure(SONGS[id]);
    const list = s.sections.map((x) => ({
      name: x.id, eights: x.eights, title: x.name, start: x.start, end: x.end,
      firstEight: x.startEight + 1, beats: x.beats, bars: x.bars, energy: x.energy,
    }));
    Object.assign(list, {
      id: s.id, title: s.title, bpm: s.bpm, beatsPerEight: s.beatsPerEight, duration: s.duration, beats: s.beats,
      eights: s.eights, loop: s.loop, loopStart: s.loopStart, tail: s.tail, cues: s.cues.map((c) => ({ ...c, eight: c.eight + 1 })),
    });
    structures.set(id, list);
  }
  return structures.get(id);
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function createAudio() {
  const events = emitter();
  const beatEvents = emitter();
  const sfxSet = new Set(SFX_NAMES);
  let ctx = null;
  let mixer = null;
  let kit = null;
  let unlocked = false;
  let disposed = false;
  let enabled = safeStorageGet(STORAGE_KEYS.sound) !== '0';
  let hidden = typeof document !== 'undefined' && !!document.hidden;
  let wantLoop = null; // the looping track the game wants
  let returnTo = null; // where a one-shot goes when it ends
  let cur = null; // { id, song, structure, track, ended }
  let timer = null;
  let lastTick = 0;
  let suspendTimer = null;
  let lastHeard = 0;
  let live = 0;
  const beatTimers = new Set();
  const lastPlayed = Object.create(null);
  const listener = { x: 0, z: 0, heading: 0, has: false };

  // ---------------------------------------------------------------- context
  function ensureContext() {
    if (ctx) return true;
    if (typeof window === 'undefined') return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (err) {
      try {
        ctx = new AC();
      } catch (err2) {
        return false;
      }
    }
    mixer = createMixer(ctx);
    kit = createKit(ctx, (Math.random() * 2 ** 31) >>> 0);
    return true;
  }

  const audible = () => unlocked && enabled && !hidden && !disposed && !!ctx && ctx.state !== 'closed';

  function resumeContext() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* not allowed yet */ }
  }

  function fadeMaster(to, seconds) {
    if (!ctx) return;
    const g = mixer.out.gain;
    const now = ctx.currentTime;
    if (g.cancelAndHoldAtTime) {
      g.cancelAndHoldAtTime(now);
    } else {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
    }
    g.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
  }

  // The context time being heard right now: the hardware's own timestamp when the browser shares
  // it, else the clock minus the output latency. Never goes backwards.
  function heardNow() {
    if (!ctx) return 0;
    let t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    if (ctx.state === 'running' && typeof ctx.getOutputTimestamp === 'function' && typeof performance !== 'undefined') {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const est = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (est > 0 && Math.abs(est - ctx.currentTime) < 0.5) t = Math.min(est, ctx.currentTime);
      }
    }
    if (t < lastHeard) t = lastHeard;
    lastHeard = t;
    return t;
  }

  // run fn when context time `at` is being heard
  function whenHeard(at, fn) {
    const ms = Math.max(0, (at - heardNow()) * 1000);
    const id = setTimeout(() => {
      beatTimers.delete(id);
      fn();
    }, ms);
    beatTimers.add(id);
  }

  function clearBeatTimers() {
    for (const id of beatTimers) clearTimeout(id);
    beatTimers.clear();
  }

  // ---------------------------------------------------------------- the scheduler
  function tick() {
    if (!cur || !audible() || ctx.state !== 'running') return;
    // A late timer (a long frame, a busy phone) looks further ahead next time so nothing starves.
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const gap = lastTick ? (nowMs - lastTick) / 1000 : 0;
    lastTick = nowMs;
    const ahead = Math.min(0.3, Math.max(LOOKAHEAD, gap * 1.5));
    cur.track.scheduleUntil(ctx.currentTime + ahead);
  }

  function startTimer() {
    if (timer || disposed) return;
    lastTick = 0;
    timer = setInterval(tick, TICK_MS);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // ---------------------------------------------------------------- tracks
  function startTrack(id, { fadeIn = 0 } = {}) {
    const song = SONGS[id];
    mixer.setTempo(song.bpm);
    const entry = { id, song, structure: trackStructure(id), track: null, ended: false };
    entry.track = createTrack({
      ctx,
      mixer,
      kit,
      song,
      at: ctx.currentTime + 0.06,
      seed: (Math.random() * 2 ** 31) >>> 0,
      fadeIn,
      onStep: (step, when) => onStep(entry, step, when),
      onEnd: (endTime) => onTrackEnd(entry, endTime),
    });
    cur = entry;
    entry.track.scheduleUntil(ctx.currentTime + LOOKAHEAD);
    startTimer();
    events.emit('track', id);
  }

  function stopCurrent(fade) {
    if (!cur) return;
    cur.track.stop(fade);
    cur = null;
    clearBeatTimers();
  }

  function onStep(entry, step, when) {
    if (!step.beat && !step.sectionStart) return;
    const spb = 60 / entry.song.bpm;
    const sec = step.sectionStart ? { name: step.section, title: step.name, time: step.t, energy: step.energy, pass: step.pass } : null;
    const beat = step.beat ? { n: step.beat.n, count: step.beat.count, eight: step.beat.eight + 1, time: step.beat.n * spb, section: step.section, pass: step.pass } : null;
    whenHeard(when, () => {
      if (entry !== cur) return;
      if (sec) beatEvents.emit('section', sec);
      if (beat) beatEvents.emit('beat', beat);
    });
  }

  function onTrackEnd(entry, endTime) {
    whenHeard(endTime, () => finish(entry));
  }

  // A song that doesn't loop has played its last note: tell the listeners, let the last chord ring,
  // then go back to the looping track it interrupted (if any).
  function finish(entry) {
    if (entry !== cur || entry.ended) return;
    entry.ended = true;
    cur = null;
    beatEvents.emit('end', { id: entry.id });
    setTimeout(() => entry.track.stop(0.4), (entry.song.tail || 1) * 1000);
    const next = returnTo;
    returnTo = null;
    if (next && audible()) startTrack(next, { fadeIn: 1.5 });
    else events.emit('track', null);
  }

  // ---------------------------------------------------------------- waking and sleeping
  function wake() {
    if (!audible()) return;
    fadeMaster(1, 0.5);
    // A one-shot whose last note was already scheduled lost its end timer when we went to sleep:
    // arm it again (it fires at once if the end has passed).
    if (cur && cur.track.ended && !cur.ended) {
      const entry = cur;
      whenHeard(entry.track.endTime, () => finish(entry));
    }
    if (!cur && wantLoop) startTrack(wantLoop, { fadeIn: 0.8 });
    if (cur) startTimer();
  }

  function onVisibility() {
    hidden = !!document.hidden;
    if (!ctx || !unlocked || disposed) return;
    if (hidden) {
      clearBeatTimers();
      stopTimer();
      fadeMaster(0, 0.12);
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => {
        if (hidden && ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
      }, 200);
    } else if (enabled) {
      clearTimeout(suspendTimer);
      resumeContext();
      wake();
    }
  }

  // iOS can interrupt audio (a call, Siri, the lock screen); the next touch brings it back
  function onGesture() {
    if (audible() && ctx.state !== 'running') resumeContext();
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  // ---------------------------------------------------------------- the public interface
  function unlock() {
    if (disposed || !ensureContext()) return false;
    const first = !unlocked;
    unlocked = true;
    resumeContext();
    // iOS only unlocks once something has played inside the gesture
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch (err) { /* fine */ }
    if (first && typeof window !== 'undefined') {
      for (const evt of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(evt, onGesture, { capture: true, passive: true });
    }
    if (enabled && !hidden) wake();
    return true;
  }

  function setEnabled(on) {
    on = !!on;
    safeStorageSet(STORAGE_KEYS.sound, on ? '1' : '0');
    if (on === enabled) return;
    enabled = on;
    if (ctx && unlocked) {
      if (on) {
        clearTimeout(suspendTimer);
        resumeContext();
        if (!hidden) wake();
      } else {
        stopCurrent(0.3);
        stopTimer();
        fadeMaster(0, 0.3);
        clearTimeout(suspendTimer);
        suspendTimer = setTimeout(() => {
          if (!enabled && ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
        }, 450);
      }
    }
    events.emit('change', enabled);
  }

  function music(id = null, { fade = 1 } = {}) {
    if (id !== null && !Object.prototype.hasOwnProperty.call(SONGS, id)) return false;
    const song = id ? SONGS[id] : null;
    if (!song) {
      wantLoop = null;
      returnTo = null;
    } else if (song.loop) {
      wantLoop = id;
    }
    if (!audible()) return false;
    fade = clamp(num(fade, 1), 0, 10);
    if (cur && cur.id === id) return true;
    if (cur && cur.id === 'victory' && song && song.loop) {
      returnTo = id;
      return true;
    }
    stopCurrent(fade);
    if (song) {
      returnTo = song.loop ? null : wantLoop;
      startTrack(id);
    } else {
      events.emit('track', null);
    }
    return true;
  }

  function sfx(name, opts = {}) {
    if (!sfxSet.has(name) || !audible() || ctx.state !== 'running') return false;
    opts = opts || {};
    const now = ctx.currentTime;
    if (now - (lastPlayed[name] ?? -1) < (MIN_GAP[name] ?? 0.025)) return false;
    if (live >= MAX_LIVE_SFX) return false;
    let level = clamp(num(opts.volume, 1), 0, 2);
    let pan = 0;
    if (listener.has && Number.isFinite(opts.x) && Number.isFinite(opts.z)) {
      const dx = opts.x - listener.x;
      const dz = opts.z - listener.z;
      const d = Math.hypot(dx, dz);
      level *= 1 / (1 + (d / FALLOFF) * (d / FALLOFF));
      // facing (sin h, cos h), the right ear points along (-cos h, sin h)
      if (d > 0.5) pan = clamp(((-dx * Math.cos(listener.heading) + dz * Math.sin(listener.heading)) / d) * 0.85, -1, 1);
    }
    if (level < 0.01) return false;
    const pitch = clamp(num(opts.pitch, 1), 0.25, 4);
    lastPlayed[name] = now;
    const res = triggerSfx(kit, mixer, name, now + 0.005, { level, pan, pitch });
    if (!res) return false;
    live++;
    setTimeout(() => {
      live--;
      for (const n of res.nodes) {
        try { n.disconnect(); } catch (e) { /* already gone */ }
      }
    }, (res.end - now + 0.5) * 1000);
    return true;
  }

  function setListener(x, z, heading) {
    if (Number.isFinite(x)) listener.x = x;
    if (Number.isFinite(z)) listener.z = z;
    if (Number.isFinite(heading)) listener.heading = heading;
    listener.has = true;
  }

  const beat = {
    get bpm() { return cur ? cur.song.bpm : wantLoop ? SONGS[wantLoop].bpm : 120; },
    get playing() { return !!cur && !cur.ended && audible() && ctx.state === 'running'; },
    get structure() { return cur ? cur.structure : null; },
    get track() { return cur ? cur.id : null; },
    time() {
      if (!cur || !ctx) return 0;
      return heardNow() - cur.track.t0;
    },
    nextBeatTime() {
      const spb = 60 / beat.bpm;
      const t = beat.time();
      return t < 0 ? 0 : (Math.floor(t / spb + 1e-6) + 1) * spb;
    },
    on: (evt, fn) => beatEvents.on(evt, fn),
    off: (evt, fn) => beatEvents.off(evt, fn),
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopTimer();
    clearBeatTimers();
    clearTimeout(suspendTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') {
      for (const evt of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(evt, onGesture, { capture: true });
    }
    if (cur) cur.track.stop(0.05);
    cur = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
  }

  return {
    unlock,
    setEnabled,
    music,
    sfx,
    setListener,
    beat,
    dispose,
    structureOf: trackStructure,
    analyser: () => (mixer ? mixer.analyser() : null),
    on: (evt, fn) => events.on(evt, fn),
    off: (evt, fn) => events.off(evt, fn),
    tracks: MUSIC_IDS.slice(),
    sfxNames: SFX_NAMES.slice(),
    get enabled() { return enabled; },
    get unlocked() { return unlocked; },
    get state() { return ctx ? ctx.state : 'locked'; },
    get current() { return cur ? cur.id : null; },
    get context() { return ctx; },
  };
}
