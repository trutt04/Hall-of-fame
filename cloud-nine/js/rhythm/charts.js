// Hit Zero charts: which notes come when, built on the eight-counts of the `routine` track.
// Pure data and logic: no DOM, no audio. Runs under node --test.
//
//   LEVELS                              [{ id: 1 | 4 | 7, name: 'Level 4', tag, blurb, approach }]   approach: seconds a note is on screen
//   levelInfo(level)                    -> one of LEVELS. Takes 4, '4', 'Level 4', 'L4', { id: 4 }; anything else is Level 1
//   DEFAULT_BPM                         144, the internal metronome's tempo
//   DEFAULT_STRUCTURE                   the section plan used when the audio module gives none
//   normalizeStructure(raw)             -> [{ kind, name, label, eights }] or null when raw is not understood
//   parseEight('L . M&R LR_2 . . . .')  -> [{ at, lanes, len }]   one eight-count in the pattern notation below
//   buildChart({ level, structure, bpm, seed }) -> chart
//
//   chart = {
//     level, bpm, spb, seed,               // spb: seconds per beat
//     sections: [{ kind, name, label, startBeat, eights, notes: boolean, motions: [left, middle, right] }],
//     notes: [{ id, beat, t, len, end, lanes, kind: 'tap' | 'hold' | 'stunt', section, motion }],   // sorted; t and end in seconds
//     countInBeat,                         // the eight before the first note: "Ready? OK! 5, 6, 7, 8!"
//     firstBeat, lastBeat, endBeat,        // first note, end of the last note, when the judges come out
//     stats: { notes, taps, holds, stunts },
//   }
//
// Pattern notation: one string per eight-count, eight tokens for counts 1 to 8.
//   .       rest
//   L M R   a tap on the left, middle or right lane
//   LR      two lanes at once: a stunt (any two of L, M, R)
//   M_3     a hold ("hold the stunt") for 3 beats; works on stunts too: LR_2
//   L&R     L on the count, R on the "and" (half a beat later); .&M is a note on the "and" only

import { hash2 } from '../core/util.js';

export const DEFAULT_BPM = 144;

export const LEVELS = [
  { id: 1, name: 'Level 1', tag: 'Mini', blurb: 'Nice and steady. Perfect for warming up!', approach: 2.2 },
  { id: 4, name: 'Level 4', tag: 'Sharp', blurb: 'Quicker counts and bigger stunts.', approach: 1.7 },
  { id: 7, name: 'Level 7', tag: 'Elite', blurb: 'Fast counts, huge stunts. Worlds ready!', approach: 1.35 },
];

export function levelInfo(level) {
  let v = level;
  if (v && typeof v === 'object') v = v.id;
  if (typeof v === 'string') {
    const m = /(\d+)/.exec(v);
    v = m ? Number(m[1]) : NaN;
  }
  return LEVELS.find((l) => l.id === v) || LEVELS[0];
}

// What a section is called on screen, and which cheer motion each lane shows during it.
export const SECTION_LABELS = {
  intro: 'Intro', opening: 'Opening', stunts: 'Stunts', tumbling: 'Tumbling', jumps: 'Jumps', pyramid: 'Pyramid',
  dance: 'Dance', break: 'Breather', finale: 'Finale', outro: 'Final pose',
};

export const MOTION_SETS = {
  intro: ['highV', 'tMotion', 'touchdown'],
  opening: ['highV', 'tMotion', 'touchdown'],
  stunts: ['liberty', 'heelStretch', 'arabesque'],
  tumbling: ['daggers', 'punch', 'lowV'],
  jumps: ['toeTouch', 'pike', 'kickDouble'],
  pyramid: ['bowArrow', 'scorpion', 'liberty'],
  dance: ['punch', 'clasp', 'daggers'],
  break: ['lowV', 'clasp', 'highV'],
  finale: ['highV', 'touchdown', 'tMotion'],
  outro: ['highV', 'touchdown', 'tMotion'],
};

// The flyer's move when a two-lane stunt hits.
const STUNT_MOTION = {
  stunts: 'heelStretch', pyramid: 'liberty', jumps: 'toeTouch', tumbling: 'twist', finale: 'liberty', outro: 'liberty',
};

