// League history: titles, last places, all-time records, rivalries and the record book.
// Pure. People are matched across seasons by ownerKey (team names change every year).

import { arr, num, int, str, round2, recordText, winPct, fmtPts, fmtTotal } from './util.js';

const KIND_CONSOLATION = 2;
const MIN_MEETINGS = 3;

function readSeasons(history) {
  const out = [];
  const seen = new Set();
  for (const s of arr(history && history.seasons)) {
    if (!s || typeof s !== 'object') continue;
    const season = int(s.season);
    if (!season || seen.has(season)) continue;

    const teams = [];
    const ids = new Set();
    for (const t of arr(s.teams)) {
      if (!t || typeof t !== 'object' || t.id == null || ids.has(String(t.id))) continue;
      ids.add(String(t.id));
      teams.push({
        id: t.id,
        name: str(t.name) || `Team ${t.id}`,
        owner: str(t.owner),
        ownerKey: str(t.ownerKey) || `t_${t.id}`,
        finalRank: Math.max(0, int(t.finalRank)),
        wins: Math.max(0, int(t.wins)),
        losses: Math.max(0, int(t.losses)),
        ties: Math.max(0, int(t.ties)),
        pointsFor: num(t.pointsFor),
      });
    }
    if (!teams.length) continue;
    seen.add(season);

    const games = [];
    for (const g of arr(s.games)) {
      if (!Array.isArray(g) || g.length < 5) continue;
      if (g[1] == null || g[3] == null) continue; // bye
      const homePts = num(g[2], NaN);
      const awayPts = num(g[4], NaN);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) continue;
      games.push({ week: int(g[0]), homeId: g[1], homePts, awayId: g[3], awayPts, kind: int(g[5]) });
    }
    out.push({ season, teams, games });
  }
  out.sort((a, b) => a.season - b.season);
  return out;
}

function bigNumber(v) {
  const fixed = num(v).toFixed(1);
  const dot = fixed.indexOf('.');
  return `${fmtTotal(Number(fixed.slice(0, dot)))}${fixed.slice(dot)}`;
}

/**
 * @param history  Contract 2 object, or null
 * @param cur      { season, week, teamCount, teams: [{ id, name, owner, ownerKey, label, rank }],
 *                   games: [{ week, homeId, awayId, homePts, awayPts, kind }] }  finished games only
 * @returns null when there is no usable history, else
 *          { model, owners: { [ownerKey]: TeamModel.history }, onThisWeek: [fact] }
 */
