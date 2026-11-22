// Where Hit Zero's beat comes from: the audio module's `routine` track (Contract 6 `beat`), or
// the internal metronome when there is no audio module or its beat clock does not run (sound off).
// It anchors song time to the music clock from the 'beat' events, keeps it there, and maps
// performance.now() onto the music clock so taps are judged between AudioContext steps.
//
//   const src = createSource({ audio, practiceBeat, rate, anchorWaitMs = 1800 })   anchorWaitMs: how long to wait for beat events
//   await src.start({ track = 'routine', latencyMs })  -> { kind: 'audio' | 'metronome', bpm, structure }
//   src.clock                       the createBeatClock() for this run (song time, latency)
//   src.sample()                    feed the smoother (call every frame and at every input)
//   src.musicAt(perfMs)             -> music time at a performance.now() moment
//   src.songAt(perfMs) / src.songNow()   -> song seconds (latency applied)
//   src.kind, src.bpm, src.structure
//   src.stop()                      unsubscribes and stops the metronome (the music is the caller's)
//   src.dispose()                   stop, and close the metronome's AudioContext
//   src.setSound(on)                the metronome's practice beat
//   src.unlock()                    from a user gesture, before an await: lets the practice beat start

import { createBeatClock, createSmoother, beatIndexOf } from './clock.js';
import { createMetronome } from './metronome.js';
import { DEFAULT_BPM, DEFAULT_STRUCTURE } from './charts.js';

const ANCHOR_WAIT_MS = 1800;
// the audio module may answer with a promise: a rejected one is no reason to shout
const quiet = (p) => {
  if (p && typeof p.catch === 'function') p.catch(() => {});
};
const DRIFT = 0.035;

export function createSource({ audio = null, practiceBeat = !audio, rate = 1, anchorWaitMs = ANCHOR_WAIT_MS } = {}) {
  let beat = null;
  let kind = null;
  let met = null;
  let clock = createBeatClock({ bpm: DEFAULT_BPM });
  let smoother = createSmoother();
  let off = null;
  let lastK = -1;
  let anchored = false;
  let bpm = DEFAULT_BPM;
  let structure = DEFAULT_STRUCTURE;
  let wantSound = !!practiceBeat;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const safeTime = () => {
    try {
      const v = beat && beat.time();
      return Number.isFinite(v) ? v : null;
    } catch (err) {
      return null;
    }
  };

  function onBeat(ev) {
    const k = beatIndexOf(ev);
    const time = Number(ev && ev.time);
    if (k === null || !Number.isFinite(time)) return;
    if (!anchored) {
      // a fresh track counts from 0; a beat that has run for a while starts us on its next "1"
      if (k < 32) clock.anchor(k, time);
      else clock.anchor(0, time + ((8 - (k % 8)) % 8) * clock.spb);
      anchored = true;
      lastK = k < 32 ? k : -1;
      return;
    }
    if (Math.abs(time - clock.musicTimeOfBeat(k)) < DRIFT) {
      lastK = k;
      return;
    }
    if (lastK >= 0 && Math.abs(time - clock.musicTimeOfBeat(lastK + 1)) < DRIFT) {
      lastK++; // the track looped: keep counting on
      return;
    }
    // the clock jumped (a restart, a seek): follow it
    if (k < 32) {
      clock.anchor(k, time);
      lastK = k;
    }
  }

  function subscribe(b) {
    if (!b || typeof b.on !== 'function') return;
    try {
      b.on('beat', onBeat);
      off = () => {
        try {
          b.off('beat', onBeat);
        } catch (err) { /* already gone */ }
      };
    } catch (err) {
      off = null;
    }
  }

  function waitForAnchor(ms) {
    return new Promise((resolve) => {
      const t0 = now();
      let firstTime = safeTime();
      const check = () => {
        if (anchored) return resolve(true);
        if (now() - t0 > ms) {
          // no beat events: if the clock runs, line up on its next beat
          const t = safeTime();
          if (t !== null && firstTime !== null && t > firstTime + 0.05) {
            let next = null;
            try {
              next = Number(beat.nextBeatTime());
            } catch (err) { /* no grid */ }
            if (Number.isFinite(next)) {
              clock.anchor(0, next + clock.spb);
              anchored = true;
              return resolve(true);
            }
          }
          return resolve(false);
        }
        if (firstTime === null) firstTime = safeTime();
        setTimeout(check, 30);
      };
      check();
    });
  }

  async function start({ track = 'routine', latencyMs = 0 } = {}) {
    stop();
    anchored = false;
    lastK = -1;
    smoother = createSmoother();
    const ab = audio && audio.beat;
    const canAudio = !!(ab && typeof ab.time === 'function' && audio.enabled !== false);
    if (canAudio) {
      try {
        if (typeof audio.unlock === 'function') quiet(audio.unlock());
      } catch (err) { /* the app unlocks too */ }
      bpm = Number(ab.bpm) >= 60 && Number(ab.bpm) <= 220 ? Number(ab.bpm) : DEFAULT_BPM;
      clock = createBeatClock({ bpm, latencyMs });
      beat = ab;
      kind = 'audio';
      subscribe(ab);
      try {
        quiet(audio.music(track, { fade: 0.3 }));
      } catch (err) { /* no music: the wait below falls back */ }
      if (await waitForAnchor(anchorWaitMs)) {
        structure = ab.structure || null;
        return info();
      }
      if (off) off();
      off = null;
    }
    // the internal metronome (kept between runs: one AudioContext at most)
    if (!met) met = createMetronome({ bpm: DEFAULT_BPM, rate });
    met.setSound(wantSound && rate === 1);
    bpm = met.bpm;
    clock = createBeatClock({ bpm, latencyMs });
    beat = met;
    kind = 'metronome';
    structure = met.structure;
    subscribe(met);
    met.start({ lead: 0.5 });
    clock.anchor(0, met.nextBeatTime());
    anchored = true;
    lastK = -1;
    return info();
  }

  function info() {
    return { kind, bpm, structure };
  }

  function sample() {
    const t = safeTime();
    if (t !== null) smoother.sample(now(), t);
  }

  function musicAt(perfMs) {
    const v = smoother.at(perfMs);
    return v === null ? safeTime() ?? 0 : v;
  }

  function stop() {
    if (off) off();
    off = null;
    if (met) met.stop();
  }

  return {
    start,
    stop,
    dispose() {
      stop();
      if (met) met.dispose();
      met = null;
    },
    sample,
    musicAt,
    songAt(perfMs) {
      return clock.song(musicAt(perfMs));
    },
    songNow() {
      return clock.song(musicAt(now()));
    },
    setSound(on) {
      wantSound = !!on;
      if (met) met.setSound(wantSound);
    },
    unlock() {
      // from a user gesture: lets the practice beat play later
      if (!audio && wantSound) {
        if (!met) met = createMetronome({ bpm: DEFAULT_BPM, rate });
        met.unlock();
      }
    },
    get clock() { return clock; },
    get kind() { return kind; },
    // can the player hear the beat? (the music with sound on, or the practice beat actually playing)
    get audible() {
      if (kind === 'audio') return !!(audio && audio.enabled !== false);
      return !!(kind === 'metronome' && met && met.usesAudioClock);
    },
    get soundWanted() { return wantSound; },
    get bpm() { return bpm; },
    get structure() { return structure; },
    get anchored() { return anchored; },
  };
}