export const MOTION_LABELS = {
  highV: 'High V', lowV: 'Low V', tMotion: 'T Motion', touchdown: 'Touchdown', daggers: 'Daggers', punch: 'Punch',
  clasp: 'Clasp', toeTouch: 'Toe Touch', pike: 'Pike', kickDouble: 'Kick Double', twist: 'Twist', liberty: 'Liberty',
  heelStretch: 'Heel Stretch', scorpion: 'Scorpion', bowArrow: 'Bow & Arrow', arabesque: 'Arabesque',
};

// 18 eight-counts at 144 BPM: one minute of routine.
export const DEFAULT_STRUCTURE = [
  { kind: 'intro', eights: 1 },
  { kind: 'opening', eights: 2 },
  { kind: 'stunts', eights: 3 },
  { kind: 'tumbling', eights: 2 },
  { kind: 'jumps', eights: 2 },
  { kind: 'pyramid', eights: 3 },
  { kind: 'dance', eights: 3 },
  { kind: 'finale', eights: 1 },
  { kind: 'outro', eights: 1 },
];

const QUIET = new Set(['intro', 'outro']); // no notes in these

// Patterns per level and section. Index 0 is the gentlest and opens each section. The finale's
// index 0 is the final pose, always the last eight with notes.
export const PATTERNS = {
  1: {
    opening: ['L . M . R . M .', 'M . L . M . R .', 'L . R . L . R .', 'M . M . L . R .'],
    stunts: ['M_3 . . . L . R .', 'L_2 . . R_2 . . M .', 'R_3 . . . M . L .', 'M_2 . . L . R . .'],
    tumbling: ['L . M . R . . .', 'R . M . L . . .', 'M . L . M . R .'],
    jumps: ['M . . . LR . . .', 'L . R . LR . . .', 'LR . . . M . . .'],
    pyramid: ['M_3 . . . LR . . .', 'LR . . . M_3 . . .', 'L . R . M_2 . . .'],
    dance: ['L . R . L . R .', 'M . L . M . R .', 'L . L . R . R .', 'R . M . L . M .'],
    break: ['M . . . M . . .', 'L . . . R . . .'],
    finale: ['L . M . LR_4 . . .', 'R . M . L . R .'],
  },
  4: {
    opening: ['L . M . R M L .', 'L M R . R M L .', 'M . L R M . LR .', 'R . M L M . MR .'],
    stunts: ['M_2 . L . R_2 . M .', 'L_3 . . R . M_2 . .', 'LR_2 . . M . L R .', 'R_2 . M . L_1.5 . LR .'],
    tumbling: ['L M R . R M L .', 'L . L M R . R .', 'M L M R M . . .', 'L M R M L . LR .'],
    jumps: ['L . LR . R . LR .', 'M . MR . M . LM .', 'LR . M . LR . M .'],
    pyramid: ['LR_3 . . M . L . R', 'M_2 . LR . M_2 . LR .', 'L_2 . R_1.5 . LR_3 . . .'],
    dance: ['L L R . R R L .', 'L&R . M . R&L . M .', 'M . L&M R . M . LR', 'L . R . L&M R . .'],
    break: ['M . . . L . R .', 'L . M . R . . .'],
    finale: ['L M R M LR_4 . . .', 'L M R . R M L .'],
  },
  7: {
    opening: ['L M R M L M R LR', 'L&M R M&L R L&M R LR .', 'M L&R M . M R&L M LR', 'L&R L&R M . R&L R&L M LR'],
    stunts: ['LR_2 . M&L R&M L_2 . R&M LR', 'M_2 L R M_2 R L LR_2 .', 'L_2 . R&M L R_2 . M&L R', 'LR_3 . . M&R L&M R&L M LR'],
    tumbling: ['L M R M L M R LR', 'L&M R&M L&M R . R&M L&M R', 'L&M R . R&M L . L&M LR'],
    jumps: ['L&R M LR . R&L M LR .', 'LR . M&M LR . M&L R&M LR', 'M&L MR . M&R LM . LR LR'],
    pyramid: ['LR_3 . . M&L R&M LR_2 . M', 'M_2 L R LR_2 . M&L R&M LR', 'L_2 . R_1.5 . LR_3 . . .'],
    dance: ['L&L R&R M . L&R M&M R LR', 'L .&R M .&L R&M L&R M LR', 'M&L M&R M . L&R L&R MR .', 'R&M L&M R LR L&M R&M L LR'],
    break: ['M . L&R . M . R&L .', 'L . R . M&M . LR .'],
    finale: ['L&M R&M L&R M LR_4 . . .', 'L&M R&M L&M R LR . M .'],
  },
};

