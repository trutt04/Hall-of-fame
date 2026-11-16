// Two extra views of the league for the world to show: the playoff picture and the draft
// graveyard. Pure and defensive, like the rest of the model: missing data gives a smaller
// answer, never an error.

import { arr, num, int, str, round2, ordinal, fmtGames, fmtPts, compareIds, rngFor } from './util.js';

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nextPow2(n) {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// ---------------------------------------------------------------------------------------------
// The playoff picture
// ---------------------------------------------------------------------------------------------

function roundName(index, total) {
  if (index === total - 1) return 'Championship';
  if (index === total - 2) return 'Semifinals';
  if (index === total - 3 && total >= 4) return 'Quarterfinals';
  return `Round ${index + 1}`;
}

/**
 * The winners bracket, round by round.
 *
 * Before the playoffs it answers "if the season ended today". Once they start, the games ESPN
 * lists are the truth. A side is only filled in when it is certain: this never guesses how the
 * next round pairs up, because leagues differ on whether they re-seed.
 *
 * @param o.seeding  team ids in seed order (the playoff field is the first o.P of them)
 * @param o.teams    [{ id, wins, losses, ties, pointsFor }]
 * @param o.games    two-sided games from derive.js ({ week, playoff, bracket, homeId, awayId, ... })
 * @param o.statusOf (game) => 'pre' | 'live' | 'final'
 */
export function buildPlayoffs(o) {
  const seeding = arr(o.seeding);
  const N = seeding.length;
  const P = Math.max(0, Math.min(int(o.P), N));
  if (N < 2 || P < 2) return null;
  const regWeeks = Math.max(0, int(o.regWeeks));
  const state = o.phase === 'complete' ? 'final' : o.phase === 'playoffs' ? 'live' : 'projected';
  const field = seeding.slice(0, P);
  const seedOf = {};
  seeding.forEach((id, i) => { seedOf[id] = i + 1; });
  const inField = new Set(field.map(String));
  const side = (id) => (id == null ? null : { teamId: id, seed: seedOf[id] });
  const bySeed = (a, b) => seedOf[a] - seedOf[b];

  // Winners-bracket games between two teams of the field, by week.
  const byWeek = new Map();
  for (const g of arr(o.games)) {
    if (!g || !g.playoff || g.bracket === 'CONSOLATION') continue;
    if (!inField.has(String(g.homeId)) || !inField.has(String(g.awayId))) continue;
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }
  const playoffWeeks = [...byWeek.keys()].sort((a, b) => a - b);
  const total = Math.ceil(Math.log2(P));
  const weekFor = (r) => {
    if (r < playoffWeeks.length) return playoffWeeks[r];
    if (playoffWeeks.length) return playoffWeeks[playoffWeeks.length - 1] + (r - playoffWeeks.length + 1);
    return regWeeks > 0 ? regWeeks + 1 + r : null;
  };

  const rounds = [];
  let alive = field.slice(); // exact list of teams still in it, or null once that is unknown
  let aliveCount = P;
  let resting = []; // teams that sat out the previous round
  const out = new Set(); // teams already beaten in this bracket
  let championId = null;

  for (let r = 0; r < total; r++) {
    const week = weekFor(r);
    const size = nextPow2(aliveCount);
    const byeCount = size - aliveCount;
    const gameCount = (aliveCount - byeCount) / 2;
    const listed = (week != null && byWeek.get(week) || []).filter(
      (g) => !out.has(String(g.homeId)) && !out.has(String(g.awayId)) && (!alive || (alive.includes(g.homeId) && alive.includes(g.awayId))),
    );
    let games = [];
    let byes = [];

    if (listed.length) {
      games = listed.map((g) => {
        const homeFirst = seedOf[g.homeId] <= seedOf[g.awayId];
        const a = homeFirst ? g.homeId : g.awayId;
        const b = homeFirst ? g.awayId : g.homeId;
        const winnerId = g.winner === 'home' ? g.homeId : g.winner === 'away' ? g.awayId : null;
        return {
          a: side(a),
          b: side(b),
          aPts: round2(homeFirst ? g.homePts : g.awayPts),
          bPts: round2(homeFirst ? g.awayPts : g.homePts),
          status: o.statusOf ? o.statusOf(g) : g.decided ? 'final' : 'pre',
          winnerId,
        };
      });
      games.sort((x, y) => x.a.seed - y.a.seed);
      const playing = new Set(games.flatMap((g) => [String(g.a.teamId), String(g.b.teamId)]));
      if (alive) byes = alive.filter((id) => !playing.has(String(id)));
    } else if (alive && r === 0) {
      // Nobody has played yet, so the first round is simply best against worst, with the top
      // seeds resting. This is the same in every format.
      byes = alive.slice(0, byeCount);
      const playing = alive.slice(byeCount);
      for (let i = 0; i < playing.length / 2; i++) {
        games.push({
          a: side(playing[i]),
          b: side(playing[playing.length - 1 - i]),
          aPts: null,
          bPts: null,
          status: state === 'projected' ? 'projected' : 'pre',
          winnerId: null,
        });
      }
    } else {
      // A later round that is not listed yet. The teams that rested are certain to play in it,
      // one to a game, when there are exactly as many of them as there are games.
      const hosts = resting.length === gameCount ? resting.slice().sort(bySeed) : [];
      for (let i = 0; i < gameCount; i++) {
        games.push({
          a: side(hosts[i] ?? null),
          b: null,
          aPts: null,
          bPts: null,
          status: state === 'projected' ? 'projected' : 'pre',
          winnerId: null,
        });
      }
    }

    rounds.push({ name: roundName(r, total), week, games, byes: byes.map(side) });

    // Who goes through.
    const decided = listed.length > 0 && games.length === gameCount && games.every((g) => g.winnerId != null);
    for (const g of games) {
      if (g.winnerId == null || !g.a || !g.b) continue;
      out.add(String(g.winnerId === g.a.teamId ? g.b.teamId : g.a.teamId));
    }
    resting = byes;
    aliveCount = byes.length + games.length;
    alive = decided && alive ? byes.concat(games.map((g) => g.winnerId)).sort(bySeed) : null;
    if (r === total - 1 && decided && games.length === 1) championId = games[0].winnerId;
  }
  if (championId == null && state === 'final' && o.championId != null && inField.has(String(o.championId))) championId = o.championId;

  // The line between the last team in and the first team out.
  let bubble = null;
  if (state === 'projected' && N > P) {
    const rows = {};
    for (const t of arr(o.teams)) rows[t.id] = t;
    const lastIn = field[P - 1];
    const firstOut = seeding[P];
    const a = rows[lastIn];
    const b = rows[firstOut];
    let text = `${ordinal(P)} is in. ${ordinal(P + 1)} is the first team out.`;
    if (a && b) {
      const value = (t) => num(t.wins) + num(t.ties) / 2 - (num(t.losses) + num(t.ties) / 2);
      const games = (value(a) - value(b)) / 2;
      const points = round2(num(a.pointsFor) - num(b.pointsFor));
      if (games > 0) text = `${ordinal(P)} leads ${ordinal(P + 1)} by ${fmtGames(games)}.`;
      else if (games === 0 && points > 0) text = `${ordinal(P)} and ${ordinal(P + 1)} are level on record. ${fmtPts(points)} points decide it.`;
      else if (games === 0 && points === 0) text = `${ordinal(P)} and ${ordinal(P + 1)} are level on everything. Somebody flip a coin.`;
    }
    bubble = { lastIn, firstOut, text };
  }

  return {
    state,
    title: state === 'projected' ? 'If the season ended today' : state === 'live' ? 'Playoffs' : 'Final bracket',
    teams: P,
    rounds,
    championId,
    bubble,
  };
}

// ---------------------------------------------------------------------------------------------
// The draft graveyard
// ---------------------------------------------------------------------------------------------

// The top half of the draft counts as an early pick (at least 3 rounds, at most 8).
const earlyRounds = (totalRounds) => Math.max(3, Math.min(8, Math.ceil(totalRounds / 2)));
const MAX_STONES = 8;
const MAX_PER_TEAM = 2;
const EPITAPH_MAX = 84;

// "Gone" covers dropped and traded alike, so no line says which.
const EPITAPHS = {
  gone: [
    (c) => `Drafted in round ${c.round}. Not on this roster by Week ${c.week}.`,
    (c) => `Taken ${c.ord} overall. Somebody else's problem now.`,
    (c) => `Round ${c.round} hopes. Gone by Week ${c.week}.`,
    (c) => `A round ${c.round} pick. The draft grade was an A. The grade was wrong.`,
    (c) => `Taken ${c.ord} overall. Left the building before Week ${c.week}.`,
    (c) => `Round ${c.round}. The plan did not survive contact with the season.`,
    (c) => `Picked ${c.ord}. Remembered fondly by nobody on this roster.`,
    (c) => `Round ${c.round}, pick ${c.pick}. A bold call. Boldly wrong.`,
  ],
  ir: [
    (c) => `Round ${c.round} pick. On injured reserve. So is the draft plan.`,
    (c) => `Taken ${c.ord} overall. The draft board did not see this coming.`,
    (c) => `Round ${c.round}. Holding an IR slot and a lot of hope.`,
    (c) => `Picked ${c.ord}. The pick is resting. The manager is not.`,
    (c) => `Round ${c.round}, pick ${c.pick}. Paid for in full. Not delivered yet.`,
  ],
};

function nameKey(v) {
  return str(v).trim().toLowerCase();
}

/**
 * Early draft picks that are no longer on the team that drafted them, or sit on its IR.
 * The earliest pick is the biggest miss, so it comes first. Here lie the picks, not the men.
 *
 * @param src  the raw league.json object (rosters are read from it directly)
 * @param ctx  { week, season, phase }
 */
export function buildGraveyard(src, ctx) {
  const league = isObj(src) ? src : {};
  const week = Math.max(1, int(ctx && ctx.week, 1));
  const phase = ctx && ctx.phase;
  if (phase === 'preseason') return [];

  const rosters = {};
  for (const t of arr(league.teams)) {
    if (!isObj(t) || t.id == null || !isObj(t.roster)) continue;
    const names = (list) => arr(list).filter(isObj).map((p) => nameKey(p.name)).filter(Boolean);
    const active = new Set(names(t.roster.starters).concat(names(t.roster.bench)));
    const ir = new Set(names(t.roster.ir));
    // A roster with nobody listed means the lineup view was missing, not that everyone was cut.
    if (active.size + ir.size === 0) continue;
    rosters[t.id] = { active, ir };
  }

  const draft = arr(league.draft).filter(isObj);
  const early = earlyRounds(draft.reduce((most, d) => Math.max(most, int(d.round)), 0));
  const picks = [];
  const seen = new Set();
  for (const d of draft) {
    const round = int(d.round);
    const name = str(d.name).trim();
    const roster = rosters[d.teamId];
    if (round < 1 || round > early || !name || !roster) continue;
    const key = `${d.teamId}|${nameKey(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const k = nameKey(name);
    const cause = roster.ir.has(k) ? 'ir' : roster.active.has(k) ? null : 'gone';
    if (!cause) continue;
    const pick = Math.max(0, int(d.pick));
    const overall = Math.max(0, int(d.overall));
    picks.push({ teamId: d.teamId, name, pos: str(d.pos), round, pick, overall, cause });
  }
  picks.sort((a, b) => (a.overall || a.round * 1000 + a.pick) - (b.overall || b.round * 1000 + b.pick) || compareIds(a.teamId, b.teamId));

  const perTeam = {};
  const used = new Set();
  const out = [];
  for (const p of picks) {
    if (out.length >= MAX_STONES) break;
    perTeam[p.teamId] = (perTeam[p.teamId] || 0) + 1;
    if (perTeam[p.teamId] > MAX_PER_TEAM) continue;
    const c = { round: p.round, pick: p.pick || '?', ord: p.overall ? ordinal(p.overall) : `in round ${p.round}`, week };
    const lines = EPITAPHS[p.cause].map((fn) => fn(c)).filter((s) => s.length <= EPITAPH_MAX && (p.pick || !s.includes('pick ?')));
    const rng = rngFor('grave', int(ctx && ctx.season), p.teamId, p.name);
    const start = Math.floor(rng() * lines.length);
    let epitaph = lines[start] || `Round ${p.round}. Gone.`;
    for (let i = 0; i < lines.length; i++) {
      const candidate = lines[(start + i) % lines.length];
      const kind = EPITAPHS[p.cause].findIndex((fn) => fn(c) === candidate);
      if (!used.has(`${p.cause}:${kind}`)) {
        epitaph = candidate;
        used.add(`${p.cause}:${kind}`);
        break;
      }
    }
    out.push({
      teamId: p.teamId,
      name: p.name,
      pos: p.pos,
      round: p.round,
      pick: p.pick,
      overall: p.overall,
      cause: p.cause,
      drafted: p.pick ? `Round ${p.round}, pick ${p.pick}` : `Round ${p.round}`,
      epitaph,
    });
  }
  return out;
}
