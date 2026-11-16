// Deterministic fake leagues for the model tests. Outputs Contract 1 (league.json) and
// Contract 2 (history.json) shaped objects. No randomness beyond the seed, no clock.

const OWNERS = ['Dan', 'Tony', 'Shane', 'Tim', 'Zach', 'Mike', 'Chris', 'Matt', 'Joe', 'Nick', 'Ben', 'Sam', 'Alex', 'Ryan'];
const TEAM_NAMES = [
  'Fourth And Long', 'Bench Mob', 'Hail Marys', 'Waiver Wizards', 'Red Zone Regulars', 'Sunday Scaries',
  'Two Minute Drill', 'Garbage Time', 'Monday Night Miracle', 'Screen Pass', 'Goal Line Stand', 'The Long Snappers',
  'Prevent Defense', 'Coin Toss',
];
const STARTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, 'D/ST': 1, K: 1 };
const DAY = 24 * 60 * 60 * 1000;

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

/** Round-robin pairings. Odd team counts get one bye (null opponent) per week. */
function schedule(ids, weeks) {
  const list = ids.slice();
  if (list.length % 2) list.push(null);
  const n = list.length;
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a == null || b == null) round.push([a == null ? b : a, null]);
      else round.push(w % 2 ? [b, a] : [a, b]);
    }
    out.push(round);
    list.splice(1, 0, list.pop());
  }
  return out;
}

/** Thursday night kickoff (UTC) of a given week, plus the Sunday and Monday windows. */
export function kickoffsFor(season, weeks) {
  const base = Date.UTC(season, 8, 11, 0, 20, 0); // Friday 00:20Z = Thursday night in the US
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const thu = base + w * 7 * DAY;
    out.push(thu, thu + 2 * DAY + 17 * 3600e3 + 40 * 60e3, thu + 2 * DAY + 21 * 3600e3 + 5 * 60e3, thu + 4 * DAY + 55 * 60e3);
  }
  return out.map((ms) => new Date(ms).toISOString().replace('.000Z', 'Z'));
}

function makeRoster(teamId, rand, crimes) {
  const starters = [];
  const order = [];
  for (const slot of Object.keys(STARTER_SLOTS)) for (let i = 0; i < STARTER_SLOTS[slot]; i++) order.push(slot);
  const empty = new Set((crimes && crimes.empty) || []);
  const emptyStarters = [];
  order.forEach((slot, i) => {
    if (empty.has(slot)) {
      empty.delete(slot);
      emptyStarters.push(slot);
      return;
    }
    const pos = slot === 'FLEX' ? 'WR' : slot;
    starters.push({ name: `Starter ${teamId}-${i}`, pos, slot, points: r2(rand() * 24), projected: r2(6 + rand() * 14) });
  });
  const bench = [];
  for (let i = 0; i < 6; i++) bench.push({ name: `Bench ${teamId}-${i}`, pos: i % 2 ? 'RB' : 'WR', slot: 'BE', points: r2(rand() * 18), projected: r2(3 + rand() * 9) });
  return {
    ir: ((crimes && crimes.ir) || []).map((name) => ({ name, pos: 'RB' })),
    emptyStarters,
    badStarters: ((crimes && crimes.bad) || []).map((b) => ({ name: b.name, pos: b.pos || 'RB', slot: b.slot || 'RB', why: b.why || 'OUT' })),
    starters,
    bench,
  };
}

