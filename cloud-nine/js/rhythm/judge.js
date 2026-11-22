// Hit Zero judging and scoring. Pure logic, no DOM: a "run" is one performance of a chart.
// All times are song seconds (seconds since beat 0 of the routine, latency already taken off).
//
//   WINDOWS                          { perfect: 0.045, good: 0.090, early: 0.15 } seconds either side of the beat
//   judgeOffset(dt)                  -> 'perfect' | 'good' | 'miss'
//   comboMultiplier(combo)           -> 1 | 2 | 3 | 4
//   const run = createRun(chart)
//   run.press(lane, t)               -> event | null    a tap, or the start of a hold (null: no note near, no harm done)
//   run.release(lane, t)             -> event | null    letting go of a hold
//   run.update(t)                    -> events[]        notes that slipped past, holds that finished, spirit draining
//   run.notes                        per note: { ...chartNote, state, verdict, dt, hits, heldTo }
//                                    state: 'pending' | 'half' (a stunt with one lane in) | 'holding' | 'hit' | 'done' | 'miss' | 'drop'
//   run.score, run.combo, run.maxCombo, run.spirit (0..1), run.fullOut, run.counts { perfect, good, miss, drop }
//   run.finished                     every note is settled
//   run.summary()                    -> result (below)
//   judgeCards(summary)              -> [{ id: 'motions' | 'spirit' | 'stunts', card }]   cards are 5.0..10.0 in halves
//
//   events: { type, note, lane, lanes, verdict, dt, points, combo, extra }
//     type: 'hit' | 'half' | 'miss' | 'drop' | 'done' | 'fullOut' | 'fullOutEnd' | 'combo'
//     a 'hit' may carry extra events (a combo call, full out) in `extra`
//
//   result: { levelId, levelName, score, total, perfect, good, miss, drop, maxCombo, accuracy (0..1), hitZero, allPerfect,
//             fullOuts, stunts: { hit, total }, holds: { done, total }, bigAccuracy, cards }

export const WINDOWS = { perfect: 0.045, good: 0.09, early: 0.15 };

export const POINTS = { perfect: 300, good: 150, holdTick: 25, holdDone: 150 };

// Spirit fills with good motions and drains while you are full out (two eight-counts from full).
export const SPIRIT = { perfect: 0.04, good: 0.025, holdDone: 0.05, miss: -0.1, drainEights: 2, fullOutGain: 0.5 };

export const COMBO_CALLS = [10, 25, 50, 75, 100, 150, 200, 250, 300];

const VALUE = { perfect: 1, good: 0.65, miss: 0 };

export function judgeOffset(dt) {
  const a = Math.abs(dt);
  if (!(a <= WINDOWS.good)) return 'miss';
  return a <= WINDOWS.perfect ? 'perfect' : 'good';
}

export function comboMultiplier(combo) {
  return combo >= 50 ? 4 : combo >= 30 ? 3 : combo >= 10 ? 2 : 1;
}

