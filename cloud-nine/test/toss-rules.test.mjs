// Basket toss rules: the launch solve, the hang, tricks, combos, scoring, basing, network validation.
// Run with: node --test "cloud-nine/test/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOSS, TRICKS, GESTURES, POINTS, COMBO, FALLBACK_HYPE,
  solveToss, heightAt, vSpeedAt, groundTrackAt, clockRate, inApex, realAirTime,
  trickFor, nextChain, comboMultiplier, scoreToss, matchSpots, cleanTossFx, cleanNick, fallbackHype,
} from '../js/world/toss-rules.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A pad on the ground and the three standard clouds from the blueprint (8, 14 and 22 m).
const PAD = { x: 0, y: 0, z: 0 };
const release = (pad = PAD) => ({ x: pad.x, y: pad.y + TOSS.releaseY, z: pad.z });
const CLOUDS = [
  { x: 4, y: 8, z: -11 },
  { x: -3, y: 14, z: -15 },
  { x: 6, y: 22, z: -17 },
];

// The highest point of the arc, found by brute force.
function peak(s) {
  let best = -Infinity;
  for (let i = 0; i <= 4000; i++) best = Math.max(best, heightAt(s, (i / 4000) * s.T));
  return best;
}

test('the arc leaves the bases\' hands and lands exactly on the target cloud', () => {
  for (const to of CLOUDS) {
    for (const friends of [0, 1, 2, 3, 4]) {
      const s = solveToss({ from: release(), to, friends });
      assert.ok(near(heightAt(s, 0), s.y0), 'starts at the release height');
      assert.ok(near(heightAt(s, s.T), to.y, 1e-6), `lands on the ${to.y} m cloud (friends ${friends})`);
      const end = groundTrackAt(s, s.T);
      assert.ok(near(end.x, to.x) && near(end.z, to.z), 'lands over the cloud');
      assert.ok(near(s.vx * s.T, to.x - s.x0) && near(s.vz * s.T, to.z - s.z0), 'horizontal speed covers the distance in the flight time');
    }
  }
});

test('the apex comes from the heights: vertical speed from the apex, apex reached at tUp', () => {
  for (const to of CLOUDS) {
    const s = solveToss({ from: release(), to });
    const want = Math.max(Math.max(s.y0, to.y) + TOSS.clearance, s.y0 + TOSS.minRise);
    assert.ok(near(s.apex, want), 'apex = clearance above the higher end');
    assert.ok(near(peak(s), s.apex, 1e-3), 'the arc really peaks at the apex');
    assert.ok(near(heightAt(s, s.tUp), s.apex, 1e-9), 'apex at tUp');
    assert.ok(Math.abs(vSpeedAt(s, s.tUp)) < 1e-9, 'vertical speed is zero at the top');
    assert.ok(near(s.vy, Math.sqrt(2 * s.gUp * s.rise), 1e-9), 'launch speed from the apex height');
    assert.ok(s.gDown < s.gUp, 'the way down is floatier than the way up');
    assert.ok(near(s.tUp + Math.sqrt((2 * s.drop) / s.gDown), s.T, 1e-9), 'up time + down time = flight time');
  }
});

test('every real friend basing adds height, up to three bases and a back spot', () => {
  const to = CLOUDS[1];
  const apexes = [0, 1, 2, 3, 4, 5, 9].map((friends) => solveToss({ from: release(), to, friends }).apex);
  for (let i = 1; i <= 4; i++) assert.ok(near(apexes[i] - apexes[i - 1], TOSS.friendLift), `friend ${i} lifts`);
  assert.equal(apexes[5], apexes[4], 'no more than four count');
  assert.equal(apexes[6], apexes[4]);
  assert.equal(solveToss({ from: release(), to, friends: -3 }).apex, apexes[0], 'negative is none');
  assert.equal(solveToss({ from: release(), to, friends: 'lots' }).apex, apexes[0], 'garbage is none');
});

test('air time is about two to three seconds, a little more with a big squad', () => {
  for (const to of CLOUDS) {
    const t0 = realAirTime(solveToss({ from: release(), to }));
    assert.ok(t0 >= 2 && t0 <= 3.1, `${to.y} m cloud: ${t0.toFixed(2)} s`);
    const t4 = realAirTime(solveToss({ from: release(), to, friends: 4 }));
    assert.ok(t4 > t0 && t4 <= 3.7, `${to.y} m cloud with four friends: ${t4.toFixed(2)} s`);
  }
  // higher clouds take longer
  const times = CLOUDS.map((to) => realAirTime(solveToss({ from: release(), to })));
  assert.ok(times[0] < times[1] && times[1] < times[2]);
});

