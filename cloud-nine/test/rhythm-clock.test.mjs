import test from 'node:test';
import assert from 'node:assert/strict';
import { beatIndexOf, createBeatClock, createSmoother, tapOffset, calibrate, cleanLatency, LATENCY_RANGE } from '../js/rhythm/clock.js';

const SPB = 60 / 144;

test('beat events: n can count from 0 or from 1, count is 1..8', () => {
  assert.equal(beatIndexOf({ n: 0, count: 1, eight: 0, time: 3 }), 0);
  assert.equal(beatIndexOf({ n: 13, count: 6, eight: 1 }), 13);
  assert.equal(beatIndexOf({ n: 1, count: 1, eight: 1 }), 0, '1-based n');
  assert.equal(beatIndexOf({ n: 14, count: 6 }), 13);
  assert.equal(beatIndexOf({ n: 40 }), 40, 'no count: trust n');
  assert.equal(beatIndexOf({ eight: 2, count: 3 }), 18);
  for (const junk of [null, undefined, {}, { n: -1 }, { n: 'x' }, { eight: 1 }, 5]) assert.equal(beatIndexOf(junk), null);
});

test('beat clock: song time from the music clock, with the latency offset', () => {
  const c = createBeatClock({ bpm: 144 });
  assert.equal(c.hasAnchor, false);
  c.anchor(4, 10);
  assert.equal(c.hasAnchor, true);
  assert.ok(Math.abs(c.origin - (10 - 4 * SPB)) < 1e-12);
  assert.ok(Math.abs(c.song(10) - 4 * SPB) < 1e-12);
  assert.ok(Math.abs(c.beat(10) - 4) < 1e-9);
  assert.ok(Math.abs(c.musicTimeOfBeat(8) - (10 + 4 * SPB)) < 1e-12);
  // Bluetooth: the sound reaches the ear 180 ms late, so song time runs 180 ms behind
  c.setLatency(180);
  assert.equal(c.latencyMs, 180);
  assert.ok(Math.abs(c.song(10) - (4 * SPB - 0.18)) < 1e-12);
  c.setLatency(5000);
  assert.equal(c.latencyMs, LATENCY_RANGE.max);
  assert.equal(createBeatClock({ bpm: 'x' }).bpm, 144);
});

test('stored latency is untrusted: junk becomes 0, numbers are clamped', () => {
  assert.equal(cleanLatency('120'), 120);
  assert.equal(cleanLatency(' 85.6 '), 86);
  assert.equal(cleanLatency(-999), LATENCY_RANGE.min);
  for (const junk of [null, undefined, '', 'abc', NaN, Infinity, {}, '1e999']) assert.equal(cleanLatency(junk), 0, String(junk));
});

test('smoother: a music clock that moves in 20 ms steps reads smoothly between them', () => {
  const sm = createSmoother();
  assert.equal(sm.at(0), null);
  const base = 7.25; // the music clock runs 7.25 s ahead of performance.now()
  let worst = 0;
  for (let perf = 1000; perf < 3000; perf += 16.7) {
    const truth = perf / 1000 + base;
    const stepped = Math.floor(truth / 0.02) * 0.02; // what AudioContext.currentTime might say
    sm.sample(perf, stepped);
    if (perf > 1400) worst = Math.max(worst, Math.abs(sm.at(perf) - truth), Math.abs(sm.at(perf + 5) - (truth + 0.005)));
  }
  assert.ok(worst < 0.004, `within 4 ms of the true clock (worst ${(worst * 1000).toFixed(2)} ms)`);
});

test('smoother: stands still with a suspended clock and starts over after a jump', () => {
  const sm = createSmoother();
  for (let perf = 0; perf <= 1000; perf += 16) sm.sample(perf, 2 + perf / 1000);
  const frozen = 2 + 992 / 1000;
  for (let perf = 1016; perf <= 1400; perf += 16) sm.sample(perf, frozen);
  assert.equal(sm.stalled, true);
  assert.equal(sm.at(1400), frozen);
  // the clock comes back 10 s later
  sm.sample(1500, 12);
  assert.equal(sm.stalled, false);
  assert.ok(Math.abs(sm.at(1500) - 12) < 1e-9);
  assert.ok(Math.abs(sm.at(1600) - 12.1) < 1e-9);
});

test('calibration: taps measured from the nearest beat, median of the steady ones', () => {
  assert.ok(Math.abs(tapOffset(10 + 3 * SPB + 0.12, 10, SPB) - 0.12) < 1e-9);
  assert.ok(Math.abs(tapOffset(10 + 3 * SPB - 0.05, 10, SPB) + 0.05) < 1e-9);
  assert.ok(Math.abs(tapOffset(10 + 0.5 * SPB, 10, SPB) + 0.5 * SPB) < 1e-9, 'halfway wraps to the early side');
  assert.equal(calibrate([0.1, 0.1, 0.1]), null, 'needs a few steady taps');
  // two warm-up taps are skipped; one wild tap does not move the median much
  const r = calibrate([0.3, -0.2, 0.15, 0.16, 0.14, 0.15, 0.17, -0.1, 0.15]);
  assert.equal(r.ms, 150);
  assert.equal(r.n, 7);
  assert.ok(r.spread <= 10);
  assert.equal(calibrate([0, 0, 0.9, 0.9, 0.9, 0.9]).ms, LATENCY_RANGE.max);
});