const LANE_OF = { L: 0, M: 1, R: 2 };

function parsePart(part, token) {
  if (part === '' || part === '.') return null;
  const m = /^([LMR]{1,2})(?:_(\d+(?:\.\d+)?))?$/.exec(part);
  if (!m) throw new Error('rhythm: bad pattern token "' + token + '"');
  const lanes = [...new Set(m[1].split('').map((c) => LANE_OF[c]))].sort((a, b) => a - b);
  if (lanes.length !== m[1].length) throw new Error('rhythm: a stunt needs two different lanes in "' + token + '"');
  return { lanes, len: m[2] ? Number(m[2]) : 0 };
}

export function parseEight(str) {
  const tokens = String(str).trim().split(/\s+/);
  if (tokens.length !== 8) throw new Error('rhythm: an eight-count needs 8 tokens, got ' + tokens.length + ' in "' + str + '"');
  const out = [];
  tokens.forEach((token, i) => {
    const parts = token.split('&');
    if (parts.length > 2) throw new Error('rhythm: one "&" per count in "' + token + '"');
    const on = parsePart(parts[0], token);
    if (on) out.push({ at: i, lanes: on.lanes, len: on.len });
    if (parts.length === 2) {
      const off = parsePart(parts[1], token);
      if (off) out.push({ at: i + 0.5, lanes: off.lanes, len: off.len });
    }
  });
  return out;
}

// ------------------------------------------------------------------ structure from the audio module

// Section names from the audio module become one of our kinds. Unknown names dance.
export function kindOf(name) {
  const s = String(name || '').toLowerCase();
  if (SECTION_LABELS[s]) return s;
  if (/intro|count|ready|warm/.test(s)) return 'intro';
  if (/outro|applause|bow\b|^end$|coda|tag\b/.test(s)) return 'outro';
  if (/final|finish|ending|grand|climax/.test(s)) return 'finale';
  if (/open/.test(s)) return 'opening';
  if (/stunt|lift|extension|elite|toss|basket/.test(s)) return 'stunts';
  if (/tumbl|flip|tuck|handspring|layout|round/.test(s)) return 'tumbling';
  if (/jump/.test(s)) return 'jumps';
  if (/pyramid/.test(s)) return 'pyramid';
  if (/break|bridge|rest|breath|calm|quiet/.test(s)) return 'break';
  return 'dance';
}

function cleanLabel(name, kind) {
  const s = typeof name === 'string' ? name.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length > 18 || s.toLowerCase() === kind) return SECTION_LABELS[kind];
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function nameOf(s) {
  for (const k of ['name', 'kind', 'id', 'type', 'section', 'label', 'part']) if (typeof s[k] === 'string' && s[k]) return s[k];
  return '';
}

// Length of a section in eights, from whichever field it has.
function lengthOf(s) {
  const e = num(s.eights) ?? num(s.eightCounts) ?? num(s.eight_counts) ?? num(s.eightcounts);
  if (e !== null) return e;
  const b = num(s.beats) ?? num(s.counts);
  if (b !== null) return b / 8;
  const bars = num(s.bars) ?? num(s.measures);
  if (bars !== null) return bars / 2;
  const sb = num(s.startBeat);
  const eb = num(s.endBeat);
  if (sb !== null && eb !== null) return (eb - sb) / 8;
  const se = num(s.startEight);
  const ee = num(s.endEight);
  if (se !== null && ee !== null) return ee - se;
  const len = num(s.length) ?? num(s.len);
  if (len !== null) return len >= 8 && len % 8 === 0 ? len / 8 : len; // "length: 16" reads as beats, "length: 2" as eights
  return null;
}

