#!/usr/bin/env node
/**
 * make-fixture.mjs
 *
 * Generates the PLACEHOLDER fixtures in scripts/fixtures/. They are shaped exactly like raw
 * ESPN responses, so `node scripts/sync-espn.mjs --sample` can push them through the same
 * normalize path the live sync uses.
 *
 *   node scripts/make-fixture.mjs           write the fixtures
 *   node scripts/make-fixture.mjs --check   regenerate in memory and compare with the files
 *
 * Everything is seeded and deterministic: the same code always writes the same bytes.
 *
 * WHAT IS REAL AND WHAT IS INVENTED
 *   Real (typed in from ESPN by the league owner on 2026-11-16, after 9 completed weeks):
 *     the 12 team ids, names and abbreviations, each team's playoff seed, wins, losses,
 *     points for, points against and current streak, and three owners' first names.
 *   Invented: everything else. The week-by-week schedule and scores (searched and fitted so
 *     they add up to the real records), week 10, every player, roster, lineup and draft
 *     pick, the NFL teams and kickoff times, and all of 2019-2025. Players and pro teams are
 *     made up on purpose so no fake stats are ever published about real athletes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { prettyJson } from './lib/io.mjs';
import { easternParts } from './lib/windows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(HERE, 'fixtures');

export const LEAGUE_ID = 70578866;
export const SEASON = 2026;
export const CURRENT_WEEK = 10;
const LEAGUE_NAME = "Dan's Real Cool League";
const REGULAR_WEEKS = 14;
const PLAYOFF_TEAMS = 6;
const SEED = 20261116;

// ---------------------------------------------------------------------------------------
// Real standings after 9 weeks (see the header). Do not "tidy" these numbers.
// ---------------------------------------------------------------------------------------

export const REAL_TEAMS = Object.freeze([
  { id: 1, name: 'The REAL Commish***', abbrev: 'BBQ', seed: 7, wins: 5, losses: 4, pf: 1112.7, pa: 1037.0, streak: ['WIN', 2], firstName: 'Dan' },
  { id: 2, name: "zach's Honorable Team", abbrev: 'ZHT', seed: 4, wins: 6, losses: 3, pf: 1135.4, pa: 1004.1, streak: ['WIN', 3], firstName: '' },
  { id: 3, name: 'Bad Boni', abbrev: 'DDT', seed: 8, wins: 4, losses: 5, pf: 1019.6, pa: 1114.2, streak: ['LOSS', 2], firstName: '' },
  { id: 4, name: 'ROME AND DIGGS IN MY FIELDS', abbrev: 'CBD', seed: 10, wins: 2, losses: 7, pf: 1033.0, pa: 1190.5, streak: ['LOSS', 7], firstName: '' },
  { id: 5, name: 'Tailored Gang', abbrev: 'TG', seed: 3, wins: 6, losses: 3, pf: 1140.5, pa: 1078.4, streak: ['WIN', 1], firstName: 'Shane' },
  { id: 6, name: 'Multiple Scoregasms', abbrev: 'MAGA', seed: 2, wins: 7, losses: 2, pf: 1194.4, pa: 972.6, streak: ['WIN', 2], firstName: '' },
  { id: 7, name: '1ST n Goal', abbrev: 'PMG', seed: 11, wins: 1, losses: 8, pf: 1003.3, pa: 1316.7, streak: ['LOSS', 7], firstName: '' },
  { id: 8, name: 'Packer Cracker', abbrev: 'Bye', seed: 12, wins: 1, losses: 8, pf: 906.8, pa: 1057.7, streak: ['LOSS', 3], firstName: '' },
  { id: 9, name: 'Love Machine', abbrev: 'JKE', seed: 5, wins: 6, losses: 3, pf: 1126.7, pa: 1026.5, streak: ['LOSS', 1], firstName: '' },
  { id: 10, name: 'Your Commishness', abbrev: '1', seed: 1, wins: 7, losses: 2, pf: 1344.5, pa: 1057.7, streak: ['WIN', 5], firstName: '' },
  { id: 11, name: '🔥Stafford_Pukas_Lounge🔥', abbrev: 'CCT', seed: 6, wins: 5, losses: 4, pf: 1153.7, pa: 1141.2, streak: ['LOSS', 1], firstName: '' },
  { id: 12, name: 'On C0k3r w Brown Nabers', abbrev: 'Haha', seed: 9, wins: 4, losses: 5, pf: 972.0, pa: 1146.1, streak: ['WIN', 1], firstName: 'Tim' },
]);
const TEAM_IDS = REAL_TEAMS.map((t) => t.id);
const WEEKS_PLAYED = 9;

/** Pairs kept apart in weeks 1-9 so they land in weeks 10 and 11 (see solveSchedule). */
const WEEK10_PAIRS = [[10, 6], [1, 11]]; // seed 1 v seed 2, and seed 7 v seed 6 across the playoff line
const WEEK11_PAIRS = [[1, 10]];

// Invented roster storylines for the world to react to.
const IR_COUNTS = { 4: 2, 6: 1 };
const EMPTY_FLEX_TEAM = 8;
const OUT_STARTER_TEAM = 7;

// ---------------------------------------------------------------------------------------
// Invented history, 2019-2025 (same 12 managers, keyed by team id)
// ---------------------------------------------------------------------------------------

const HISTORY_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const CHAMPIONS = { 2019: 5, 2020: 1, 2021: 9, 2022: 6, 2023: 1, 2024: 2, 2025: 11 }; // team 1 twice, team 10 never
const LAST_PLACES = { 2019: 8, 2020: 12, 2021: 4, 2022: 8, 2023: 7, 2024: 8, 2025: 3 }; // team 8 three times
const RUNNERS_UP = { 2022: 10, 2025: 10 };
/** Team 10 almost never beats team 1: these are its only wins, as [year, which meeting that year]. */
const RIVAL = { loser: 10, winner: 1, loserWins: [[2020, 1], [2023, 2]], singleMeetingYears: [2021] };
const RECORD_HIGH = { year: 2022, week: 7, teamId: 6, points: 211.38 };
const RECORD_LOW = { year: 2024, week: 11, teamId: 8, points: 44.92 };
const SKILL = { 1: 5, 2: 4, 3: 0, 4: -3, 5: 4, 6: 6, 7: -4, 8: -7, 9: 3, 10: 7, 11: 3, 12: -2 };
/** Invented older team names, as [first year used, name]. The newest entry is the real 2026 name. */
const NAME_HISTORY = {
  1: [[2019, 'The Commish'], [2021, 'The REAL Commish'], [2024, 'The REAL Commish***']],
  2: [[2019, "zach's Honorable Team"]],
  3: [[2019, 'Good Boni'], [2022, 'Bad Boni']],
  4: [[2019, 'DIGGS IN THE DIRT'], [2021, 'FIELDS OF DREAMS'], [2024, 'ROME AND DIGGS IN MY FIELDS']],
  5: [[2019, 'Tailored Gang']],
  6: [[2019, 'Multiple Scoregasms']],
  7: [[2019, '4th n Long'], [2023, '1ST n Goal']],
  8: [[2019, 'Packer Backer'], [2022, 'Packer Cracker']],
  9: [[2019, 'Love Machine']],
  10: [[2019, 'Deputy Commish'], [2023, 'Your Commishness']],
  11: [[2019, 'The Lounge'], [2021, 'Stafford_Lounge'], [2023, '🔥Stafford_Pukas_Lounge🔥']],
  12: [[2019, 'Brown Out'], [2024, 'On C0k3r w Brown Nabers']],
};

// ---------------------------------------------------------------------------------------
// Invented NFL: 32 made-up pro teams (ESPN-style ids 1-30, 33, 34) and made-up player names
// ---------------------------------------------------------------------------------------

const PRO_TEAMS = [
  [1, 'POR', 'Portland', 'Lumberjacks'], [2, 'OMA', 'Omaha', 'Stampede'], [3, 'TUL', 'Tulsa', 'Twisters'],
  [4, 'BOI', 'Boise', 'Sawtooths'], [5, 'MEM', 'Memphis', 'Kingfishers'], [6, 'SAC', 'Sacramento', 'Prospectors'],
  [7, 'HON', 'Honolulu', 'Breakers'], [8, 'ANC', 'Anchorage', 'Huskies'], [9, 'BIR', 'Birmingham', 'Ironworks'],
  [10, 'RAL', 'Raleigh', 'Oaks'], [11, 'HAR', 'Hartford', 'Lanterns'], [12, 'ELP', 'El Paso', 'Scorpions'],
  [13, 'FRE', 'Fresno', 'Foxes'], [14, 'LOU', 'Louisville', 'Thoroughbreds'], [15, 'ABQ', 'Albuquerque', 'Roadrunners'],
  [16, 'SAT', 'San Antonio', 'Marshals'], [17, 'OKC', 'Oklahoma City', 'Outlaws'], [18, 'SLC', 'Salt Lake', 'Summit'],
  [19, 'AUS', 'Austin', 'Armadillos'], [20, 'CLB', 'Columbus', 'Comets'], [21, 'MKE', 'Milwaukee', 'Mallards'],
  [22, 'RIC', 'Richmond', 'Rapids'], [23, 'DSM', 'Des Moines', 'Harvesters'], [24, 'TUC', 'Tucson', 'Sidewinders'],
  [25, 'ORL', 'Orlando', 'Orbit'], [26, 'SDG', 'San Diego', 'Surf'], [27, 'STL', 'St. Louis', 'Arches'],
  [28, 'VAB', 'Virginia Beach', 'Tides'], [29, 'SPO', 'Spokane', 'Sasquatch'], [30, 'LRK', 'Little Rock', 'Diamonds'],
  [33, 'PVD', 'Providence', 'Lighthouses'], [34, 'CHS', 'Charleston', 'Herons'],
].map(([id, abbrev, location, name]) => ({ id, abbrev, location, name }));