test('the hang: the flight clock slows around the apex, never when reduced motion is on', () => {
  const s = solveToss({ from: release(), to: CLOUDS[0] });
  assert.ok(near(clockRate(s, s.tUp), TOSS.hangSlow), 'slowest at the very top');
  assert.equal(clockRate(s, 0), 1, 'full speed off the hands');
  assert.equal(clockRate(s, s.T), 1, 'full speed at touchdown');
  // smooth: no jumps anywhere along the flight
  let prev = clockRate(s, 0);
  for (let i = 1; i <= 2000; i++) {
    const r = clockRate(s, (i / 2000) * s.T);
    assert.ok(Math.abs(r - prev) < 0.01, 'the hang eases in and out');
    assert.ok(r >= TOSS.hangSlow - 1e-9 && r <= 1);
    prev = r;
  }
  assert.ok(realAirTime(s) > s.T + 0.2, 'the hang adds real air time');
  assert.ok(inApex(s, s.tUp) && !inApex(s, 0) && !inApex(s, s.T));

  const calm = solveToss({ from: release(), to: CLOUDS[0], calm: true });
  for (let i = 0; i <= 100; i++) assert.equal(clockRate(calm, (i / 100) * calm.T), 1);
  assert.ok(Math.abs(realAirTime(calm) - calm.T) < 0.01, 'no slow motion when calm');
  assert.ok(near(calm.T, s.T + TOSS.calmExtra), 'a gentler arc instead');
  assert.ok(inApex(calm, calm.tUp), 'body positions still work near the top');
});

test('classic toss (no cloud): straight up and back into the bases\' arms', () => {
  const from = release();
  const to = { x: 9, y: TOSS.catchY, z: 9 };
  const s = solveToss({ from, to, classic: true });
  assert.equal(s.x1, from.x);
  assert.equal(s.z1, from.z);
  assert.equal(s.vx, 0);
  assert.equal(s.vz, 0);
  assert.ok(near(s.apex, Math.max(from.y, to.y) + TOSS.classicRise));
  assert.ok(near(heightAt(s, s.T), TOSS.catchY));
  const t = realAirTime(s);
  assert.ok(t >= 2 && t <= 3.2, `classic air time ${t.toFixed(2)} s`);
});

test('the solve never produces NaN, whatever it is given', () => {
  const rnd = (() => {
    let a = 7;
    return () => ((a = (a * 16807) % 2147483647) / 2147483647);
  })();
  for (let i = 0; i < 400; i++) {
    const from = { x: rnd() * 80 - 40, y: rnd() * 30 - 5, z: rnd() * 80 - 40 };
    const to = { x: rnd() * 80 - 40, y: rnd() * 40 - 5, z: rnd() * 80 - 40 };
    const s = solveToss({ from, to, friends: Math.floor(rnd() * 6), calm: rnd() < 0.3 });
    for (const k of ['apex', 'T', 'tUp', 'gUp', 'gDown', 'vy', 'vx', 'vz']) assert.ok(Number.isFinite(s[k]), k);
    assert.ok(s.T >= TOSS.minFlight && s.T <= TOSS.maxFlight + TOSS.calmExtra);
    assert.ok(near(heightAt(s, s.T), to.y, 1e-6));
    assert.ok(s.apex >= Math.max(from.y, to.y) + Math.min(TOSS.clearance, TOSS.minRise) - 1e-9);
  }
  const junk = solveToss({ from: { x: 'a', y: null, z: undefined }, to: null });
  for (const k of ['apex', 'T', 'tUp', 'vy', 'vx', 'vz']) assert.ok(Number.isFinite(junk[k]), 'junk in, numbers out: ' + k);
  assert.doesNotThrow(() => solveToss());
});

test('gestures map to tricks; near the apex they become body positions', () => {
  assert.equal(trickFor('up').id, 'toeTouch');
  assert.equal(trickFor('down').id, 'pike');
  assert.equal(trickFor('left').id, 'kickDouble');
  assert.equal(trickFor('right').id, 'kickDouble');
  assert.equal(trickFor('circle').id, 'twist');
  assert.equal(trickFor('up', true).id, 'liberty');
  assert.equal(trickFor('down', true).id, 'heelStretch');
  assert.equal(trickFor('left', true).id, 'scorpion');
  assert.equal(trickFor('right', true).id, 'bowArrow');
  assert.equal(trickFor('circle', true).id, 'arabesque');
  assert.equal(trickFor('tap'), null);
  assert.equal(trickFor('nope'), null);
  assert.equal(trickFor(undefined), null);
  // every trick plays a Contract 3 animation and takes real air time
  const anims = new Set(['toeTouch', 'pike', 'kickDouble', 'twist', 'liberty', 'heelStretch', 'scorpion', 'bowArrow', 'arabesque']);
  for (const t of Object.values(TRICKS)) {
    assert.ok(anims.has(t.anim), t.id + ' anim');
    assert.ok(t.dur >= 0.4 && t.dur <= 1, t.id + ' duration');
    assert.ok(t.points > 0 && Number.isInteger(t.points), t.id + ' points');
    assert.ok(Number.isInteger(t.spin) && t.spin >= 0, t.id + ' spin is whole turns');
    assert.ok(t.name.length > 2);
  }
  for (const [g, m] of Object.entries(GESTURES)) {
    assert.ok(TRICKS[m.air] && !TRICKS[m.air].apex, g + ' air trick');
    assert.ok(TRICKS[m.apex] && TRICKS[m.apex].apex, g + ' apex position');
  }
});

