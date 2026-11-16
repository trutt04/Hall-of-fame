// The league brain. Turns the saved league data (Contract 1) and history (Contract 2) into the
// model the world renders (Contract 4 in world/ARCHITECTURE.md).
//
// Pure and deterministic: same inputs and the same `now` always give the same model. No DOM,
// no Date.now(). Never throws on missing optional data: garbage in gives a smaller model out.

import { TEAM_COLORS } from '../config.js';
import {
  arr, num, int, str, round2, recordText, winPct, compareIds, tierForRank, tierIndex, teamLabels,
} from './util.js';
import { buildHistory } from './history.js';
import { composeCopy } from './roasts.js';
import { buildPlayoffs, buildGraveyard } from './extras.js';

export { tierForRank } from './util.js';

const KICKOFF_WINDOW_MS = 3.5 * 60 * 60 * 1000;
const MAX_TRASH_BAGS = 12;
const MAX_FLAMINGOS = 6;
const LUCK_MIN_WEEKS = 3;
const STREAK_CODES = { WIN: 'W', LOSS: 'L', TIE: 'T' };

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toMs(v) {
  if (v == null) return null;
  let ms = NaN;
  if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v;
  else if (typeof v === 'string') ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function uniquePositive(values) {
  const seen = new Set();
  for (const v of values) {
    if (!(v > 0) || seen.has(v)) return false;
    seen.add(v);
  }
  return values.length > 0;
}

// ---------- reading the raw data defensively ----------

function readRoster(raw) {
  if (!isObj(raw)) return null;
  const players = (list) =>
    arr(list)
      .filter(isObj)
      .map((p) => ({ name: str(p.name), pos: str(p.pos), slot: str(p.slot), why: str(p.why).toUpperCase() }))
      .filter((p) => p.name);
  return {
    ir: players(raw.ir),
    emptyStarters: arr(raw.emptyStarters).map(str).filter(Boolean),
    badStarters: players(raw.badStarters),
  };
}

function readTeams(list) {
  const out = [];
  const seen = new Set();
  for (const t of arr(list)) {
    if (!isObj(t)) continue;
    const id = t.id;
    if ((typeof id !== 'number' && typeof id !== 'string') || id === '' || seen.has(String(id))) continue;
    seen.add(String(id));
    const streakType = STREAK_CODES[str(t.streakType).toUpperCase()] || null;
    out.push({
      id,
      name: str(t.name) || `Team ${id}`,
      abbrev: str(t.abbrev) || (str(t.name) || `T${id}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || `T${id}`,
      owner: str(t.owner),
      ownerKey: str(t.ownerKey) || `t_${id}`,
      seed: Math.max(0, int(t.seed)),
      finalRank: Math.max(0, int(t.finalRank)),
      wins: Math.max(0, int(t.wins)),
      losses: Math.max(0, int(t.losses)),
      ties: Math.max(0, int(t.ties)),
      pointsFor: round2(t.pointsFor),
      pointsAgainst: round2(t.pointsAgainst),
      streakType,
      streakLength: streakType ? Math.max(0, int(t.streakLength)) : 0,
      roster: readRoster(t.roster),
    });
  }
  return out;
}

function readSide(side, byId) {
  if (!isObj(side) || side.teamId == null) return null;
  const team = byId[side.teamId];
  if (!team) return null;
  const projected = side.projected == null ? null : num(side.projected, NaN);
  return {
    id: team.id,
    points: round2(side.points),
    projected: Number.isFinite(projected) ? round2(projected) : null,
  };
}

/** Two-sided games only. A bye (away: null) is not a matchup and is left out. */
function readGames(list, byId, regWeeks) {
  const out = [];
  for (const m of arr(list)) {
    if (!isObj(m)) continue;
    const week = int(m.week);
    if (week < 1) continue;
    const home = readSide(m.home, byId);
    const away = readSide(m.away, byId);
    if (!home || !away || home.id === away.id) continue;
    const w = str(m.winner).toLowerCase();
    const winner = w === 'home' || w === 'away' || w === 'tie' ? w : 'undecided';
    const playoff = typeof m.playoff === 'boolean' ? m.playoff : regWeeks > 0 && week > regWeeks;
    out.push({
      week,
      playoff,
      bracket: str(m.bracket).toUpperCase() || 'NONE',
      homeId: home.id,
      awayId: away.id,
      homePts: home.points,
      awayPts: away.points,
      homeProj: home.projected,
      awayProj: away.projected,
      winner,
      decided: winner !== 'undecided',
    });
  }
  out.sort((a, b) => a.week - b.week);
  return out;
}

// ---------- small pure pieces ----------

function viewGame(g, status) {
  return {
    week: g.week,
    homeId: g.homeId,
    awayId: g.awayId,
    homePts: g.homePts,
    awayPts: g.awayPts,
    homeProj: g.homeProj,
    awayProj: g.awayProj,
    status,
    winnerId: g.winner === 'home' ? g.homeId : g.winner === 'away' ? g.awayId : null,
    margin: round2(Math.abs(g.homePts - g.awayPts)),
    playoff: g.playoff,
    bracket: g.bracket,
  };
}

/** Result of a decided game from one team's side: 'W' | 'L' | 'T'. */
function resultFor(g, id) {
  if (g.winner === 'tie') return 'T';
  const homeSide = g.homeId === id;
  return (g.winner === 'home') === homeSide ? 'W' : 'L';
}

/** Regular-season standings from decided games in weeks 1..throughWeek. */
function tallyThrough(teams, regular, throughWeek) {
  const t = {};
  for (const team of teams) t[team.id] = { wins: 0, losses: 0, ties: 0, pointsFor: 0, games: 0 };
  let counted = 0;
  for (const g of regular) {
    if (!g.decided || g.week > throughWeek) continue;
    counted++;
    for (const id of [g.homeId, g.awayId]) {
      const row = t[id];
      const r = resultFor(g, id);
      row.games++;
      row.pointsFor += id === g.homeId ? g.homePts : g.awayPts;
      if (r === 'W') row.wins++;
      else if (r === 'L') row.losses++;
      else row.ties++;
    }
  }
  return { rows: t, counted };
}

function orderByRecord(teams, rows) {
  return teams
    .slice()
    .sort((a, b) => {
      const ra = rows[a.id];
      const rb = rows[b.id];
      return (
        winPct(rb.wins, rb.losses, rb.ties) - winPct(ra.wins, ra.losses, ra.ties) ||
        rb.pointsFor - ra.pointsFor ||
        compareIds(a.id, b.id)
      );
    })
    .map((t) => t.id);
}

/**
 * Before week 1 there is no table yet, so everyone keeps the address they earned last season:
 * the champion stays on The Hill until somebody plays a game. Teams that were not in the league
 * last season go to the back, in id order. Returns null when there is no earlier season to use.
 */
function lastSeasonOrder(history, season, teams) {
  const earlier = arr(isObj(history) ? history.seasons : null)
    .filter((s) => isObj(s) && int(s.season) > 0 && (season <= 0 || int(s.season) < season))
    .sort((a, b) => int(b.season) - int(a.season));
  if (!earlier.length) return null;
  const finish = new Map();
  for (const t of arr(earlier[0].teams)) {
    if (isObj(t) && t.id != null && int(t.finalRank) > 0 && !finish.has(String(t.id))) finish.set(String(t.id), int(t.finalRank));
  }
  if (!teams.some((t) => finish.has(String(t.id)))) return null;
  const spot = (t) => (finish.has(String(t.id)) ? finish.get(String(t.id)) : Number.MAX_SAFE_INTEGER);
  return teams
    .slice()
    .sort((a, b) => spot(a) - spot(b) || compareIds(a.id, b.id))
    .map((t) => t.id);
}

/**
 * Conservative clinch and elimination math, tiebreakers ignored.
 * rows: [{ id, value (wins, a tie is half), max (value + games left) }]
 */
function clinchFlags(rows, playoffTeams) {
  const out = {};
  for (const me of rows) {
    let canCatch = 0;
    let alreadyPast = 0;
    for (const other of rows) {
      if (other.id === me.id) continue;
      if (other.max >= me.value) canCatch++;
      if (other.value > me.max) alreadyPast++;
    }
    out[me.id] = { clinched: canCatch < playoffTeams, eliminated: alreadyPast >= playoffTeams };
  }
  return out;
}

function lineupNotes(roster) {
  if (!roster) return [];
  const notes = [];
  const counts = {};
  for (const slot of roster.emptyStarters) counts[slot] = (counts[slot] || 0) + 1;
  for (const slot of Object.keys(counts)) {
    notes.push(counts[slot] > 1 ? `${counts[slot]} ${slot} slots are empty` : `${slot} is empty`);
  }
  for (const p of roster.badStarters) notes.push(p.why ? `Starting ${p.name} (${p.why})` : `Starting ${p.name}`);
  return notes;
}

function emptyModel(src, lg, historyIsSample) {
  return {
    meta: {
      leagueName: str(lg.name),
      season: int(lg.season),
      week: Math.max(1, int(lg.currentWeek, 1)),
      regularSeasonWeeks: Math.max(0, int(lg.regularSeasonWeeks)),
      playoffTeamCount: Math.max(0, int(lg.playoffTeamCount)),
      teamCount: 0,
      phase: lg.seasonComplete === true ? 'complete' : 'preseason',
      isSample: src.source !== 'espn',
      historyIsSample,
      generatedAt: typeof src.generatedAt === 'string' ? src.generatedAt : null,
      weekStatus: 'pre',
      nflLive: false,
      nextKickoff: null,
    },
    cutLine: Math.max(0, int(lg.playoffTeamCount)),
    order: [],
    tiers: { hill: [], heights: [], bubble: [], park: [], dump: [] },
    teams: {},
    matchups: [],
    lastWeek: null,
    headlines: [],
    blimp: '',
    history: null,
    playoffs: null,
    graveyard: [],
  };
}

// ---------- derive ----------

export function derive(league, history, opts) {
  const src = isObj(league) ? league : {};
  const lg = isObj(src.league) ? src.league : {};
  const historyIsSample = isObj(history) && history.source !== 'espn';

  const teams = readTeams(src.teams);
  const N = teams.length;
  if (N === 0) return emptyModel(src, lg, historyIsSample);

  const byId = {};
  for (const t of teams) byId[t.id] = t;

  const season = int(lg.season);
  const regWeeks = Math.max(0, int(lg.regularSeasonWeeks));
  let P = int(lg.playoffTeamCount);
  if (P < 1) P = Math.max(1, Math.floor(N / 2));
  if (P > N) P = N;

  const games = readGames(src.matchups, byId, regWeeks);
  const regular = games.filter((g) => !g.playoff);

  let week = int(lg.currentWeek);
  if (week < 1) {
    const open = games.filter((g) => !g.decided).map((g) => g.week);
    week = open.length ? Math.min(...open) : games.length ? games[games.length - 1].week : 1;
  }

  // ----- the real-world clock -----
  const nowMs = toMs(opts && opts.now);
  let nflLive = false;
  let nextKickoff = null;
  if (nowMs != null) {
    const kicks = arr(src.nfl && src.nfl.kickoffs)
      .map((raw) => ({ raw, ms: toMs(raw) }))
      .filter((k) => k.ms != null && typeof k.raw === 'string')
      .sort((a, b) => a.ms - b.ms);
    for (const k of kicks) {
      if (k.ms <= nowMs && nowMs <= k.ms + KICKOFF_WINDOW_MS) nflLive = true;
      if (k.ms > nowMs && nextKickoff == null) nextKickoff = k.raw;
    }
  }

  // ----- this week -----
  const statusOf = (g) => (g.decided ? 'final' : g.homePts > 0 || g.awayPts > 0 || nflLive ? 'live' : 'pre');
  const currentGames = games.filter((g) => g.week === week);
  const matchups = currentGames.map((g) => viewGame(g, statusOf(g)));
  let weekStatus = 'pre';
  if (matchups.length) {
    if (matchups.every((m) => m.status === 'final')) weekStatus = 'final';
    else if (matchups.some((m) => m.status !== 'pre')) weekStatus = 'live';
  } else if (lg.seasonComplete === true) {
    weekStatus = 'final';
  }

  // ----- the last fully completed week (L) -----
  const weekAllDecided = {};
  for (const g of games) {
    if (g.week > week) continue;
    weekAllDecided[g.week] = (weekAllDecided[g.week] !== false) && g.decided;
  }
  let L = null;
  for (const key of Object.keys(weekAllDecided)) {
    const w = Number(key);
    if (weekAllDecided[key] && (L == null || w > L)) L = w;
  }

  // ----- phase -----
  const anyDecided = games.some((g) => g.decided);
  const anyRecord = teams.some((t) => t.wins + t.losses + t.ties > 0);
  let phase = 'regular';
  if (lg.seasonComplete === true) phase = 'complete';
  else if (regWeeks > 0 && week > regWeeks) phase = 'playoffs';
  else if (!anyDecided && !anyRecord && weekStatus === 'pre' && week <= 1) phase = 'preseason';
  const regularOver = phase === 'playoffs' || phase === 'complete' || (regWeeks > 0 && L != null && L >= regWeeks);

  // ----- rank -----
  const recordRows = {};
  for (const t of teams) recordRows[t.id] = t;
  const seedOk = uniquePositive(teams.map((t) => t.seed));
  const finalOk = lg.seasonComplete === true && uniquePositive(teams.map((t) => t.finalRank));
  const seedOrder = seedOk ? teams.slice().sort((a, b) => a.seed - b.seed).map((t) => t.id) : null;
  const carriedOrder = phase === 'preseason' ? lastSeasonOrder(history, season, teams) : null;
  let order;
  if (finalOk) order = teams.slice().sort((a, b) => a.finalRank - b.finalRank).map((t) => t.id);
  else if (carriedOrder) order = carriedOrder;
  else if (seedOrder) order = seedOrder;
  else order = orderByRecord(teams, recordRows);

  // ----- standings one completed week earlier -----
  let prevOrder = null;
  if (L != null && L >= 2) {
    if (regWeeks > 0 && L > regWeeks) {
      // The regular-season table is frozen during the playoffs. Once final ranks land, the
      // "before" picture is the seeding the playoffs started from.
      prevOrder = finalOk ? seedOrder || orderByRecord(teams, recordRows) : order.slice();
    } else {
      const before = tallyThrough(teams, regular, L - 1);
      if (before.counted > 0) prevOrder = orderByRecord(teams, before.rows);
    }
  }

  // ----- per-team game logs -----
  const regularDecided = {};
  const remaining = {};
  for (const t of teams) {
    regularDecided[t.id] = [];
    remaining[t.id] = 0;
  }
  for (const g of regular) {
    for (const id of [g.homeId, g.awayId]) {
      if (g.decided) regularDecided[id].push(g);
      else remaining[id]++;
    }
  }
  if (!regular.length) {
    for (const t of teams) remaining[t.id] = Math.max(0, regWeeks - (t.wins + t.losses + t.ties));
  }

  // ----- luck: all-play record over completed regular-season weeks -----
  const regWeekGames = {};
  for (const g of regular) {
    if (g.week > week) continue;
    (regWeekGames[g.week] || (regWeekGames[g.week] = [])).push(g);
  }
  const luckRows = {};
  for (const t of teams) luckRows[t.id] = { apw: 0, apl: 0, games: 0, wins: 0 };
  let luckWeeks = 0;
  for (const key of Object.keys(regWeekGames)) {
    const list = regWeekGames[key];
    if (!list.every((g) => g.decided)) continue;
    luckWeeks++;
    const scores = [];
    for (const g of list) {
      scores.push([g.homeId, g.homePts], [g.awayId, g.awayPts]);
      for (const id of [g.homeId, g.awayId]) {
        const r = resultFor(g, id);
        luckRows[id].games++;
        luckRows[id].wins += r === 'W' ? 1 : r === 'T' ? 0.5 : 0;
      }
    }
    for (const [id, pts] of scores) {
      for (const [otherId, otherPts] of scores) {
        if (otherId === id) continue;
        if (pts > otherPts) luckRows[id].apw++;
        else if (pts < otherPts) luckRows[id].apl++;
      }
    }
  }
  const luck = {};
  for (const t of teams) {
    const r = luckRows[t.id];
    const total = r.apw + r.apl;
    const expected = total > 0 ? (r.apw / total) * r.games : 0;
    luck[t.id] = {
      allPlayWins: r.apw,
      allPlayLosses: r.apl,
      expectedWins: round2(expected),
      delta: total > 0 ? round2(r.wins - expected) : 0,
    };
  }
  let luckiestId = null;
  let unluckiestId = null;
  if (luckWeeks >= LUCK_MIN_WEEKS && N >= 2) {
    const byId2 = teams.slice().sort((a, b) => compareIds(a.id, b.id));
    for (const t of byId2) {
      if (luckiestId == null || luck[t.id].delta > luck[luckiestId].delta) luckiestId = t.id;
    }
    for (const t of byId2) {
      if (t.id === luckiestId) continue;
      if (unluckiestId == null || luck[t.id].delta < luck[unluckiestId].delta) unluckiestId = t.id;
    }
  }

  // ----- last completed week -----
  let lastWeek = null;
  if (L != null) {
    const results = games.filter((g) => g.week === L).map((g) => viewGame(g, 'final'));
    if (results.length) {
      const scores = [];
      for (const r of results) scores.push([r.homeId, r.homePts], [r.awayId, r.awayPts]);
      // Lowest score first. Ties go to the lower team id for the toilet, the higher for the spotlight,
      // so the two trophies never land on the same lawn.
      scores.sort((a, b) => a[1] - b[1] || compareIds(a[0], b[0]));
      lastWeek = { week: L, results, lowScoreId: scores[0][0], highScoreId: scores[scores.length - 1][0] };
    }
  }

  // ----- clinched / eliminated -----
  const rankOf = {};
  order.forEach((id, i) => { rankOf[id] = i + 1; });
  let flags;
  if (regularOver) {
    flags = {};
    for (const t of teams) flags[t.id] = { clinched: rankOf[t.id] <= P, eliminated: rankOf[t.id] > P };
  } else {
    flags = clinchFlags(
      teams.map((t) => {
        const value = t.wins + t.ties * 0.5;
        return { id: t.id, value, max: value + remaining[t.id] };
      }),
      P,
    );
  }
  // What the same math said one completed week earlier, so the paper can report news.
  const newlyClinched = [];
  const newlyEliminated = [];
  if (L != null && regular.length && (regWeeks === 0 || L <= regWeeks) && phase !== 'preseason') {
    const before = tallyThrough(teams, regular, L - 1).rows;
    const leftBefore = {};
    for (const t of teams) leftBefore[t.id] = 0;
    for (const g of regular) {
      if (g.week >= L) { leftBefore[g.homeId]++; leftBefore[g.awayId]++; }
    }
    const prevFlags = clinchFlags(
      teams.map((t) => {
        const value = before[t.id].wins + before[t.id].ties * 0.5;
        return { id: t.id, value, max: value + leftBefore[t.id] };
      }),
      P,
    );
    for (const id of order) {
      if (flags[id].clinched && !prevFlags[id].clinched) newlyClinched.push(id);
      if (flags[id].eliminated && !prevFlags[id].eliminated) newlyEliminated.push(id);
    }
  }

  // ----- team models -----
  const labels = teamLabels(teams);
  const colorIndex = {};
  teams.slice().sort((a, b) => compareIds(a.id, b.id)).forEach((t, i) => { colorIndex[t.id] = i; });
  const prevRankOf = {};
  if (prevOrder) prevOrder.forEach((id, i) => { prevRankOf[id] = i + 1; });

  const tiers = { hill: [], heights: [], bubble: [], park: [], dump: [] };
  const teamModels = {};
  const lastWinWeek = {};
  const lastLossWeek = {};

  for (const id of order) {
    const t = byId[id];
    const rank = rankOf[id];
    const tier = tierForRank(rank, N, P);
    const slot = tiers[tier].length;
    tiers[tier].push(id);

    const prevRank = prevOrder ? prevRankOf[id] : null;
    const prevTier = prevRank != null ? tierForRank(prevRank, N, P) : null;
    let tierMove = null;
    if (prevTier && prevTier !== tier) tierMove = tierIndex(tier) < tierIndex(prevTier) ? 'up' : 'down';

    // Game log walk: trash bags, last win, last loss, and a streak if ESPN did not send one.
    const log = regularDecided[id];
    let bags = 0;
    let runType = null;
    let runLength = 0;
    lastWinWeek[id] = null;
    lastLossWeek[id] = null;
    for (const g of log) {
      const r = resultFor(g, id);
      if (r === 'L') { bags = Math.min(MAX_TRASH_BAGS, bags + 1); lastLossWeek[id] = g.week; }
      else if (r === 'W') { bags = Math.max(0, bags - 1); lastWinWeek[id] = g.week; }
      if (r === runType) runLength++;
      else { runType = r; runLength = 1; }
    }
    let streak = { type: t.streakType, length: t.streakLength };
    if (!streak.type || streak.length < 1) streak = runType ? { type: runType, length: runLength } : { type: null, length: 0 };
    if (!log.length) bags = streak.type === 'L' ? Math.min(MAX_TRASH_BAGS, streak.length) : 0;

    // This week and last week from this team's side.
    let thisWeek = null;
    const cur = matchups.find((m) => m.homeId === id || m.awayId === id);
    if (cur) {
      const home = cur.homeId === id;
      const pts = home ? cur.homePts : cur.awayPts;
      const oppPts = home ? cur.awayPts : cur.homePts;
      let winning = null;
      if (cur.status === 'final') winning = cur.winnerId == null ? null : cur.winnerId === id;
      else if (cur.status === 'live') winning = pts > oppPts ? true : pts < oppPts ? false : null;
      thisWeek = {
        oppId: home ? cur.awayId : cur.homeId,
        pts,
        oppPts,
        proj: home ? cur.homeProj : cur.awayProj,
        oppProj: home ? cur.awayProj : cur.homeProj,
        status: cur.status,
        winning,
      };
    }
    let lastGame = null;
    const prev = lastWeek ? lastWeek.results.find((m) => m.homeId === id || m.awayId === id) : null;
    if (prev) {
      const home = prev.homeId === id;
      lastGame = {
        oppId: home ? prev.awayId : prev.homeId,
        pts: home ? prev.homePts : prev.awayPts,
        oppPts: home ? prev.awayPts : prev.homePts,
        won: prev.winnerId == null ? null : prev.winnerId === id,
        margin: prev.margin,
      };
    }

    const roster = t.roster;
    teamModels[id] = {
      id,
      name: t.name,
      abbrev: t.abbrev,
      owner: t.owner,
      ownerKey: t.ownerKey,
      color: TEAM_COLORS[colorIndex[id] % TEAM_COLORS.length],
      rank,
      prevRank,
      rankDelta: prevRank != null ? prevRank - rank : 0,
      tier,
      prevTier,
      tierMove,
      slot,
      record: { wins: t.wins, losses: t.losses, ties: t.ties, text: recordText(t.wins, t.losses, t.ties) },
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      streak,
      inPlayoffSpot: rank <= P,
      onCutLine: rank === P || rank === P + 1,
      clinched: flags[id].clinched,
      eliminated: flags[id].eliminated,
      trashBags: bags,
      flamingos: streak.type === 'W' && streak.length >= 2 ? Math.min(MAX_FLAMINGOS, streak.length) : 0,
      ir: { count: roster ? roster.ir.length : 0, names: roster ? roster.ir.map((p) => p.name) : [] },
      goalposts: !roster ? 'up' : roster.emptyStarters.length ? 'down' : roster.badStarters.length ? 'crooked' : 'up',
      lineupNotes: lineupNotes(roster),
      thisWeek,
      lastWeek: lastGame,
      beatLastWeek: lastGame && lastGame.won === true ? lastGame.oppId : null,
      luck: luck[id],
      luckTag: id === luckiestId ? 'luckiest' : id === unluckiestId ? 'unluckiest' : null,
      trophy: {
        toilet: !!lastWeek && lastWeek.lowScoreId === id,
        spotlight: !!lastWeek && lastWeek.highScoreId === id,
      },
      history: null,
      roast: { arrival: '', mailbox: [], sign: '' },
    };
  }

  // ----- history -----
  let historyModel = null;
  let onThisWeek = [];
  let built = null;
  try {
    built = buildHistory(history, {
      season,
      week,
      teamCount: N,
      rankOf,
      teams: order.map((id) => ({
        id,
        name: byId[id].name,
        owner: byId[id].owner,
        ownerKey: byId[id].ownerKey,
        label: labels[id],
      })),
      games: games
        .filter((g) => g.decided)
        .map((g) => ({
          week: g.week,
          homeId: g.homeId,
          awayId: g.awayId,
          homePts: g.homePts,
          awayPts: g.awayPts,
          kind: !g.playoff ? 0 : g.bracket === 'CONSOLATION' ? 2 : 1,
        })),
    });
  } catch (e) {
    built = null; // malformed history: show the world without it
  }
  if (built) {
    historyModel = built.model;
    onThisWeek = built.onThisWeek;
    for (const id of order) teamModels[id].history = built.owners[byId[id].ownerKey] || null;
  }

  // ----- assemble -----
  const model = {
    meta: {
      leagueName: str(lg.name),
      season,
      week,
      regularSeasonWeeks: regWeeks,
      playoffTeamCount: P,
      teamCount: N,
      phase,
      isSample: src.source !== 'espn',
      historyIsSample,
      generatedAt: typeof src.generatedAt === 'string' ? src.generatedAt : null,
      weekStatus,
      nflLive,
      nextKickoff,
    },
    cutLine: P,
    order,
    tiers,
    teams: teamModels,
    matchups,
    lastWeek,
    headlines: [],
    blimp: '',
    history: historyModel,
    playoffs: null,
    graveyard: [],
  };

  // ----- extras: the playoff picture and the draft graveyard -----
  try {
    model.playoffs = buildPlayoffs({
      seeding: seedOrder || (phase === 'complete' ? orderByRecord(teams, recordRows) : order),
      teams,
      P,
      regWeeks,
      games,
      phase,
      statusOf,
      championId: finalOk ? order[0] : null,
    });
  } catch (e) {
    model.playoffs = null;
  }
  try {
    model.graveyard = buildGraveyard(src, { week, season, phase });
  } catch (e) {
    model.graveyard = [];
  }

  // ----- the copy -----
  const lineupsRaw = isObj(src.lastWeekLineups) && isObj(src.lastWeekLineups.teams) ? src.lastWeekLineups : null;
  const benchTop = {};
  if (lineupsRaw && L != null && int(lineupsRaw.week) === L) {
    for (const id of order) {
      const row = lineupsRaw.teams[id];
      const top = isObj(row) && isObj(row.benchTop) ? row.benchTop : null;
      const points = top ? num(top.points, NaN) : NaN;
      if (!top || !str(top.name) || !Number.isFinite(points)) continue;
      const low = isObj(row.starterLow) ? row.starterLow : null;
      const lowPoints = low ? num(low.points, NaN) : NaN;
      const lowOk = !!low && !!str(low.name) && Number.isFinite(lowPoints);
      // "You started X over Y" is only a fair thing to say when X and Y play the same position.
      const samePos = lowOk && !!str(top.pos) && str(top.pos).toUpperCase() === str(low.pos).toUpperCase();
      benchTop[id] = {
        name: str(top.name),
        points: round2(points),
        lowName: samePos ? str(low.name) : '',
        lowPoints: samePos ? round2(lowPoints) : null,
      };
    }
  }
  const rosterCrimes = {};
  for (const id of order) {
    const roster = byId[id].roster;
    rosterCrimes[id] = {
      empty: roster ? roster.emptyStarters.slice() : [],
      bad: roster ? roster.badStarters.map((p) => ({ name: p.name, why: p.why })) : [],
    };
  }
  // Winners-bracket losses: who is out of the title hunt, and since when.
  const knockedOut = {};
  for (const g of games) {
    if (!g.playoff || g.bracket === 'CONSOLATION' || !g.decided || g.winner === 'tie') continue;
    const loser = g.winner === 'home' ? g.awayId : g.homeId;
    if (knockedOut[loser] == null) knockedOut[loser] = g.week;
  }
  try {
    composeCopy(model, {
      labels,
      knockedOut,
      lastCompletedWeek: L,
      weeksLeft: regularOver ? 0 : Math.max(0, regWeeks - (L || 0)),
      regularOver,
      remaining,
      benchTop,
      rosterCrimes,
      newlyClinched,
      newlyEliminated,
      onThisWeek,
      lastWinWeek,
      lastLossWeek,
    });
  } catch (e) {
    // Copy is decoration. The world still renders with empty lines.
  }

  return model;
}