const FIRST_NAMES = [
  'Darius', 'Malik', 'Trevon', 'Cade', 'Brock', 'Tyrell', 'Dante', 'Marcus', 'Xavier', 'DeShawn', 'Kellen', 'Rashad',
  'Corbin', 'Easton', 'Jaxon', 'Kofi', 'Luca', 'Micah', 'Nico', 'Omari', 'Pierce', 'Quentin', 'Reggie', 'Silas',
  'Tobias', 'Uriah', 'Vaughn', 'Wes', 'Zeke', 'Andre', 'Beau', 'Colt', 'Emmett', 'Flynn', 'Gideon', 'Hakeem',
  'Isaiah', 'Jericho', 'Keon', 'Lamont', 'Mekhi', 'Nash', 'Osiris', 'Jamal', 'Devonte', 'Chase', 'Grayson', 'Holden',
  'Jett', 'Knox', 'Leon', 'Milo', 'Rocco', 'Thad', 'Wyatt', 'Zion', 'Amari', 'Bryce', 'Cyrus', 'Dax', 'Elias', 'Roman',
];
const LAST_NAMES = [
  'Quimby', 'Vandersloot', 'Brannigan', 'Halloway', 'Pemberton', 'Okonjo', 'Tillerman', 'Castellane', 'Whitcombe',
  'Ashgrove', 'Fontanelle', 'Kowalczyk', 'Delacroix', 'Montrose', 'Babatunde', 'Lindqvist', 'Marlowe', 'Bellweather',
  'Wojcik', 'Abernethy', 'Stanhope', 'Kilbride', 'Rasmusson', 'Oyelowo', 'Featherstone', 'Grabowski', 'Lockridge',
  'Zielinski', 'Ravenscroft', 'Dunmore', 'Eastlake', 'Fairweather', 'Hollister', 'Jorgensen', 'Kensington', 'Lachance',
  'Ostrowski', 'Penhallow', 'Quarrington', 'Rothwell', 'Silverthorne', 'Templeton', 'Underhill', 'Winterbourne',
  'Yarborough', 'Zamorano', 'Blackwood', 'Dragomir', 'Ellingsworth', 'Farnsworth', 'Greenhalgh', 'Ingersoll',
  'Jablonski', 'Kettering', 'Longfellow', 'Macalister', 'Nettleton', 'Oakhurst', 'Pickering', 'Ridgeway',
  'Stonebridge', 'Thackeray', 'Umberfield', 'Wetherby', 'Adeyemi-Clark', 'Van der Berg', 'Okpara', 'Szymanski',
];

const POS_ID = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DST: 16 };
const SLOT_ID = { QB: 0, RB: 2, WR: 4, TE: 6, DST: 16, K: 17, BE: 20, IR: 21, FLEX: 23 };
const ELIGIBLE = {
  QB: [0, 7, 20, 21], RB: [2, 3, 23, 7, 20, 21], WR: [4, 3, 5, 23, 7, 20, 21], TE: [6, 5, 23, 7, 20, 21], K: [17, 20, 21], DST: [16, 20, 21],
};
const BASELINE = { QB: 19.5, RB: 14.5, WR: 14.5, TE: 10, K: 8.5, DST: 7.5 };
const STARTER_SPEC = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DST', 'K'];
const BENCH_SPEC = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE'];
const LINEUP_SLOT_COUNTS = {
  0: 1, 1: 0, 2: 2, 3: 0, 4: 2, 5: 0, 6: 1, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0, 16: 1, 17: 1, 18: 0, 19: 0, 20: 7, 21: 2, 22: 0, 23: 1, 24: 0,
};

// ---------------------------------------------------------------------------------------
// Seeded random numbers
// ---------------------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    gauss: () => {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

const cents = (v) => Math.round(v * 100);
const fromCents = (c) => Math.round(c) / 100;
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function guid(rng) {
  const hex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[rng.int(0, 15)]).join('');
  return `{${hex(8)}-${hex(4)}-4${hex(3)}-${rng.pick(['8', '9', 'A', 'B'])}${hex(3)}-${hex(12)}}`;
}

// ---------------------------------------------------------------------------------------
// 2026, step 1: who won each week (forced almost entirely by the real records and streaks)
// ---------------------------------------------------------------------------------------

/** For each team, the weeks its record and streak pin down, and how many wins are left to place. */
function knownResults(team) {
  const [type, length] = team.streak;
  const mark = type === 'WIN' ? 'W' : 'L';
  const pattern = Array(WEEKS_PLAYED).fill(null);
  for (let w = WEEKS_PLAYED - length; w < WEEKS_PLAYED; w++) pattern[w] = mark;
  if (WEEKS_PLAYED - length - 1 >= 0) pattern[WEEKS_PLAYED - length - 1] = mark === 'W' ? 'L' : 'W'; // the streak started here
  const open = pattern.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const winsLeft = team.wins - pattern.filter((v) => v === 'W').length;
  return { pattern, open, winsLeft };
}

function combinations(list, k) {
  if (k === 0) return [[]];
  if (k > list.length) return [];
  const [head, ...rest] = list;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/** A full W/L grid: grid[teamId][week 0..8], six winners every week. */
function solveResults(rng) {
  const info = new Map(REAL_TEAMS.map((t) => [t.id, knownResults(t)]));
  const order = rng.shuffle(TEAM_IDS).sort((a, b) => info.get(a).open.length - info.get(b).open.length);
  const winCount = Array(WEEKS_PLAYED).fill(0);
  const lossCount = Array(WEEKS_PLAYED).fill(0);
  const grid = {};
  const half = TEAM_IDS.length / 2;

  const place = (index) => {
    if (index === order.length) return winCount.every((c) => c === half);
    const id = order[index];
    const { pattern, open, winsLeft } = info.get(id);
    for (const winWeeks of rng.shuffle(combinations(open, winsLeft))) {
      const row = pattern.map((v, w) => v ?? (winWeeks.includes(w) ? 'W' : 'L'));
      row.forEach((v, w) => (v === 'W' ? winCount[w]++ : lossCount[w]++));
      if (winCount.every((c) => c <= half) && lossCount.every((c) => c <= half)) {
        grid[id] = row;
        if (place(index + 1)) return true;
      }
      row.forEach((v, w) => (v === 'W' ? winCount[w]-- : lossCount[w]--));
    }
    return false;
  };
  return place(0) ? grid : null;
}

// ---------------------------------------------------------------------------------------
// 2026, step 2: who played whom (a proper round robin: 11 weeks, everyone meets once)
// ---------------------------------------------------------------------------------------

/**
 * Pair each week's six winners with its six losers so that nobody meets twice in weeks 1-9,
 * the reserved pairs stay unplayed, and the two leftover rounds complete the round robin.
 * Returns { weeks: [[{ winner, loser }]], week10: [[a, b]], week11: [[a, b]] } or null.
 */
function solveSchedule(grid, rng) {
  const reserved = new Set([...WEEK10_PAIRS, ...WEEK11_PAIRS].map(([a, b]) => pairKey(a, b)));
  const used = new Set();
  const weeks = Array(WEEKS_PLAYED).fill(null);
  let budget = 40000;

  const fillWeek = (w) => {
    if (w < 0) return true;
    const winners = rng.shuffle(TEAM_IDS.filter((id) => grid[id][w] === 'W'));
    const losers = TEAM_IDS.filter((id) => grid[id][w] === 'L');
    const taken = new Set();
    const games = [];
    const match = (i) => {
      if (--budget < 0) return false;
      if (i === winners.length) {
        weeks[w] = games.map((g) => ({ ...g }));
        return fillWeek(w - 1);
      }
      for (const loser of rng.shuffle(losers)) {
        const key = pairKey(winners[i], loser);
        if (taken.has(loser) || used.has(key) || reserved.has(key)) continue;
        taken.add(loser);
        used.add(key);
        games.push({ winner: winners[i], loser });
        if (match(i + 1)) return true;
        games.pop();
        used.delete(key);
        taken.delete(loser);
      }
      return false;
    };
    return match(0);
  };
  if (!fillWeek(WEEKS_PLAYED - 1)) return null;

  // Whoever has not met yet forms a set of loops. Even loops split into two more full rounds.
  const unplayed = new Map(TEAM_IDS.map((id) => [id, TEAM_IDS.filter((o) => o !== id && !used.has(pairKey(id, o)))]));
  if ([...unplayed.values()].some((list) => list.length !== 2)) return null;
  const want10 = new Set(WEEK10_PAIRS.map(([a, b]) => pairKey(a, b)));
  const want11 = new Set(WEEK11_PAIRS.map(([a, b]) => pairKey(a, b)));
  const week10 = [];
  const week11 = [];
  const seen = new Set();
  for (const start of TEAM_IDS) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = null;
    let at = start;
    do {
      loop.push(at);
      seen.add(at);
      const [first, second] = unplayed.get(at);
      const step = first !== prev ? first : second;
      prev = at;
      at = step;
    } while (at !== start && loop.length <= TEAM_IDS.length);
    if (loop.length % 2 !== 0 || loop.length < 4) return null;
    const edges = loop.map((id, i) => [id, loop[(i + 1) % loop.length]]);
    const evens = edges.filter((_, i) => i % 2 === 0);
    const odds = edges.filter((_, i) => i % 2 === 1);
    const has = (list, wanted) => list.some(([a, b]) => wanted.has(pairKey(a, b)));
    let first = evens;
    let second = odds;
    if (has(odds, want10) || has(evens, want11)) [first, second] = [odds, evens];
    else if (!has(evens, want10) && !has(odds, want11) && rng.chance(0.5)) [first, second] = [odds, evens];
    if (has(first, want11) || has(second, want10)) return null;
    week10.push(...first);
    week11.push(...second);
  }
  if (week10.length !== 6 || week11.length !== 6) return null;
  const inWeek = (list, [a, b]) => list.some(([x, y]) => pairKey(x, y) === pairKey(a, b));
  if (!WEEK10_PAIRS.every((p) => inWeek(week10, p)) || !WEEK11_PAIRS.every((p) => inWeek(week11, p))) return null;
  return { weeks, week10, week11 };
}