export function createRun(chart) {
  const spb = chart.spb;
  const notes = chart.notes.map((n) => ({ ...n, state: 'pending', verdict: null, dt: null, hits: {}, heldTo: n.t }));
  const down = [false, false, false];
  const counts = { perfect: 0, good: 0, miss: 0, drop: 0 };
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let spirit = 0;
  let fullOut = false;
  let fullOuts = 0;
  let lastT = -Infinity;
  let first = 0; // every note before this index is settled
  let open = notes.length;

  const isSettled = (n) => n.state === 'hit' || n.state === 'done' || n.state === 'miss' || n.state === 'drop';
  const weight = (n) => (n.lanes.length > 1 ? 2 : 1);

  function settle(n, state) {
    n.state = state;
    open--;
  }

  function award(base) {
    const pts = Math.round(base * comboMultiplier(combo) * (fullOut ? 2 : 1));
    score += pts;
    return pts;
  }

  function addSpirit(v, out) {
    if (v > 0 && fullOut) v *= SPIRIT.fullOutGain;
    const before = spirit;
    spirit = Math.max(0, Math.min(1, spirit + v));
    if (!fullOut && before < 1 && spirit >= 1) {
      fullOut = true;
      fullOuts++;
      out.push({ type: 'fullOut' });
    }
  }

  // A miss or a drop: the combo starts over and the spirit dips a little. Nothing else.
  function stumble(out, n, type, lane) {
    const had = combo;
    combo = 0;
    counts[type]++;
    const ev = { type, note: n, lane, lanes: n.lanes, verdict: 'miss', dt: n.dt, points: 0, combo: 0, broke: had };
    out.push(ev);
    addSpirit(SPIRIT.miss, out);
    return ev;
  }

  function scoreHit(n, verdict, out) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    counts[verdict]++;
    const points = award(POINTS[verdict] * weight(n));
    addSpirit(SPIRIT[verdict] * weight(n), out);
    if (COMBO_CALLS.includes(combo)) out.push({ type: 'combo', combo });
    return points;
  }

  // The note a press on `lane` at time t belongs to: the closest unsettled one within the early window.
  function candidate(lane, t) {
    let best = null;
    let bestAbs = Infinity;
    for (let i = first; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t + WINDOWS.early) break;
      if (n.state !== 'pending' && n.state !== 'half') continue;
      if (!n.lanes.includes(lane) || n.hits[lane] !== undefined) continue;
      const a = Math.abs(t - n.t);
      if (a <= WINDOWS.early && a < bestAbs) {
        best = n;
        bestAbs = a;
      }
    }
    return best;
  }

  function press(lane, t) {
    if (!(lane >= 0 && lane <= 2)) return null;
    down[lane] = true;
    const n = candidate(lane, t);
    if (!n) return null;
    const out = [];
    const dt = t - n.t;
    n.hits[lane] = dt;
    if (judgeOffset(dt) === 'miss') {
      // way too early (or late): this one got away. Shake it off.
      n.verdict = 'miss';
      n.dt = dt;
      settle(n, 'miss');
      const ev = stumble(out, n, 'miss', lane);
      ev.extra = out.slice(1);
      return ev;
    }
    if (n.lanes.length > 1 && n.lanes.some((l) => n.hits[l] === undefined)) {
      n.state = 'half';
      return { type: 'half', note: n, lane, lanes: n.lanes, verdict: judgeOffset(dt), dt, points: 0, combo };
    }
    // every lane is in: the stunt is as clean as its sloppiest lane
    let worst = dt;
    for (const l of n.lanes) if (Math.abs(n.hits[l]) > Math.abs(worst)) worst = n.hits[l];
    const verdict = judgeOffset(worst);
    n.verdict = verdict;
    n.dt = worst;
    const points = scoreHit(n, verdict, out);
    const ev = { type: 'hit', note: n, lane, lanes: n.lanes, verdict, dt: worst, points, combo };
    if (n.len > 0) {
      n.state = 'holding';
      n.heldTo = Math.max(n.t, t);
      // a two-lane hold needs both hands still on it
      if (n.lanes.some((l) => !down[l])) {
        settle(n, 'drop');
        stumble(out, n, 'drop', lane);
      }
    } else {
      settle(n, 'hit');
    }
    ev.extra = out;
    return ev;
  }

  // points for every half beat held
  function tickHold(n, t) {
    const step = spb / 2;
    while (n.heldTo + step <= t + 1e-9) {
      n.heldTo += step;
      award(POINTS.holdTick * weight(n));
    }
  }

  function finishHold(n, t, out) {
    tickHold(n, Math.min(t, n.end));
    n.heldTo = n.end;
    settle(n, 'done');
    const points = award(POINTS.holdDone * weight(n));
    const ev = { type: 'done', note: n, lanes: n.lanes, verdict: n.verdict, points, combo };
    out.push(ev);
    addSpirit(SPIRIT.holdDone, out);
    return ev;
  }

  function release(lane, t) {
    if (!(lane >= 0 && lane <= 2)) return null;
    down[lane] = false;
    for (let i = first; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t + WINDOWS.early) break;
      if (n.state !== 'holding' || !n.lanes.includes(lane)) continue;
      const out = [];
      if (t >= n.end - WINDOWS.good) {
        const ev = finishHold(n, t, out);
        ev.extra = out.slice(1);
        return ev;
      }
      tickHold(n, t);
      settle(n, 'drop');
      const ev = stumble(out, n, 'drop', lane);
      ev.extra = out.slice(1);
      return ev;
    }
    return null;
  }

  function update(t) {
    const out = [];
    const dtSec = lastT === -Infinity ? 0 : Math.max(0, Math.min(0.25, t - lastT));
    lastT = Math.max(lastT, t);
    for (let i = first; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > t + WINDOWS.early) break;
      if (n.state === 'holding') {
        if (t >= n.end) finishHold(n, t, out);
        else tickHold(n, t);
      } else if ((n.state === 'pending' || n.state === 'half') && t > n.t + WINDOWS.good) {
        n.verdict = 'miss';
        settle(n, 'miss');
        stumble(out, n, 'miss', null);
      }
    }
    while (first < notes.length && isSettled(notes[first])) first++;
    if (fullOut) {
      spirit -= dtSec / (SPIRIT.drainEights * 8 * spb);
      if (spirit <= 0) {
        spirit = 0;
        fullOut = false;
        out.push({ type: 'fullOutEnd' });
      }
    }
    return out;
  }

  function summary() {
    const total = notes.length;
    let value = 0;
    let bigValue = 0;
    let bigCount = 0;
    let stuntsHit = 0;
    let stuntsTotal = 0;
    let holdsDone = 0;
    let holdsTotal = 0;
    for (const n of notes) {
      let v = VALUE[n.verdict] || 0;
      if (n.len > 0) {
        holdsTotal++;
        if (n.state === 'done') holdsDone++;
        else v *= 0.5;
      }
      if (n.lanes.length > 1) {
        stuntsTotal++;
        if (n.verdict === 'perfect' || n.verdict === 'good') stuntsHit++;
      }
      if (n.len > 0 || n.lanes.length > 1) {
        bigValue += v;
        bigCount++;
      }
      value += v;
    }
    const accuracy = total ? value / total : 0;
    const hitZero = total > 0 && open === 0 && counts.miss === 0 && counts.drop === 0;
    const s = {
      levelId: chart.level.id, levelName: chart.level.name, score, total,
      perfect: counts.perfect, good: counts.good, miss: counts.miss, drop: counts.drop, maxCombo,
      accuracy, hitZero, allPerfect: hitZero && counts.good === 0, fullOuts,
      stunts: { hit: stuntsHit, total: stuntsTotal }, holds: { done: holdsDone, total: holdsTotal },
      bigAccuracy: bigCount ? bigValue / bigCount : accuracy,
    };
    s.cards = judgeCards(s);
    return s;
  }

  return {
    notes,
    press,
    release,
    update,
    summary,
    get score() { return score; },
    get combo() { return combo; },
    get maxCombo() { return maxCombo; },
    get spirit() { return spirit; },
    get fullOut() { return fullOut; },
    get counts() { return { ...counts }; },
    get finished() { return open === 0; },
    get down() { return down.slice(); },
  };
}

// A judge's card: 5.0 to 10.0 in halves. Everybody who performs gets a card worth holding up.
export function cardFor(r) {
  const x = 5 + 5 * Math.pow(Math.max(0, Math.min(1, r)), 1.6);
  return Math.max(5, Math.min(10, Math.floor(x * 2 + 1e-9) / 2));
}

export function judgeCards(s) {
  const total = Math.max(1, s.total);
  const cards = [
    { id: 'motions', card: cardFor(s.accuracy) },
    { id: 'spirit', card: cardFor(0.65 * (s.maxCombo / total) + 0.35 * s.accuracy) },
    { id: 'stunts', card: cardFor(Number.isFinite(s.bigAccuracy) ? s.bigAccuracy : s.accuracy) },
  ];
  if (s.hitZero) {
    for (const c of cards) c.card = Math.max(c.card, 9.5);
    cards[1].card = 10; // a full combo is all the spirit there is
    if (s.allPerfect) for (const c of cards) c.card = 10;
  }
  return cards;
}
