import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChart, LEVELS } from '../js/rhythm/charts.js';
import { WINDOWS, judgeOffset, comboMultiplier, createRun, cardFor, judgeCards } from '../js/rhythm/judge.js';
import { JUDGES, judgeLine, verdictWord, resultTitle, comboCall, countInCall } from '../js/rhythm/lines.js';

const SPB = 60 / 144;

// A tiny chart from a list of [beat, lanes, len].
function mini(list) {
  const notes = list.map(([beat, lanes, len = 0], id) => ({
    id, beat, t: beat * SPB, len, end: (beat + len) * SPB, lanes, kind: lanes.length > 1 ? 'stunt' : len ? 'hold' : 'tap', section: 0, motion: 'highV',
  }));
  return { level: LEVELS[1], spb: SPB, notes };
}

// Plays a chart: every note pressed `off` seconds from its beat, holds held to the end.
function play(chart, off = 0, { step = 1 / 60 } = {}) {
  const run = createRun(chart);
  const events = [];
  const holds = [];
  const last = chart.notes[chart.notes.length - 1];
  const end = Math.max(...chart.notes.map((n) => n.end)) + 0.5;
  let i = 0;
  for (let t = 0; t <= end; t += step) {
    while (i < chart.notes.length && chart.notes[i].t + off <= t) {
      const n = chart.notes[i++];
      for (const lane of n.lanes) {
        const ev = run.press(lane, n.t + off);
        if (ev) events.push(ev);
      }
      if (n.len > 0) holds.push(n);
    }
    for (let h = holds.length - 1; h >= 0; h--) {
      if (t >= holds[h].end + 0.02) {
        for (const lane of holds[h].lanes) run.release(lane, t);
        holds.splice(h, 1);
      }
    }
    // let go of plain taps right away
    for (let lane = 0; lane < 3; lane++) if (!holds.some((h) => h.lanes.includes(lane))) run.release(lane, t);
    events.push(...run.update(t));
  }
  assert.ok(last);
  return { run, events };
}