// ---------------------------------------------------------------------------------------
// 2026, step 3: scores that add up to the real points for / against
// ---------------------------------------------------------------------------------------

/**
 * Target totals in cents. Points for are the real numbers exactly. The published table is
 * rounded to one decimal and its points-for total is 0.1 below its points-against total, so
 * that tenth is spread over points against, one cent per team.
 */
function scoreTargets() {
  const pf = new Map(REAL_TEAMS.map((t) => [t.id, cents(t.pf)]));
  const pa = new Map(REAL_TEAMS.map((t) => [t.id, cents(t.pa)]));
  let gap = [...pf.values()].reduce((a, b) => a + b, 0) - [...pa.values()].reduce((a, b) => a + b, 0);
  for (let i = 0; gap !== 0; i++) {
    const id = TEAM_IDS[i % TEAM_IDS.length];
    pa.set(id, pa.get(id) + Math.sign(gap));
    gap -= Math.sign(gap);
  }
  return { pf, pa };
}

/**
 * Find a score for every team in every game of weeks 1-9 such that
 *   - each team's scores sum to its real points for,
 *   - the scores against each team sum to its real points against (within a cent),
 *   - every winner outscores its loser, scores stay between 60 and 190,
 *   - week 9 has one blowout (50+) and one nail-biter (under 2).
 * Method: start from random realistic scores, then repeatedly project onto each constraint
 * (row totals, column totals, bounds, margins) until all hold, round to cents, and push the
 * leftover cents along a spanning tree of the games so the totals are exact.
 */
function fitScores(schedule, rng) {
  const { pf, pa } = scoreTargets();
  const LO = 66;
  const HI = 184;
  const week9 = schedule.weeks[WEEKS_PLAYED - 1];
  const blowout = week9.find((g) => g.winner === 10) ?? week9[0];
  const closeOrder = [9, 11, 3].map((id) => week9.find((g) => g.loser === id)).filter((g) => g && g !== blowout);
  const nailBiter = closeOrder[0] ?? week9.find((g) => g !== blowout);

  const games = [];
  schedule.weeks.forEach((week, w) => {
    for (const g of week) {
      const base = (id) => pf.get(id) / 100 / WEEKS_PLAYED;
      let win = base(g.winner) + 13 * rng.gauss() + 6;
      let lose = base(g.loser) + 13 * rng.gauss() - 6;
      if (win - lose < 3) {
        const mid = (win + lose) / 2;
        win = mid + rng.float(2, 9);
        lose = mid - rng.float(2, 9);
      }
      const rule = g === blowout ? { min: 52.5, max: 80 } : g === nailBiter ? { min: 0.6, max: 1.6 } : { min: 1.2, max: 75 };
      games.push({ week: w + 1, winner: g.winner, loser: g.loser, win, lose, ...rule });
    }
  });

  const mine = new Map(TEAM_IDS.map((id) => [id, []])); // [game, 'win' | 'lose'] where the team's own score lives
  for (const g of games) {
    mine.get(g.winner).push([g, 'win']);
    mine.get(g.loser).push([g, 'lose']);
  }
  const other = (side) => (side === 'win' ? 'lose' : 'win');

  let settled = false;
  for (let sweep = 0; sweep < 40000 && !settled; sweep++) {
    let worst = 0;
    for (const id of TEAM_IDS) {
      const list = mine.get(id);
      const diff = (pf.get(id) / 100 - list.reduce((s, [g, side]) => s + g[side], 0)) / list.length;
      worst = Math.max(worst, Math.abs(diff));
      for (const [g, side] of list) g[side] += diff;
    }
    for (const id of TEAM_IDS) {
      const list = mine.get(id);
      const diff = (pa.get(id) / 100 - list.reduce((s, [g, side]) => s + g[other(side)], 0)) / list.length;
      worst = Math.max(worst, Math.abs(diff));
      for (const [g, side] of list) g[other(side)] += diff;
    }
    for (const g of games) {
      for (const side of ['win', 'lose']) {
        if (g[side] < LO) [worst, g[side]] = [Math.max(worst, LO - g[side]), LO];
        if (g[side] > HI) [worst, g[side]] = [Math.max(worst, g[side] - HI), HI];
      }
      const margin = g.win - g.lose;
      if (margin < g.min) {
        worst = Math.max(worst, g.min - margin);
        g.win += (g.min - margin) / 2;
        g.lose -= (g.min - margin) / 2;
      } else if (margin > g.max) {
        worst = Math.max(worst, margin - g.max);
        g.win -= (margin - g.max) / 2;
        g.lose += (margin - g.max) / 2;
      }
    }
    settled = worst < 1e-7;
  }
  if (!settled) return null;

  // Round to cents, then make the totals exact.
  for (const g of games) {
    g.win = cents(g.win);
    g.lose = cents(g.lose);
  }
  const rowNode = (id) => `r${id}`;
  const colNode = (id) => `c${id}`;
  const residual = new Map();
  for (const id of TEAM_IDS) {
    const list = mine.get(id);
    residual.set(rowNode(id), pf.get(id) - list.reduce((s, [g, side]) => s + g[side], 0));
    residual.set(colNode(id), pa.get(id) - list.reduce((s, [g, side]) => s + g[other(side)], 0));
  }
  // Each score is an edge between "row of the scorer" and "column of the opponent".
  const edges = new Map([...residual.keys()].map((n) => [n, []]));
  for (const g of games) {
    for (const [side, scorer, opponent] of [['win', g.winner, g.loser], ['lose', g.loser, g.winner]]) {
      edges.get(rowNode(scorer)).push({ to: colNode(opponent), game: g, side });
      edges.get(colNode(opponent)).push({ to: rowNode(scorer), game: g, side });
    }
  }
  const root = rowNode(TEAM_IDS[0]);
  const parent = new Map([[root, null]]);
  const visitOrder = [root];
  for (let i = 0; i < visitOrder.length; i++) {
    for (const e of edges.get(visitOrder[i])) {
      if (parent.has(e.to)) continue;
      parent.set(e.to, { node: visitOrder[i], game: e.game, side: e.side });
      visitOrder.push(e.to);
    }
  }
  if (visitOrder.length !== residual.size) return null;
  for (let i = visitOrder.length - 1; i > 0; i--) {
    const node = visitOrder[i];
    const link = parent.get(node);
    const delta = residual.get(node);
    link.game[link.side] += delta;
    residual.set(node, 0);
    residual.set(link.node, residual.get(link.node) - delta);
  }
  if (residual.get(root) !== 0) return null;

  // Final checks on the rounded numbers.
  for (const g of games) {
    const margin = g.win - g.lose;
    if (g.win > 19000 || g.lose < 6000 || margin < 30) return null;
    if (g === blowout && margin < 5000) return null;
    if (g === nailBiter && margin >= 200) return null;
  }
  for (const id of TEAM_IDS) {
    const list = mine.get(id);
    if (list.reduce((s, [g, side]) => s + g[side], 0) !== pf.get(id)) return null;
    if (list.reduce((s, [g, side]) => s + g[other(side)], 0) !== pa.get(id)) return null;
  }
  return { games, blowout: games.find((g) => g.week === 9 && g.winner === blowout.winner), nailBiter: games.find((g) => g.week === 9 && g.winner === nailBiter.winner) };
}

