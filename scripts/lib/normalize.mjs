/**
 * normalize.mjs
 *
 * Pure functions (no network, no disk) that turn raw ESPN fantasy football JSON into the
 * files the world reads:
 *
 *   normalizeLeague(...)  -> world/data/league.json   (Contract 1 in world/ARCHITECTURE.md)
 *   normalizeSeason(...)  -> one season of world/data/history.json (Contract 2)
 *   validate(...)         -> list of problems with a league.json object ([] means good)
 *
 * The roster, matchup and draft views could not be checked against the live league when
 * this was written (the league was private). Everything here is therefore defensive:
 * a missing or odd-looking optional piece becomes null / [] instead of throwing.
 *
 * Privacy rules enforced here:
 *   - owner is a first name only. Last names, display names, emails and member GUIDs are
 *     never copied into the output. ownerKey is a short one-way hash of the member GUID.
 *   - ESPN logo fields are never read.
 */

import { createHash } from 'node:crypto';

export const SCHEMA = 1;

/** ESPN lineup slot id -> label used in league.json. */
export const SLOT_LABELS = Object.freeze({
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP',
  8: 'DT', 9: 'DE', 10: 'LB', 11: 'DL', 12: 'CB', 13: 'S', 14: 'DB', 15: 'DP',
  16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BE', 21: 'IR', 23: 'FLEX',
});
export const BENCH_SLOT = 20;
export const IR_SLOT = 21;
const NON_STARTING_SLOTS = new Set([BENCH_SLOT, IR_SLOT]);
/** Order starters are listed in (anything not listed sorts after, by slot id). */
const SLOT_ORDER = [0, 1, 2, 3, 4, 5, 6, 23, 7, 16, 17, 18, 19];

/** ESPN defaultPositionId -> label. */
export const POSITION_LABELS = Object.freeze({
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 7: 'P', 9: 'DT', 10: 'DE', 11: 'LB',
  12: 'CB', 13: 'S', 14: 'HC', 16: 'D/ST',
});
const UNKNOWN_POS = '?';
const UNKNOWN_PLAYER = 'Unknown player';

/** injuryStatus values that mean a starter cannot score, and what we call them. */
const BAD_STATUS = Object.freeze({ OUT: 'OUT', INJURY_RESERVE: 'IR', SUSPENSION: 'SUSPENDED' });

const WINNER = Object.freeze({ HOME: 'home', AWAY: 'away', TIE: 'tie', UNDECIDED: 'undecided' });
const BRACKET = Object.freeze({
  NONE: 'NONE',
  WINNERS_BRACKET: 'WINNERS',
  LOSERS_CONSOLATION_LADDER: 'CONSOLATION',
  WINNERS_CONSOLATION_LADDER: 'CONSOLATION',
});

// ---------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, fallback = 0) => (isNum(v) ? v : fallback);
const int = (v, fallback = 0) => (isNum(v) ? Math.trunc(v) : fallback);
const str = (v) => (typeof v === 'string' ? v : '');