export function buildHistory(history, cur) {
  const seasons = readSeasons(history);
  if (!seasons.length) return null;

  const people = {};
  const stats = {};
  const person = (key) =>
    people[key] || (people[key] = { ownerKey: key, owner: '', teamName: '', teamId: null, label: '' });
  const stat = (key) =>
    stats[key] ||
    (stats[key] = { titles: [], lastPlaces: [], seasons: 0, wins: 0, losses: 0, ties: 0, h2h: {} });

  // Who is who. Later seasons overwrite earlier names, the current season overwrites everything.
  for (const s of seasons) {
    for (const t of s.teams) {
      const p = person(t.ownerKey);
      if (t.owner) p.owner = t.owner;
      p.teamName = t.name;
    }
  }
  for (const t of arr(cur.teams)) {
    const p = person(t.ownerKey);
    if (t.owner) p.owner = t.owner;
    p.teamName = t.name;
    p.teamId = t.id;
    p.label = t.label;
  }
  for (const key of Object.keys(people)) {
    if (!people[key].label) people[key].label = people[key].owner || people[key].teamName;
  }

  const weekly = { high: null, low: null, blowout: null };
  const sameWeek = { high: null, low: null, blowout: null, close: null };

  const tallyGame = (season, g, keyOf, fromHistory) => {
    if (g.kind === KIND_CONSOLATION) return;
    const a = keyOf[g.homeId];
    const b = keyOf[g.awayId];
    if (!a || !b || a === b) return;

    const sa = stat(a);
    const sb = stat(b);
    const ha = sa.h2h[b] || (sa.h2h[b] = { w: 0, l: 0, t: 0 });
    const hb = sb.h2h[a] || (sb.h2h[a] = { w: 0, l: 0, t: 0 });
    if (g.homePts > g.awayPts) {
      sa.wins++; sb.losses++; ha.w++; hb.l++;
    } else if (g.homePts < g.awayPts) {
      sb.wins++; sa.losses++; hb.w++; ha.l++;
    } else {
      sa.ties++; sb.ties++; ha.t++; hb.t++;
    }

    const margin = round2(Math.abs(g.homePts - g.awayPts));
    const homeWon = g.homePts >= g.awayPts;
    const sides = [
      { season, week: g.week, ownerKey: a, oppKey: b, pts: g.homePts, oppPts: g.awayPts, margin },
      { season, week: g.week, ownerKey: b, oppKey: a, pts: g.awayPts, oppPts: g.homePts, margin },
    ];
    const winnerSide = homeWon ? sides[0] : sides[1];
    for (const side of sides) {
      if (!weekly.high || side.pts > weekly.high.pts) weekly.high = side;
      if (side.pts > 0 && (!weekly.low || side.pts < weekly.low.pts)) weekly.low = side;
    }
    if (margin > 0 && (!weekly.blowout || margin > weekly.blowout.margin)) weekly.blowout = winnerSide;

    if (fromHistory && g.week === cur.week) {
      for (const side of sides) {
        if (!sameWeek.high || side.pts > sameWeek.high.pts) sameWeek.high = side;
        if (side.pts > 0 && (!sameWeek.low || side.pts < sameWeek.low.pts)) sameWeek.low = side;
      }
      if (margin > 0 && (!sameWeek.blowout || margin > sameWeek.blowout.margin)) sameWeek.blowout = winnerSide;
      if (margin > 0 && (!sameWeek.close || margin < sameWeek.close.margin)) sameWeek.close = winnerSide;
    }
  };

  const seasonal = { best: null, worst: null, most: null };
  const champions = [];
  const lastPlaces = [];
  const entry = (season, t) => {
    const p = people[t.ownerKey];
    return {
      season,
      teamName: p.teamId != null ? p.teamName : t.name,
      owner: p.owner || t.owner,
      ownerKey: t.ownerKey,
      teamId: p.teamId,
      record: recordText(t.wins, t.losses, t.ties),
    };
  };

  for (const s of seasons) {
    const keyOf = {};
    let champ = null;
    let last = null;
    for (const t of s.teams) {
      keyOf[t.id] = t.ownerKey;
      stat(t.ownerKey).seasons++;
      if (t.finalRank === 1 && !champ) champ = t;
      if (t.finalRank > 1 && (!last || t.finalRank > last.finalRank)) last = t;

      const games = t.wins + t.losses + t.ties;
      if (games > 0) {
        const row = { season: s.season, t, pct: winPct(t.wins, t.losses, t.ties) };
        const b = seasonal.best;
        if (!b || row.pct > b.pct || (row.pct === b.pct && (t.wins > b.t.wins || (t.wins === b.t.wins && t.pointsFor > b.t.pointsFor)))) {
          seasonal.best = row;
        }
        const w = seasonal.worst;
        if (!w || row.pct < w.pct || (row.pct === w.pct && (t.losses > w.t.losses || (t.losses === w.t.losses && t.pointsFor < w.t.pointsFor)))) {
          seasonal.worst = row;
        }
      }
      if (t.pointsFor > 0 && (!seasonal.most || t.pointsFor > seasonal.most.t.pointsFor)) {
        seasonal.most = { season: s.season, t };
      }
    }
    if (champ) {
      stat(champ.ownerKey).titles.push(s.season);
      champions.push(entry(s.season, champ));
    }
    if (last) {
      stat(last.ownerKey).lastPlaces.push(s.season);
      lastPlaces.push(entry(s.season, last));
    }
    for (const g of s.games) tallyGame(s.season, g, keyOf, true);
  }

  // The season in progress counts toward all-time records, unless history already holds it.
  if (!seasons.some((s) => s.season === cur.season)) {
    const keyOf = {};
    for (const t of arr(cur.teams)) keyOf[t.id] = t.ownerKey;
    for (const g of arr(cur.games)) tallyGame(cur.season, g, keyOf, false);
  }

  champions.reverse();
  lastPlaces.reverse();

  // ---------- per-owner history ----------
  const rivalOut = (key, r) => {
    const p = people[key];
    return { ownerKey: key, owner: p.owner, teamName: p.teamName, teamId: p.teamId, wins: r.w, losses: r.l };
  };
  const owners = {};
  for (const key of Object.keys(stats)) {
    const st = stats[key];
    if (st.seasons < 1) continue; // new this season: no history to show

    const lastTitle = st.titles.length ? st.titles[st.titles.length - 1] : null;
    const rivals = Object.keys(st.h2h)
      .map((k) => {
        const r = st.h2h[k];
        const n = r.w + r.l + r.t;
        return { key: k, r, n, pct: n > 0 ? (r.w + r.t * 0.5) / n : 0.5 };
      })
      .filter((c) => c.n >= MIN_MEETINGS);
    const current = rivals.filter((c) => people[c.key].teamId != null);
    const pool = current.length ? current : rivals;
    const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const worst = pool.filter((c) => c.pct < 0.5).sort((a, b) => a.pct - b.pct || b.n - a.n || byKey(a, b))[0];
    const best = pool.filter((c) => c.pct > 0.5).sort((a, b) => b.pct - a.pct || b.n - a.n || byKey(a, b))[0];

    owners[key] = {
      titles: st.titles.slice(),
      lastPlaces: st.lastPlaces.slice(),
      seasonsPlayed: st.seasons,
      seasonsSinceTitle: lastTitle == null ? null : seasons.filter((s) => s.season > lastTitle).length,
      allTime: { wins: st.wins, losses: st.losses, ties: st.ties, text: recordText(st.wins, st.losses, st.ties) },
      nemesis: worst ? rivalOut(worst.key, worst.r) : null,
      victim: best ? rivalOut(best.key, best.r) : null,
    };
  }

  // ---------- the record book ----------
  const label = (key) => (people[key] ? people[key].label : '');
  const teamIdOf = (key) => (people[key] ? people[key].teamId : null);
  const records = [];
  const push = (id, text, value, body, ownerKey, season, week) =>
    records.push({ id, label: text, value, text: body, ownerKey, teamId: teamIdOf(ownerKey), season, week });

  if (weekly.high) {
    const r = weekly.high;
    push('highWeek', 'Highest score', fmtPts(r.pts), `${label(r.ownerKey)}, Week ${r.week}, ${r.season}`, r.ownerKey, r.season, r.week);
  }
  if (weekly.low) {
    const r = weekly.low;
    push('lowWeek', 'Lowest score', fmtPts(r.pts), `${label(r.ownerKey)}, Week ${r.week}, ${r.season}`, r.ownerKey, r.season, r.week);
  }
  if (weekly.blowout) {
    const r = weekly.blowout;
    push('blowout', 'Biggest blowout', fmtPts(r.margin), `${label(r.ownerKey)} over ${label(r.oppKey)}, Week ${r.week}, ${r.season}`, r.ownerKey, r.season, r.week);
  }
  if (seasonal.best) {
    const r = seasonal.best;
    push('bestRecord', 'Best record', recordText(r.t.wins, r.t.losses, r.t.ties), `${label(r.t.ownerKey)}, ${r.season}`, r.t.ownerKey, r.season, null);
  }
  if (seasonal.worst) {
    const r = seasonal.worst;
    push('worstRecord', 'Worst record', recordText(r.t.wins, r.t.losses, r.t.ties), `${label(r.t.ownerKey)}, ${r.season}`, r.t.ownerKey, r.season, null);
  }
  if (seasonal.most) {
    const r = seasonal.most;
    push('mostPoints', 'Most points in a season', bigNumber(r.t.pointsFor), `${label(r.t.ownerKey)}, ${r.season}`, r.t.ownerKey, r.season, null);
  }

  // ---------- defending champion ----------
  let defendingChamp = null;
  const newest = champions[0];
  if (newest && newest.season === seasons[seasons.length - 1].season) {
    const rank = newest.teamId != null && cur.rankOf ? cur.rankOf[newest.teamId] || null : null;
    const n = cur.teamCount;
    let condition = 'pigeons';
    if (rank != null && n > 0) {
      if (rank <= Math.max(1, Math.floor(n / 4))) condition = 'shiny';
      else if (rank > n - Math.floor(n / 3)) condition = 'cone';
    }
    defendingChamp = {
      season: newest.season,
      owner: newest.owner,
      ownerKey: newest.ownerKey,
      teamName: newest.teamName,
      teamId: newest.teamId,
      rank,
      condition,
    };
  }

  // ---------- "on this week in league history" ----------
  const onThisWeek = [];
  for (const kind of ['high', 'blowout', 'close', 'low']) {
    const r = sameWeek[kind];
    if (!r) continue;
    onThisWeek.push({
      kind,
      season: r.season,
      week: r.week,
      name: label(r.ownerKey),
      oppName: label(r.oppKey),
      pts: r.pts,
      oppPts: r.oppPts,
      margin: r.margin,
      teamIds: [teamIdOf(r.ownerKey), teamIdOf(r.oppKey)].filter((id) => id != null),
      selfListed: teamIdOf(r.ownerKey) != null,
    });
  }

  return {
    model: { champions, lastPlaces, records, defendingChamp },
    owners,
    onThisWeek,
  };
}