// Start of a section in eights, when it says.
function startOf(s) {
  const se = num(s.startEight) ?? num(s.eight) ?? num(s.fromEight);
  if (se !== null) return se;
  const sb = num(s.startBeat) ?? num(s.beat) ?? num(s.fromBeat);
  if (sb !== null) return sb / 8;
  const st = num(s.start) ?? num(s.at) ?? num(s.from);
  if (st !== null) return st >= 8 && st % 8 === 0 ? st / 8 : st;
  return null;
}

export function normalizeStructure(raw, depth = 0) {
  if (!raw || depth > 3) return null;
  if (!Array.isArray(raw)) {
    if (typeof raw !== 'object') return null;
    for (const k of ['routine', 'sections', 'parts', 'eights']) {
      if (raw[k]) {
        const got = normalizeStructure(raw[k], depth + 1);
        if (got) return got;
      }
    }
    // { intro: 1, stunts: 3, ... } in order
    const pairs = Object.entries(raw).filter(([, v]) => num(v) !== null);
    if (pairs.length) return normalizeStructure(pairs.map(([name, eights]) => ({ name, eights: num(eights) })), depth + 1);
    return null;
  }
  if (!raw.length) return null;

  // one name per eight-count: ['intro', 'stunts', 'stunts', ...]
  if (raw.every((x) => typeof x === 'string')) {
    const out = [];
    for (const name of raw) {
      const last = out[out.length - 1];
      if (last && last.name === name) last.eights++;
      else out.push({ name, eights: 1 });
    }
    return normalizeStructure(out, depth + 1);
  }

  const items = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    items.push({ name: nameOf(s), len: lengthOf(s), start: startOf(s) });
  }
  if (!items.length) return null;
  // positions without lengths: each runs to the next one's start
  const positioned = items.every((it) => it.start !== null);
  if (positioned) {
    items.sort((a, b) => a.start - b.start);
    items.forEach((it, i) => {
      if (it.len === null && i + 1 < items.length) it.len = items[i + 1].start - it.start;
    });
  }
  const out = [];
  let cursor = 0;
  let total = 0;
  for (const it of items) {
    if (positioned && it.start > cursor + 0.5) {
      // a gap between sections: a breather
      const gap = Math.round(it.start - cursor);
      if (gap >= 1) {
        out.push({ kind: 'break', name: 'break', label: SECTION_LABELS.break, eights: Math.min(32, gap) });
        total += gap;
      }
    }
    let eights = it.len === null ? 2 : Math.round(it.len);
    if (!(eights >= 1)) continue;
    eights = Math.min(32, eights);
    const kind = kindOf(it.name);
    out.push({ kind, name: it.name || kind, label: cleanLabel(it.name, kind), eights });
    cursor = (positioned ? it.start : cursor) + eights;
    total += eights;
    if (total >= 128) break; // seven minutes is plenty
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------------ the chart

function mirrorLanes(lanes) {
  return lanes.map((l) => 2 - l).sort((a, b) => a - b);
}

export function buildChart({ level = 1, structure = null, bpm = DEFAULT_BPM, seed = 11 } = {}) {
  const L = levelInfo(level);
  const pools = PATTERNS[L.id];
  bpm = num(bpm);
  if (!(bpm >= 60 && bpm <= 220)) bpm = DEFAULT_BPM;
  const spb = 60 / bpm;
  seed = (num(seed) ?? 11) | 0;

  let secs = normalizeStructure(structure);
  const noteKinds = (list) => list.some((s, i) => !QUIET.has(s.kind) && !(i === 0 && s.eights < 2));
  if (!secs || !noteKinds(secs)) secs = normalizeStructure(DEFAULT_STRUCTURE);

  // lay the sections out in beats, and decide which eights carry notes. The very first eight
  // never does: notes need a lead-in to scroll down, and it is the count-in.
  const sections = [];
  const eights = []; // { section, index (in section), startBeat, notes }
  let beat = 0;
  secs.forEach((s, si) => {
    const sec = {
      kind: s.kind, name: s.name, label: s.label || SECTION_LABELS[s.kind] || 'Dance', startBeat: beat, eights: s.eights,
      notes: false, motions: (MOTION_SETS[s.kind] || MOTION_SETS.dance).slice(),
    };
    sections.push(sec);
    for (let i = 0; i < s.eights; i++) {
      const has = !QUIET.has(s.kind) && !(si === 0 && i === 0) && !(eights.length === 0);
      eights.push({ section: si, index: i, startBeat: beat, notes: has });
      if (has) sec.notes = true;
      beat += 8;
    }
  });
  const totalBeats = beat;
  const withNotes = eights.filter((e) => e.notes);
  const lastEight = withNotes[withNotes.length - 1];

  const raw = [];
  let prevPattern = null;
  for (const e of withNotes) {
    const sec = sections[e.section];
    const pool = pools[sec.kind] || pools.dance;
    let pattern;
    let mirror = false;
    if (e === lastEight) {
      pattern = pools.finale[0];
    } else if (sec.kind === 'finale') {
      pattern = pools.finale[1];
      mirror = hash2(seed + e.section * 7, e.index * 13 + 5) < 0.5;
    } else if (e.index === 0 || pool.length === 1) {
      pattern = pool[0];
      mirror = e.section % 2 === 1;
    } else {
      const h = hash2(seed + e.section * 31, e.index * 17 + 3);
      let k = 1 + Math.floor(h * (pool.length - 1));
      if (pool[k] === prevPattern) k = 1 + (k % (pool.length - 1));
      pattern = pool[k];
      mirror = hash2(seed + e.section * 5, e.index * 11 + 1) < 0.5;
    }
    prevPattern = pattern;
    for (const n of parseEight(pattern)) {
      raw.push({ beat: e.startBeat + n.at, lanes: mirror ? mirrorLanes(n.lanes) : n.lanes.slice(), len: n.len, section: e.section });
    }
  }

  raw.sort((a, b) => a.beat - b.beat || a.lanes[0] - b.lanes[0]);
  resolveOverlaps(raw);

  const notes = raw.map((n, i) => {
    const sec = sections[n.section];
    const kind = n.lanes.length > 1 ? 'stunt' : n.len > 0 ? 'hold' : 'tap';
    const motion = n.lanes.length > 1 ? STUNT_MOTION[sec.kind] || 'liberty' : sec.motions[n.lanes[0]];
    return {
      id: i, beat: n.beat, t: n.beat * spb, len: n.len, end: (n.beat + n.len) * spb, lanes: n.lanes, kind, section: n.section, motion,
    };
  });

  const firstBeat = notes.length ? notes[0].beat : 8;
  const lastBeat = notes.reduce((m, n) => Math.max(m, n.beat + n.len), 0);
  const countInBeat = Math.max(0, Math.floor(firstBeat / 8) * 8 - 8);
  const stats = {
    notes: notes.length,
    taps: notes.filter((n) => n.kind === 'tap').length,
    holds: notes.filter((n) => n.len > 0).length,
    stunts: notes.filter((n) => n.kind === 'stunt').length,
  };
  return {
    level: L, bpm, spb, seed, sections, notes, countInBeat, firstBeat, lastBeat,
    endBeat: Math.min(totalBeats + 4, lastBeat + 2), totalBeats, stats,
  };
}

// A hold must let go before the next note on its lane: shorten it (at least a beat) or make it a tap.
export function resolveOverlaps(notes) {
  const GAP = 0.5;
  for (let i = 0; i < notes.length; i++) {
    const a = notes[i];
    if (!(a.len > 0)) continue;
    for (let j = i + 1; j < notes.length; j++) {
      const b = notes[j];
      if (b.beat >= a.beat + a.len + GAP) break;
      if (!b.lanes.some((l) => a.lanes.includes(l))) continue;
      const room = b.beat - a.beat - GAP;
      a.len = room >= 1 ? room : 0;
      break;
    }
  }
  return notes;
}