test('timing windows: Perfect is within 45 ms, Good within 90 ms, otherwise a miss', () => {
  assert.equal(WINDOWS.perfect, 0.045);
  assert.equal(WINDOWS.good, 0.09);
  for (const [dt, v] of [[0, 'perfect'], [0.045, 'perfect'], [-0.045, 'perfect'], [0.0451, 'good'], [-0.07, 'good'], [0.09, 'good'], [-0.09, 'good'], [0.0901, 'miss'], [-0.2, 'miss'], [NaN, 'miss']]) {
    assert.equal(judgeOffset(dt), v, `dt ${dt}`);
  }
  assert.deepEqual([0, 9, 10, 29, 30, 49, 50, 500].map(comboMultiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
});

for (const L of LEVELS) {
  test(`perfect play on ${L.name} hits zero with three 10s`, () => {
    const chart = buildChart({ level: L.id });
    const { run } = play(chart, 0);
    assert.ok(run.finished);
    const s = run.summary();
    assert.equal(s.total, chart.notes.length);
    assert.equal(s.perfect, s.total);
    assert.equal(s.miss + s.drop + s.good, 0);
    assert.equal(s.maxCombo, s.total);
    assert.equal(s.hitZero, true);
    assert.equal(s.allPerfect, true);
    assert.equal(s.accuracy, 1);
    assert.equal(s.holds.done, s.holds.total);
    assert.equal(s.stunts.hit, s.stunts.total);
    assert.deepEqual(s.cards.map((c) => c.card), [10, 10, 10]);
    assert.ok(s.fullOuts >= 1, 'a perfect routine goes full out');
    assert.ok(s.score > s.total * 300, 'combos and full out multiply the score');
  });
}

test('all Goods still hit zero (no deductions), just not all perfect', () => {
  const { run } = play(buildChart({ level: 4 }), 0.07);
  const s = run.summary();
  assert.equal(s.good, s.total);
  assert.equal(s.hitZero, true);
  assert.equal(s.allPerfect, false);
  assert.ok(s.cards.every((c) => c.card >= 9.5));
  assert.equal(s.cards[1].card, 10, 'a full combo earns the spirit 10');
  assert.ok(s.accuracy > 0.6 && s.accuracy < 0.7);
});

test('late by 100 ms is a miss every time; nobody plays: everything is missed, cards stay kind', () => {
  const late = play(buildChart({ level: 1 }), 0.1).run.summary();
  assert.equal(late.miss, late.total);
  const chart = buildChart({ level: 1 });
  const run = createRun(chart);
  for (let t = 0; t < chart.notes[chart.notes.length - 1].end + 1; t += 1 / 30) run.update(t);
  const s = run.summary();
  assert.ok(run.finished);
  assert.equal(s.miss, s.total);
  assert.equal(s.score, 0);
  assert.equal(s.maxCombo, 0);
  assert.equal(s.hitZero, false);
  assert.deepEqual(s.cards.map((c) => c.card), [5, 5, 5], 'nobody gets less than a 5');
});

test('a stray tap with no note near it costs nothing; a way-early tap uses up the note', () => {
  const run = createRun(mini([[4, [1]], [8, [1]]]));
  assert.equal(run.press(1, 0.5), null);
  assert.equal(run.counts.miss, 0);
  const early = run.press(1, 4 * SPB - 0.12);
  assert.equal(early.type, 'miss');
  assert.equal(run.notes[0].state, 'miss');
  const ok = run.press(1, 8 * SPB + 0.03);
  assert.equal(ok.type, 'hit');
  assert.equal(ok.verdict, 'perfect');
  assert.equal(ok.combo, 1);
});

test('a tap goes to the closest note on its lane, and only its lane', () => {
  const run = createRun(mini([[0, [0]], [0.5, [0]], [0.5, [2]]]));
  assert.equal(run.press(1, 0), null, 'no note on the middle lane');
  const ev = run.press(0, 0.5 * SPB - 0.02);
  assert.equal(ev.note.id, 1, 'nearer the second note');
  run.update(0.2);
  assert.equal(run.notes[0].state, 'miss', 'the skipped one slips by');
});

test('holds: hold to the end for points, let go early and it is a drop', () => {
  const chart = mini([[0, [1], 2], [4, [1], 2], [8, [1], 2]]);
  const run = createRun(chart);
  assert.equal(run.press(1, 0).type, 'hit');
  assert.equal(run.notes[0].state, 'holding');
  const scoreAtHead = run.score;
  run.update(1 * SPB);
  assert.ok(run.score > scoreAtHead, 'points tick while you hold');
  const drop = run.release(1, 1 * SPB);
  assert.equal(drop.type, 'drop');
  assert.equal(run.counts.drop, 1);
  assert.equal(run.combo, 0);
  // let go just inside the Good window of the end: that counts
  run.press(1, 4 * SPB);
  const done = run.release(1, 6 * SPB - 0.08);
  assert.equal(done.type, 'done');
  // or keep holding: it finishes by itself
  run.press(1, 8 * SPB);
  const evs = run.update(10 * SPB + 0.01);
  assert.ok(evs.some((e) => e.type === 'done'));
  assert.ok(run.finished);
  const s = run.summary();
  assert.equal(s.holds.done, 2);
  assert.equal(s.hitZero, false);
});

test('a hold tapped early and let go before its start is still a drop', () => {
  const run = createRun(mini([[4, [0], 2]]));
  assert.equal(run.press(0, 4 * SPB - 0.04).type, 'hit');
  assert.equal(run.release(0, 4 * SPB - 0.02).type, 'drop');
});

test('stunts: both lanes at once; one lane alone slips by; judged on the sloppier lane', () => {
  const run = createRun(mini([[0, [0, 2]], [4, [0, 2]], [8, [1, 2], 2]]));
  assert.equal(run.press(0, 0).type, 'half');
  assert.equal(run.notes[0].state, 'half');
  const evs = run.update(0.1);
  assert.equal(evs[0].type, 'miss');
  assert.equal(run.notes[0].state, 'miss');
  run.press(0, 4 * SPB + 0.01);
  const ev = run.press(2, 4 * SPB - 0.06);
  assert.equal(ev.type, 'hit');
  assert.equal(ev.verdict, 'good');
  assert.ok(Math.abs(ev.dt + 0.06) < 1e-9);
  // a two-lane hold: let go of one hand and it drops
  run.release(0, 5 * SPB);
  run.release(2, 5 * SPB);
  run.press(1, 8 * SPB);
  assert.equal(run.press(2, 8 * SPB).type, 'hit');
  assert.equal(run.notes[2].state, 'holding');
  assert.equal(run.release(2, 9 * SPB).type, 'drop');
});

test('a two-lane hold where the first hand let go before the second landed drops at once', () => {
  const run = createRun(mini([[0, [0, 1], 2]]));
  run.press(0, 0);
  run.release(0, 0.01);
  const ev = run.press(1, 0.02);
  assert.equal(ev.type, 'hit');
  assert.ok(ev.extra.some((e) => e.type === 'drop'));
  assert.equal(run.notes[0].state, 'drop');
});

test('spirit fills up to FULL OUT, which doubles points and drains away', () => {
  const list = [];
  for (let b = 0; b < 60; b++) list.push([b, [b % 3]]);
  const run = createRun(mini(list));
  let sawFull = false;
  let fullAt = -1;
  for (let i = 0; i < 30; i++) {
    const ev = run.press(i % 3, i * SPB);
    run.release(i % 3, i * SPB + 0.01);
    if ((ev.extra || []).some((e) => e.type === 'fullOut')) {
      sawFull = true;
      fullAt = i;
    }
    run.update(i * SPB + 0.02);
  }
  assert.ok(sawFull, 'twenty-five perfects fill the meter');
  assert.equal(fullAt, 24);
  assert.ok(run.fullOut);
  const before = run.score;
  run.press(30 % 3, 30 * SPB);
  assert.equal(run.score - before, 300 * 3 * 2, 'x3 combo, x2 full out');
  // stop playing: the meter drains over two eight-counts and full out ends
  let ended = false;
  for (let t = 31 * SPB; t < 60 * SPB; t += 1 / 30) {
    if (run.update(t).some((e) => e.type === 'fullOutEnd')) ended = true;
  }
  assert.ok(ended);
  assert.equal(run.fullOut, false);
});

test('combo calls fire at the milestones', () => {
  const list = [];
  for (let b = 0; b < 26; b++) list.push([b, [0]]);
  const run = createRun(mini(list));
  const calls = [];
  for (let i = 0; i < 26; i++) {
    const ev = run.press(0, i * SPB);
    run.release(0, i * SPB + 0.01);
    for (const e of ev.extra || []) if (e.type === 'combo') calls.push(e.combo);
  }
  assert.deepEqual(calls, [10, 25]);
});

test('judges cards: 5 to 10 in halves', () => {
  assert.equal(cardFor(0), 5);
  assert.equal(cardFor(1), 10);
  assert.equal(cardFor(0.97), 9.5, 'a 10 is for flawless');
  assert.equal(cardFor(-1), 5);
  assert.equal(cardFor(2), 10);
  for (let r = 0; r <= 1; r += 0.05) assert.equal(cardFor(r) * 2 % 1, 0);
  const cards = judgeCards({ total: 100, accuracy: 0.8, maxCombo: 40, bigAccuracy: 0.9, hitZero: false });
  assert.deepEqual(cards.map((c) => c.id), JUDGES.map((j) => j.id));
});

test('words: kind about misses, never mean, short enough for a speech bubble', () => {
  const MEAN = /\b(lose|lost|loser|fail|failed|bad|terrible|awful|worst|ugly|stupid|dumb|cry|crying|fat|skinny|pretty|weight)\b/i;
  let r = 0;
  const rng = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const results = [
    { hitZero: true, allPerfect: true, levelId: 7, miss: 0, drop: 0, accuracy: 1 },
    { hitZero: true, allPerfect: false, levelId: 4, miss: 0, drop: 0, accuracy: 0.8 },
    { hitZero: false, miss: 2, drop: 0, accuracy: 0.9, levelId: 1 },
    { hitZero: false, miss: 20, drop: 4, accuracy: 0.5, levelId: 1 },
    { hitZero: false, miss: 80, drop: 9, accuracy: 0.1, levelId: 7 },
  ];
  for (const s of results) {
    for (const j of JUDGES) {
      for (const card of [5, 6, 7, 8, 8.5, 9, 9.5, 10]) {
        for (let k = 0; k < 6; k++) {
          const line = judgeLine(j.id, card, s, rng);
          assert.ok(line && line.length <= 64, `"${line}" fits a bubble`);
          assert.ok(!MEAN.test(line), `"${line}" is kind`);
        }
      }
    }
    const t = resultTitle(s);
    assert.ok(t.big && t.sub && !MEAN.test(t.big + ' ' + t.sub));
  }
  assert.equal(resultTitle(results[0]).big, 'HIT ZERO!');
  assert.equal(resultTitle(results[2]).big, 'SO CLOSE!');
  assert.match(resultTitle(results[2]).sub, /2 bobbles/);
  assert.equal(verdictWord({ type: 'miss' }), 'OOPS!');
  assert.equal(verdictWord({ type: 'hit', verdict: 'perfect', lanes: [0] }), 'PERFECT!');
  assert.equal(verdictWord({ type: 'hit', verdict: 'good', lanes: [0] }), 'GOOD!');
  assert.equal(comboCall(25), '25 IN A ROW!');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(countInCall), ['READY?', '', 'OK!', '', '5', '6', '7', '8!']);
});