test('different tricks in a row make a combo; a repeat starts over', () => {
  let chain = 0;
  let prev = null;
  const seq = ['toeTouch', 'pike', 'twist', 'twist', 'kickDouble', 'liberty', 'toeTouch', 'pike', 'scorpion'];
  const chains = [];
  for (const id of seq) {
    chain = nextChain(prev, id, chain);
    prev = id;
    chains.push(chain);
  }
  assert.deepEqual(chains, [1, 2, 3, 1, 2, 3, 4, 5, 6]);
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.5);
  assert.equal(comboMultiplier(3), 2);
  assert.equal(comboMultiplier(5), COMBO.max);
  assert.equal(comboMultiplier(50), COMBO.max, 'capped');
  assert.equal(comboMultiplier(0), 1);
});

test('score = height + tricks (with combos) + stuck landing', () => {
  const r = scoreToss({
    apexHeight: 10.6,
    tricks: [{ id: 'toeTouch' }, { id: 'liberty' }, { id: 'pike' }],
    landing: 'stuck',
  });
  assert.equal(r.height, 106);
  assert.deepEqual(r.rows.map((x) => x.points), [100, 240, 240]); // 100, 160 x1.5, 120 x2
  assert.deepEqual(r.rows.map((x) => x.mult), [1, 1.5, 2]);
  assert.equal(r.trickPoints, 580);
  assert.equal(r.landingPoints, POINTS.stuck);
  assert.equal(r.total, 106 + 580 + POINTS.stuck);

  // the same trick twice does not combo
  const rep = scoreToss({ apexHeight: 0, tricks: [{ id: 'pike' }, { id: 'pike' }], landing: 'stuck' });
  assert.deepEqual(rep.rows.map((x) => x.points), [120, 120]);
});

test('still mid-trick at touchdown: a soft cradle, and the unfinished trick does not count', () => {
  const r = scoreToss({ apexHeight: 9, tricks: [{ id: 'toeTouch' }, { id: 'kickDouble', done: false }], landing: 'cradle' });
  assert.equal(r.landing, 'cradle');
  assert.equal(r.landingPoints, POINTS.cradle);
  assert.deepEqual(r.rows.map((x) => [x.points, x.done]), [[100, true], [0, false]]);
  assert.equal(r.total, 90 + 100 + POINTS.cradle);
  assert.ok(POINTS.cradle > 0, 'a cradle still scores: never shame');
  assert.ok(POINTS.stuck > POINTS.cradle);
});

test('scoring shrugs off junk', () => {
  const r = scoreToss({ apexHeight: 'high', tricks: [null, { id: 'moonwalk' }, 7, { id: 'pike' }], landing: 'sideways' });
  assert.equal(r.height, 0);
  assert.equal(r.rows.length, 1);
  assert.equal(r.landing, 'cradle');
  assert.ok(Number.isFinite(r.total));
  assert.equal(scoreToss().total, POINTS.stuck);
  assert.equal(scoreToss({ apexHeight: 1e9 }).height, 5000, 'height is capped');
});

test('base spots: nearest friend per spot, one spot per friend, on the mat only', () => {
  const spots = [{ x: -0.8, y: 0, z: 0 }, { x: 0.8, y: 0, z: 0 }, { x: 0, y: 0, z: 0.8 }, { x: 0, y: 0, z: -0.8 }];
  const people = [
    { id: 'ana', x: -0.75, y: 0, z: 0.05 }, // on spot 0
    { id: 'bo', x: -0.6, y: 0, z: 0.1 }, // also near spot 0, but further: no spot (centre is 0.8 m from the others)
    { id: 'cy', x: 0.0, y: 0.1, z: 0.85 }, // on spot 2
    { id: 'di', x: 0.0, y: 6, z: -0.8 }, // above spot 3 (on a cloud): does not count
    { id: 'ed', x: 3, y: 0, z: 3 }, // off the mat
    { id: 'fi', x: NaN, y: 0, z: 0.8 }, // broken state: ignored
    { id: null, x: 0.8, y: 0, z: 0 }, // no id: ignored
  ];
  const m = matchSpots(spots, people);
  assert.deepEqual(m.taken, ['ana', null, 'cy', null]);
  assert.equal(m.count, 2);
  // one person standing between two spots only takes one of them
  const one = matchSpots([{ x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }], [{ id: 'a', x: 0.12, y: 0, z: 0 }]);
  assert.equal(one.count, 1);
  assert.deepEqual(one.taken, ['a', null]);
  assert.deepEqual(matchSpots(null, null), { taken: [], count: 0 });
});