/** Standings after a given week, best first: wins, then points for. */
function standingsAfter(games, week) {
  const rows = new Map(TEAM_IDS.map((id) => [id, { id, wins: 0, losses: 0, pf: 0, pa: 0, results: [] }]));
  for (const g of [...games].sort((a, b) => a.week - b.week)) {
    if (g.week > week) continue;
    const w = rows.get(g.winner);
    const l = rows.get(g.loser);
    w.wins++;
    l.losses++;
    w.pf += g.win;
    w.pa += g.lose;
    l.pf += g.lose;
    l.pa += g.win;
    w.results.push('W');
    l.results.push('L');
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

function tierOf(rank, teams = 12, playoff = PLAYOFF_TEAMS) {
  if (rank === 1) return 'hill';
  if (rank === teams) return 'dump';
  const bubbleTop = Math.max(2, playoff - 1);
  const bubbleBottom = Math.min(teams - 1, playoff + 2);
  if (rank < bubbleTop) return 'heights';
  if (rank <= bubbleBottom) return 'bubble';
  return 'park';
}

function currentStreak(results) {
  const last = results[results.length - 1];
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return [last === 'W' ? 'WIN' : 'LOSS', n];
}

/** Steps 1 to 3 together: try seeds until everything fits, then prove it matches the real table. */
function buildSeason2026() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = makeRng(SEED + attempt * 7919);
    const grid = solveResults(rng);
    if (!grid) continue;
    const schedule = solveSchedule(grid, rng);
    if (!schedule) continue;
    const fit = fitScores(schedule, rng);
    if (!fit) continue;

    const table = standingsAfter(fit.games, WEEKS_PLAYED);
    table.forEach((row, i) => {
      const real = REAL_TEAMS.find((t) => t.id === row.id);
      const [type, length] = currentStreak(row.results);
      const ok = real.seed === i + 1 && real.wins === row.wins && real.losses === row.losses &&
        real.streak[0] === type && real.streak[1] === length &&
        Math.abs(row.pf - cents(real.pf)) === 0 && Math.abs(row.pa - cents(real.pa)) <= 1;
      if (!ok) throw new Error(`Generated season does not match the real table for team ${row.id}`);
    });
    const before = standingsAfter(fit.games, WEEKS_PLAYED - 1);
    const tierMoves = table
      .map((row, i) => ({ id: row.id, from: tierOf(before.findIndex((r) => r.id === row.id) + 1), to: tierOf(i + 1) }))
      .filter((m) => m.from !== m.to);
    const maxPaError = Math.max(...table.map((row) => Math.abs(row.pa - cents(REAL_TEAMS.find((t) => t.id === row.id).pa)))) / 100;
    return { rng, schedule, games: fit.games, blowout: fit.blowout, nailBiter: fit.nailBiter, tierMoves, maxPaError, attempt };
  }
  throw new Error('Could not build a 2026 season that matches the real standings');
}

// ---------------------------------------------------------------------------------------
// Invented NFL calendar
// ---------------------------------------------------------------------------------------

/** UTC milliseconds for a US Eastern wall-clock time (daylight saving handled). */
function easternToUtc(year, month, day, hour, minute) {
  for (const offset of [4, 5]) {
    const ms = Date.UTC(year, month - 1, day, hour + offset, minute);
    const p = easternParts(new Date(ms));
    if (p.hour === hour && p.day === day && p.month === month) return ms;
  }
  throw new Error('No such Eastern time');
}

function buildProSchedule(rng) {
  const ids = PRO_TEAMS.map((t) => t.id);
  // Byes: weeks 5-14, in pairs, every team exactly once.
  const byePairsPerWeek = { 5: 1, 6: 2, 7: 2, 8: 2, 9: 1, 10: 2, 11: 2, 12: 1, 13: 1, 14: 2 };
  const pool = rng.shuffle(ids);
  const byeWeek = new Map();
  for (const [week, pairs] of Object.entries(byePairsPerWeek)) {
    for (let i = 0; i < pairs * 2; i++) byeWeek.set(pool.pop(), Number(week));
  }

  const thursdayOf = (week) => new Date(Date.UTC(2026, 8, 10 + 7 * (week - 1), 12)); // week 1: Thursday Sept 10 2026
  const at = (week, dayOffset, hour, minute) => {
    const d = new Date(thursdayOf(week).getTime() + dayOffset * 86400000);
    return easternToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute);
  };
  const THU = 0, SAT = 2, SUN = 3, MON = 4;

  const gamesByTeam = new Map(ids.map((id) => [id, {}]));
  const weeks = [];
  let gameId = 401900001;
  for (let week = 1; week <= 18; week++) {
    const playing = rng.shuffle(ids.filter((id) => byeWeek.get(id) !== week));
    const count = playing.length / 2;
    // Special slots first, the early Sunday window takes whatever is left.
    let slots;
    if (week === 12) slots = [[THU, 12, 30], [THU, 16, 30], [THU, 20, 20], [MON, 20, 15], [SUN, 20, 20]]; // Thanksgiving, Nov 26
    else if (week === 18) slots = [[SAT, 16, 30], [SAT, 20, 15], [SUN, 20, 20]];
    else slots = [[THU, 20, 15], [MON, 20, 15], [SUN, 20, 20]];
    slots.push([SUN, 16, 25], [SUN, 16, 25], [SUN, 16, 25], [SUN, 16, 5], [SUN, 16, 5]);
    while (slots.length < count) slots.push([SUN, 13, 0]);

    const games = [];
    for (let g = 0; g < count; g++) {
      const [day, hour, minute] = slots[g];
      const game = {
        id: gameId++, awayProTeamId: playing[g * 2], homeProTeamId: playing[g * 2 + 1], date: at(week, day, hour, minute),
        scoringPeriodId: week, startTimeTBD: false, validForLocking: true, monday: day === MON,
      };
      games.push(game);
    }
    weeks.push(games);
  }

  // Week 10's Monday game must not involve a team that was on bye in week 9 (lineups reuse those players).
  const week10 = weeks[9];
  const monday = week10.find((g) => g.monday);
  const swap = week10.find((g) => !g.monday && g.date < monday.date && [g.awayProTeamId, g.homeProTeamId].every((id) => byeWeek.get(id) !== 9));
  if ([monday.awayProTeamId, monday.homeProTeamId].some((id) => byeWeek.get(id) === 9) && swap) {
    for (const k of ['awayProTeamId', 'homeProTeamId']) [monday[k], swap[k]] = [swap[k], monday[k]];
  }

  const now = Date.UTC(2026, 10, 16, 15); // the fixture's "now": Monday Nov 16 2026, before the night game
  for (const games of weeks) {
    for (const game of games) {
      const { monday: _monday, ...rest } = game;
      const entry = { ...rest, statsOfficial: game.date + 4 * 3600000 < now };
      gamesByTeam.get(game.awayProTeamId)[String(game.scoringPeriodId)] = [entry];
      gamesByTeam.get(game.homeProTeamId)[String(game.scoringPeriodId)] = [entry];
    }
  }

  const raw = {
    abbrev: 'FFL',
    active: true,
    currentScoringPeriod: { id: CURRENT_WEEK },
    id: 1,
    name: 'Fantasy Football',
    settings: {
      proTeams: [
        { abbrev: 'FA', byeWeek: 0, id: 0, location: '', name: 'FA' },
        ...PRO_TEAMS.map((t) => ({ ...t, byeWeek: byeWeek.get(t.id), proGamesByScoringPeriod: gamesByTeam.get(t.id) })),
      ],
    },
  };
  return { raw, byeWeek, mondayTeams: [monday.awayProTeamId, monday.homeProTeamId] };
}

// ---------------------------------------------------------------------------------------
// Invented players, rosters and lineups
// ---------------------------------------------------------------------------------------