/** Round to 2 decimals without the classic 1.005 surprise. */
export function round2(v) {
  if (!isNum(v)) return 0;
  const r = Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** ISO timestamp without milliseconds, e.g. 2026-11-16T03:10:00Z. */
export function isoNoMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Control characters, line/paragraph separators, zero-width space and BOM. Built from code
// points so this file stays plain ASCII. The zero-width JOINER is kept: emoji need it.
const JUNK_CHARS = new RegExp(`[\\p{Cc}\\p{Zl}\\p{Zp}${String.fromCharCode(0x200b, 0xfeff)}]`, 'gu');

/** Trim, collapse whitespace, drop control characters. Emoji and symbols survive. */
export function cleanText(value, maxLength = 80) {
  const s = str(value).replace(JUNK_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, maxLength).join('');
}

/** First name only: first word of firstName. Anything that looks like more than a name is dropped. */
export function firstNameOnly(member) {
  if (!isObj(member)) return '';
  const first = cleanText(member.firstName, 40).split(' ')[0] || '';
  if (!first || /[@\d{}/\\]/.test(first)) return '';
  const word = Array.from(first).slice(0, 20).join('');
  if (word.length > 1 && (word === word.toLowerCase() || word === word.toUpperCase())) {
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }
  return word;
}

/**
 * Stable, anonymous key for a manager: "o_" + first 8 hex chars of sha256(member GUID).
 * Braces and letter case are ignored so a formatting change at ESPN does not change the key.
 * With no member id it falls back to "t_<teamId>".
 */
export function ownerKeyFor(memberId, teamId) {
  const id = str(memberId).replace(/[{}\s]/g, '').toUpperCase();
  if (!id) return `t_${teamId}`;
  return 'o_' + createHash('sha256').update(id).digest('hex').slice(0, 8);
}

function slotLabel(slotId) {
  return SLOT_LABELS[slotId] ?? 'FLEX'; // unknown starting slots read as FLEX
}

function slotRank(slotId) {
  const i = SLOT_ORDER.indexOf(slotId);
  return i === -1 ? 100 + int(slotId) : i;
}

function isStartingSlot(slotId) {
  return Number.isInteger(slotId) && slotId >= 0 && !NON_STARTING_SLOTS.has(slotId);
}

// ---------------------------------------------------------------------------------------
// Players and rosters
// ---------------------------------------------------------------------------------------

function playerOf(entry) {
  const p = entry?.playerPoolEntry?.player;
  return isObj(p) ? p : null;
}

function playerIdOf(entry) {
  const id = playerOf(entry)?.id ?? entry?.playerPoolEntry?.id ?? entry?.playerId;
  return isNum(id) ? id : null;
}

function playerName(player) {
  if (!isObj(player)) return '';
  return cleanText(player.fullName, 60) || cleanText(`${str(player.firstName)} ${str(player.lastName)}`, 60);
}

function playerPos(player) {
  return POSITION_LABELS[player?.defaultPositionId] ?? UNKNOWN_POS;
}

/**
 * A player's fantasy points for one scoring period from player.stats[].
 * sourceId 0 = actual, 1 = projected. statSplitTypeId 1 = a single week
 * (0 would be the season total, which we must not confuse with a week).
 * Returns null when there is no such line.
 */
export function statFor(player, scoringPeriod, sourceId) {
  for (const s of arr(player?.stats)) {
    if (!isObj(s)) continue;
    if (s.scoringPeriodId !== scoringPeriod || s.statSourceId !== sourceId) continue;
    if (s.statSplitTypeId !== undefined && s.statSplitTypeId !== 1) continue;
    if (isNum(s.appliedTotal)) return round2(s.appliedTotal);
  }
  return null;
}

/**
 * Set of pro team ids that have no game in the given scoring period, or null when the
 * pro schedule is unavailable (in which case nobody is flagged as on bye).
 */
export function byeTeamsForPeriod(proSchedule, scoringPeriod) {
  const proTeams = proSchedule?.settings?.proTeams;
  if (!Array.isArray(proTeams) || !Number.isInteger(scoringPeriod) || scoringPeriod < 1) return null;
  const byes = new Set();
  let sawSchedule = false;
  let lastWeek = 0;
  for (const t of proTeams) {
    for (const k of Object.keys(isObj(t?.proGamesByScoringPeriod) ? t.proGamesByScoringPeriod : {})) {
      const w = Number(k);
      if (Number.isInteger(w) && w > lastWeek) lastWeek = w;
    }
  }
  for (const t of proTeams) {
    if (!isObj(t) || !isNum(t.id) || t.id === 0) continue; // id 0 is "free agent"
    if (Number.isInteger(t.byeWeek) && t.byeWeek > 0) {
      sawSchedule = true;
      if (t.byeWeek === scoringPeriod) byes.add(t.id);
    } else if (isObj(t.proGamesByScoringPeriod) && lastWeek > 0) {
      sawSchedule = true;
      const games = t.proGamesByScoringPeriod[String(scoringPeriod)];
      if (scoringPeriod <= lastWeek && arr(games).length === 0) byes.add(t.id);
    }
  }
  return sawSchedule ? byes : null;
}

/** Starting slot counts as { label: count } in display order. May be {}. */
export function starterSlotsFrom(lineupSlotCounts) {
  if (!isObj(lineupSlotCounts)) return {};
  const ids = Object.keys(lineupSlotCounts)
    .map(Number)
    .filter((id) => isStartingSlot(id) && int(lineupSlotCounts[String(id)]) > 0)
    .sort((a, b) => slotRank(a) - slotRank(b));
  const out = {};
  for (const id of ids) {
    const label = slotLabel(id);
    out[label] = (out[label] ?? 0) + int(lineupSlotCounts[String(id)]);
  }
  return out;
}

/**
 * Normalize one team's roster for the current scoring period.
 *   entries            raw roster.entries[]
 *   scoringPeriod      the scoring period the lineup is for
 *   lineupSlotCounts   settings.rosterSettings.lineupSlotCounts (may be missing)
 *   byeTeams           Set of pro team ids on bye, or null
 *   periodPoints       Map playerId -> points for this period (from the matchup roster), optional
 */
export function normalizeRoster(entries, { scoringPeriod, lineupSlotCounts, byeTeams = null, periodPoints = null } = {}) {
  if (!Array.isArray(entries)) return null;
  const starters = [];
  const bench = [];
  const ir = [];
  const badStarters = [];
  const filled = new Map();

  for (const entry of entries) {
    if (!isObj(entry)) continue;
    const slotId = entry.lineupSlotId;
    if (!Number.isInteger(slotId)) continue;
    const player = playerOf(entry);
    const name = playerName(player) || UNKNOWN_PLAYER;
    const pos = playerPos(player);

    if (slotId === IR_SLOT) {
      ir.push({ name, pos });
      continue;
    }

    const hasStats = Array.isArray(player?.stats);
    let points = statFor(player, scoringPeriod, 0);
    if (points === null) {
      const id = playerIdOf(entry);
      if (periodPoints && id !== null && periodPoints.has(id)) points = periodPoints.get(id);
      else if (hasStats) points = 0; // stats came back, no actual line yet: has not played
    }
    const projected = statFor(player, scoringPeriod, 1);

    if (slotId === BENCH_SLOT) {
      bench.push({ name, pos, slot: 'BE', points, projected });
      continue;
    }

    filled.set(slotId, (filled.get(slotId) ?? 0) + 1);
    const slot = slotLabel(slotId);
    starters.push({ _rank: slotRank(slotId), name, pos, slot, points, projected });

    const status = str(player?.injuryStatus).toUpperCase();
    let why = BAD_STATUS[status] ?? null;
    if (!why && byeTeams && isNum(player?.proTeamId) && byeTeams.has(player.proTeamId)) why = 'BYE';
    if (why) badStarters.push({ _rank: slotRank(slotId), name, pos, slot, why });
  }

  const emptyStarters = [];
  if (isObj(lineupSlotCounts)) {
    const ids = Object.keys(lineupSlotCounts).map(Number).filter(isStartingSlot).sort((a, b) => slotRank(a) - slotRank(b));
    for (const id of ids) {
      const missing = int(lineupSlotCounts[String(id)]) - (filled.get(id) ?? 0);
      for (let i = 0; i < missing; i++) emptyStarters.push(slotLabel(id));
    }
  }

  const strip = ({ _rank, ...rest }) => rest;
  const byRank = (a, b) => a._rank - b._rank;
  return {
    ir,
    emptyStarters,
    badStarters: badStarters.sort(byRank).map(strip),
    starters: starters.sort(byRank).map(strip),
    bench,
  };
}

/** Map playerId -> points for the period, from a matchup side's rosterForCurrentScoringPeriod. */
function periodPointsFromSide(side, scoringPeriod, into) {
  for (const entry of arr(side?.rosterForCurrentScoringPeriod?.entries)) {
    const id = playerIdOf(entry);
    if (id === null) continue;
    const pts = statFor(playerOf(entry), scoringPeriod, 0);
    const applied = entry?.playerPoolEntry?.appliedStatTotal;
    if (pts !== null) into.set(id, pts);
    else if (isNum(applied)) into.set(id, round2(applied));
  }
}

// ---------------------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------------------

function membersById(raw) {
  const map = new Map();
  for (const m of arr(raw?.members)) {
    if (isObj(m) && typeof m.id === 'string' && m.id) map.set(m.id, m);
  }
  return map;
}

function teamName(t) {
  const name = cleanText(t?.name);
  if (name) return name;
  const joined = cleanText(`${str(t?.location)} ${str(t?.nickname)}`); // seasons before the single name field
  if (joined) return joined;
  return `Team ${int(t?.id)}`;
}

function ownerOf(t, members) {
  const candidates = [];
  if (typeof t?.primaryOwner === 'string' && t.primaryOwner) candidates.push(t.primaryOwner);
  for (const o of arr(t?.owners)) if (typeof o === 'string' && o) candidates.push(o);
  const memberId = candidates[0] ?? '';
  const known = candidates.find((id) => members.has(id));
  return {
    owner: known ? firstNameOnly(members.get(known)) : '',
    ownerKey: ownerKeyFor(memberId, int(t?.id)),
  };
}

function streakOf(overall) {
  const length = Math.max(0, int(overall?.streakLength));
  const type = str(overall?.streakType).toUpperCase();
  if (length === 0 || !['WIN', 'LOSS', 'TIE'].includes(type)) return { streakType: 'NONE', streakLength: 0 };
  return { streakType: type, streakLength: length };
}

function baseTeam(t, members) {
  const overall = isObj(t?.record?.overall) ? t.record.overall : {};
  return {
    id: t.id,
    name: teamName(t),
    ...ownerOf(t, members),
    seed: Math.max(0, int(t.playoffSeed)),
    finalRank: Math.max(0, int(t.rankCalculatedFinal)),
    // The record is the heart of the data. If ESPN did not send it, say so (null) instead of
    // inventing 0-0: validation then refuses the whole response and the old file is kept.
    wins: isNum(overall.wins) ? Math.max(0, int(overall.wins)) : null,
    losses: isNum(overall.losses) ? Math.max(0, int(overall.losses)) : null,
    ties: Math.max(0, int(overall.ties)),
    pointsFor: isNum(overall.pointsFor) ? round2(overall.pointsFor) : isNum(t.points) ? round2(t.points) : null,
    pointsAgainst: isNum(overall.pointsAgainst) ? round2(overall.pointsAgainst) : null,
    _overall: overall,
  };
}

function usableTeams(raw) {
  const seen = new Set();
  const out = [];
  for (const t of arr(raw?.teams)) {
    if (!isObj(t) || !Number.isInteger(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Matchups
// ---------------------------------------------------------------------------------------

function sidePoints(side, useLive) {
  if (useLive) {
    if (isNum(side.totalPointsLive)) return round2(side.totalPointsLive);
    const total = num(side.totalPoints);
    const rosterTotal = side.rosterForCurrentScoringPeriod?.appliedStatTotal;
    if (total === 0 && isNum(rosterTotal)) return round2(rosterTotal);
    return round2(total);
  }
  return round2(num(side.totalPoints));
}

function normalizeSide(side, useLive) {
  if (!isObj(side) || !Number.isInteger(side.teamId)) return null;
  return {
    teamId: side.teamId,
    points: sidePoints(side, useLive),
    projected: useLive && isNum(side.totalProjectedPointsLive) ? round2(side.totalProjectedPointsLive) : null,
  };
}

export function normalizeMatchups(raw, { currentWeek, regularSeasonWeeks, teamIds }) {
  const out = [];
  arr(raw?.schedule).forEach((m, index) => {
    if (!isObj(m) || !Number.isInteger(m.matchupPeriodId) || m.matchupPeriodId < 1) return;
    const winner = WINNER[str(m.winner).toUpperCase()] ?? 'undecided';
    const useLive = winner === 'undecided' && m.matchupPeriodId === currentWeek;
    let home = normalizeSide(m.home, useLive);
    let away = normalizeSide(m.away, useLive);
    if (home && teamIds && !teamIds.has(home.teamId)) home = null;
    if (away && teamIds && !teamIds.has(away.teamId)) away = null;
    if (!home && !away) return;
    let result = winner;
    if (!home) {
      // A bye recorded on the away side: keep the "away is null for a bye" promise.
      home = away;
      away = null;
      result = winner === 'away' ? 'home' : 'undecided';
    } else if (!away && winner !== 'home') {
      result = 'undecided'; // nobody to lose to or tie with
    }
    const tier = str(m.playoffTierType).toUpperCase();
    const bracket = BRACKET[tier] ?? (tier ? 'CONSOLATION' : 'NONE');
    const playoff = tier ? bracket !== 'NONE' : regularSeasonWeeks > 0 && m.matchupPeriodId > regularSeasonWeeks;
    out.push({
      _index: index,
      week: m.matchupPeriodId,
      playoff,
      bracket: tier ? bracket : playoff ? 'WINNERS' : 'NONE',
      home,
      away,
      winner: result,
    });
  });
  out.sort((a, b) => a.week - b.week || a._index - b._index);
  return out.map(({ _index, ...m }) => m);
}

/** The latest week in which every real (non-bye) matchup has a winner. 0 if none. */
export function lastCompletedWeek(matchups) {
  const byWeek = new Map();
  for (const m of arr(matchups)) {
    if (!m.away) continue;
    const s = byWeek.get(m.week) ?? { games: 0, undecided: 0 };
    s.games++;
    if (m.winner === 'undecided') s.undecided++;
    byWeek.set(m.week, s);
  }
  let best = 0;
  for (const [week, s] of byWeek) if (s.games > 0 && s.undecided === 0 && week > best) best = week;
  return best;
}

/**
 * Which week's lineups the sync should ask ESPN for, straight from a raw "current season"
 * response. Returns { week, scoringPeriod } or null when no week is finished yet.
 */
export function lineupRequestFor(rawMain) {
  if (!isObj(rawMain)) return null;
  const matchups = normalizeMatchups(rawMain, {
    currentWeek: int(rawMain.status?.currentMatchupPeriod),
    regularSeasonWeeks: int(rawMain.settings?.scheduleSettings?.matchupPeriodCount),
    teamIds: new Set(usableTeams(rawMain).map((t) => t.id)),
  });
  const week = lastCompletedWeek(matchups);
  if (week < 1) return null;
  // A matchup period can span several scoring periods (two-week playoff rounds). Use the last one.
  const periods = arr(rawMain.settings?.scheduleSettings?.matchupPeriods?.[String(week)]).filter(Number.isInteger);
  return { week, scoringPeriod: periods.length ? Math.max(...periods) : week };
}

// ---------------------------------------------------------------------------------------
// Last week's lineups, draft, kickoffs
// ---------------------------------------------------------------------------------------

function lineupSummary(entries, scoringPeriod) {
  let benchTop = null;
  let starterLow = null;
  let benchTotal = 0;
  let counted = 0;
  for (const entry of arr(entries)) {
    if (!isObj(entry) || !Number.isInteger(entry.lineupSlotId)) continue;
    const slotId = entry.lineupSlotId;
    if (slotId === IR_SLOT) continue;
    const player = playerOf(entry);
    let points = statFor(player, scoringPeriod, 0);
    if (points === null) points = round2(num(entry.playerPoolEntry?.appliedStatTotal));
    const row = { name: playerName(player) || UNKNOWN_PLAYER, pos: playerPos(player), points };
    counted++;
    if (slotId === BENCH_SLOT) {
      benchTotal += points;
      if (!benchTop || points > benchTop.points) benchTop = row;
    } else if (!starterLow || points < starterLow.points) {
      starterLow = row;
    }
  }
  if (counted === 0) return null;
  return { benchTop, starterLow, benchTotal: round2(benchTotal) };
}

/** Contract 1 lastWeekLineups from a "?view=mMatchup&view=mMatchupScore&scoringPeriodId=N" response. */
export function normalizeLastWeekLineups(rawLineups, { week, scoringPeriod, teamIds }) {
  if (!isObj(rawLineups) || !Number.isInteger(week) || week < 1) return null;
  const sp = Number.isInteger(scoringPeriod) ? scoringPeriod : week;
  const teams = {};
  for (const m of arr(rawLineups.schedule)) {
    if (!isObj(m) || m.matchupPeriodId !== week) continue;
    for (const side of [m.home, m.away]) {
      if (!isObj(side) || !Number.isInteger(side.teamId)) continue;
      if (teamIds && !teamIds.has(side.teamId)) continue;
      const entries = side.rosterForCurrentScoringPeriod?.entries ?? side.rosterForMatchupPeriod?.entries;
      const summary = lineupSummary(entries, sp);
      if (summary) teams[String(side.teamId)] = summary;
    }
  }
  return Object.keys(teams).length ? { week, teams } : null;
}

function addPlayersFromEntries(index, entries) {
  for (const entry of arr(entries)) {
    const player = playerOf(entry);
    const id = playerIdOf(entry);
    const name = playerName(player);
    if (id !== null && name && !index.has(id)) index.set(id, { name, pos: playerPos(player) });
  }
}

/** Map playerId -> { name, pos } from every place a raw response names a player. */
export function buildPlayerIndex({ main = null, lineups = null, players = null } = {}) {
  const index = new Map();
  const list = Array.isArray(players) ? players : arr(players?.players);
  for (const item of list) {
    const p = isObj(item?.player) ? item.player : item;
    const name = playerName(p);
    if (isObj(p) && isNum(p.id) && name) index.set(p.id, { name, pos: playerPos(p) });
  }
  for (const raw of [main, lineups]) {
    for (const t of arr(raw?.teams)) addPlayersFromEntries(index, t?.roster?.entries);
    for (const m of arr(raw?.schedule)) {
      for (const side of [m?.home, m?.away]) {
        addPlayersFromEntries(index, side?.rosterForCurrentScoringPeriod?.entries);
        addPlayersFromEntries(index, side?.rosterForMatchupPeriod?.entries);
      }
    }
  }
  return index;
}

/**
 * Contract 1 draft[]. ESPN's draft picks carry only a playerId, so names come from the
 * player index. Picks whose player cannot be named are left out (and counted).
 */
export function normalizeDraft(rawDraft, playerIndex, teamIds) {
  const picks = [];
  let unresolved = 0;
  for (const p of arr(rawDraft?.draftDetail?.picks)) {
    if (!isObj(p) || !Number.isInteger(p.teamId)) continue;
    if (teamIds && !teamIds.has(p.teamId)) continue;
    const known = playerIndex?.get(p.playerId);
    if (!known) {
      unresolved++;
      continue;
    }
    picks.push({
      round: Math.max(0, int(p.roundId)),
      pick: Math.max(0, int(p.roundPickNumber)),
      overall: Math.max(0, int(p.overallPickNumber)),
      teamId: p.teamId,
      name: known.name,
      pos: known.pos,
    });
  }
  picks.sort((a, b) => a.overall - b.overall || a.round - b.round || a.pick - b.pick);
  return { picks, unresolved };
}

/** Sorted, unique ISO kickoff times from a proTeamSchedules response. [] if unavailable. */
export function normalizeKickoffs(proSchedule) {
  const times = new Set();
  for (const t of arr(proSchedule?.settings?.proTeams)) {
    const byPeriod = isObj(t?.proGamesByScoringPeriod) ? t.proGamesByScoringPeriod : {};
    for (const games of Object.values(byPeriod)) {
      for (const g of arr(games)) {
        // Epoch milliseconds. Anything outside 2000..2100 is not a kickoff.
        if (isNum(g?.date) && g.date > 946684800000 && g.date < 4102444800000) times.add(Math.round(g.date));
      }
    }
  }
  return [...times].sort((a, b) => a - b).map((ms) => isoNoMs(new Date(ms)));
}

// ---------------------------------------------------------------------------------------
// league.json
// ---------------------------------------------------------------------------------------

function scoringTypeOf(scoringSettings) {
  const items = scoringSettings?.scoringItems;
  if (!Array.isArray(items)) return null;
  const reception = items.find((i) => isObj(i) && i.statId === 53);
  const pts = num(reception?.points);
  if (pts >= 0.75) return 'PPR';
  if (pts > 0) return 'HALF_PPR';
  return 'STANDARD';
}

/**
 * Build the Contract 1 object.
 *   raw.main         current season, combined views (required)
 *   raw.lineups      last completed week: ?view=mMatchup&view=mMatchupScore&scoringPeriodId=N
 *   raw.draft        ?view=mDraftDetail
 *   raw.players      <base>/seasons/<season>/players?view=players_wl (names for draft picks)
 *   raw.proSchedule  <base>/seasons/<season>?view=proTeamSchedules_wl
 * Never throws on odd data. Run validate() on the result before trusting it.
 */
export function normalizeLeague(raw, { source = 'espn', generatedAt = new Date() } = {}) {
  const main = isObj(raw?.main) ? raw.main : {};
  const settings = isObj(main.settings) ? main.settings : {};
  const schedule = isObj(settings.scheduleSettings) ? settings.scheduleSettings : {};
  const status = isObj(main.status) ? main.status : {};
  const lineupSlotCounts = isObj(settings.rosterSettings?.lineupSlotCounts) ? settings.rosterSettings.lineupSlotCounts : null;

  const rawTeams = usableTeams(main);
  const teamIds = new Set(rawTeams.map((t) => t.id));
  const members = membersById(main);

  const currentWeek = int(status.currentMatchupPeriod);
  const scoringPeriod = int(main.scoringPeriodId);
  const finalScoringPeriod = int(status.finalScoringPeriod);
  const regularSeasonWeeks = int(schedule.matchupPeriodCount);

  const matchups = normalizeMatchups(main, { currentWeek, regularSeasonWeeks, teamIds });

  // Points for the current scoring period per player, from the live matchup rosters.
  const periodPoints = new Map();
  const matchupRosters = new Map();
  for (const m of arr(main.schedule)) {
    if (!isObj(m) || m.matchupPeriodId !== currentWeek) continue;
    for (const side of [m.home, m.away]) {
      if (!isObj(side) || !Number.isInteger(side.teamId)) continue;
      periodPointsFromSide(side, scoringPeriod, periodPoints);
      const entries = side.rosterForCurrentScoringPeriod?.entries;
      if (Array.isArray(entries) && entries.length) matchupRosters.set(side.teamId, entries);
    }
  }

  const byeTeams = byeTeamsForPeriod(raw?.proSchedule, scoringPeriod);

  const teams = rawTeams.map((t) => {
    const base = baseTeam(t, members);
    const { _overall, ...fields } = base;
    const tc = isObj(t.transactionCounter) ? t.transactionCounter : {};
    const entries = Array.isArray(t.roster?.entries) ? t.roster.entries : matchupRosters.get(t.id) ?? null;
    return {
      id: fields.id,
      name: fields.name,
      abbrev: cleanText(typeof t.abbrev === 'number' ? String(t.abbrev) : t.abbrev, 12),
      owner: fields.owner,
      ownerKey: fields.ownerKey,
      seed: fields.seed,
      finalRank: fields.finalRank,
      wins: fields.wins,
      losses: fields.losses,
      ties: fields.ties,
      pointsFor: fields.pointsFor,
      pointsAgainst: fields.pointsAgainst,
      ...streakOf(_overall),
      moves: {
        acquisitions: Math.max(0, int(tc.acquisitions)),
        drops: Math.max(0, int(tc.drops)),
        trades: Math.max(0, int(tc.trades)),
      },
      roster: normalizeRoster(entries, { scoringPeriod, lineupSlotCounts, byeTeams, periodPoints }),
    };
  });

  const allRanked = teams.length > 0 && teams.every((t) => t.finalRank > 0);
  const seasonComplete =
    allRanked || status.isActive === false || (finalScoringPeriod > 0 && scoringPeriod > finalScoringPeriod);

  const lastWeek = lastCompletedWeek(matchups);
  let lastWeekLineups = null;
  if (lastWeek > 0) {
    const periods = arr(schedule.matchupPeriods?.[String(lastWeek)]).filter(Number.isInteger);
    lastWeekLineups = normalizeLastWeekLineups(raw?.lineups, {
      week: lastWeek,
      scoringPeriod: periods.length ? Math.max(...periods) : lastWeek,
      teamIds,
    });
  }

  const playerIndex = buildPlayerIndex({ main, lineups: raw?.lineups, players: raw?.players });
  const draft = normalizeDraft(raw?.draft, playerIndex, teamIds);
  const kickoffs = normalizeKickoffs(raw?.proSchedule);

  return {
    schema: SCHEMA,
    source,
    generatedAt: isoNoMs(generatedAt),
    league: {
      id: int(main.id),
      name: cleanText(settings.name, 120),
      season: int(main.seasonId),
      isPublic: settings.isPublic === true,
      teamCount: teams.length,
      regularSeasonWeeks,
      playoffTeamCount: Number.isInteger(schedule.playoffTeamCount) ? schedule.playoffTeamCount : null,
      currentWeek,
      scoringPeriod,
      finalScoringPeriod,
      seasonComplete,
      scoringType: scoringTypeOf(settings.scoringSettings),
      starterSlots: starterSlotsFrom(lineupSlotCounts),
    },
    teams,
    matchups,
    lastWeekLineups,
    draft: draft.picks,
    nfl: { kickoffs, source: kickoffs.length ? source : null },
  };
}

// ---------------------------------------------------------------------------------------
// history.json
// ---------------------------------------------------------------------------------------

/** True when a raw past-season response is a finished season. */
export function isSeasonComplete(raw) {
  if (!isObj(raw)) return false;
  const teams = usableTeams(raw);
  if (teams.length < 2) return false;
  if (teams.every((t) => int(t.rankCalculatedFinal) > 0)) return true;
  const games = arr(raw.schedule).filter((m) => isObj(m?.home) && isObj(m?.away));
  const undecided = games.filter((m) => (WINNER[str(m.winner).toUpperCase()] ?? 'undecided') === 'undecided');
  return raw.status?.isActive === false && games.length > 0 && undecided.length === 0;
}

/** One Contract 2 season from a raw past-season response, or null if it is unusable. */
export function normalizeSeason(raw) {
  if (!isObj(raw)) return null;
  const rawTeams = usableTeams(raw);
  const season = int(raw.seasonId);
  if (rawTeams.length < 2 || season < 2000) return null;
  const members = membersById(raw);
  const teamIds = new Set(rawTeams.map((t) => t.id));
  const schedule = isObj(raw.settings?.scheduleSettings) ? raw.settings.scheduleSettings : {};
  const regularSeasonWeeks = int(schedule.matchupPeriodCount);

  const teams = rawTeams.map((t) => {
    const { _overall, ...fields } = baseTeam(t, members);
    return fields;
  });

  const matchups = normalizeMatchups(raw, { currentWeek: -1, regularSeasonWeeks, teamIds });
  const games = matchups.map((m) => [
    m.week,
    m.home.teamId,
    m.home.points,
    m.away ? m.away.teamId : null,
    m.away ? m.away.points : null,
    m.bracket === 'WINNERS' ? 1 : m.bracket === 'CONSOLATION' ? 2 : 0,
  ]);

  return {
    season,
    regularSeasonWeeks,
    playoffTeamCount: Number.isInteger(schedule.playoffTeamCount) ? schedule.playoffTeamCount : null,
    teams,
    games,
  };
}

export function buildHistory(seasons, { source = 'espn', generatedAt = new Date() } = {}) {
  const bySeason = new Map();
  for (const s of arr(seasons)) if (isObj(s) && Number.isInteger(s.season)) bySeason.set(s.season, s);
  return {
    schema: SCHEMA,
    source,
    generatedAt: isoNoMs(generatedAt),
    seasons: [...bySeason.values()].sort((a, b) => a.season - b.season),
  };
}

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

const FORBIDDEN_KEY = /logo|lastname|displayname|email|primaryowner|^owners$|memberid|swid|espn_s2|cookie|token|password/i;
const GUID = /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/;

/** Walk any output object looking for things that must never be published. */
export function findLeaks(value, path = '', out = []) {
  if (out.length >= 10) return out;
  if (typeof value === 'string') {
    if (GUID.test(value)) out.push(`${path}: looks like a member GUID`);
    if (/espncdn\.com/i.test(value)) out.push(`${path}: looks like an ESPN image URL`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findLeaks(v, `${path}[${i}]`, out));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(k)) out.push(`${path}.${k}: field must never be stored`);
      findLeaks(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isIsoString = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function checkTeamCore(t, where, problems) {
  if (typeof t.name !== 'string' || !t.name) problems.push(`${where}: name is missing`);
  if (typeof t.owner !== 'string') problems.push(`${where}: owner must be a string`);
  else if (/\s/.test(t.owner)) problems.push(`${where}: owner must be a first name only`);
  if (typeof t.ownerKey !== 'string' || !/^(o_[0-9a-f]{8}|t_-?\d+)$/.test(t.ownerKey)) problems.push(`${where}: ownerKey is malformed`);
  for (const k of ['wins', 'losses', 'ties', 'seed', 'finalRank']) {
    if (!isCount(t[k])) problems.push(`${where}: ${k} must be a whole number >= 0`);
  }
  for (const k of ['pointsFor', 'pointsAgainst']) {
    if (!isNum(t[k])) problems.push(`${where}: ${k} must be a number`);
  }
}

/**
 * Problems with a league.json object. An empty list means it is safe to publish.
 * options.leagueId / options.season: when given, the object must be for that league / season.
 */
export function validate(league, options = {}) {
  const problems = [];
  const push = (msg) => {
    if (problems.length < 40) problems.push(msg);
  };
  if (!isObj(league)) return ['league: not an object'];
  if (league.schema !== SCHEMA) push(`schema must be ${SCHEMA}`);
  if (league.source !== 'espn' && league.source !== 'placeholder') push('source must be "espn" or "placeholder"');
  if (!isIsoString(league.generatedAt)) push('generatedAt must be an ISO time');

  const L = league.league;
  if (!isObj(L)) {
    push('league: section is missing');
  } else {
    if (!Number.isInteger(L.id) || L.id <= 0) push('league.id must be a positive whole number');
    if (options.leagueId !== undefined && L.id !== options.leagueId) push(`league.id is ${L.id}, expected ${options.leagueId}`);
    if (typeof L.name !== 'string' || !L.name) push('league.name is missing');
    if (!Number.isInteger(L.season) || L.season < 2000 || L.season > 2100) push('league.season is not a sane year');
    if (options.season !== undefined && L.season !== options.season) push(`league.season is ${L.season}, expected ${options.season}`);
    if (typeof L.isPublic !== 'boolean') push('league.isPublic must be true or false');
    if (!Number.isInteger(L.regularSeasonWeeks) || L.regularSeasonWeeks < 1 || L.regularSeasonWeeks > 30) push('league.regularSeasonWeeks is not sane');
    if (!Number.isInteger(L.currentWeek) || L.currentWeek < 1 || L.currentWeek > 30) push('league.currentWeek is not sane');
    if (!isCount(L.scoringPeriod) || L.scoringPeriod > 40) push('league.scoringPeriod is not sane');
    if (!isCount(L.finalScoringPeriod) || L.finalScoringPeriod > 40) push('league.finalScoringPeriod is not sane');
    if (typeof L.seasonComplete !== 'boolean') push('league.seasonComplete must be true or false');
    if (![null, 'PPR', 'HALF_PPR', 'STANDARD'].includes(L.scoringType)) push('league.scoringType is not a known value');
    if (!isObj(L.starterSlots) || Object.values(L.starterSlots).some((v) => !Number.isInteger(v) || v < 1)) push('league.starterSlots must map slot names to counts');
  }

  const teams = league.teams;
  const ids = new Set();
  if (!Array.isArray(teams) || teams.length < 2) {
    push('teams: need at least 2 teams');
  } else {
    if (isObj(L) && L.teamCount !== teams.length) push('league.teamCount does not match the number of teams');
    if (isObj(L) && (!Number.isInteger(L.playoffTeamCount) || L.playoffTeamCount < 0 || L.playoffTeamCount > teams.length)) {
      push('league.playoffTeamCount is not sane');
    }
    teams.forEach((t, i) => {
      const where = `teams[${i}]`;
      if (!isObj(t)) return push(`${where}: not an object`);
      if (!Number.isInteger(t.id)) push(`${where}: id must be a whole number`);
      else if (ids.has(t.id)) push(`${where}: duplicate id ${t.id}`);
      else ids.add(t.id);
      const core = [];
      checkTeamCore(t, where, core);
      core.forEach(push);
      if (typeof t.abbrev !== 'string') push(`${where}: abbrev must be a string`);
      if (!['WIN', 'LOSS', 'TIE', 'NONE'].includes(t.streakType)) push(`${where}: streakType is not a known value`);
      if (!isCount(t.streakLength)) push(`${where}: streakLength must be a whole number >= 0`);
      if (!isObj(t.moves) || !['acquisitions', 'drops', 'trades'].every((k) => isCount(t.moves[k]))) push(`${where}: moves is malformed`);
      if (t.roster !== null) {
        if (!isObj(t.roster)) push(`${where}: roster must be an object or null`);
        else {
          for (const k of ['ir', 'emptyStarters', 'badStarters', 'starters', 'bench']) {
            if (!Array.isArray(t.roster[k])) push(`${where}: roster.${k} must be a list`);
          }
        }
      }
    });
  }

  if (!Array.isArray(league.matchups)) {
    push('matchups: must be a list');
  } else {
    league.matchups.forEach((m, i) => {
      const where = `matchups[${i}]`;
      if (!isObj(m)) return push(`${where}: not an object`);
      if (!Number.isInteger(m.week) || m.week < 1 || m.week > 30) push(`${where}: week is not sane`);
      if (typeof m.playoff !== 'boolean') push(`${where}: playoff must be true or false`);
      if (!['NONE', 'WINNERS', 'CONSOLATION'].includes(m.bracket)) push(`${where}: bracket is not a known value`);
      if (!['home', 'away', 'tie', 'undecided'].includes(m.winner)) push(`${where}: winner is not a known value`);
      for (const side of ['home', 'away']) {
        const s = m[side];
        if (s === null && side === 'away') continue;
        if (!isObj(s)) push(`${where}: ${side} is missing`);
        else {
          if (!ids.has(s.teamId)) push(`${where}: ${side}.teamId ${s.teamId} is not a team in this league`);
          if (!isNum(s.points)) push(`${where}: ${side}.points must be a number`);
          if (s.projected !== null && !isNum(s.projected)) push(`${where}: ${side}.projected must be a number or null`);
        }
      }
      if (isObj(m.home) && isObj(m.away) && m.home.teamId === m.away.teamId) push(`${where}: a team cannot play itself`);
    });
    const played = Array.isArray(teams) && teams.some((t) => isObj(t) && t.wins + t.losses + t.ties > 0);
    if (played && league.matchups.length === 0) push('matchups: teams have results but the schedule is empty');
  }

  const lw = league.lastWeekLineups;
  if (lw !== null && (!isObj(lw) || !Number.isInteger(lw.week) || !isObj(lw.teams))) push('lastWeekLineups must be null or { week, teams }');
  if (!Array.isArray(league.draft)) push('draft: must be a list');
  else if (league.draft.some((p) => !isObj(p) || !ids.has(p.teamId) || typeof p.name !== 'string' || !p.name)) push('draft: a pick is malformed');
  if (!isObj(league.nfl) || !Array.isArray(league.nfl.kickoffs) || league.nfl.kickoffs.some((k) => !isIsoString(k))) {
    push('nfl.kickoffs must be a list of ISO times');
  }

  findLeaks(league).forEach(push);
  return problems;
}

/** Problems with one Contract 2 season. */
export function validateSeason(season) {
  const problems = [];
  if (!isObj(season)) return ['season: not an object'];
  if (!Number.isInteger(season.season) || season.season < 2000 || season.season > 2100) problems.push('season year is not sane');
  if (!Number.isInteger(season.regularSeasonWeeks) || season.regularSeasonWeeks < 1) problems.push('regularSeasonWeeks is not sane');
  if (!isCount(season.playoffTeamCount)) problems.push('playoffTeamCount is not sane');
  const ids = new Set();
  if (!Array.isArray(season.teams) || season.teams.length < 2) problems.push('need at least 2 teams');
  else {
    season.teams.forEach((t, i) => {
      if (!isObj(t) || !Number.isInteger(t.id) || ids.has(t.id)) return problems.push(`teams[${i}]: bad or duplicate id`);
      ids.add(t.id);
      checkTeamCore(t, `teams[${i}]`, problems);
    });
  }
  if (!Array.isArray(season.games)) problems.push('games must be a list');
  else {
    const bad = season.games.find(
      (g) =>
        !Array.isArray(g) || g.length !== 6 || !Number.isInteger(g[0]) || !ids.has(g[1]) || !isNum(g[2]) ||
        !(g[3] === null ? g[4] === null : ids.has(g[3]) && isNum(g[4])) || ![0, 1, 2].includes(g[5]),
    );
    if (bad) problems.push('games: a row is malformed');
  }
  findLeaks(season).forEach((p) => problems.push(p));
  return problems.slice(0, 20);
}

export function validateHistory(history) {
  const problems = [];
  if (!isObj(history)) return ['history: not an object'];
  if (history.schema !== SCHEMA) problems.push(`schema must be ${SCHEMA}`);
  if (history.source !== 'espn' && history.source !== 'placeholder') problems.push('source must be "espn" or "placeholder"');
  if (!isIsoString(history.generatedAt)) problems.push('generatedAt must be an ISO time');
  if (!Array.isArray(history.seasons)) problems.push('seasons must be a list');
  else {
    history.seasons.forEach((s) => validateSeason(s).forEach((p) => problems.push(`season ${s?.season}: ${p}`)));
    const years = history.seasons.map((s) => s?.season);
    if (new Set(years).size !== years.length) problems.push('seasons: duplicate year');
    if (years.some((y, i) => i > 0 && y < years[i - 1])) problems.push('seasons: must be oldest first');
  }
  return problems.slice(0, 40);
}