/**
 * @param o.seed               number, drives every score
 * @param o.teamCount          default 12
 * @param o.playoffTeamCount   default 6
 * @param o.regularSeasonWeeks default 14
 * @param o.playoffWeeks       default 3
 * @param o.season             default 2026
 * @param o.currentWeek        default 10
 * @param o.weekState          'pre' | 'live' | 'final' for the current week (default 'pre')
 * @param o.seasonComplete     every week decided, finalRank filled in
 * @param o.seeds              'ok' (default) | 'missing' | 'duplicate'
 * @param o.names              [{ name, owner }] overrides by index
 * @param o.rosters            false for roster: null on every team
 * @param o.crimes             { [teamId]: { empty: ['FLEX'], bad: [{ name, why }], ir: ['Name'] } }
 * @param o.projections        false to leave projected: null
 * @param o.lineups            false for lastWeekLineups: null
 * @param o.kickoffs           false for nfl.kickoffs: []
 * @param o.scoreFor           optional (week, teamId, defaultScore) => score, to script results
 */
export function makeLeague(o = {}) {
  const N = o.teamCount ?? 12;
  const P = o.playoffTeamCount ?? 6;
  const regWeeks = o.regularSeasonWeeks ?? 14;
  const playoffWeeks = o.playoffWeeks ?? 3;
  const season = o.season ?? 2026;
  const complete = !!o.seasonComplete;
  const lastWeekOfSeason = regWeeks + playoffWeeks;
  const currentWeek = complete ? lastWeekOfSeason : o.currentWeek ?? 10;
  const weekState = complete ? 'final' : o.weekState ?? 'pre';
  const rand = rng32((o.seed ?? 1) * 7919 + season);

  const teams = [];
  for (let i = 0; i < N; i++) {
    const custom = (o.names && o.names[i]) || {};
    teams.push({
      id: i + 1,
      name: custom.name ?? TEAM_NAMES[(i + (season % 3)) % TEAM_NAMES.length],
      abbrev: (custom.owner ?? OWNERS[i % OWNERS.length]).slice(0, 4).toUpperCase() || `T${i + 1}`,
      owner: custom.owner ?? OWNERS[i % OWNERS.length],
      ownerKey: custom.ownerKey ?? `o_${(0x1000 + i * 977).toString(16)}`,
      seed: 0,
      finalRank: 0,
      wins: 0, losses: 0, ties: 0,
      pointsFor: 0, pointsAgainst: 0,
      streakType: 'NONE',
      streakLength: 0,
      moves: { acquisitions: Math.floor(rand() * 20), drops: Math.floor(rand() * 20), trades: Math.floor(rand() * 3) },
      roster: null,
      strength: 92 + rand() * 30,
    });
  }
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const score = (week, id) => {
    const base = r2(byId[id].strength + (rand() + rand() + rand() - 1.5) * 34);
    return o.scoreFor ? r2(o.scoreFor(week, id, base)) : base;
  };
  const proj = (id) => (o.projections === false ? null : r2(byId[id].strength + (rand() - 0.5) * 10));

  const matchups = [];
  const decidedState = (week) => (week < currentWeek ? 'final' : week === currentWeek ? weekState : 'pre');
  const play = (week, homeId, awayId, playoff, bracket) => {
    const state = decidedState(week);
    const m = {
      week,
      playoff,
      bracket,
      home: { teamId: homeId, points: 0, projected: proj(homeId) },
      away: awayId == null ? null : { teamId: awayId, points: 0, projected: proj(awayId) },
      winner: 'undecided',
    };
    if (state !== 'pre') {
      m.home.points = score(week, homeId);
      if (m.away) m.away.points = score(week, awayId);
      if (state === 'live') {
        m.home.points = r2(m.home.points * 0.55);
        if (m.away) m.away.points = r2(m.away.points * 0.45);
      }
    }
    if (state === 'final' && m.away) {
      m.winner = m.home.points > m.away.points ? 'home' : m.home.points < m.away.points ? 'away' : 'tie';
    }
    matchups.push(m);
    return m;
  };

  // ----- regular season -----
  const rounds = schedule(teams.map((t) => t.id), regWeeks);
  const logs = Object.fromEntries(teams.map((t) => [t.id, []]));
  rounds.forEach((round, i) => {
    const week = i + 1;
    for (const [homeId, awayId] of round) {
      const m = play(week, homeId, awayId, false, 'NONE');
      if (m.winner === 'undecided') continue;
      const h = byId[homeId];
      const a = byId[awayId];
      h.pointsFor += m.home.points; h.pointsAgainst += m.away.points;
      a.pointsFor += m.away.points; a.pointsAgainst += m.home.points;
      if (m.winner === 'home') { h.wins++; a.losses++; logs[homeId].push('WIN'); logs[awayId].push('LOSS'); }
      else if (m.winner === 'away') { a.wins++; h.losses++; logs[awayId].push('WIN'); logs[homeId].push('LOSS'); }
      else { h.ties++; a.ties++; logs[homeId].push('TIE'); logs[awayId].push('TIE'); }
    }
  });
  for (const t of teams) {
    t.pointsFor = r2(t.pointsFor);
    t.pointsAgainst = r2(t.pointsAgainst);
    const log = logs[t.id];
    if (log.length) {
      t.streakType = log[log.length - 1];
      let n = 0;
      for (let i = log.length - 1; i >= 0 && log[i] === t.streakType; i--) n++;
      t.streakLength = n;
    }
  }
  const pct = (t) => (t.wins + t.losses + t.ties ? (t.wins + t.ties / 2) / (t.wins + t.losses + t.ties) : 0);
  const standing = teams.slice().sort((a, b) => pct(b) - pct(a) || b.pointsFor - a.pointsFor || a.id - b.id);
  if ((o.seeds ?? 'ok') !== 'missing') standing.forEach((t, i) => { t.seed = i + 1; });
  if (o.seeds === 'duplicate' && standing.length > 1) standing[1].seed = standing[0].seed;

  // ----- playoffs: winners bracket among the top P seeds, everyone else pairs off -----
  let alive = standing.slice(0, P).map((t) => t.id);
  const others = standing.slice(P).map((t) => t.id);
  let champion = null;
  let runnerUp = null;
  for (let w = 1; w <= playoffWeeks; w++) {
    const week = regWeeks + w;
    if (week > currentWeek && !complete) {
      // Future rounds are not known yet. ESPN lists nothing for them either.
      continue;
    }
    let size = 1;
    while (size < alive.length) size *= 2;
    const byes = alive.slice(0, size - alive.length);
    const playing = alive.slice(size - alive.length);
    const next = byes.slice();
    for (const id of byes) play(week, id, null, true, 'WINNERS');
    for (let i = 0; i < playing.length / 2; i++) {
      const hi = playing[i];
      const lo = playing[playing.length - 1 - i];
      const m = play(week, hi, lo, true, 'WINNERS');
      const won = m.winner === 'away' ? lo : hi;
      next.push(won);
      if (alive.length === 2 && m.winner !== 'undecided') {
        champion = won;
        runnerUp = won === hi ? lo : hi;
      }
    }
    if (alive.length > 1) alive = next.sort((a, b) => byId[a].seed - byId[b].seed);
    for (let i = 0; i + 1 < others.length; i += 2) play(week, others[(i + w) % others.length], others[(i + w + 1) % others.length], true, 'CONSOLATION');
  }

  if (complete) {
    const ranked = standing.slice();
    if (champion != null) {
      ranked.sort((a, b) => {
        const score2 = (t) => (t.id === champion ? 0 : t.id === runnerUp ? 1 : 2);
        return score2(a) - score2(b) || a.seed - b.seed || a.id - b.id;
      });
    }
    ranked.forEach((t, i) => { t.finalRank = i + 1; });
  }

  // ----- rosters and last week's lineups -----
  if (o.rosters !== false) for (const t of teams) t.roster = makeRoster(t.id, rand, o.crimes && o.crimes[t.id]);
  const completed = matchups.filter((m) => m.winner !== 'undecided').map((m) => m.week);
  const lastDone = completed.length ? Math.max(...completed) : null;
  let lastWeekLineups = null;
  if (o.lineups !== false && lastDone != null) {
    lastWeekLineups = { week: lastDone, teams: {} };
    for (const t of teams) {
      lastWeekLineups.teams[t.id] = {
        benchTop: { name: `Bench ${t.id}-0`, pos: 'WR', points: r2(4 + rand() * 24) },
        starterLow: { name: `Starter ${t.id}-3`, pos: 'RB', points: r2(rand() * 6) },
        benchTotal: r2(30 + rand() * 50),
      };
    }
  }

  for (const t of teams) delete t.strength;
  return {
    schema: 1,
    source: o.source ?? 'placeholder',
    generatedAt: `${season}-11-16T03:10:00Z`,
    league: {
      id: 70578866,
      name: o.leagueName ?? 'Test League',
      season,
      isPublic: false,
      teamCount: N,
      regularSeasonWeeks: regWeeks,
      playoffTeamCount: P,
      currentWeek,
      scoringPeriod: currentWeek,
      finalScoringPeriod: lastWeekOfSeason,
      seasonComplete: complete,
      scoringType: 'PPR',
      starterSlots: { ...STARTER_SLOTS },
    },
    teams,
    matchups,
    lastWeekLineups,
    draft: [],
    nfl: { kickoffs: o.kickoffs === false ? [] : kickoffsFor(season, lastWeekOfSeason) },
  };
}