test('toss events from the network are validated', () => {
  const pads = ['pad-a', 'pad-b', 3];
  assert.deepEqual(cleanTossFx({ kind: 'toss', pad: 'pad-a', beat: 0.4 }, pads), { kind: 'toss', pad: 'pad-a', beat: 0.4 });
  assert.deepEqual(cleanTossFx({ kind: 'toss', pad: 3 }, pads), { kind: 'toss', pad: '3', beat: TOSS.countBeat });
  assert.equal(cleanTossFx({ kind: 'toss', pad: 'pad-a', beat: 99 }, pads).beat, 0.8, 'beat clamped');
  assert.equal(cleanTossFx({ kind: 'toss', pad: 'pad-a', beat: -1 }, pads).beat, 0.25);
  assert.deepEqual(cleanTossFx({ kind: 'tossLand', pad: 'pad-b', stuck: true, score: 812.4 }, pads), { kind: 'tossLand', pad: 'pad-b', stuck: true, score: 812 });
  assert.equal(cleanTossFx({ kind: 'tossLand', pad: 'pad-b', stuck: 'yes', score: 1e12 }, pads).stuck, false, 'only true is true');
  assert.equal(cleanTossFx({ kind: 'tossLand', pad: 'pad-b', score: 1e12 }, pads).score, 99999);
  assert.equal(cleanTossFx({ kind: 'toss', pad: 'nope' }, pads), null, 'unknown pad');
  assert.equal(cleanTossFx({ kind: 'toss', pad: { evil: 1 } }, pads), null);
  assert.equal(cleanTossFx({ kind: 'explode', pad: 'pad-a' }, pads), null, 'unknown kind');
  assert.equal(cleanTossFx('toss', pads), null);
  assert.equal(cleanTossFx(null, pads), null);
  assert.equal(cleanTossFx([1, 2], pads), null);
  const extra = cleanTossFx({ kind: 'toss', pad: 'pad-a', html: '<b>hi</b>' }, pads);
  assert.equal('html' in extra, false, 'unknown fields are dropped');
});

test('friend nicks are letters and spaces only', () => {
  assert.equal(cleanNick('Sparkle Comet'), 'Sparkle Comet');
  assert.equal(cleanNick('  Moon   Pie  '), 'Moon Pie');
  assert.equal(cleanNick('Zoë'), 'Zoë');
  assert.equal(cleanNick('<script>'), null);
  assert.equal(cleanNick('a'.repeat(21)), null);
  assert.equal(cleanNick(''), null);
  assert.equal(cleanNick(42), null);
  assert.equal(cleanNick('http://x'), null);
});

test('fallback hype is kind: about skill and spirit, never looks, never shame', () => {
  const banned = /\b(fail|failed|loser|lose|lost|bad|ugly|pretty|beautiful|cute|fat|skinny|weight|diet|crash|stupid|dumb|worst)\b/i;
  for (const [k, list] of Object.entries(FALLBACK_HYPE)) {
    assert.ok(list.length >= 3, k);
    for (const line of list) {
      assert.ok(!banned.test(line), `"${line}"`);
      assert.ok(line.length <= 60, `short enough: "${line}"`);
    }
  }
  assert.ok(FALLBACK_HYPE.stuck.includes(fallbackHype('tossLand', { stuck: true }, () => 0)));
  assert.ok(FALLBACK_HYPE.cradle.includes(fallbackHype('tossLand', { stuck: false }, () => 0.99)));
  assert.ok(FALLBACK_HYPE.classic.includes(fallbackHype('tossLand', { stuck: true, classic: true }, () => 0.5)), 'a classic catch is not about clouds');
  assert.equal(typeof fallbackHype('unknown-situation'), 'string');
  assert.equal(typeof fallbackHype('bigToss', {}, () => 1), 'string', 'rng of exactly 1 still picks a line');
  assert.equal(typeof fallbackHype('trick', {}, 'not a function'), 'string');
});