function buildRosters(rng, pro, season) {
  const usedNames = new Set();
  let nextPlayerId = 4410001;
  const newPlayer = (pos, quality) => {
    let firstName;
    let lastName;
    do {
      firstName = rng.pick(FIRST_NAMES);
      lastName = rng.pick(LAST_NAMES);
    } while (usedNames.has(`${firstName} ${lastName}`));
    usedNames.add(`${firstName} ${lastName}`);
    nextPlayerId += rng.int(3, 180);
    return { id: nextPlayerId, firstName, lastName, fullName: `${firstName} ${lastName}`, pos, quality, injuryStatus: 'ACTIVE', injured: false };
  };
  const usedDefenses = new Set();
  const newDefense = (candidates, quality) => {
    const proTeam = rng.pick(candidates.filter((id) => !usedDefenses.has(id)));
    usedDefenses.add(proTeam);
    const team = PRO_TEAMS.find((t) => t.id === proTeam);
    return { id: -16000 - proTeam, firstName: team.name, lastName: 'D/ST', fullName: `${team.name} D/ST`, pos: 'DST', quality, proTeamId: proTeam, isDefense: true };
  };

  const proIds = PRO_TEAMS.map((t) => t.id);
  const [mondayA, mondayB] = pro.mondayTeams;
  // Starters play on teams with a game in weeks 9 and 10 that is already over.
  const safe = proIds.filter((id) => ![9, 10].includes(pro.byeWeek.get(id)) && id !== mondayA && id !== mondayB);

  // How many of each team's starters play in the pending Monday night game.
  const week10Pairs = season.schedule.week10;
  const mondayCount = new Map(TEAM_IDS.map((id) => [id, 0]));
  mondayCount.set(10, 1).set(6, 2).set(1, 1).set(11, 1);
  const rest = rng.shuffle([0, 0, 0, 1, 1, 2, 0, 1]);
  TEAM_IDS.filter((id) => ![10, 6, 1, 11].includes(id)).forEach((id, i) => mondayCount.set(id, rest[i]));

  const nailBiterLoser = season.nailBiter.loser;
  const teams = new Map();
  for (const team of REAL_TEAMS) {
    const strength = (team.pf / WEEKS_PLAYED - 121.7) / 121.7; // better teams get slightly better players
    const players = [];
    const flexPos = rng.pick(['WR', 'WR', 'RB', 'RB', 'TE']);
    STARTER_SPEC.forEach((spec) => {
      const pos = spec === 'FLEX' ? flexPos : spec;
      const quality = rng.float(0.9, 1.25) * (1 + strength * 0.6);
      const p = pos === 'DST' ? newDefense(safe, quality) : newPlayer(pos, quality);
      p.proTeamId ??= rng.pick(safe);
      p.slot10 = spec === 'FLEX' ? SLOT_ID.FLEX : SLOT_ID[pos];
      p.slot9 = p.slot10;
      p.acquisition = 'DRAFT';
      players.push(p);
    });
    BENCH_SPEC.forEach((pos) => {
      const p = newPlayer(pos, rng.float(0.45, 0.82));
      p.proTeamId = rng.pick(proIds);
      p.slot10 = SLOT_ID.BE;
      p.slot9 = SLOT_ID.BE;
      p.acquisition = 'DRAFT';
      if (rng.chance(0.12)) [p.injuryStatus, p.injured] = ['QUESTIONABLE', false];
      players.push(p);
    });

    // Monday night starters (not the defense: keeps the two Monday defenses simple).
    const candidates = rng.shuffle(players.filter((p) => p.slot10 !== SLOT_ID.BE && !p.isDefense && p.pos !== 'K'));
    candidates.slice(0, mondayCount.get(team.id)).forEach((p, i) => {
      p.proTeamId = i % 2 === 0 ? mondayA : mondayB;
      p.monday = true;
    });

    // Storylines.
    if (team.id === EMPTY_FLEX_TEAM) {
      // Last week the FLEX was filled; this week that player was dropped and nobody was added.
      const flex = players.find((p) => p.slot10 === SLOT_ID.FLEX);
      flex.droppedAfterWeek9 = true;
      flex.monday = false;
      if (flex.proTeamId === mondayA || flex.proTeamId === mondayB) flex.proTeamId = rng.pick(safe);
    }
    if (team.id === OUT_STARTER_TEAM) {
      const rb = players.find((p) => p.slot10 === SLOT_ID.RB && !p.monday) ?? players.find((p) => p.slot10 === SLOT_ID.WR && !p.monday);
      [rb.injuryStatus, rb.injured, rb.outThisWeek] = ['OUT', true, true];
    }
    for (let i = 0; i < (IR_COUNTS[team.id] ?? 0); i++) {
      const p = newPlayer(i === 0 ? 'RB' : 'WR', rng.float(0.9, 1.15));
      p.proTeamId = rng.pick(proIds);
      [p.slot10, p.slot9, p.injuryStatus, p.injured, p.onIr, p.acquisition] = [SLOT_ID.IR, SLOT_ID.IR, 'INJURY_RESERVE', true, true, 'DRAFT'];
      players.push(p);
    }

    // Projections and week 9 / week 10 points.
    for (const p of players) {
      const proj = (BASELINE[p.pos] * p.quality * rng.float(0.92, 1.08));
      p.proj10 = p.onIr || p.outThisWeek || pro.byeWeek.get(p.proTeamId) === 10 ? 0 : round2(proj);
      p.proj9 = p.onIr || pro.byeWeek.get(p.proTeamId) === 9 ? 0 : round2(proj * rng.float(0.9, 1.1));
    }
    teams.set(team.id, { team, players });
  }

  const roundFor = (p, value) => {
    if (p.pos === 'K' || p.pos === 'DST') return Math.max(0, Math.round(value));
    if (p.pos === 'QB') return Math.max(0, Math.round(value * 50) / 50);
    return Math.max(0, round1(value));
  };
  const weights = (list) => list.map((p) => BASELINE[p.pos] * p.quality * Math.exp(0.42 * rng.gauss()));

  // Week 9: starters' points must add up to the fitted team score exactly. The QB absorbs the cents.
  const week9Score = new Map();
  for (const g of season.games.filter((x) => x.week === WEEKS_PLAYED)) {
    week9Score.set(g.winner, g.win);
    week9Score.set(g.loser, g.lose);
  }
  for (const { team, players } of teams.values()) {
    const starters = players.filter((p) => p.slot9 !== SLOT_ID.BE && p.slot9 !== SLOT_ID.IR);
    const qb = starters.find((p) => p.pos === 'QB');
    const total = week9Score.get(team.id);
    for (let tries = 0; ; tries++) {
      if (tries > 500) throw new Error(`Could not split week 9 points for team ${team.id}`);
      const w = weights(starters);
      const sum = w.reduce((a, b) => a + b, 0);
      let usedCents = 0;
      starters.forEach((p, i) => {
        if (p === qb) return;
        p.pts9 = roundFor(p, (total / 100) * (w[i] / sum));
        usedCents += cents(p.pts9);
      });
      qb.pts9 = fromCents(total - usedCents);
      if (qb.pts9 >= 7 && qb.pts9 <= 41) break;
    }
    const bench = players.filter((p) => p.slot9 === SLOT_ID.BE);
    for (const p of bench) {
      const idle = pro.byeWeek.get(p.proTeamId) === 9;
      p.pts9 = idle ? null : Math.min(21.4, roundFor(p, p.proj9 * Math.exp(0.5 * rng.gauss()) * 0.8));
    }
    if (team.id === nailBiterLoser) {
      // The roast: lost by under two points with this on the bench.
      const star = bench.find((p) => p.pos === 'WR' && pro.byeWeek.get(p.proTeamId) !== 9) ?? bench.find((p) => p.pos === 'WR');
      if (pro.byeWeek.get(star.proTeamId) === 9) star.proTeamId = rng.pick(safe);
      star.pts9 = round1(rng.float(31.2, 36.8));
      star.benchStar = true;
    }
  }

  // Week 10 is live: everyone has played except Monday night's players.
  const live = new Map();
  for (const { team, players } of teams.values()) {
    const starters = players.filter((p) => p.slot10 !== SLOT_ID.BE && p.slot10 !== SLOT_ID.IR && !p.droppedAfterWeek9);
    const fullGame = Math.min(168, Math.max(84, 0.5 * (team.pf / WEEKS_PLAYED) + 0.5 * 121.7 + 14 * rng.gauss()));
    const active = starters.filter((p) => !p.outThisWeek);
    const w = weights(active);
    const sum = w.reduce((a, b) => a + b, 0);
    let points = 0;
    let projected = 0;
    active.forEach((p, i) => {
      if (p.monday) {
        p.pts10 = null;
        projected += p.proj10;
        return;
      }
      p.pts10 = roundFor(p, fullGame * (w[i] / sum) * (active.length / 9)); // a short lineup scores less
      points += p.pts10;
    });
    for (const p of starters.filter((x) => x.outThisWeek)) p.pts10 = null;
    for (const p of players.filter((x) => x.slot10 === SLOT_ID.BE && !x.droppedAfterWeek9)) {
      const idle = pro.byeWeek.get(p.proTeamId) === 10 || p.proTeamId === pro.mondayTeams[0] || p.proTeamId === pro.mondayTeams[1];
      p.pts10 = idle ? null : Math.min(23.8, roundFor(p, p.proj10 * Math.exp(0.5 * rng.gauss()) * 0.8));
    }
    live.set(team.id, { points: round2(points), projected: round2(points + projected) });
  }

  for (const { players } of teams.values()) {
    for (const p of players) p.seasonTotal = round2((p.pts9 ?? 0) + (p.pts10 ?? 0) + p.proj9 * rng.float(4.5, 8));
  }
  return { teams, live, week10Pairs };
}

function statLine(scoringPeriodId, statSourceId, appliedTotal) {
  // statSplitTypeId 0 is a season total, 1 is a single week. statSourceId 0 is actual, 1 is projected.
  return { appliedTotal, scoringPeriodId, seasonId: SEASON, statSourceId, statSplitTypeId: scoringPeriodId === 0 ? 0 : 1 };
}

/**
 * One raw roster entry.
 *   view 'roster'  the plain roster view: this week's slot, season total in appliedStatTotal
 *   view 'week10'  a matchup roster for the live week: that week's points in appliedStatTotal
 *   view 'week9'   a matchup roster for last week
 */