/** A completed Contract 1 league as one Contract 2 season. */
export function toHistorySeason(league) {
  return {
    season: league.league.season,
    regularSeasonWeeks: league.league.regularSeasonWeeks,
    playoffTeamCount: league.league.playoffTeamCount,
    teams: league.teams.map((t) => ({
      id: t.id, name: t.name, owner: t.owner, ownerKey: t.ownerKey, seed: t.seed, finalRank: t.finalRank,
      wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, pointsAgainst: t.pointsAgainst,
    })),
    games: league.matchups
      .filter((m) => m.away == null || m.winner !== 'undecided')
      .map((m) => [
        m.week,
        m.home.teamId,
        m.home.points,
        m.away ? m.away.teamId : null,
        m.away ? m.away.points : null,
        !m.playoff ? 0 : m.bracket === 'CONSOLATION' ? 2 : 1,
      ]),
  };
}

/**
 * @param o.seasons  list of years, oldest first (default 2021..2025)
 * @param o.seed     number
 * Remaining options are passed to makeLeague for every past season (teamCount, names, ...).
 */
export function makeHistory(o = {}) {
  const years = o.seasons ?? [2021, 2022, 2023, 2024, 2025];
  const { seasons: _ignored, source, ...rest } = o;
  return {
    schema: 1,
    source: source ?? 'placeholder',
    generatedAt: '2026-11-16T03:10:00Z',
    seasons: years.map((year, i) => toHistorySeason(makeLeague({ ...rest, season: year, seed: (o.seed ?? 1) * 31 + i, seasonComplete: true }))),
  };
}

/**
 * The league's real team names. The first nine are exact and have no known owner first name,
 * so the team name is what the copy has to use as the subject. The last three have owners.
 */
export const REAL_NAMES = [
  { name: 'Your Commishness', owner: '' },
  { name: 'Multiple Scoregasms', owner: '' },
  { name: "zach's Honorable Team", owner: '' },
  { name: '\u{1F525}Stafford_Pukas_Lounge\u{1F525}', owner: '' },
  { name: 'The REAL Commish***', owner: '' },
  { name: 'ROME AND DIGGS IN MY FIELDS', owner: '' },
  { name: '1ST n Goal', owner: '' },
  { name: 'On C0k3r w Brown Nabers', owner: '' },
  { name: 'Packer Cracker', owner: '' },
  { name: 'AssistantCommish', owner: 'Tony' },
  { name: 'Tailored Gang', owner: 'Shane' },
  { name: 'Bye Week Heroes', owner: 'Mike' },
];
