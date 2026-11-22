// Hit Zero's beat source against a stand-in for the Contract 6 audio module: anchoring song time
// to the music clock from 'beat' events, loops, long-running beats, and every fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSource } from '../js/rhythm/source.js';

const STRUCTURE = [{ name: 'intro', eights: 2 }, { name: 'stunts', eights: 4 }, { name: 'finale', eights: 1 }];

// A fake audio module: music('routine') starts a beat `startDelay` seconds later and emits 'beat'
// events a little ahead of each beat, like a WebAudio scheduler would.
function fakeAudio({ bpm = 140, startDelay = 0.05, nBase = 0, startN = 0, loopAt = 0, events = true, enabled = true, runs = true, restartAfter = 0 } = {}) {
  const t0 = performance.now() / 1000;
  const spb = 60 / bpm;
  const listeners = new Set();
  let start = null;
  let timer = null;
  const beat = {
    bpm,
    structure: STRUCTURE,
    get playing() { return start !== null; },
    time: () => (runs ? performance.now() / 1000 - t0 + 5 : 5),
    nextBeatTime() {
      const now = beat.time();
      if (start === null) return now;
      return start + Math.ceil((now - start) / spb) * spb;
    },
    on(name, fn) { if (name === 'beat') listeners.add(fn); },
    off(name, fn) { listeners.delete(fn); },
  };
  const audio = {
    enabled,
    beat,
    calls: [],
    unlock() {},
    setEnabled(on) { audio.enabled = on; },
    sfx() {},
    music(id) {
      audio.calls.push(id);
      if (id !== 'routine') return;
      start = beat.time() + startDelay;
      audio.start = start;
      if (!events) return;
      let k = 0;
      let restarted = false;
      timer = setInterval(() => {
        while (start + k * spb <= beat.time() + 0.1) {
          if (restartAfter && k === restartAfter && !restarted) {
            // the track starts over somewhere else on the clock
            restarted = true;
            start = start + k * spb + 0.37;
            audio.start = start;
            k = 0;
          }
          let n = startN + k;
          if (loopAt) n %= loopAt;
          const ev = { n: n + nBase, count: (n % 8) + 1, eight: Math.floor(n / 8), time: start + k * spb };
          listeners.forEach((fn) => fn(ev));
          k++;
        }
      }, 5);
    },
    stop() { clearInterval(timer); },
  };
  return audio;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('source: anchors on the first beat event, with tempo and structure from the audio module', async () => {
  const audio = fakeAudio();
  const src = createSource({ audio });
  const info = await src.start({ track: 'routine', latencyMs: 0 });
  assert.equal(info.kind, 'audio');
  assert.equal(info.bpm, 140);
  assert.equal(info.structure, STRUCTURE);
  assert.deepEqual(audio.calls, ['routine']);
  assert.ok(near(src.clock.origin, audio.start), 'beat 0 is when the track started');
  assert.ok(src.audible);
  src.sample();
  const song = src.songNow();
  assert.ok(song > -0.2 && song < 0.5, 'song time starts near zero: ' + song);
  src.dispose();
  audio.stop();
});

test('source: beat numbers that count from 1 anchor the same', async () => {
  const audio = fakeAudio({ nBase: 1 });
  const src = createSource({ audio });
  await src.start();
  assert.ok(near(src.clock.origin, audio.start));
  src.dispose();
  audio.stop();
});

test('source: a beat that has been running a while starts the routine on its next "1"', async () => {
  const audio = fakeAudio({ startN: 100 });
  const src = createSource({ audio });
  await src.start();
  const spb = 60 / 140;
  // the first event is beat 100 (count 5): the next "1" is beat 104
  assert.ok(near(src.clock.origin, audio.start + 4 * spb), 'origin ' + src.clock.origin + ' vs ' + (audio.start + 4 * spb));
  src.dispose();
  audio.stop();
});

test('source: a looping track keeps counting on instead of jumping back', async () => {
  const audio = fakeAudio({ bpm: 180, loopAt: 8 });
  const src = createSource({ audio });
  await src.start();
  const origin = src.clock.origin;
  await wait(60 / 180 * 1000 * 11); // past the loop point
  assert.ok(near(src.clock.origin, origin), 'still anchored to the first pass');
  src.dispose();
  audio.stop();
});

test('source: a track that restarts somewhere else is followed', async () => {
  const audio = fakeAudio({ bpm: 200, restartAfter: 3 });
  const src = createSource({ audio });
  await src.start();
  const first = src.clock.origin;
  await wait(60 / 200 * 1000 * 6);
  assert.ok(!near(src.clock.origin, first), 'moved');
  assert.ok(near(src.clock.origin, audio.start), 're-anchored on the new start');
  src.dispose();
  audio.stop();
});

test('source: no beat events but a running clock: lines up on the clock\'s beat grid', async () => {
  const audio = fakeAudio({ events: false });
  const src = createSource({ audio, anchorWaitMs: 150 });
  const info = await src.start();
  assert.equal(info.kind, 'audio');
  assert.ok(src.anchored);
  const spb = 60 / 140;
  const k = (src.clock.origin - audio.start) / spb;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'on the beat grid');
  src.dispose();
  audio.stop();
});

test('source: an audio clock that never moves falls back to the internal metronome', async () => {
  const audio = fakeAudio({ events: false, runs: false });
  const src = createSource({ audio, anchorWaitMs: 120 });
  const info = await src.start();
  assert.equal(info.kind, 'metronome');
  assert.equal(info.bpm, 144);
  assert.ok(src.anchored);
  assert.equal(src.audible, false, 'no practice beat in Node');
  src.dispose();
  audio.stop();
});

test('source: sound off goes straight to the silent metronome; no audio module at all too', async () => {
  const audio = fakeAudio({ enabled: false });
  const src = createSource({ audio });
  const info = await src.start();
  assert.equal(info.kind, 'metronome');
  assert.deepEqual(audio.calls, [], 'no music asked for');
  src.dispose();
  const alone = createSource({ audio: null, practiceBeat: false });
  const i2 = await alone.start();
  assert.equal(i2.kind, 'metronome');
  assert.ok(Array.isArray(i2.structure) && i2.structure.length > 3);
  // the metronome's song clock runs forward from just before beat 0
  const a = alone.songNow();
  await wait(50);
  alone.sample();
  const b = alone.songNow();
  assert.ok(a < 0 && b > a, 'counting up to the first beat');
  alone.dispose();
});

test('source: latency moves song time back by that much', async () => {
  const audio = fakeAudio();
  const src = createSource({ audio });
  await src.start({ latencyMs: 150 });
  src.sample();
  const t = src.musicAt(performance.now());
  assert.ok(near(src.clock.song(t), t - src.clock.origin - 0.15, 1e-9));
  src.dispose();
  audio.stop();
});