function rosterEntry(p, teamId, view) {
  const stats = [];
  const has = (v) => v !== null && v !== undefined;
  if (view === 'roster') stats.push(statLine(0, 0, p.seasonTotal));
  if (view !== 'week10' && has(p.pts9)) stats.push(statLine(9, 0, p.pts9));
  if (view === 'week9' && p.proj9 > 0) stats.push(statLine(9, 1, p.proj9));
  if (view !== 'week9') {
    if (has(p.pts10)) stats.push(statLine(10, 0, p.pts10));
    if (p.proj10 > 0 || p.outThisWeek) stats.push(statLine(10, 1, p.proj10));
  }
  const player = {
    defaultPositionId: POS_ID[p.pos], fullName: p.fullName, id: p.id, injured: p.injured, injuryStatus: p.injuryStatus,
    proTeamId: p.proTeamId, stats,
  };
  if (p.isDefense) {
    delete player.injured; // ESPN sends no injury fields for a defense
    delete player.injuryStatus;
  }
  return {
    acquisitionType: p.acquisition,
    lineupSlotId: view === 'week9' ? p.slot9 : p.slot10,
    playerId: p.id,
    playerPoolEntry: {
      appliedStatTotal: view === 'week9' ? p.pts9 ?? 0 : view === 'week10' ? p.pts10 ?? 0 : p.seasonTotal,
      id: p.id, onTeamId: teamId, player,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Invented draft
// ---------------------------------------------------------------------------------------

function buildDraft(rng, rosters, members) {
  const freeAgents = [];
  const drafted = new Map();
  const moves = new Map();
  const usedNames = new Set([...rosters.teams.values()].flatMap(({ players }) => players.map((p) => p.fullName)));
  let nextId = 4390001;

  for (const { team, players } of rosters.teams.values()) {
    const size = players.length;
    const minAdds = Math.max(1, size - 16);
    const adds = Math.max(minAdds, team.id === EMPTY_FLEX_TEAM ? 1 : rng.int(1, 4));
    const pickups = rng.shuffle(players.filter((p) => p.slot10 === SLOT_ID.BE || p.pos === 'K' || p.pos === 'DST')).slice(0, adds);
    for (const p of pickups) p.acquisition = 'ADD';
    const mine = players.filter((p) => !pickups.includes(p));
    while (mine.length < 16) {
      const pos = rng.pick(['RB', 'WR', 'WR', 'TE', 'RB', 'QB']);
      let fullName;
      let firstName;
      let lastName;
      do {
        firstName = rng.pick(FIRST_NAMES);
        lastName = rng.pick(LAST_NAMES);
        fullName = `${firstName} ${lastName}`;
      } while (usedNames.has(fullName));
      usedNames.add(fullName);
      nextId += rng.int(3, 90);
      const dropped = { id: nextId, firstName, lastName, fullName, pos, quality: rng.float(0.4, 0.75), proTeamId: rng.pick(PRO_TEAMS).id, dropped: true };
      freeAgents.push(dropped);
      mine.push(dropped);
    }
    drafted.set(team.id, mine);
    const churn = team.id === EMPTY_FLEX_TEAM ? 0 : rng.int(0, 11);
    const drops = mine.filter((p) => p.dropped).length + (team.id === EMPTY_FLEX_TEAM ? 1 : 0);
    moves.set(team.id, { acquisitions: adds + churn, drops: drops + churn, trades: 0, moveToActive: rng.int(4, 30), moveToIR: IR_COUNTS[team.id] ?? 0 });
  }

  // One trade: a drafted bench player each way between two teams.
  const [a, b] = [2, 11];
  const swapOut = (id) => drafted.get(id).find((p) => !p.dropped && !p.benchStar && p.slot10 === SLOT_ID.BE && p.acquisition === 'DRAFT');
  const fromA = swapOut(a);
  const fromB = swapOut(b);
  const rosterA = rosters.teams.get(a).players;
  const rosterB = rosters.teams.get(b).players;
  rosterA[rosterA.indexOf(fromA)] = fromB;
  rosterB[rosterB.indexOf(fromB)] = fromA;
  fromA.acquisition = 'TRADE';
  fromB.acquisition = 'TRADE';
  moves.get(a).trades = 1;
  moves.get(b).trades = 1;

  const order = rng.shuffle(TEAM_IDS);
  const boards = new Map(
    [...drafted].map(([id, list]) => {
      const value = (p) => (p.pos === 'K' ? 2 : p.pos === 'DST' ? 2.6 : BASELINE[p.pos] * p.quality * (p.pos === 'QB' ? 0.55 : 1)) * rng.float(0.85, 1.15);
      return [id, list.map((p) => ({ p, v: value(p) })).sort((x, y) => y.v - x.v).map((x) => x.p)];
    }),
  );
  const picks = [];
  for (let round = 1; round <= 16; round++) {
    const roundOrder = round % 2 === 1 ? order : [...order].reverse();
    roundOrder.forEach((teamId, i) => {
      const p = boards.get(teamId)[round - 1];
      picks.push({
        id: picks.length + 1, keeper: false, lineupSlotId: SLOT_ID[p.pos], memberId: members.get(teamId).id,
        overallPickNumber: picks.length + 1, playerId: p.id, roundId: round, roundPickNumber: i + 1, teamId,
      });
    });
  }
  return { picks, freeAgents, moves };
}

// ---------------------------------------------------------------------------------------
// Assembling the raw 2026 responses
// ---------------------------------------------------------------------------------------

function buildMembers(rng) {
  const members = new Map();
  for (const team of REAL_TEAMS) {
    members.set(team.id, {
      displayName: `placeholder_member_${String(team.id).padStart(2, '0')}`,
      firstName: team.firstName, // only three are known; the rest are deliberately empty
      id: guid(rng),
      isLeagueManager: team.id === 1,
      lastName: 'Placeholder',
    });
  }
  return members;
}

function settingsFor(regularWeeks, finalPeriod) {
  const matchupPeriods = {};
  for (let w = 1; w <= finalPeriod; w++) matchupPeriods[String(w)] = [w];
  return {
    isPublic: false,
    name: LEAGUE_NAME,
    restrictionType: 'NONE',
    rosterSettings: { lineupSlotCounts: LINEUP_SLOT_COUNTS, rosterLocktimeType: 'INDIVIDUAL_GAME' },
    scheduleSettings: {
      matchupPeriodCount: regularWeeks, matchupPeriodLength: 1, matchupPeriods, playoffMatchupPeriodLength: 1,
      playoffSeedingRule: 'TOTAL_POINTS_SCORED', playoffTeamCount: PLAYOFF_TEAMS,
    },
    scoringSettings: {
      playerRankType: 'PPR',
      scoringItems: [
        { isReverseItem: false, points: 0.04, statId: 3 }, { isReverseItem: false, points: 4, statId: 4 },
        { isReverseItem: false, points: -2, statId: 20 }, { isReverseItem: false, points: 0.1, statId: 24 },
        { isReverseItem: false, points: 6, statId: 25 }, { isReverseItem: false, points: 0.1, statId: 42 },
        { isReverseItem: false, points: 6, statId: 43 }, { isReverseItem: false, points: 1, statId: 53 },
        { isReverseItem: false, points: -2, statId: 72 },
      ],
      scoringType: 'H2H_POINTS',
    },
    size: 12,
  };
}

function rawTeam({ id, abbrev, name, splitName, member, seed, finalRank, record, moves, roster }) {
  const team = { abbrev, id };
  if (splitName) {
    const cut = name.indexOf(' ');
    team.location = cut === -1 ? name : name.slice(0, cut);
    team.nickname = cut === -1 ? '' : name.slice(cut + 1);
  } else {
    team.name = name;
  }
  Object.assign(team, {
    // Deliberately fake: proves the sync never copies logo fields into the world's data.
    logo: 'https://example.invalid/placeholder-not-a-real-logo.png',
    logoType: 'CUSTOM_VALID',
    owners: [member.id],
    playoffSeed: seed,
    points: record.pointsFor,
    primaryOwner: member.id,
    rankCalculatedFinal: finalRank,
    record: {
      overall: {
        gamesBack: 0, losses: record.losses, percentage: round2(record.wins / Math.max(1, record.wins + record.losses)),
        pointsAgainst: record.pointsAgainst, pointsFor: record.pointsFor, streakLength: record.streak[1], streakType: record.streak[0],
        ties: 0, wins: record.wins,
      },
    },
    transactionCounter: moves,
  });
  if (roster) team.roster = { entries: roster };
  return team;
}

function build2026(rng) {
  const season = buildSeason2026();
  const pro = buildProSchedule(rng);
  const members = buildMembers(rng);
  const rosters = buildRosters(rng, pro, season);
  const draft = buildDraft(rng, rosters, members);

  const status = {
    currentMatchupPeriod: CURRENT_WEEK, finalScoringPeriod: 17, firstScoringPeriod: 1, isActive: true,
    latestScoringPeriod: CURRENT_WEEK, previousSeasons: HISTORY_YEARS,
  };
  const head = { gameId: 1, id: LEAGUE_ID, scoringPeriodId: CURRENT_WEEK, seasonId: SEASON, segmentId: 0 };

  const rawTeams = REAL_TEAMS.map((t) =>
    rawTeam({
      id: t.id, abbrev: t.abbrev, name: t.name, splitName: false, member: members.get(t.id), seed: t.seed, finalRank: 0,
      // The record fields are the real numbers, exactly as supplied.
      record: { wins: t.wins, losses: t.losses, pointsFor: t.pf, pointsAgainst: t.pa, streak: t.streak },
      moves: draft.moves.get(t.id),
      roster: rosters.teams.get(t.id).players.filter((p) => !p.droppedAfterWeek9).map((p) => rosterEntry(p, t.id, 'roster')),
    }),
  );

  // Schedule: weeks 1-9 final, week 10 live, weeks 11-14 still to play (12-14 repeat weeks 1-3).
  const pairsByWeek = [];
  season.schedule.weeks.forEach((week, i) => {
    pairsByWeek[i + 1] = week.map((g) => {
      const fitted = season.games.find((x) => x.week === i + 1 && x.winner === g.winner);
      return { a: g.winner, b: g.loser, aPts: fitted.win, bPts: fitted.lose, final: true };
    });
  });
  pairsByWeek[10] = season.schedule.week10.map(([a, b]) => ({ a, b }));
  pairsByWeek[11] = season.schedule.week11.map(([a, b]) => ({ a, b }));
  for (const w of [12, 13, 14]) pairsByWeek[w] = pairsByWeek[w - 11].map(({ a, b }) => ({ a: b, b: a }));

  const scheduleFor = (rosterWeek) => {
    const out = [];
    let id = 1;
    for (let week = 1; week <= REGULAR_WEEKS; week++) {
      for (const game of pairsByWeek[week]) {
        const flip = (game.a * 7 + game.b * 13 + week) % 2 === 0;
        const [homeId, awayId] = flip ? [game.b, game.a] : [game.a, game.b];
        const side = (teamId) => {
          const s = { teamId, totalPoints: 0 };
          if (game.final) {
            s.totalPoints = fromCents(teamId === game.a ? game.aPts : game.bPts);
            s.pointsByScoringPeriod = { [String(week)]: s.totalPoints };
          }
          const entries = () => rosters.teams.get(teamId).players
            .filter((p) => (rosterWeek === 9 ? true : !p.droppedAfterWeek9))
            .map((p) => rosterEntry(p, teamId, rosterWeek === 9 ? 'week9' : 'week10'));
          if (week === CURRENT_WEEK) {
            const live = rosters.live.get(teamId);
            s.totalPoints = live.points;
            s.pointsByScoringPeriod = { [String(week)]: live.points };
            if (rosterWeek === 10) {
              s.totalPointsLive = live.points;
              s.totalProjectedPointsLive = live.projected;
              s.rosterForCurrentScoringPeriod = { appliedStatTotal: live.points, entries: entries() };
            }
          }
          if (week === 9 && rosterWeek === 9) s.rosterForCurrentScoringPeriod = { appliedStatTotal: s.totalPoints, entries: entries() };
          return s;
        };
        out.push({
          away: side(awayId), home: side(homeId), id: id++, matchupPeriodId: week, playoffTierType: 'NONE',
          winner: game.final ? (homeId === game.a ? 'HOME' : 'AWAY') : 'UNDECIDED',
        });
      }
    }
    return out;
  };

  const main = {
    draftDetail: { drafted: true, inProgress: false },
    ...head,
    members: [...members.values()],
    schedule: scheduleFor(10),
    settings: settingsFor(REGULAR_WEEKS, 17),
    status,
    teams: rawTeams,
  };
  const lineups = { draftDetail: { drafted: true, inProgress: false }, ...head, scoringPeriodId: 9, schedule: scheduleFor(9), status };
  const draftRaw = {
    draftDetail: { completeDate: Date.UTC(2026, 8, 6, 23, 40), drafted: true, inProgress: false, picks: draft.picks },
    ...head,
    settings: { name: LEAGUE_NAME },
    status,
  };
  const allPlayers = [...rosters.teams.values()].flatMap(({ team, players }) => players.map((p) => ({ p, onTeamId: p.droppedAfterWeek9 ? 0 : team.id })));
  const playersRaw = [...allPlayers, ...draft.freeAgents.map((p) => ({ p, onTeamId: 0 }))]
    .sort((x, y) => x.p.id - y.p.id)
    .map(({ p }) => ({
      defaultPositionId: POS_ID[p.pos], droppable: true, eligibleSlots: ELIGIBLE[p.pos], firstName: p.firstName,
      fullName: p.fullName, id: p.id, lastName: p.lastName, proTeamId: p.proTeamId, universeId: 2,
    }));

  return { main, lineups, draftRaw, playersRaw, proRaw: pro.raw, members, season, rosters };
}

// ---------------------------------------------------------------------------------------
// Invented history
// ---------------------------------------------------------------------------------------

function nameIn(year, teamId) {
  let name = NAME_HISTORY[teamId][0][1];
  for (const [from, n] of NAME_HISTORY[teamId]) if (year >= from) name = n;
  return name;
}

/** Circle-method round robin: 11 rounds of 6 pairs for 12 teams. */
function roundRobin(ids) {
  const list = [...ids];
  const rounds = [];
  for (let r = 0; r < list.length - 1; r++) {
    const round = [];
    for (let i = 0; i < list.length / 2; i++) round.push([list[i], list[list.length - 1 - i]]);
    rounds.push(round);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

function simulatePastSeason(year, seed) {
  const rng = makeRng(seed);
  const regularWeeks = year <= 2020 ? 13 : 14; // the league added a week when the NFL did
  const finalWeek = regularWeeks + 3;
  const champion = CHAMPIONS[year];
  const lastPlace = LAST_PLACES[year];
  const runnerUp = RUNNERS_UP[year] ?? null;

  const strength = new Map(TEAM_IDS.map((id) => [id, SKILL[id] + 4 * rng.gauss() + (id === champion ? 7 : 0) + (id === lastPlace ? -13 : 0) + (id === runnerUp ? 5 : 0)]));
  const draw = (id) => {
    for (;;) {
      const v = round2(118 + strength.get(id) + 16.5 * rng.gauss());
      if (v >= 70 && v <= 182) return v;
    }
  };

  // Schedule: a round robin, then the first rounds again. Put the rivalry in or out of the repeats.
  let rounds = rng.shuffle(roundRobin(rng.shuffle(TEAM_IDS)));
  const repeats = regularWeeks - rounds.length;
  const rivalRound = rounds.findIndex((r) => r.some(([a, b]) => pairKey(a, b) === pairKey(RIVAL.loser, RIVAL.winner)));
  const wantRepeat = !RIVAL.singleMeetingYears.includes(year);
  const target = wantRepeat ? rng.int(0, repeats - 1) : rng.int(repeats, rounds.length - 1);
  [rounds[rivalRound], rounds[target]] = [rounds[target], rounds[rivalRound]];
  rounds = [...rounds, ...rounds.slice(0, repeats).map((r) => r.map(([a, b]) => [b, a]))];

  const games = [];
  let rivalMeeting = 0;
  rounds.forEach((round, i) => {
    for (const [home, away] of round) {
      let homePts = draw(home);
      let awayPts = draw(away);
      while (homePts === awayPts) awayPts = draw(away);
      if (pairKey(home, away) === pairKey(RIVAL.loser, RIVAL.winner)) {
        rivalMeeting++;
        const loserWinsThis = RIVAL.loserWins.some(([y, n]) => y === year && n === rivalMeeting);
        const shouldWin = loserWinsThis ? RIVAL.loser : RIVAL.winner;
        const leader = homePts > awayPts ? home : away;
        if (leader !== shouldWin) [homePts, awayPts] = [awayPts, homePts];
      }
      games.push({ week: i + 1, home, away, homePts, awayPts, tier: 'NONE' });
    }
  });
  for (const rec of [RECORD_HIGH, RECORD_LOW]) {
    if (rec.year !== year) continue;
    const g = games.find((x) => x.week === rec.week && (x.home === rec.teamId || x.away === rec.teamId));
    if (g.home === rec.teamId) g.homePts = rec.points;
    else g.awayPts = rec.points;
  }

  const rows = new Map(TEAM_IDS.map((id) => [id, { id, wins: 0, losses: 0, pf: 0, pa: 0, results: [] }]));
  for (const g of games) {
    const h = rows.get(g.home);
    const a = rows.get(g.away);
    h.pf += g.homePts;
    h.pa += g.awayPts;
    a.pf += g.awayPts;
    a.pa += g.homePts;
    const homeWon = g.homePts > g.awayPts;
    (homeWon ? h : a).wins++;
    (homeWon ? a : h).losses++;
    h.results.push(homeWon ? 'W' : 'L');
    a.results.push(homeWon ? 'L' : 'W');
  }
  const seeds = [...rows.values()].sort((x, y) => y.wins - x.wins || y.pf - x.pf).map((r) => r.id);
  const seedOf = (id) => seeds.indexOf(id) + 1;
  if (seedOf(champion) > PLAYOFF_TEAMS || seedOf(lastPlace) !== 12) return null;
  if (runnerUp && seedOf(runnerUp) > PLAYOFF_TEAMS) return null;

  // Playoffs. Home is the better seed. The story decides the games that matter.
  let rivalsMet = false;
  const play = (week, a, b, tier) => {
    const [home, away] = seedOf(a) < seedOf(b) ? [a, b] : [b, a];
    if (pairKey(home, away) === pairKey(RIVAL.loser, RIVAL.winner)) rivalsMet = true;
    let homePts = draw(home);
    let awayPts = draw(away);
    while (homePts === awayPts) awayPts = draw(away);
    const must = [home, away].includes(champion) ? champion : [home, away].includes(runnerUp) ? runnerUp : null;
    if (must !== null && (homePts > awayPts ? home : away) !== must) [homePts, awayPts] = [awayPts, homePts];
    games.push({ week, home, away, homePts, awayPts, tier });
    return homePts > awayPts ? { winner: home, loser: away } : { winner: away, loser: home };
  };
  const bye = (week, id, tier) => games.push({ week, home: id, away: null, homePts: draw(id), awayPts: null, tier });

  const s = (n) => seeds[n - 1];
  const w1 = regularWeeks + 1;
  bye(w1, s(1), 'WINNERS_BRACKET');
  bye(w1, s(2), 'WINNERS_BRACKET');
  const q1 = play(w1, s(3), s(6), 'WINNERS_BRACKET');
  const q2 = play(w1, s(4), s(5), 'WINNERS_BRACKET');
  const c1 = play(w1, s(7), s(10), 'LOSERS_CONSOLATION_LADDER');
  const c2 = play(w1, s(8), s(9), 'LOSERS_CONSOLATION_LADDER');
  const c3 = play(w1, s(11), s(12), 'LOSERS_CONSOLATION_LADDER');
  const [lowWinner, highWinner] = seedOf(q1.winner) > seedOf(q2.winner) ? [q1.winner, q2.winner] : [q2.winner, q1.winner];
  const semi1 = play(w1 + 1, s(1), lowWinner, 'WINNERS_BRACKET');
  const semi2 = play(w1 + 1, s(2), highWinner, 'WINNERS_BRACKET');
  const fifth = play(w1 + 1, q1.loser, q2.loser, 'WINNERS_CONSOLATION_LADDER');
  const d1 = play(w1 + 1, c1.winner, c2.winner, 'LOSERS_CONSOLATION_LADDER');
  const d2 = play(w1 + 1, c3.winner, c1.loser, 'LOSERS_CONSOLATION_LADDER');
  const d3 = play(w1 + 1, c2.loser, c3.loser, 'LOSERS_CONSOLATION_LADDER');
  const final = play(w1 + 2, semi1.winner, semi2.winner, 'WINNERS_BRACKET');
  const third = play(w1 + 2, semi1.loser, semi2.loser, 'WINNERS_CONSOLATION_LADDER');
  play(w1 + 2, d1.winner, d2.winner, 'LOSERS_CONSOLATION_LADDER');
  play(w1 + 2, d1.loser, d3.winner, 'LOSERS_CONSOLATION_LADDER');
  play(w1 + 2, d2.loser, d3.loser, 'LOSERS_CONSOLATION_LADDER');
  if (rivalsMet || final.winner !== champion || (runnerUp && final.loser !== runnerUp)) return null;

  const finalRank = new Map();
  [final.winner, final.loser, third.winner, third.loser, fifth.winner, fifth.loser].forEach((id, i) => finalRank.set(id, i + 1));
  for (let n = 7; n <= 12; n++) finalRank.set(s(n), n);

  const scores = games.filter((g) => !(g.week === RECORD_HIGH.week && year === RECORD_HIGH.year) && !(g.week === RECORD_LOW.week && year === RECORD_LOW.year))
    .flatMap((g) => [g.homePts, g.awayPts]).filter((v) => v !== null);
  if (Math.max(...scores) > 182 || Math.min(...scores) < 70) return null;

  return { year, regularWeeks, finalWeek, games, rows, seeds, finalRank };
}

function buildPastSeason(year, members) {
  let sim = null;
  for (let attempt = 0; attempt < 5000 && !sim; attempt++) sim = simulatePastSeason(year, SEED + year * 1009 + attempt * 31);
  if (!sim) throw new Error(`Could not build the ${year} season`);

  const moveRng = makeRng(SEED + year);
  const teams = REAL_TEAMS.map((t) => {
    const row = sim.rows.get(t.id);
    return rawTeam({
      id: t.id, abbrev: t.abbrev, name: nameIn(year, t.id), splitName: year <= 2021, member: members.get(t.id),
      seed: sim.seeds.indexOf(t.id) + 1, finalRank: sim.finalRank.get(t.id),
      record: { wins: row.wins, losses: row.losses, pointsFor: round2(row.pf), pointsAgainst: round2(row.pa), streak: currentStreak(row.results) },
      moves: { acquisitions: moveRng.int(4, 38), drops: moveRng.int(4, 38), trades: moveRng.int(0, 3), moveToActive: moveRng.int(10, 60), moveToIR: moveRng.int(0, 4) },
      roster: null,
    });
  });
  const schedule = sim.games
    .slice()
    .sort((a, b) => a.week - b.week)
    .map((g, i) => {
      const item = {
        home: { teamId: g.home, totalPoints: g.homePts },
        id: i + 1, matchupPeriodId: g.week, playoffTierType: g.tier,
        winner: g.away === null ? 'UNDECIDED' : g.homePts > g.awayPts ? 'HOME' : 'AWAY', // ESPN leaves a bye undecided
      };
      if (g.away !== null) item.away = { teamId: g.away, totalPoints: g.awayPts };
      return item;
    });

  return {
    draftDetail: { drafted: true, inProgress: false },
    gameId: 1,
    id: LEAGUE_ID,
    members: [...members.values()],
    schedule,
    scoringPeriodId: sim.finalWeek + 1,
    seasonId: year,
    segmentId: 0,
    settings: settingsFor(sim.regularWeeks, sim.finalWeek),
    status: {
      currentMatchupPeriod: sim.finalWeek, finalScoringPeriod: sim.finalWeek, firstScoringPeriod: 1, isActive: false,
      latestScoringPeriod: sim.finalWeek, previousSeasons: HISTORY_YEARS.filter((y) => y < year),
    },
    teams,
  };
}

// ---------------------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------------------

/** Build every fixture in memory: { files: { name: object }, notes: { ... } }. */
export function buildFixtures() {
  const rng = makeRng(SEED);
  const current = build2026(rng);
  const files = {
    [`espn-${SEASON}.json`]: current.main,
    [`espn-${SEASON}-week9-lineups.json`]: current.lineups,
    [`espn-${SEASON}-draft.json`]: current.draftRaw,
    [`espn-${SEASON}-players.json`]: current.playersRaw,
    [`pro-schedule-${SEASON}.json`]: current.proRaw,
  };
  for (const year of HISTORY_YEARS) files[`espn-${year}.json`] = buildPastSeason(year, current.members);

  const { season } = current;
  const describe = (g) => `team ${g.winner} ${fromCents(g.win).toFixed(2)} beat team ${g.loser} ${fromCents(g.lose).toFixed(2)}`;
  return {
    files,
    notes: {
      attempt: season.attempt,
      maxPointsForError: 0,
      maxPointsAgainstError: season.maxPaError,
      week9Blowout: describe(season.blowout),
      week9NailBiter: describe(season.nailBiter),
      week9BenchStar: [...current.rosters.teams.values()].flatMap(({ team, players }) => players.filter((p) => p.benchStar).map((p) => `team ${team.id} benched ${p.fullName} (${p.pts9})`))[0],
      tierMoves: season.tierMoves.map((m) => `team ${m.id} ${m.from} -> ${m.to}`),
      week10: season.schedule.week10.map(([a, b]) => `${a} v ${b}`).join(', '),
      week11: season.schedule.week11.map(([a, b]) => `${a} v ${b}`).join(', '),
    },
  };
}

export function fixtureText(value) {
  return prettyJson(value, { width: 200, inlineFromDepth: 5 });
}

function main() {
  const check = process.argv.includes('--check');
  const { files, notes } = buildFixtures();
  let different = 0;
  if (!check) fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(FIXTURE_DIR, name);
    const text = fixtureText(value);
    if (check) {
      const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (onDisk !== text) {
        different++;
        console.log(`DIFFERENT  ${name}`);
      }
    } else {
      fs.writeFileSync(file, text);
      console.log(`wrote ${name} (${Math.round(text.length / 1024)} KB)`);
    }
  }
  console.log('');
  console.log('2026 season fit against the real standings:');
  console.log(`  points for: exact for all 12 teams; points against: within ${notes.maxPointsAgainstError.toFixed(2)}`);
  console.log(`  week 9 blowout: ${notes.week9Blowout}`);
  console.log(`  week 9 nail-biter: ${notes.week9NailBiter}; ${notes.week9BenchStar}`);
  console.log(`  tier changes week 8 -> week 9: ${notes.tierMoves.join('; ') || 'none'}`);
  console.log(`  week 10: ${notes.week10}`);
  console.log(`  week 11: ${notes.week11}`);
  if (check) {
    console.log(different ? `${different} fixture file(s) differ from what the generator produces.` : 'All fixture files match the generator.');
    process.exit(different ? 1 : 0);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
