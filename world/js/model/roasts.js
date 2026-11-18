// The roast copy: arrival lines, mailbox cards, yard signs, the weekly paper and the blimp.
//
// Everything is a template filled with real numbers from the model and picked with a seeded
// random (team id + week + season), so a line holds still all week and changes the next week.
//
// House rules for anyone adding lines:
//   - Dry and deadpan. Jokes are about records, lineups, luck, history and the neighborhood.
//     Never about a real person's life. No profanity. No em-dashes.
//   - Team names are untrusted data. Insert them, never riff on them. Most teams have no owner
//     first name, so the "name" is usually a full team name: keep it followed by a space or a
//     comma (never a possessive, never a sentence-ending period) so any name reads cleanly.
//   - A template returns a string, or a falsy value when the data it needs is not there.
//     Lines over their length limit are skipped automatically, so a long team name can never
//     push copy past its limit.

import { TIERS } from '../config.js';
import {
  arr, ordinal, fmtPts, fmtTotal, fmtGames, plural, clip, capFirst, rngFor, shuffled, compareIds,
  teamLabels, tierIndex, withArticle,
} from './util.js';

export { ordinal };

export const PAPER_NAME = 'The Sunday Regret';

export const COPY_LIMITS = Object.freeze({
  arrival: 90,
  mailboxLine: 84,
  mailboxMin: 2,
  mailboxMax: 4,
  sign: 28,
  headline: 60,
  body: 220,
  blimp: 60,
});

const EM_DASH = String.fromCharCode(0x2014); // banned from all copy
const NAME_MAX = 32;
const NAME_STEPS = [NAME_MAX, 20, 12]; // names are only shortened when nothing fits at full length
const TIER_SHORT = { hill: 'the Hill', heights: 'the Heights', bubble: 'the Bubble', park: 'the Trailer Park', dump: 'the Dump' };
const TIER_TITLE = { hill: 'The Hill', heights: 'The Heights', bubble: 'The Bubble', park: 'The Trailer Park', dump: 'The Dump' };
const TIER_LIVES = { hill: 'on the Hill', heights: 'in Playoff Heights', bubble: 'in the Bubble', park: 'in the Waiver Wire Trailer Park', dump: 'in the Dump' };
const TIER_LONG = { hill: 'the Hill', heights: 'Playoff Heights', bubble: 'the Bubble', park: 'the Waiver Wire Trailer Park', dump: 'the Dump' };
const WHY_TEXT = { OUT: 'out', IR: 'on IR', BYE: 'on bye', SUSPENDED: 'suspended' };

// ---------------------------------------------------------------------------------------------
// Picking machinery
// ---------------------------------------------------------------------------------------------

function fmtGap(pts) {
  return pts >= 10 ? String(Math.round(pts)) : fmtPts(pts);
}

/** "2 games", "31 points" or "a tiebreaker": the distance between two teams in the standings. */
function gapText(games, pts) {
  if (games > 0) return fmtGames(games);
  if (pts > 0) return `${fmtGap(pts)} points`;
  return 'a tiebreaker';
}

/**
 * Bench blunder test. The best bench player has to beat the margin. When the worst starter played
 * the same position (lowPoints is set), the swap itself has to have been enough to flip the
 * result. Returns a "how bad was it" number, or 0 when it was not a blunder.
 */
function benchSwing(top, margin) {
  if (!top || !(top.points > margin)) return 0;
  if (top.lowPoints != null) {
    const swing = top.points - Math.max(0, top.lowPoints) - margin;
    return swing > 0 ? swing : 0;
  }
  return (top.points - margin) * 0.6; // no like-for-like swap to point at: a smaller story
}

/** Two scores side by side. If one decimal would make them look tied, show two. */
function fmtPair(a, b) {
  const close = a !== b && Math.abs(a - b) < 0.1;
  return close ? [a.toFixed(2), b.toFixed(2)] : [fmtPts(a), fmtPts(b)];
}

function titleCase(s) {
  return s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** A context object: plain fields plus name getters that honor the current name length cap. */
function makeCtx(F, fields, names) {
  const c = Object.assign({ nameMax: NAME_MAX, banned: F.banned }, fields);
  for (const key of Object.keys(names || {})) {
    const raw = names[key] || '';
    Object.defineProperty(c, key, { enumerable: true, get: () => clip(raw, c.nameMax) });
  }
  return c;
}

function tryLine(fn, c, limit) {
  let s;
  try {
    s = fn(c);
  } catch (e) {
    return null;
  }
  if (typeof s !== 'string') return null;
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s.length > limit) return null;
  for (const bad of c.banned) if (s.includes(bad)) return null;
  return s;
}

/**
 * Seeded pick of the first template that has its data and fits the limit. Templates already
 * used by another team this week (tracked in `used`) are passed over while fresh ones remain.
 */
function pickLine(pool, c, limit, rng, used, key, steps, freshOnly) {
  const idx = shuffled(pool.map((_, i) => i), rng);
  try {
    for (const max of steps || NAME_STEPS) {
      c.nameMax = max;
      let spare = null;
      for (const i of idx) {
        const s = tryLine(pool[i], c, limit);
        if (!s) continue;
        const k = `${key}:${i}`;
        if (used && used.has(k)) {
          if (!spare) spare = s;
          continue;
        }
        if (used) used.add(k);
        return s;
      }
      // Something fit at this name length but another team has it. Reuse it, or give up on
      // this pool. Either way, never shorten a name just to find a line nobody else has.
      if (spare) return freshOnly ? null : spare;
    }
    return null;
  } finally {
    c.nameMax = NAME_MAX;
  }
}

function weigh(list, c, rng, jitter) {
  const out = [];
  for (const item of list) {
    let w = 0;
    try {
      w = Number(item.when(c)) || 0;
    } catch (e) {
      w = 0;
    }
    if (w > 0) out.push({ item, w: w + rng() * jitter });
  }
  out.sort((a, b) => b.w - a.w);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-team facts
// ---------------------------------------------------------------------------------------------

function teamCtx(model, F, id) {
  const meta = model.meta;
  const t = model.teams[id];
  const N = meta.teamCount;
  const P = model.cutLine;
  const at = (rank) => model.teams[model.order[rank - 1]] || null;
  const label = (tid) => (tid != null && F.labels[tid] != null ? F.labels[tid] : '');
  const value = (x) => x.record.wins + x.record.ties * 0.5;
  const dropped = (x) => x.record.losses + x.record.ties * 0.5;
  const gamesAhead = (a, b) => (value(a) - value(b) + (dropped(b) - dropped(a))) / 2;

  const names = { me: label(id) };
  const f = {
    id,
    mode: F.mode,
    phase: meta.phase,
    weekStatus: meta.weekStatus,
    season: meta.season,
    week: meta.week,
    L: F.lastCompletedWeek || 0,
    left: F.weeksLeft,
    leftW: plural(F.weeksLeft, 'week'),
    N,
    P,
    others: N - 1,
    rec: t.record.text,
    w: t.record.wins,
    l: t.record.losses,
    gp: t.record.wins + t.record.losses + t.record.ties,
    rank: t.rank,
    ord: ordinal(t.rank),
    tier: t.tier,
    tierShort: TIER_SHORT[t.tier],
    tierTitle: TIER_TITLE[t.tier],
    tierName: TIERS[t.tier].name,
    prevRank: t.prevRank,
    prevOrd: t.prevRank != null ? ordinal(t.prevRank) : '',
    prevTierShort: t.prevTier ? TIER_SHORT[t.prevTier] : '',
    prevTierLived: t.prevTier ? (t.prevTier === 'hill' ? 'on the Hill' : `in ${TIER_SHORT[t.prevTier]}`) : '',
    tierMove: t.tierMove,
    pf: fmtTotal(t.pointsFor),
    winStreak: t.streak.type === 'W' ? t.streak.length : 0,
    lossStreak: t.streak.type === 'L' ? t.streak.length : 0,
    lastWinWeek: F.lastWinWeek[id] || 0,
    lastLossWeek: F.lastLossWeek[id] || 0,
    bags: t.trashBags,
    irN: t.ir.count,
    irName: t.ir.names[0] || '',
    clinched: t.clinched,
    eliminated: t.eliminated,
    inSpot: t.inPlayoffSpot,
    luckTag: t.luckTag,
    luckDelta: t.luck.delta,
    ap: `${t.luck.allPlayWins}-${t.luck.allPlayLosses}`,
    exp: t.luck.expectedWins.toFixed(1),
    luckD: Math.abs(t.luck.delta).toFixed(1),
    toilet: t.trophy.toilet,
    spotlight: t.trophy.spotlight,
    lineupLive: meta.phase !== 'preseason' && meta.phase !== 'complete' && meta.weekStatus !== 'final',
  };

  // The waiver wire. Null until at least three teams have move counts, so it is always a comparison.
  f.churn = null;
  if (t.churn && t.churn.total > 0) {
    const ch = t.churn;
    f.churn = {
      adds: ch.adds,
      drops: ch.drops,
      trades: ch.trades,
      total: ch.total,
      rank: ch.rank,
      ord: ordinal(ch.rank),
      busiest: !!ch.busiest,
      quietest: !!ch.quietest,
      median: ch.median,
      noTrades: ch.trades === 0,
      tradeN: plural(ch.trades, 'trade'),
      perWeek: f.L > 0 ? (ch.total / f.L).toFixed(1) : '',
    };
  }

  f.pfRank = 1 + model.order.filter((tid) => model.teams[tid].pointsFor > t.pointsFor).length;
  f.pfOrd = ordinal(f.pfRank);

  // Standings distances.
  f.lead = null;
  f.leadGames = 0;
  f.leadPts = '';
  if (t.rank === 1 && N >= 2) {
    const second = at(2);
    const games = gamesAhead(t, second);
    const pts = t.pointsFor - second.pointsFor;
    f.lead = gapText(games, pts);
    f.leadGames = games;
    f.leadPts = games <= 0 && pts > 0 ? fmtGap(pts) : '';
    names.second = label(second.id);
  }
  f.gbFirst = null;
  if (t.rank > 1) {
    const first = at(1);
    f.gbFirst = gamesAhead(first, t);
    f.gbText = f.gbFirst > 0 ? fmtGames(f.gbFirst) : '';
    names.first = label(first.id);
  }
  f.gap = '';
  if (F.mode === 'regular' && P < N) {
    const inside = t.rank <= P;
    const other = inside ? at(P + 1) : at(P);
    if (other) {
      const games = inside ? gamesAhead(t, other) : gamesAhead(other, t);
      const pts = inside ? t.pointsFor - other.pointsFor : other.pointsFor - t.pointsFor;
      f.gap = gapText(games, pts);
    }
  }

  // Last completed week.
  f.last = null;
  if (t.lastWeek && model.lastWeek) {
    const lw = t.lastWeek;
    const scores = [];
    for (const r of model.lastWeek.results) scores.push(r.homePts, r.awayPts);
    const wkRank = 1 + scores.filter((s) => s > lw.pts).length;
    const [lastPts, lastOppPts] = fmtPair(lw.pts, lw.oppPts);
    f.last = {
      won: lw.won,
      margin: lw.margin,
      m: fmtPts(lw.margin),
      pts: lastPts,
      oppPts: lastOppPts,
      wkRank,
      wkN: scores.length,
      wkOrd: ordinal(wkRank),
      fromBottomOrd: ordinal(scores.length - wkRank + 1),
      beatN: wkRank - 1,
      oppId: lw.oppId,
    };
    names.lastOpp = label(lw.oppId);
  }
  f.bench = null;
  const top = F.benchTop[id];
  if (f.last && f.last.won === false && benchSwing(top, f.last.margin) > 0) {
    f.bench = { player: top.name, pts: fmtPts(top.points), low: top.lowName, lowPts: top.lowPoints != null ? fmtPts(top.lowPoints) : '' };
  }

  // This week.
  f.cur = null;
  if (t.thisWeek) {
    const tw = t.thisWeek;
    const opp = model.teams[tw.oppId];
    const hasProj = tw.proj != null && tw.oppProj != null && (tw.proj > 0 || tw.oppProj > 0);
    const [curPts, curOppPts] = fmtPair(tw.pts, tw.oppPts);
    f.cur = {
      status: tw.status,
      winning: tw.winning,
      pts: curPts,
      oppPts: curOppPts,
      scored: tw.pts > 0 || tw.oppPts > 0,
      diff: fmtPts(Math.abs(tw.pts - tw.oppPts)),
      hasProj,
      proj: hasProj ? fmtPts(tw.proj) : '',
      oppProj: hasProj ? fmtPts(tw.oppProj) : '',
      projDiff: hasProj ? fmtPts(Math.abs(tw.proj - tw.oppProj)) : '',
      favored: hasProj ? tw.proj > tw.oppProj : null,
      oppRec: opp ? opp.record.text : '',
      oppId: tw.oppId,
      sameAsLast: tw.status === 'final' && f.L === meta.week,
    };
    names.opp = label(tw.oppId);
  }

  // History.
  const h = t.history;
  f.hist = null;
  f.nem = null;
  f.vic = null;
  if (h) {
    const years = (list) => (list.length <= 3 ? list.join(', ') : `${list.slice(-2).join(', ')} and ${list.length - 2} more`);
    const yearsProse = (list) => {
      if (list.length <= 1) return list.join('');
      if (list.length <= 3) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
      return `${list.slice(-2).join(', ')} and ${list.length - 2} other years`;
    };
    // A season that just ended is not in history.json yet. Count it, so nobody who just won
    // the title is told how long it has been since their last one.
    let titles = h.titles;
    let lastPlaces = h.lastPlaces;
    let seasons = h.seasonsPlayed;
    let since = h.seasonsSinceTitle;
    if (F.seasonJustEnded) {
      seasons += 1;
      if (t.rank === 1) {
        titles = titles.concat(meta.season);
        since = 0;
      } else if (since != null) {
        since += 1;
      }
      if (t.rank === N && N > 1) lastPlaces = lastPlaces.concat(meta.season);
    }
    f.hist = {
      titlesN: titles.length,
      titleYears: years(titles),
      lastTitle: titles.length ? titles[titles.length - 1] : 0,
      since,
      seasons,
      lastN: lastPlaces.length,
      lastYears: yearsProse(lastPlaces),
      lastYear: lastPlaces.length ? lastPlaces[lastPlaces.length - 1] : 0,
      allTime: h.allTime.text,
      allTimeWinning: h.allTime.wins > h.allTime.losses,
    };
    // Where this season sits against every season this owner has finished. finishes only holds
    // seasons with a final rank, so a first season has none and nothing below fires.
    const bf = h.bestFinish;
    const fin = arr(h.finishes);
    if (bf && bf.rank > 0 && fin.length > 0) {
      f.hist.bestRank = bf.rank;
      f.hist.bestOrd = ordinal(bf.rank);
      f.hist.bestYear = bf.season;
      f.hist.bestOnce = fin.length === 1;
      // A career high only counts once there is a record to beat and a season to compare.
      f.hist.careerHigh = f.gp > 0 && t.rank < bf.rank;
      f.hist.worstRank = h.worstFinish && h.worstFinish.rank > 0 ? h.worstFinish.rank : 0;
      f.hist.worstOrd = f.hist.worstRank ? ordinal(f.hist.worstRank) : '';
      f.hist.worstYear = h.worstFinish && h.worstFinish.season ? h.worstFinish.season : 0;
      f.hist.careerLow = f.gp > 0 && !!f.hist.worstRank && t.rank > f.hist.worstRank;
      f.hist.held = f.gp > 0 && t.rank === bf.rank && !f.hist.bestOnce;
    }
    const rival = (r) => (r.teamId != null ? label(r.teamId) : r.owner || r.teamName);
    if (h.nemesis && rival(h.nemesis)) {
      f.nem = { w: h.nemesis.wins, l: h.nemesis.losses, teamId: h.nemesis.teamId, lopsided: h.nemesis.wins * 2 <= h.nemesis.losses };
      names.nemName = rival(h.nemesis);
    }
    if (h.victim && rival(h.victim)) {
      f.vic = { w: h.victim.wins, l: h.victim.losses, teamId: h.victim.teamId, lopsided: h.victim.losses * 2 <= h.victim.wins };
      names.vicName = rival(h.victim);
    }
  }
  const dc = model.history ? model.history.defendingChamp : null;
  f.champ = dc && dc.teamId === id && dc.season !== meta.season ? { season: dc.season, condition: dc.condition } : null;

  // Playoff bracket.
  f.koWeek = F.mode === 'post' && t.inPlayoffSpot ? F.knockedOut[id] || 0 : 0;
  f.alive = F.alive.indexOf(id) !== -1;
  f.titleGame = f.alive && F.alive.length === 2 && !!f.cur && f.cur.status !== 'final' && F.alive.indexOf(f.cur.oppId) !== -1;

  // Lineup crimes.
  const crimes = F.rosterCrimes[id] || { empty: [], bad: [] };
  f.emptySlot = crimes.empty[0] || '';
  f.emptyN = crimes.empty.length;
  f.bad = crimes.bad[0] ? { player: crimes.bad[0].name, why: crimes.bad[0].why, whyText: WHY_TEXT[crimes.bad[0].why] || 'unavailable' } : null;

  return makeCtx(F, f, names);
}

// ---------------------------------------------------------------------------------------------
// Arrival lines. Second person. 90 characters.
// ---------------------------------------------------------------------------------------------

const ARRIVAL_TIER = {
  hill: [
    (c) => `First place at ${c.rec}. The crown is a loaner. Read the fine print.`,
    (c) => `${c.rec} and alone at the top. Heavy is the head. Heavier is the target.`,
    (c) => `You live on the Hill. ${c.others} people can see your house from theirs. They resent it.`,
    () => `First place. The gates are gold. The lease is week to week.`,
    (c) => `${c.rec}. Best record in the league. Try to act like you have been here before.`,
    (c) => `Top of the Hill with ${c.pf} points. The throne does not come with a warranty.`,
    (c) => `1st of ${c.N}. The view from up here is mostly the tops of other people's heads.`,
    (c) => `${c.rec}. Everyone below you is doing math. You are doing landscaping.`,
    (c) => `The Hill is yours through Week ${c.week}. After that it depends on you. Sorry.`,
    (c) => `First place at ${c.rec}. Nobody likes you right now. That is how you know it is working.`,
  ],
  heights: [
    (c) => `${c.ord} place at ${c.rec}. You can see the Hill from here. That is the problem.`,
    (c) => `${c.rec}. Solidly in. The fountain is nice. You did not come here for a fountain.`,
    (c) => `${c.ord} of ${c.N}. Comfortable, which is exactly when people stop checking waivers.`,
    (c) => c.gbText && `${capFirst(c.gbText)} behind first place and telling everyone you prefer the Heights.`,
    (c) => `${c.rec} and ${c.ord}. Your neighbors say "we" about their roster. You have started too.`,
    (c) => `${c.ord} place. Close enough to hear the party on the Hill. Not close enough to be at it.`,
    (c) => `${c.rec}. A playoff team on paper. The games, unfortunately, are not played on paper.`,
    (c) => `You are ${c.ord}. Good lawn, good record, no trophy for either.`,
    (c) => `${c.pf} points and ${withArticle(c.ord)} place lawn. Respectable. Nobody frames respectable.`,
    (c) => `Playoff Heights at ${c.rec}. It is a nice house. It is not the big house.`,
  ],
  bubble: [
    (c) => `${c.ord} place. The Bubble. Beige house, beige record, no sleep.`,
    (c) => `${c.rec}. Not in, not out. Welcome to the cul-de-sac of maybe.`,
    (c) => c.left > 0 && `${c.ord} of ${c.N} with ${c.leftW} to play. Everyone on this street is doing the same math.`,
    (c) => `The Bubble at ${c.rec}. Every Sunday is a referendum now.`,
    (c) => `${c.rec}. One good week from the Heights. One bad week from the raccoons.`,
    (c) => `You are ${c.ord}. The "For Sale?" signs on this street are not decoration.`,
    (c) => `${c.rec}, ${c.ord} place. The most stressful address in the league. Welcome home.`,
    (c) => `Bubble life at ${c.rec}. You check the standings more than you check your lineup.`,
    (c) => `${c.ord} place. Nobody on this street has unpacked. Nobody should.`,
    (c) => c.gap && c.inSpot && `${c.rec} and ${c.gap} clear of the cut line. Do not get comfortable. Beige is temporary.`,
    (c) => c.gap && !c.inSpot && `${c.rec} and ${c.gap} out of a playoff spot. The street is beige. So is the outlook.`,
  ],
  park: [
    (c) => `${c.ord} place at ${c.rec}. The raccoons have elected you treasurer.`,
    (c) => `${c.rec}. You live next to the landfill. The landfill is having a better year.`,
    (c) => `${c.ord} of ${c.N}. The trailer is paid off. So, very nearly, is your season.`,
    (c) => c.gap && `${c.rec} and ${c.gap} out of a playoff spot. The raccoons believe in you. They are raccoons.`,
    (c) => `Trailer park, ${c.rec}. You have worked the waiver wire. It has not worked back.`,
    (c) => `${c.ord} place. From down here the Hill is mostly a rumor.`,
    (c) => c.bags >= 2 && `${c.rec}. ${c.bags} trash bags on the lawn and pickup is not scheduled.`,
    (c) => `${c.pf} points, ${c.ord} place. Somebody has to live by the landfill. This year it is you.`,
    (c) => `${c.rec}. The good news: the Dump is a different neighborhood. The bad news: barely.`,
    (c) => `${c.ord} of ${c.N}. The raccoons run the homeowners association. You report to them.`,
  ],
  dump: [
    (c) => `Last place at ${c.rec}. A tent, a heap, and a rain cloud that knows your name.`,
    (c) => `${c.ord} of ${c.N}. There is nobody below you to feel better about.`,
    (c) => `${c.rec}. The rain cloud over your tent is not weather. It is personal.`,
    (c) => `Dead last at ${c.rec}. The seagulls stopped circling. Even they have standards.`,
    (c) => `${c.rec} and last. The only way is up, which is also what you said last week.`,
    () => `You live in the Dump. On the bright side, nobody asks you for trade advice.`,
    (c) => `Last place with ${c.pf} points. The garbage truck comes by weekly. So do the losses.`,
    (c) => `${c.ord} place. Every league needs a foundation. You are holding ${c.others} teams up.`,
    (c) => `${c.rec}. Rock bottom has a tent on it. The tent has your name on it.`,
    (c) => c.gap && `Last of ${c.N} and ${c.gap} out of a playoff spot, if you are still counting. Stop counting.`,
  ],
};

// Nobody has finished a game yet.
const ARRIVAL_FRESH = [
  () => `0-0. Undefeated. This is the best your record will ever look.`,
  () => `No games played. Your address is a guess. It gets personal in Week 1.`,
  () => `Your record is perfect. So is everyone else's. This is as equal as it gets.`,
  () => `0-0. Your roster has never let you down. Give it a week.`,
  () => `No wins, no losses, no evidence. Enjoy the benefit of the doubt.`,
  () => `Opening week. The standings are a formality. They get personal quickly.`,
  () => `You are undefeated and so is your optimism. One of those may end Sunday.`,
  () => `0-0. Every team in this league is a contender right now. Even yours.`,
  () => `0-0 and full of hope. The league has seen this before.`,
  () => `Everybody is tied for first. Enjoy the company while it lasts.`,
  () => `You have not lost a game all year. Technically nobody has. It still counts.`,
  () => `0-0. The draft grades are in and they mean nothing. Yours especially.`,
  (c) => `Nothing has happened yet. Somehow you are already ${c.ord} of ${c.N}.`,
  () => `Week 1 is coming. Your lawn is clean. Take a picture.`,
  () => `The season has not started. You have never been closer to a title.`,
  () => `0-0. No trash bags, no flamingos, no excuses. Yet.`,
  (c) => c.rank === c.N && `Last place before a single game. That is just the seeding. Probably.`,
  (c) => c.rank === 1 && `First place before a single game. You have earned nothing. Enjoy the throne.`,
];

// The regular season is done and the playoffs are on.
const ARRIVAL_POST_IN = [
  (c) => `The ${c.ord} seed at ${c.rec}. The regular season was the easy part.`,
  (c) => `You made the playoffs as the ${c.ord} seed. Everything before this was a rehearsal.`,
  (c) => `Playoffs. ${c.rec} got you in the door. It will not get you a drink.`,
  (c) => `${c.ord} seed. Win and the title is in play. Lose and it is a long winter.`,
  (c) => `In the bracket at ${c.rec}. This is where good seasons go to be judged.`,
  (c) => `The ${c.ord} seed. Your regular season has been noted and no longer matters.`,
  (c) => `${c.rec} and into the playoffs. Set a lineup. Check it twice. Then check it again.`,
  (c) => `You are in. ${c.rec}, ${c.ord} seed. From here every loss is the last one.`,
  (c) => c.rank === 1 && `The top seed at ${c.rec}. Anything short of the title is now a collapse. No pressure.`,
];
const ARRIVAL_POST_KO = [
  (c) => `Knocked out in Week ${c.koWeek}. ${c.rec} got you a ticket. It did not get you a second act.`,
  (c) => `The ${c.ord} seed, eliminated in Week ${c.koWeek}. The bracket moved on without a word.`,
  (c) => `Your playoff run ended in Week ${c.koWeek}. It is being called a run out of politeness.`,
  (c) => `Out of the bracket. ${c.rec} was a fine season. The playoffs did not ask about it.`,
  (c) => `Eliminated in Week ${c.koWeek}. You made the playoffs. The playoffs made a point.`,
  (c) => `You went out in Week ${c.koWeek}. The title is now officially someone else's problem.`,
  (c) => `${c.ord} seed, out in Week ${c.koWeek}. The regular season banner stays up. It is a small banner.`,
  (c) => `The bracket has ${c.P} names on it. Yours has a line through it as of Week ${c.koWeek}.`,
];
const ARRIVAL_POST_OUT = [
  (c) => `Missed the playoffs at ${c.rec}. The consolation bracket thanks you for your service.`,
  (c) => `${c.ord} of ${c.N}. The playoffs are happening up the hill. You can hear them from here.`,
  (c) => `Season over at ${c.rec}. You are now a fan of chaos. Root accordingly.`,
  (c) => `No playoffs this year. ${c.rec} will do that. See you at the draft.`,
  (c) => `${c.ord} place and out. The off-season started early at your house.`,
  (c) => `Out at ${c.rec}. The consolation games still count. To someone. Somewhere.`,
  (c) => `${c.rec}. The regular season is over and it won. See you next year.`,
  (c) => `You finished ${c.ord}. The playoff bracket has ${c.P} names on it. None of them are yours.`,
  (c) => c.rank === c.N && `Last place, final answer. The playoffs are something happening to other people.`,
];

// The whole season is over.
const ARRIVAL_COMPLETE = {
  champ: [
    () => `Champion. The crown stays on until next fall. Wear it to the group chat.`,
    (c) => `You won the whole thing at ${c.rec}. The Hill is yours all off-season. Do not be gracious.`,
    (c) => `${c.season} champion. The engraver spelled it right. Everyone checked.`,
    (c) => c.prevRank > 1 && `Entered the playoffs as the ${c.prevOrd} seed. Left with the crown. The Hill has a new owner.`,
    (c) => `First of ${c.N}. Nothing left to prove until September. Be unbearable.`,
  ],
  runner: [
    () => `Second place. One game short. You will think about it until September.`,
    (c) => `Runner-up at ${c.rec}. The fountain is nice. It is not a trophy.`,
    (c) => `You finished 2nd of ${c.N}. So close that it will come up every year. Mostly from you.`,
    () => `Second. The Hill was right there. You could read the gate code.`,
  ],
  last: [
    () => `Final standing: last. The tent is yours for the entire off-season.`,
    (c) => `The season is over and you finished ${c.ord} of ${c.N}. The rain cloud renewed its lease.`,
    (c) => `Last place at ${c.rec}, final. The good news is the draft order. That is all the good news.`,
    () => `Last. The season ended, which is the nicest thing it did for you.`,
  ],
  in: [
    (c) => `Final: ${c.ord} place. A playoff team, briefly. See you in the fall.`,
    (c) => `${c.ord} of ${c.N} when it ended. You made the playoffs. The playoffs made a point.`,
    (c) => `Season over. ${c.ord} place at ${c.rec}. Good enough to hope. Not enough to win.`,
    (c) => `You finished ${c.ord}. A banner will not be made. A nice season, though. Truly.`,
  ],
  out: [
    (c) => `Final: ${c.ord} of ${c.N} at ${c.rec}. The off-season is long. Use all of it.`,
    (c) => `Season over at ${c.rec}. ${c.ord} place. There is always next year. That is what it is for.`,
    (c) => `${c.ord} place, final. Nothing can go wrong for you until September.`,
    (c) => `The books are closed at ${c.rec}. ${c.ord} of ${c.N}. The raccoons will watch the place.`,
  ],
  any: [
    (c) => `Season over. ${c.ord} place, ${c.rec}. The standings are final and so is the judgment.`,
    (c) => `It is over. You finished ${c.ord}. The draft is the next time hope is legal.`,
    (c) => `${c.rec}, ${c.ord} of ${c.N}, final. Your house stays where it is until next season.`,
  ],
};

function arrivalBase(c) {
  if (c.mode === 'fresh') return { key: 'fresh', lines: ARRIVAL_FRESH, w: 6 };
  if (c.mode === 'post') {
    if (c.koWeek) return { key: 'post-ko', lines: ARRIVAL_POST_KO, w: 6.5 };
    return c.inSpot
      ? { key: 'post-in', lines: ARRIVAL_POST_IN, w: 6.5 }
      : { key: 'post-out', lines: ARRIVAL_POST_OUT, w: 6.5 };
  }
  if (c.mode === 'complete') {
    const k = c.rank === 1 ? 'champ' : c.rank === c.N ? 'last' : c.rank === 2 ? 'runner' : c.inSpot ? 'in' : 'out';
    const own = ARRIVAL_COMPLETE[k];
    return { key: `complete-${k}`, lines: k === 'champ' || k === 'last' ? own : own.concat(ARRIVAL_COMPLETE.any), w: 6 };
  }
  return { key: `tier-${c.tier}`, lines: ARRIVAL_TIER[c.tier] || ARRIVAL_TIER.bubble, w: 5 };
}

const inSeason = (c) => c.mode === 'regular';
const lastWeekCounts = (c) => (c.mode === 'regular' || c.mode === 'post') && c.last;

// Special cases. `when` returns a weight (0 = does not apply). The heaviest one usually wins,
// with a little seeded jitter so a team is not handed the same kind of line every week.
const ARRIVAL_SPECIALS = [
  {
    kind: 'title-game',
    when: (c) => (c.titleGame ? 9.6 : 0),
    lines: [
      () => `You are in the title game. One more win and the Hill is yours until next fall.`,
      (c) => `Championship week. ${c.rec} and everything after it comes down to one lineup. Check it.`,
      () => `Title game. You are in it. Set the lineup, then stop touching it.`,
      (c) => `One game for the title, and it is against ${c.opp} of all teams. No pressure.`,
    ],
  },
  {
    kind: 'empty',
    when: (c) => (c.lineupLive && c.emptySlot ? 9 : 0),
    lines: [
      (c) => `Your ${c.emptySlot} spot is empty. Free points, just sitting there. The goalposts gave up.`,
      (c) => `Nobody is starting at ${c.emptySlot}. That is not a strategy. The goalposts fell over.`,
      (c) => `You are starting nobody at ${c.emptySlot}. Nobody is projected for 0.0.`,
      (c) => `Empty ${c.emptySlot} slot this week. Your opponent sends thanks and a fruit basket.`,
    ],
  },
  {
    kind: 'bad',
    when: (c) => (c.lineupLive && c.bad ? 7.2 : 0),
    lines: [
      (c) => `You are starting ${c.bad.player}, who is ${c.bad.whyText}. One of you should know that.`,
      (c) => `${c.bad.player} (${c.bad.why}) is in your starting lineup. Bold. Wrong, but bold.`,
      (c) => `Your lineup features ${c.bad.player}, currently ${c.bad.whyText}. The goalposts are crooked for a reason.`,
      (c) => `${c.bad.player} is ${c.bad.whyText} and starting for you anyway. The bench is right there.`,
    ],
  },
  {
    kind: 'took-hill',
    when: (c) => (inSeason(c) && c.rank === 1 && c.prevRank > 1 ? 9 : 0),
    lines: [
      (c) => `New to the Hill. You were ${c.prevOrd} last week. The throne is still warm.`,
      () => `You took first place this week. The throne is still warm. Do not ask from whom.`,
      () => `First place, as of this week. The gate code is new. So is everybody hating you.`,
      (c) => `${c.prevOrd} to 1st in a week. The moving truck could barely make it up the Hill.`,
    ],
  },
  {
    kind: 'fell-dump',
    when: (c) => (inSeason(c) && c.rank === c.N && c.prevRank && c.prevRank < c.N ? 8.6 : 0),
    lines: [
      (c) => `New to the Dump. You were ${c.prevOrd} last week. The tent comes furnished with regret.`,
      () => `Last place, as of this week. The rain cloud found you fast.`,
      (c) => `${c.prevOrd} to last in one week. The Dump had a vacancy. You filled it.`,
    ],
  },
  {
    kind: 'first-mile',
    when: (c) => (inSeason(c) && c.rank === 1 && c.leadGames >= 2 ? 8 : 0),
    lines: [
      (c) => `${capFirst(c.lead)} clear of the field. The trophy engraver has started on your name.`,
      (c) => `First place by ${c.lead}. Everyone else is playing for second and pretending otherwise.`,
      (c) => `Up ${c.lead} at ${c.rec}. The rest of the league is competing for the right to look up.`,
      (c) => `${c.rec} and ${c.lead} ahead. You could bench your kicker and nobody would notice.`,
    ],
  },
  {
    kind: 'first-barely',
    when: (c) => (inSeason(c) && c.rank === 1 && c.lead && c.leadGames <= 0 ? 8 : 0),
    lines: [
      (c) => c.leadPts && `Tied with ${c.second} at ${c.rec}. You hold the Hill by ${c.leadPts} points. Sleep lightly.`,
      (c) => c.leadPts && `First place by ${c.leadPts} points. That is not a lead. That is a rounding error.`,
      (c) => c.leadPts && `${c.rec}, tied on record, ahead by ${c.leadPts} points. The crown is yours. Do not sneeze.`,
      (c) => !c.leadPts && `Tied at ${c.rec} and first on a tiebreaker. The tiebreaker is the only one who likes you.`,
      (c) => `${c.rec} and first by ${c.lead}. Somebody down the street has the same record and a grudge.`,
    ],
  },
  {
    kind: 'first-narrow',
    when: (c) => (inSeason(c) && c.rank === 1 && c.leadGames > 0 && c.leadGames < 2 ? 6.5 : 0),
    lines: [
      (c) => `${capFirst(c.lead)} up on ${c.second} and they are already measuring your guest room.`,
      (c) => `First place by ${c.lead}. The Hill has one house on it. ${c.second} has noticed.`,
      (c) => `${c.rec}, ${c.lead} clear. A lead like that survives exactly one bad Sunday.`,
    ],
  },
  {
    kind: 'second-close',
    when: (c) => (inSeason(c) && c.rank === 2 && c.gbFirst != null && c.gbFirst <= 1 ? 6 : 0),
    lines: [
      (c) => c.gbText && `${capFirst(c.gbText)} behind ${c.first} for the Hill. Close enough to see the throne. Not to sit in it.`,
      (c) => c.gbText && `${capFirst(c.gbText)} out of first at ${c.rec}. You can see the throne. You cannot sit in it.`,
      (c) => !c.gbText && `Tied with ${c.first} at ${c.rec} and losing the tiebreaker. The Hill is one door away.`,
      (c) => !c.gbText && `Same record as first place. Wrong side of the tiebreaker. The Hill is one door away.`,
    ],
  },
  {
    kind: 'cut-in',
    when: (c) => (inSeason(c) && c.rank === c.P && c.gap ? 7.2 : 0),
    lines: [
      (c) => `Last team in at ${c.rec}, by ${c.gap}. The trailer park can see your porch light.`,
      (c) => `${c.ord} place. The playoff line runs along your back fence. You are inside it by ${c.gap}.`,
      (c) => `In by ${c.gap} at ${c.rec}. The sign on your lawn says "For Sale?" and means it.`,
      (c) => `${c.rec} and holding the last playoff spot by ${c.gap}. Do not make any sudden moves.`,
    ],
  },
  {
    kind: 'cut-out',
    when: (c) => (inSeason(c) && c.rank === c.P + 1 && c.gap ? 7.2 : 0),
    lines: [
      (c) => `First team out at ${c.rec}, ${c.gap} short. The playoff line is the neighbor's fence.`,
      (c) => `${c.rec} and ${c.gap} out of a playoff spot. You can read the party invitations from here.`,
      (c) => `${c.ord} place. The cut line is right there. You are on the wrong side of it by ${c.gap}.`,
      (c) => `${capFirst(c.gap)} out at ${c.rec}. Close enough to smell the playoffs. Not close enough to eat.`,
    ],
  },
  {
    kind: 'moved-up',
    when: (c) => (inSeason(c) && c.tierMove === 'up' && c.rank !== 1 ? 8 : 0),
    lines: [
      (c) => `Moved up to ${c.tierShort} this week. The truck is still out front. Do not unpack.`,
      (c) => `New address: ${c.tierShort}. You were ${c.prevOrd}, now ${c.ord}. Try to look like you belong.`,
      (c) => `Up from ${c.prevTierShort} to ${c.tierShort}. Your old neighbors are already talking about you.`,
      (c) => `${c.prevOrd} to ${c.ord} in a week. The moving truck was not in the budget. Worth it.`,
    ],
  },
  {
    kind: 'moved-down',
    when: (c) => (inSeason(c) && c.tierMove === 'down' && c.rank !== c.N ? 8 : 0),
    lines: [
      (c) => `Relocated from ${c.prevTierShort} to ${c.tierShort}. The truck did not need directions.`,
      (c) => `Down to ${c.tierShort}. You were ${c.prevOrd} a week ago. Your old house already has new people in it.`,
      (c) => `Welcome to ${c.tierShort}. You used to live ${c.prevTierLived}. Nobody here will ask. Much.`,
      (c) => `${c.prevOrd} to ${c.ord} in one week. The moving truck is idling. It thinks you are not done.`,
    ],
  },
  {
    kind: 'loss-streak',
    when: (c) => (inSeason(c) && c.lossStreak >= 3 ? 6 + Math.min(c.lossStreak, 7) * 0.4 : 0),
    lines: [
      (c) => `${c.lossStreak} straight losses. The trash bags on your lawn are not decor. They are a count.`,
      (c) => `Lost ${c.lossStreak} in a row. ${c.rec} now. The raccoons have started bringing friends.`,
      (c) => c.lastWinWeek > 0 && `${c.lossStreak} losses running. Your last win was Week ${c.lastWinWeek}. It was a simpler time.`,
      (c) => c.w === 0 && `${c.lossStreak} losses running and still looking for win number 1. It is out there. Probably.`,
      (c) => `${capFirst(withArticle(c.lossStreak))}-game losing streak at ${c.rec}. The lawn is filling up. So is the excuse jar.`,
    ],
  },
  {
    kind: 'win-streak',
    when: (c) => (inSeason(c) && c.winStreak >= 3 ? 6 + Math.min(c.winStreak, 7) * 0.4 : 0),
    lines: [
      (c) => `${c.winStreak} wins in a row. The flamingos on your lawn are multiplying. Do not ask how.`,
      (c) => `Won ${c.winStreak} straight. ${c.rec} now. The neighbors have noticed and they hate it.`,
      (c) => c.lastLossWeek > 0 && `${capFirst(withArticle(c.winStreak))}-game win streak. You have not lost since Week ${c.lastLossWeek}. Stay humble. Or do not.`,
      (c) => c.l === 0 && `${c.rec}. You have not lost yet. Somebody should check the scoring settings.`,
      (c) => `${c.winStreak} straight wins. One flamingo per win, per the bylaws. Your lawn is getting loud.`,
    ],
  },
  {
    kind: 'unluckiest',
    when: (c) => (inSeason(c) && c.luckTag === 'unluckiest' && c.luckDelta <= -0.75 ? 7 : 0),
    lines: [
      (c) => `Unluckiest team in the league. ${c.ap} in all-play, ${c.rec} where it counts. The black cat moved in.`,
      (c) => `Your points say ${c.exp} wins. Your record says ${c.w}. The schedule owes you an apology.`,
      (c) => `${c.ap} in all-play and only ${c.rec} to show for it. A black cat now lives on your porch.`,
      (c) => `The math says you are ${c.luckD} wins short of what you earned. The schedule does not do math.`,
    ],
  },
  {
    kind: 'luckiest',
    when: (c) => (inSeason(c) && c.luckTag === 'luckiest' && c.luckDelta >= 0.75 ? 7 : 0),
    lines: [
      (c) => `Luckiest team in the league. ${c.rec} on ${withArticle(c.ap)} all-play record. The horseshoe is doing the work.`,
      (c) => `Your points say ${c.exp} wins. You have ${c.w}. Nobody is checking. Keep walking.`,
      (c) => `${c.luckD} more wins than the math says you earned. Do not look directly at the horseshoe.`,
      (c) => `${c.rec} on ${withArticle(c.ap)} all-play record. You keep finding the right opponent on the right week.`,
    ],
  },
  {
    kind: 'toilet',
    when: (c) => (lastWeekCounts(c) && c.toilet ? 8.5 : 0),
    lines: [
      (c) => `${c.last.pts} last week, the lowest score in the league. Enjoy the golden toilet. You earned it.`,
      (c) => `You scored ${c.last.pts} in Week ${c.L}. Nobody scored less. The golden toilet has been delivered.`,
      (c) => `Week ${c.L} low score: you, with ${c.last.pts}. The toilet is gold. That is the only good news.`,
      (c) => c.last.won === true && `Lowest score of the week (${c.last.pts}) and you still won. The golden toilet came anyway.`,
    ],
  },
  {
    kind: 'spotlight',
    when: (c) => (lastWeekCounts(c) && c.spotlight ? 7 : 0),
    lines: [
      (c) => `${c.last.pts} last week, most in the league. The spotlight is on your house. Try not to squint.`,
      (c) => `Week ${c.L} high score: ${c.last.pts}. The spotlight is yours for a week. Everyone can see it.`,
      (c) => `You dropped ${c.last.pts} in Week ${c.L}. Best in the league. This may have been the peak.`,
    ],
  },
  {
    kind: 'eliminated',
    when: (c) => (inSeason(c) && c.eliminated ? 8.8 : 0),
    lines: [
      (c) => `Mathematically eliminated at ${c.rec}. The math was not close.`,
      (c) => c.left > 0 && `Eliminated with ${c.leftW} to play. The rest is for pride. You may need to borrow some.`,
      () => `Your playoff odds are 0. Not low. 0. The remaining games are for the love of it.`,
      (c) => `Eliminated at ${c.rec}. From here on you are a spoiler. Spoil something.`,
    ],
  },
  {
    kind: 'clinched',
    when: (c) => (inSeason(c) && c.clinched ? 7.5 : 0),
    lines: [
      (c) => `Playoff spot clinched at ${c.rec}. You may now rest your starters and blame the bye week.`,
      () => `Clinched. The rest of the regular season is a victory lap with homework.`,
      (c) => c.left > 0 && `You are in the playoffs. It is official. Try to make ${c.left === 1 ? 'the last week' : `the next ${c.leftW}`} interesting.`,
      (c) => `${c.rec} and clinched. Nothing can stop you now except everything in the playoffs.`,
    ],
  },
  {
    kind: 'champ',
    when: (c) => (inSeason(c) && c.champ ? (c.champ.condition === 'cone' ? 8.5 : 6.6) : 0),
    lines: [
      (c) => c.champ.condition === 'cone' && `Defending champion. Currently ${c.ord}. There is a traffic cone on your statue.`,
      (c) => c.champ.condition === 'cone' && `You won it all in ${c.champ.season}. You are ${c.rec} now. The statue has questions.`,
      (c) => c.champ.condition === 'cone' && `From champion to ${c.ord} of ${c.N}. The banner is still up. Nobody has the heart to move it.`,
      (c) => c.champ.condition === 'shiny' && `Defending champion and ${c.ord} again. The statue is freshly polished. It is annoying.`,
      (c) => c.champ.condition === 'shiny' && `Champion in ${c.champ.season}, ${c.rec} now. You are being insufferable about it. Correctly.`,
      (c) => c.champ.condition === 'pigeons' && `Defending champion, currently ${c.ord}. Pigeons have taken an interest in your statue.`,
      (c) => c.champ.condition === 'pigeons' && `You won it all in ${c.champ.season}. This year you are ${c.rec}. The statue is collecting pigeons.`,
    ],
  },
  {
    kind: 'drought',
    when: (c) => (inSeason(c) && c.hist && c.hist.titlesN === 0 && c.hist.seasons >= 3 ? (c.rank <= 2 || c.rank >= c.N - 1 ? 6.5 : 5.5) : 0),
    lines: [
      (c) => `${c.hist.seasons} seasons, 0 titles. Currently ${c.ord} at ${c.rec}. The drought has its own room.`,
      (c) => c.inSpot && `0 titles in ${c.hist.seasons} seasons and ${c.ord} right now. This could be the year. It usually is not.`,
      (c) => `${c.hist.seasons} seasons in this league and the trophy has never slept over. ${c.rec} this time.`,
      (c) => !c.inSpot && `0 for ${c.hist.seasons} on titles and ${c.ord} this year. At least you are consistent.`,
    ],
  },
  {
    kind: 'since-title',
    when: (c) => (inSeason(c) && c.hist && c.hist.titlesN > 0 && c.hist.since >= 3 ? 5.6 : 0),
    lines: [
      (c) => `Last title: ${c.hist.lastTitle}. That was ${c.hist.since} seasons ago. The banner is fading. ${c.rec} this year.`,
      (c) => `You won in ${c.hist.lastTitle}. ${c.hist.since} seasons later you are ${c.ord}. The trophy does not call anymore.`,
    ],
  },
  {
    kind: 'last-again',
    when: (c) => (inSeason(c) && c.hist && c.hist.lastN >= 1 && c.rank >= c.N - 1 ? 6.6 : 0),
    lines: [
      (c) => `You finished last in ${c.hist.lastYear}. At ${c.ord} of ${c.N}, you are in position to do it again.`,
      (c) => c.hist.lastN >= 2 && `${c.hist.lastN} last place finishes on your record. At ${c.ord} of ${c.N}, another one is in play.`,
      (c) => `Last place in ${c.hist.lastYear} and ${c.ord} now. The tent still has your name on the mail slot.`,
    ],
  },
  {
    kind: 'pf-king',
    when: (c) => (inSeason(c) && c.gp >= 3 && c.pfRank === 1 && c.rank >= 4 ? 7 : 0),
    lines: [
      (c) => `Most points in the league (${c.pf}) and ${c.ord} place. The schedule has a sense of humor.`,
      (c) => `Nobody has outscored your ${c.pf}. ${c.rank - 1} teams have a better record anyway.`,
      (c) => `${c.pf} points, 1st in scoring, ${c.ord} in the standings. One of those is lying. Not the points.`,
    ],
  },
  {
    kind: 'pf-fraud',
    when: (c) => (inSeason(c) && c.gp >= 3 && c.rank <= Math.max(2, Math.floor(c.P / 2)) && c.pfRank >= c.rank + 4 ? 6.8 : 0),
    lines: [
      (c) => `${c.ord} place with the ${c.pfOrd} most points. You win on the right days. That is the whole trick.`,
      (c) => `${c.rec} on ${c.pf} points, ${c.pfOrd} in scoring. The standings like you more than the numbers do.`,
    ],
  },
  {
    kind: 'bench',
    when: (c) => (lastWeekCounts(c) && c.bench ? 8.2 : 0),
    lines: [
      (c) => `${c.bench.player} scored ${c.bench.pts} on your bench last week. You lost by ${c.last.m}. Think about that.`,
      (c) => `You lost by ${c.last.m} with ${c.bench.pts} sitting on the bench. The start button is free to use.`,
      (c) => `${c.bench.pts} points from ${c.bench.player}, on your bench, in ${withArticle(c.last.m)}-point loss. Bold managing.`,
      (c) => c.bench.low && `You started ${c.bench.low} (${c.bench.lowPts}) over ${c.bench.player} (${c.bench.pts}) and lost by ${c.last.m}.`,
    ],
  },
  {
    kind: 'heartbreak',
    when: (c) => (lastWeekCounts(c) && c.last.won === false && c.last.margin < 3 ? 7 + (3 - c.last.margin) / 2 : 0),
    lines: [
      (c) => `Lost by ${c.last.m} last week. One catch. You know which one.`,
      (c) => `${c.last.pts} to ${c.last.oppPts}. You lost Week ${c.L} by ${c.last.m}. Watching the replay will not change it.`,
      (c) => c.mode === 'regular' && c.l > 0 && `${c.last.m} points. That was the difference between ${c.rec} and ${c.w + 1}-${c.l - 1}. Sleep well.`,
    ],
  },
  {
    kind: 'squeaker',
    when: (c) => (lastWeekCounts(c) && c.last.won === true && c.last.margin < 3 ? 6.3 : 0),
    lines: [
      (c) => `Won by ${c.last.m} last week. A win is a win. This one was barely a win.`,
      (c) => `You beat ${c.lastOpp} by ${c.last.m}. Frame the box score. Hide the bench.`,
      (c) => `${c.last.pts} to ${c.last.oppPts}. You survived Week ${c.L} by ${c.last.m}. Do not call it a statement.`,
    ],
  },
  {
    kind: 'blown-out',
    when: (c) => (lastWeekCounts(c) && c.last.won === false && c.last.margin >= 40 ? 6.8 + Math.min(1, (c.last.margin - 40) / 30) : 0),
    lines: [
      (c) => `Lost by ${c.last.m} last week. ${c.lastOpp} stopped watching by halftime. So did you.`,
      (c) => `${c.last.oppPts} to ${c.last.pts}. That was not a matchup. That was an incident.`,
      (c) => `You lost Week ${c.L} by ${c.last.m}. The trash bag for that one needed a second bag.`,
    ],
  },
  {
    kind: 'blowout-win',
    when: (c) => (lastWeekCounts(c) && c.last.won === true && c.last.margin >= 40 ? 6.2 : 0),
    lines: [
      (c) => `Beat ${c.lastOpp} by ${c.last.m} last week. Somebody should go check on them.`,
      (c) => `Won by ${c.last.m} in Week ${c.L}. There is no mercy rule. You checked.`,
      (c) => `${c.last.pts} to ${c.last.oppPts}. You did not have to do all that. You did anyway.`,
    ],
  },
  {
    kind: 'robbed',
    when: (c) => (lastWeekCounts(c) && c.last.won === false && c.last.wkN >= 6 && c.last.wkRank <= 3 ? 7.4 : 0),
    lines: [
      (c) => `${c.last.pts} last week, ${c.last.wkOrd} best in the league, and you lost. The schedule sends its regards.`,
      (c) => c.last.beatN === 1 && `You scored ${c.last.pts} and lost. Only 1 team scored more. It was your opponent.`,
      (c) => c.last.beatN > 1 && `You scored ${c.last.pts} and lost. Only ${c.last.beatN} teams scored more. One was your opponent.`,
    ],
  },
  {
    kind: 'gifted',
    when: (c) => (lastWeekCounts(c) && c.last.won === true && c.last.wkN >= 6 && c.last.wkRank >= c.last.wkN - 2 ? 7 : 0),
    lines: [
      (c) => `${c.last.pts} last week, ${c.last.fromBottomOrd} worst in the league, and you won. Do not explain it. Just leave.`,
      (c) => `You won Week ${c.L} with ${c.last.pts}. ${c.last.beatN} teams outscored you. None of them were your opponent.`,
    ],
  },
  {
    kind: 'nemesis-week',
    when: (c) => (c.lineupLive && c.mode !== 'fresh' && c.cur && c.nem && c.nem.teamId != null && c.nem.teamId === c.cur.oppId ? 7.6 : 0),
    lines: [
      (c) => `${c.opp} is up next. You are ${c.nem.w}-${c.nem.l} against them all time. Bring a helmet.`,
      (c) => `This week you get ${c.opp} again. Lifetime record: ${c.nem.w}-${c.nem.l}. The mailbox already flinched.`,
      (c) => `${c.nem.w}-${c.nem.l} all time against ${c.opp} and here they come again. History is not on your side.`,
      (c) => `Your nemesis is on the schedule this week. You are ${c.nem.w}-${c.nem.l} lifetime. Lower your expectations.`,
    ],
  },
  {
    kind: 'victim-week',
    when: (c) => (c.lineupLive && c.mode !== 'fresh' && c.cur && c.vic && c.vic.teamId != null && c.vic.teamId === c.cur.oppId ? 6 : 0),
    lines: [
      (c) => `${c.opp} is up next. You are ${c.vic.w}-${c.vic.l} against them all time. They have this one circled.`,
      (c) => `You own ${c.opp} at ${c.vic.w}-${c.vic.l} all time. That is exactly the kind of thing that ends this week.`,
      (c) => `${c.vic.w}-${c.vic.l} lifetime against this week's opponent. Try not to mention it until Tuesday.`,
    ],
  },
  {
    kind: 'ir-ward',
    when: (c) => (inSeason(c) && c.irN >= 3 ? 5.2 : 0),
    lines: [
      (c) => `${c.irN} players on IR. The ambulance has a reserved spot at your curb.`,
      (c) => `Your IR has ${c.irN} players in it. At this point it is less a roster than a waiting room.`,
    ],
  },
  {
    kind: 'trash-heap',
    when: (c) => (inSeason(c) && c.bags >= 5 ? 5.6 : 0),
    lines: [
      (c) => `${c.bags} trash bags on the lawn. Each one is a loss you never answered. Pickup is not scheduled.`,
      (c) => `${c.bags} bags of garbage out front at ${c.rec}. The raccoons consider you a sponsor.`,
    ],
  },
];

function arrivalFor(c, rng, used) {
  const base = arrivalBase(c);
  const cands = c.mode === 'complete' ? [] : weigh(ARRIVAL_SPECIALS, c, rng, 1.5).map((x) => ({ key: x.item.kind, lines: x.item.lines, w: x.w }));
  cands.push({ key: base.key, lines: base.lines, w: base.w + rng() * 1.5 });
  cands.sort((a, b) => b.w - a.w);
  // First pass: only lines no other team has been given this week. Second pass: anything that fits.
  for (const freshOnly of [true, false]) {
    for (const cand of cands) {
      const s = pickLine(cand.lines, c, COPY_LIMITS.arrival, rng, used, `arrival:${cand.key}`, null, freshOnly);
      if (s) return s;
    }
  }
  return `You are ${c.ord} of ${c.N}.`;
}

// ---------------------------------------------------------------------------------------------
// Yard signs. 28 characters. No names.
// ---------------------------------------------------------------------------------------------

const SIGN_TIER = {
  hill: [
    () => `1st. Yes, Still.`,
    () => `No Soliciting. No Trades.`,
    () => `Crown On Loan`,
    (c) => `${c.rec}. Wave Back.`,
    () => `Throne Room By Appointment`,
    () => `Mind The Gold Gates`,
    (c) => `${c.rec}. Ask Me How.`,
    () => `Keep Off The Throne`,
  ],
  heights: [
    (c) => `${c.rec}. Playoff Bound?`,
    () => `Future Hill Resident`,
    (c) => `${c.ord} And Climbing`,
    () => `Mind The Fountain`,
    () => `We Say "We" Here`,
    (c) => `${c.rec}. Quietly Smug.`,
    () => `Hill Adjacent`,
    () => `Not First. Not Worried.`,
  ],
  bubble: [
    (c) => `For Sale? (${c.ord})`,
    () => `Do Not Jinx It`,
    (c) => `${c.rec}. Please Stand By.`,
    (c) => (c.inSpot ? `In. For Now.` : `Out. For Now.`),
    () => `Math Homework Inside`,
    () => `Quiet. Scoreboard Watching.`,
    () => `Beige By Choice`,
    (c) => `${c.rec}. It Is Fine.`,
  ],
  park: [
    () => `Beware Of Raccoons`,
    (c) => `${c.rec}. Do Not Ask.`,
    () => `Wait Till Next Week`,
    () => `Free Trade Advice`,
    () => `Under Renovation`,
    () => `Honk If You Lost Too`,
    (c) => c.l > 1 && `${c.l} Losses. Who Counts.`,
    () => `Landfill View Lots`,
  ],
  dump: [
    (c) => `${c.rec}. Send Help.`,
    () => `Last. But Present.`,
    () => `Tent Sweet Tent`,
    () => `Rebuilding Since Week 1`,
    () => `Rock Bottom Has A View`,
    () => `Free Rain. Take Some.`,
    () => `It Can Only Get Better`,
    () => `Seagulls Welcome`,
  ],
};

const SIGN_FRESH = [
  () => `0-0. Undefeated.`,
  () => `Undefeated Since Forever`,
  () => `Ask Me About My Draft`,
  () => `Hope Lives Here`,
  () => `No Losses On Premises`,
  () => `Lawn Is Clean. For Now.`,
  () => `This Is The Year`,
  () => `Check Back Week 2`,
  () => `Est. Week 1`,
  () => `Still Perfect`,
  () => `Optimism: Fully Stocked`,
  () => `Trophy Parking Only`,
  () => `Contender (Unverified)`,
];

const SIGN_SPECIALS = [
  { kind: 'complete-champ', when: (c) => (c.mode === 'complete' && c.rank === 1 ? 10 : 0), lines: [(c) => `${c.season} Champion`, () => `Champ. Do Not Knock.`, () => `The Trophy Lives Here`] },
  { kind: 'complete-last', when: (c) => (c.mode === 'complete' && c.rank === c.N ? 10 : 0), lines: [() => `Closed For The Winter`, () => `Wait Till Next Year`, () => `Last. See You In Fall.`] },
  { kind: 'complete', when: (c) => (c.mode === 'complete' ? 8 : 0), lines: [
    () => `See You In September`, (c) => `Final: ${c.rec}`, () => `Gone Fishing`, (c) => `Finished ${c.ord}. Moving On.`,
    () => `Closed For The Season`, (c) => `${c.rec}. The End.`, () => `Offseason Hours`, () => `Do Not Disturb Till Fall`,
    (c) => `Finished ${c.ord}. It Happened.`, () => `Will Draft Better`, (c) => c.inSpot && `Playoff Team (Retired)`, () => `Back In September`,
  ] },
  { kind: 'post-in', when: (c) => (c.mode === 'post' && c.alive ? 8 : 0), lines: [() => `Playoffs. Do Not Disturb.`, (c) => `${c.ord} Seed. Stay Back.`, () => `Win Or Go Home (Here)`, () => `Still Alive. Shh.`, () => `Bracket Business Only`] },
  { kind: 'post-ko', when: (c) => (c.mode === 'post' && c.koWeek ? 8 : 0), lines: [(c) => `Out In Week ${c.koWeek}`, () => `Was In The Playoffs`, () => `Bracket Alumni`, () => `It Was A Nice Run`] },
  { kind: 'post-out', when: (c) => (c.mode === 'post' && !c.inSpot ? 8 : 0), lines: [() => `Wait Till Next Year`, () => `Consolation Bracket HQ`, (c) => `${c.rec}. That Was It.`, () => `Draft Prep In Progress`, () => `Rooting For Chaos`] },
  { kind: 'empty', when: (c) => (c.lineupLive && c.emptySlot ? 9 : 0), lines: [(c) => `Now Hiring: ${c.emptySlot}`, (c) => `Help Wanted: ${c.emptySlot}`] },
  { kind: 'toilet', when: (c) => (lastWeekCounts(c) && c.toilet ? 8 : 0), lines: [() => `Home Of The Golden Toilet`, (c) => `${c.last.pts}. Do Not Look.`] },
  { kind: 'spotlight', when: (c) => (lastWeekCounts(c) && c.spotlight ? 7 : 0), lines: [(c) => `${c.last.pts}. You Saw It.`, (c) => `Week ${c.L} High Score`] },
  { kind: 'career-high', when: (c) => (inSeason(c) && c.hist && c.hist.careerHigh && !c.hist.bestOnce && c.gp >= 3 ? 7.2 : 0), lines: [() => `Best Season Yet`, (c) => `${c.ord}. A Career High.`, () => `Never Been This High`] },
  { kind: 'career-low', when: (c) => (inSeason(c) && c.hist && c.hist.careerLow && !c.hist.bestOnce && c.gp >= 3 ? 6.8 : 0), lines: [() => `New Personal Worst`, () => `Uncharted Territory`] },
  { kind: 'waiver-busy', when: (c) => (inSeason(c) && c.churn && c.churn.busiest ? 6.9 : 0), lines: [(c) => `${c.churn.total} Moves And Counting`, () => `Always On The Wire`, () => `Roster Under Construction`] },
  { kind: 'waiver-quiet', when: (c) => (inSeason(c) && c.churn && c.churn.quietest ? 6.7 : 0), lines: [(c) => `${c.churn.total} Moves. All Season.`, () => `Set It And Forget It`, () => `No Waiver Claims Here`] },
  { kind: 'win-streak', when: (c) => (inSeason(c) && c.winStreak >= 3 ? 7.5 : 0), lines: [(c) => `${c.winStreak} Straight. Honk.`, (c) => `Won ${c.winStreak} In A Row`] },
  { kind: 'loss-streak', when: (c) => (inSeason(c) && c.lossStreak >= 3 ? 7.5 : 0), lines: [(c) => `${c.lossStreak} Straight. Shh.`, (c) => `Lost ${c.lossStreak} In A Row. Shh.`] },
  { kind: 'clinched', when: (c) => (inSeason(c) && c.clinched ? 7 : 0), lines: [() => `Clinched. Relax.`, () => `Playoffs: Booked`] },
  { kind: 'eliminated', when: (c) => (inSeason(c) && c.eliminated ? 7.5 : 0), lines: [() => `Eliminated. Still Here.`, () => `See You Next Year`, () => `Playing For Pride`] },
  { kind: 'moved-up', when: (c) => (inSeason(c) && c.tierMove === 'up' ? 7.5 : 0), lines: [() => `New Here. Be Nice.`, () => `Just Moved In`] },
  { kind: 'moved-down', when: (c) => (inSeason(c) && c.tierMove === 'down' ? 7.5 : 0), lines: [() => `Just Visiting`, () => `Temporary Address`] },
  { kind: 'unluckiest', when: (c) => (inSeason(c) && c.luckTag === 'unluckiest' ? 6.5 : 0), lines: [() => `The Schedule Did This`, () => `Blame The Schedule`] },
  { kind: 'luckiest', when: (c) => (inSeason(c) && c.luckTag === 'luckiest' ? 6.5 : 0), lines: [() => `Luck Is A Skill`, () => `Better Lucky Than Good`] },
  { kind: 'champ', when: (c) => (inSeason(c) && c.champ ? 6.5 : 0), lines: [(c) => `${c.champ.season} Champ. Ask Me.`, () => `Defending Champ. Allegedly.`] },
  { kind: 'titles', when: (c) => (inSeason(c) && c.hist && c.hist.titlesN >= 2 ? 5.5 : 0), lines: [(c) => `${c.hist.titlesN}x Champ. Ask Me.`] },
  { kind: 'ir', when: (c) => (inSeason(c) && c.irN >= 2 ? 5.2 : 0), lines: [(c) => `${c.irN} On IR. Send Soup.`] },
  { kind: 'cut', when: (c) => (inSeason(c) && c.gap && (c.rank === c.P || c.rank === c.P + 1) ? 6 : 0), lines: [(c) => `For Sale? (${c.ord})`, (c) => (c.inSpot ? `In By A Little` : `Out By A Little`)] },
];

function signFor(c, rng, used) {
  const base = c.mode === 'fresh' ? { key: 'fresh', lines: SIGN_FRESH } : { key: `tier-${c.tier}`, lines: SIGN_TIER[c.tier] || SIGN_TIER.bubble };
  const cands = weigh(SIGN_SPECIALS, c, rng, 2).map((x) => ({ key: x.item.kind, lines: x.item.lines, w: x.w }));
  cands.push({ key: base.key, lines: base.lines, w: 6 + rng() * 2 });
  cands.sort((a, b) => b.w - a.w);
  for (const freshOnly of [true, false]) {
    for (const cand of cands) {
      const s = pickLine(cand.lines, c, COPY_LIMITS.sign, rng, used, `sign:${cand.key}`, null, freshOnly);
      if (s) return s;
    }
  }
  return `${c.rec}`;
}

// ---------------------------------------------------------------------------------------------
// Mailbox card. Third person. 2 to 4 short lines.
// ---------------------------------------------------------------------------------------------

const MAIL_RECORD = [
  (c) => c.mode === 'fresh' && `${c.me} is 0-0, like everyone. It will not last.`,
  (c) => c.mode === 'fresh' && `${c.me} is undefeated, on a technicality.`,
  (c) => c.mode === 'fresh' && `No games yet. ${c.me} is tied for first and tied for last.`,
  (c) => c.mode === 'complete' && `${c.me} finished ${c.ord} of ${c.N} at ${c.rec}.`,
  (c) => c.mode === 'complete' && `Final: ${c.rec}, ${c.ord} place.`,
  (c) => c.mode === 'post' && c.inSpot && !c.koWeek && `${c.rec} in the regular season. The ${c.ord} seed.`,
  (c) => c.mode === 'post' && c.koWeek > 0 && `${c.rec}, the ${c.ord} seed. Knocked out in Week ${c.koWeek}.`,
  (c) => c.mode === 'post' && c.titleGame && `${c.rec}, the ${c.ord} seed, and playing for the title this week.`,
  (c) => c.mode === 'post' && !c.inSpot && `${c.rec}, ${c.ord} of ${c.N}. Missed the playoffs.`,
  (c) => c.mode === 'post' && `${c.me} went ${c.rec} and finished ${c.ord} in the regular season.`,
  (c) => c.mode === 'regular' && `${c.me} is ${c.rec}, ${c.ord} of ${c.N}.`,
  (c) => c.mode === 'regular' && c.gp >= 2 && `${c.rec} and ${c.ord} place. ${c.pf} points, ${c.pfOrd} in scoring.`,
  (c) => c.mode === 'regular' && c.winStreak >= 2 && `${c.rec}, ${c.ord} place, won ${c.winStreak} straight.`,
  (c) => c.mode === 'regular' && c.lossStreak >= 2 && `${c.rec}, ${c.ord} place, lost ${c.lossStreak} straight.`,
  (c) => c.mode === 'regular' && c.gap && !c.inSpot && `${c.rec}, ${c.ord} place, ${c.gap} out of a playoff spot.`,
  (c) => c.mode === 'regular' && c.gap && c.inSpot && c.rank > 1 && `${c.rec}, ${c.ord} place, ${c.gap} clear of the cut line.`,
  (c) => c.mode === 'regular' && c.lead && `${c.rec}. First place by ${c.lead}.`,
];

const MAIL_WEEK = [
  // Not started.
  (c) => c.cur && c.cur.status === 'pre' && c.cur.hasProj && `This week: ${c.opp} (${c.cur.oppRec}). Projected ${c.cur.proj} to ${c.cur.oppProj}.`,
  (c) => c.cur && c.cur.status === 'pre' && c.cur.favored === true && `Favored by ${c.cur.projDiff} over ${c.opp} this week. Allegedly.`,
  (c) => c.cur && c.cur.status === 'pre' && c.cur.favored === false && `Projected to lose to ${c.opp} by ${c.cur.projDiff}. Projections are not promises.`,
  (c) => c.cur && c.cur.status === 'pre' && c.cur.favored === false && `${capFirst(withArticle(c.cur.projDiff))}-point underdog to ${c.opp} this week.`,
  (c) => c.cur && c.cur.status === 'pre' && !c.cur.hasProj && `This week: ${c.opp} (${c.cur.oppRec}).`,
  (c) => c.cur && c.cur.status === 'pre' && !c.cur.hasProj && `Up next: ${c.opp}, who is ${c.cur.oppRec}.`,
  // In progress.
  (c) => c.cur && c.cur.status === 'live' && c.cur.winning === true && `Leading ${c.opp} ${c.cur.pts} to ${c.cur.oppPts}. Not over.`,
  (c) => c.cur && c.cur.status === 'live' && c.cur.winning === true && `Up ${c.cur.diff} on ${c.opp} right now. Do not look at it.`,
  (c) => c.cur && c.cur.status === 'live' && c.cur.winning === false && `Trailing ${c.opp} ${c.cur.pts} to ${c.cur.oppPts}. The app will not help.`,
  (c) => c.cur && c.cur.status === 'live' && c.cur.winning === false && `Down ${c.cur.diff} to ${c.opp} right now. There is still time. Some.`,
  (c) => c.cur && c.cur.status === 'live' && c.cur.winning === null && c.cur.scored && `Tied with ${c.opp} at ${c.cur.pts}. Nobody blink.`,
  (c) => c.cur && c.cur.status === 'live' && c.cur.winning === null && !c.cur.scored && `Playing ${c.opp} this week. No points on the board yet.`,
  // Finished.
  (c) => c.cur && c.cur.status === 'final' && c.cur.winning === true && `Beat ${c.opp} ${c.cur.pts} to ${c.cur.oppPts} in Week ${c.week}.`,
  (c) => c.cur && c.cur.status === 'final' && c.cur.winning === true && `Won Week ${c.week} by ${c.cur.diff} over ${c.opp} (${c.cur.pts} to ${c.cur.oppPts}).`,
  (c) => c.cur && c.cur.status === 'final' && c.cur.winning === false && `Lost to ${c.opp} ${c.cur.pts} to ${c.cur.oppPts} in Week ${c.week}.`,
  (c) => c.cur && c.cur.status === 'final' && c.cur.winning === false && `Lost Week ${c.week} by ${c.cur.diff} to ${c.opp} (${c.cur.pts} to ${c.cur.oppPts}).`,
  (c) => c.cur && c.cur.status === 'final' && c.cur.winning === null && `Tied ${c.opp} at ${c.cur.pts} in Week ${c.week}. Everybody loses.`,
  // No game this week.
  (c) => !c.cur && (c.mode === 'regular' || c.mode === 'post') && c.phase !== 'complete' && `No game this week. Cannot lose. Finally.`,
];

const MAIL_CRIME = [
  (c) => c.lineupLive && c.emptyN === 1 && `Lineup: ${c.emptySlot} is empty. On purpose, presumably.`,
  (c) => c.lineupLive && c.emptyN === 1 && `Starting nobody at ${c.emptySlot}. Bold.`,
  (c) => c.lineupLive && c.emptyN > 1 && `${c.emptyN} starting spots are empty. That seems like a lot.`,
  (c) => c.lineupLive && !c.emptyN && c.bad && `Starting ${c.bad.player} (${c.bad.why}). Nobody tell them.`,
  (c) => c.lineupLive && !c.emptyN && c.bad && `${c.bad.player} is ${c.bad.whyText} and in the starting lineup anyway.`,
];

const MAIL_EXTRAS = [
  {
    // Where this season sits against every season this owner has finished. The seasons are real
    // final ranks from history.json, and they follow the owner, not the team slot, because ESPN
    // hands the same team id to a new owner when somebody leaves.
    kind: 'career-high',
    group: 'career',
    when: (c) => (c.hist && c.hist.careerHigh && !c.hist.bestOnce && c.gp >= 3 ? 8.2 : 0),
    lines: [
      (c) => `Best season of their career finished ${c.hist.bestOrd} (${c.hist.bestYear}). Sitting ${c.ord} now.`,
      (c) => `${c.hist.seasons} seasons in this league and never better than ${c.hist.bestOrd}. Currently ${c.ord}.`,
      (c) => c.mode === 'complete' && `Finished ${c.ord}. Their best before this was ${c.hist.bestOrd} in ${c.hist.bestYear}.`,
    ],
  },
  {
    kind: 'career-low',
    group: 'career',
    when: (c) => (c.hist && c.hist.careerLow && !c.hist.bestOnce && c.gp >= 3 ? 7.8 : 0),
    lines: [
      (c) => `Worst they have ever finished is ${c.hist.worstOrd} (${c.hist.worstYear}). This is worse.`,
      (c) => `${c.ord} of ${c.N}. In ${c.hist.seasons} seasons here they have never finished below ${c.hist.worstOrd}.`,
    ],
  },
  {
    kind: 'career-holding',
    group: 'career',
    when: (c) => (c.hist && c.hist.held && c.gp >= 3 ? 6.6 : 0),
    lines: [
      (c) => `${c.ord}, exactly where they finished in ${c.hist.bestYear}. Their ceiling is holding.`,
    ],
  },
  {
    // Roster moves straight from ESPN: adds, drops and trades. Only ever stated as a comparison.
    kind: 'waiver-busy',
    group: 'waiver',
    when: (c) => (inSeason(c) && c.churn && c.churn.busiest ? 7.8 : 0),
    lines: [
      (c) => `Busiest hands in the league: ${c.churn.adds} in, ${c.churn.drops} out.`,
      (c) => `${c.churn.total} roster moves, more than anyone else. The league median is ${c.churn.median}.`,
      (c) => c.churn.perWeek && `${c.churn.perWeek} roster moves a week. Nobody touches the wire more.`,
    ],
  },
  {
    kind: 'waiver-quiet',
    group: 'waiver',
    when: (c) => (inSeason(c) && c.churn && c.churn.quietest ? 7.6 : 0),
    lines: [
      (c) => `${c.churn.total} roster moves all season. The league median is ${c.churn.median}.`,
      (c) => `Quietest wire in the league: ${c.churn.adds} in, ${c.churn.drops} out. Drafted it and left it alone.`,
    ],
  },
  {
    kind: 'waiver-rank',
    group: 'waiver',
    when: (c) => (inSeason(c) && c.churn && !c.churn.busiest && !c.churn.quietest && c.churn.total >= 8 ? 4.4 : 0),
    lines: [
      (c) => `Waiver wire: ${c.churn.adds} in, ${c.churn.drops} out, ${c.churn.ord} busiest in the league.`,
    ],
  },
  {
    kind: 'last-week',
    group: 'last-game',
    when: (c) => (lastWeekCounts(c) && !(c.cur && c.cur.sameAsLast) && c.last.won != null ? (c.last.margin < 3 || c.last.margin >= 40 ? 6.6 : 5) : 0),
    lines: [
      (c) => c.last.won && `Last week: beat ${c.lastOpp} by ${c.last.m}.`,
      (c) => !c.last.won && `Last week: lost to ${c.lastOpp} by ${c.last.m}.`,
      (c) => c.last.won && `Won Week ${c.L} by ${c.last.m}, ${c.last.pts} to ${c.last.oppPts}.`,
      (c) => !c.last.won && `Lost Week ${c.L} by ${c.last.m}, ${c.last.pts} to ${c.last.oppPts}.`,
    ],
  },
  {
    kind: 'bench',
    group: 'last-game',
    when: (c) => (lastWeekCounts(c) && c.bench ? 7.6 : 0),
    lines: [
      (c) => `Lost by ${c.last.m} last week with ${c.bench.player} (${c.bench.pts}) on the bench.`,
      (c) => `Benched ${c.bench.pts} points last week. Lost by ${c.last.m}.`,
    ],
  },
  {
    kind: 'unluckiest',
    when: (c) => (inSeason(c) && c.luckTag === 'unluckiest' ? 8 : 0),
    lines: [
      (c) => `Unluckiest team in the league: ${c.ap} in all-play, ${c.luckD} wins below expected.`,
      (c) => `The black cat is theirs. All-play says ${c.exp} wins. The record says ${c.w}.`,
    ],
  },
  {
    kind: 'luckiest',
    when: (c) => (inSeason(c) && c.luckTag === 'luckiest' ? 8 : 0),
    lines: [
      (c) => `Luckiest team in the league: ${c.luckD} wins more than the points earned.`,
      (c) => `The horseshoe is theirs. All-play says ${c.exp} wins. The record says ${c.w}.`,
    ],
  },
  {
    kind: 'luck',
    when: (c) => (inSeason(c) && !c.luckTag && Math.abs(c.luckDelta) >= 1.2 ? 5.6 : 0),
    lines: [
      (c) => c.luckDelta < 0 && `All-play math says ${c.exp} wins. The record says ${c.w}. Unlucky.`,
      (c) => c.luckDelta > 0 && `All-play math says ${c.exp} wins. The record says ${c.w}. Shh.`,
    ],
  },
  {
    kind: 'toilet',
    when: (c) => (lastWeekCounts(c) && c.toilet ? 8 : 0),
    lines: [
      (c) => `Holds the golden toilet: ${c.last.pts} in Week ${c.L}, lowest in the league.`,
      (c) => `Scored ${c.last.pts} in Week ${c.L}. Nobody scored less. The toilet is out front.`,
    ],
  },
  {
    kind: 'spotlight',
    when: (c) => (lastWeekCounts(c) && c.spotlight ? 7 : 0),
    lines: [
      (c) => `Week ${c.L} high score: ${c.last.pts}. The spotlight is on this house.`,
      (c) => `Scored ${c.last.pts} in Week ${c.L}, the most in the league. Has mentioned it.`,
    ],
  },
  {
    kind: 'champ',
    when: (c) => (c.champ ? 7.6 : 0),
    lines: [
      (c) => c.mode !== 'complete' && c.champ.condition === 'cone' && `Defending champion, currently ${c.ord}. The statue has a traffic cone on it.`,
      (c) => c.mode !== 'complete' && c.champ.condition === 'pigeons' && `Defending champion, currently ${c.ord}. The statue has pigeons.`,
      (c) => c.mode !== 'complete' && c.champ.condition === 'shiny' && `Defending champion, currently ${c.ord}. The statue gets polished weekly.`,
      (c) => c.mode === 'complete' && c.rank === 1 && `Champion in ${c.champ.season} and again in ${c.season}. There is no living with it now.`,
      (c) => c.mode === 'complete' && c.rank > 1 && `Champion in ${c.champ.season}. Finished ${c.ord} this year. The crown has been forwarded.`,
    ],
  },
  {
    kind: 'titles',
    when: (c) => (c.hist && c.hist.titlesN > 0 && !c.champ ? 6.5 : 0),
    lines: [
      (c) => c.hist.titlesN === 1 && `Champion in ${c.hist.lastTitle}. Still brings it up.`,
      (c) => c.hist.titlesN > 1 && `${c.hist.titlesN} titles (${c.hist.titleYears}). Will mention it.`,
      (c) => c.hist.since >= 2 && `Last title: ${c.hist.lastTitle}. ${c.hist.since} seasons and counting.`,
    ],
  },
  {
    kind: 'drought',
    when: (c) => (c.hist && c.hist.titlesN === 0 && c.hist.seasons >= 2 ? 6 : 0),
    lines: [
      (c) => `0 titles in ${c.hist.seasons} seasons. The trophy case is a shelf.`,
      (c) => `${c.hist.seasons} seasons, no titles. The engraver does not have the name on file.`,
    ],
  },
  {
    kind: 'nemesis',
    when: (c) => (c.nem ? 7 : 0),
    group: 'rival',
    lines: [
      (c) => c.nem.lopsided && `Owned by ${c.nemName}, ${c.nem.w}-${c.nem.l} all time.`,
      (c) => c.nem.lopsided && `${c.nemName} has their number: ${c.nem.w}-${c.nem.l} all time.`,
      (c) => `Is ${c.nem.w}-${c.nem.l} all time against ${c.nemName} and knows it.`,
      (c) => !c.nem.lopsided && `Trails ${c.nemName} ${c.nem.w}-${c.nem.l} all time. It comes up.`,
    ],
  },
  {
    kind: 'victim',
    when: (c) => (c.vic ? 6 : 0),
    group: 'rival',
    lines: [
      (c) => c.vic.lopsided && `Owns ${c.vicName}, ${c.vic.w}-${c.vic.l} all time.`,
      (c) => `Is ${c.vic.w}-${c.vic.l} all time against ${c.vicName} and brings it up.`,
      (c) => !c.vic.lopsided && `Leads ${c.vicName} ${c.vic.w}-${c.vic.l} all time. Mentions it.`,
    ],
  },
  {
    kind: 'last-places',
    when: (c) => (c.hist && c.hist.lastN > 0 ? 6 : 0),
    lines: [
      (c) => `Finished last in ${c.hist.lastYears}. Kept the tent.`,
      (c) => c.hist.lastN > 1 && `${c.hist.lastN} last place finishes. A specialist.`,
    ],
  },
  {
    kind: 'all-time',
    when: (c) => (c.hist ? 4.6 : 0),
    lines: [
      (c) => `All-time record: ${c.hist.allTime} over ${plural(c.hist.seasons, 'season')}.`,
      (c) => !c.hist.allTimeWinning && `All-time record: ${c.hist.allTime}. The sample size is not the problem.`,
      (c) => c.hist.allTimeWinning && `All-time record: ${c.hist.allTime}. Brings it up when losing.`,
    ],
  },
  {
    kind: 'clinched',
    when: (c) => (inSeason(c) && c.clinched ? 7 : 0),
    lines: [() => `Clinched a playoff spot. Insufferable until further notice.`, () => `Playoff spot: clinched. Lineup effort: optional.`],
  },
  {
    kind: 'eliminated',
    when: (c) => (inSeason(c) && c.eliminated ? 7.5 : 0),
    lines: [() => `Mathematically eliminated. Still setting a lineup, allegedly.`, () => `Eliminated from the playoffs. Now playing for spite.`],
  },
  {
    kind: 'moved',
    when: (c) => (inSeason(c) && c.tierMove ? 7 : 0),
    lines: [
      (c) => c.tierMove === 'up' && `Just moved up from ${c.prevTierShort}. Boxes still in the yard.`,
      (c) => c.tierMove === 'down' && `Just moved down from ${c.prevTierShort}. Did not bring much.`,
    ],
  },
  {
    kind: 'pf-king',
    when: (c) => (inSeason(c) && c.gp >= 3 && c.pfRank === 1 && c.rank >= 4 ? 6.6 : 0),
    lines: [(c) => `Leads the league in points (${c.pf}) and is ${c.ord} anyway.`],
  },
  {
    kind: 'trash',
    when: (c) => (inSeason(c) && c.bags >= 3 ? 5 : 0),
    lines: [
      (c) => `${c.bags} trash bags on the lawn, one for each unanswered loss.`,
      (c) => `${c.bags} trash bags out front. The raccoons have a schedule.`,
    ],
  },
  {
    kind: 'ir',
    when: (c) => (c.lineupLive && c.irN >= 1 ? (c.irN >= 2 ? 6.2 : 4.8) : 0),
    lines: [
      (c) => c.irN === 1 && c.irName && `${c.irName} is on IR. The ambulance knows the address.`,
      (c) => c.irN >= 2 && `${c.irN} players on IR. The ambulance has a parking pass.`,
      (c) => c.irN >= 2 && `${c.irN} on IR. It is a roster and a waiting room.`,
    ],
  },
];

const MAIL_FILLER = {
  hill: [() => `Lives on the Hill. Knows it.`, () => `First place. The gate code changes weekly.`],
  heights: [() => `Lives in Playoff Heights. Mentions it.`, () => `Has a fountain view and opinions.`],
  bubble: [() => `Lives in the Bubble. Does not sleep.`, () => `Beige house. Nervous owner.`],
  park: [() => `Lives in the Trailer Park. The raccoons vouch for them.`, () => `Landfill adjacent. Raccoon approved.`],
  dump: [() => `Lives in the Dump. Has the rain cloud to prove it.`, () => `One tent. One cloud. No comment.`],
};

function mailboxFor(c, rng, used) {
  const limit = COPY_LIMITS.mailboxLine;
  const lines = [];
  const push = (s) => {
    if (s && lines.indexOf(s) === -1 && lines.length < COPY_LIMITS.mailboxMax) lines.push(s);
  };
  push(pickLine(MAIL_RECORD, c, limit, rng, used, 'mail:record'));
  push(pickLine(MAIL_WEEK, c, limit, rng, used, 'mail:week'));
  const crime = pickLine(MAIL_CRIME, c, limit, rng, null, 'mail:crime');

  const room = COPY_LIMITS.mailboxMax - lines.length - (crime ? 1 : 0);
  let taken = 0;
  const groups = {};
  for (const x of weigh(MAIL_EXTRAS, c, rng, 1.5)) {
    if (taken >= room) break;
    if (lines.length >= 3 && x.w < 6.5) break; // a fourth line has to be worth reading
    if (x.item.group && groups[x.item.group]) continue; // one line per subject
    const before = lines.length;
    push(pickLine(x.item.lines, c, limit, rng, used, `mail:${x.item.kind}`));
    if (lines.length > before) {
      taken++;
      if (x.item.group) groups[x.item.group] = true;
    }
  }
  push(crime);
  if (lines.length < COPY_LIMITS.mailboxMin) push(pickLine(MAIL_FILLER[c.tier] || MAIL_FILLER.bubble, c, limit, rng, null, 'mail:filler'));
  if (lines.length < COPY_LIMITS.mailboxMin) push(`${c.ord} of ${c.N}.`);
  if (lines.length < COPY_LIMITS.mailboxMin) push(`Record: ${c.rec}.`);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The paper and the blimp
// ---------------------------------------------------------------------------------------------

/** Marks a template that names nobody. Used only when no named variant fits. */
function fb(fn) {
  fn.fallback = true;
  return fn;
}

/**
 * Named variants first, in seeded order, with names at full length. Then the no-name fallbacks.
 * A shortened name is the last resort: a clean headline beats a clipped team name.
 */
function pickPreferred(pool, c, limit, rng) {
  const named = pool.filter((fn) => !fn.fallback);
  const spare = pool.filter((fn) => fn.fallback);
  return (
    (named.length ? pickLine(named, c, limit, rng, null, '', [NAME_MAX]) : null) ||
    (spare.length ? pickLine(spare, c, limit, rng, null, '') : null) ||
    (named.length ? pickLine(named, c, limit, rng, null, '') : null)
  );
}

function buildStories(model, F) {
  const meta = model.meta;
  const N = meta.teamCount;
  const L = F.lastCompletedWeek || 0;
  const lab = (id) => F.labels[id] || '';
  const team = (id) => model.teams[id];
  const stories = [];
  const add = (kind, drama, teamIds, fields, names, heads, bodies, blimps) => {
    stories.push({ kind, drama, teamIds, ctx: makeCtx(F, Object.assign({ L, N, season: meta.season, week: meta.week }, fields), names), heads, bodies, blimps: blimps || [] });
  };

  if (F.mode === 'complete' && N >= 1) {
    const champ = team(model.order[0]);
    const lw = champ.lastWeek;
    const final = model.lastWeek && lw && lw.won === true
      ? model.lastWeek.results.find((r) => r.winnerId === champ.id && r.playoff && r.bracket !== 'CONSOLATION')
      : null;
    add('champion', 120, final ? [champ.id, lw.oppId] : [champ.id],
      { rec: champ.record.text, hasFinal: !!final, wp: lw ? fmtPts(lw.pts) : '', lp: lw ? fmtPts(lw.oppPts) : '', m: lw ? fmtPts(lw.margin) : '' },
      { T: lab(champ.id), Z: final ? lab(lw.oppId) : '' },
      [(c) => `${c.T} Wins The ${c.season} Title`, (c) => `${c.T} Is Your ${c.season} Champion`, fb((c) => `${c.season} Title Decided. Hill Occupied.`)],
      [
        (c) => c.hasFinal && `${c.T} beat ${c.Z} ${c.wp} to ${c.lp} in the title game. The crown stays on the Hill until next fall.`,
        (c) => !c.hasFinal && `${c.T} finished first after ${withArticle(c.rec)} regular season. The crown stays on the Hill until next fall.`,
        (c) => c.hasFinal && `${c.T} is the ${c.season} champion after beating ${c.Z} by ${c.m} in the final. The engraver has been called.`,
        (c) => !c.hasFinal && `${c.T} is the ${c.season} champion and the engraver has been called. Everyone else has been told to wait until next year.`,
      ],
      [(c) => `${c.T} is your ${c.season} champion`, (c) => `${c.season} champion: ${c.T}`, fb((c) => `The ${c.season} title has been claimed`)]);
    if (N >= 3) {
      const last = team(model.order[N - 1]);
      add('lastPlace', 80, [last.id], { rec: last.record.text, ord: ordinal(N) }, { T: lab(last.id) },
        [(c) => `${c.T} Finishes Last, Keeps Tent`, fb(() => `Last Place Decided. Tent Stays Occupied.`)],
        [(c) => `${c.T} ended the season ${c.ord} of ${c.N} at ${c.rec}. The tent is reserved through the winter.`],
        []);
    }
  }

  if (F.mode === 'fresh') {
    {
      add('opener', 50, [], {}, {},
        [(c) => `Season Opens With ${c.N}-Way Tie For First`, (c) => `All ${c.N} Teams Undefeated, For Now`],
        [() => `Every team is 0-0, which is the most optimistic this league will be all year. Enjoy it until Week 1 ends.`],
        [() => `Everyone is 0-0. Enjoy it.`, () => `Nobody has lost yet. Give it a week.`]);
      add('draft', 40, [], {}, {},
        [() => `Draft Grades Released, Mean Nothing`, () => `Experts Grade Draft. Experts Not Liable.`],
        [() => `Everybody got an A or a C. None of it counts until someone loses, which will be soon.`],
        []);
      add('addresses', 35, [], {}, {},
        [() => `Neighborhoods Assigned By Seeding`, () => `Hill, Dump Handed Out Before Kickoff`],
        [() => `Until games are played, addresses come from the seeding. Nobody has earned the Hill and nobody deserves the Dump, yet.`],
        []);
    }
    return stories;
  }

  const lastResults = model.lastWeek ? model.lastWeek.results : [];
  const results = lastResults.map((r) => {
    const homeWon = r.winnerId === r.homeId;
    const tie = r.winnerId == null;
    const W = tie || homeWon ? r.homeId : r.awayId;
    const Z = W === r.homeId ? r.awayId : r.homeId;
    const wp = W === r.homeId ? r.homePts : r.awayPts;
    const lp = W === r.homeId ? r.awayPts : r.homePts;
    return { W, Z, wp, lp, margin: r.margin, tie, bracket: r.playoff ? r.bracket : 'NONE' };
  });
  const decided = results.filter((r) => !r.tie);
  const scores = [];
  for (const r of results) scores.push({ id: r.W, pts: r.wp }, { id: r.Z, pts: r.lp });
  const weekRank = (pts) => 1 + scores.filter((s) => s.pts > pts).length;
  const gameCtx = (r) => ({ m: fmtPts(r.margin), wp: fmtPair(r.wp, r.lp)[0], lp: fmtPair(r.wp, r.lp)[1], wrec: team(r.W).record.text, zrec: team(r.Z).record.text, reg: F.mode === 'regular' });
  const gameNames = (r) => ({ W: lab(r.W), Z: lab(r.Z) });

  // ----- playoff bracket -----
  if (F.mode === 'post') {
    let told = 0;
    for (const r of decided) {
      if (r.bracket !== 'WINNERS' || F.knockedOut[r.Z] !== L || F.knockedOut[r.W] != null || told >= 2) continue;
      told++;
      add('playoff', told === 1 ? 93 : 84, [r.W, r.Z], gameCtx(r), gameNames(r),
        [
          (c) => `${c.W} Knocks Out ${c.Z}`,
          (c) => `${c.W} Advances By ${c.m}`,
          (c) => `${c.Z} Eliminated In Week ${c.L}`,
          fb((c) => `Bracket Shrinks After ${c.m}-Point Game`),
        ],
        [
          (c) => `${c.W} beat ${c.Z} ${c.wp} to ${c.lp} in the bracket and is still playing for the title. The losing side has been thanked for coming.`,
          (c) => `${c.Z} is out of the playoffs after losing to ${c.W} by ${c.m}. The regular season record did not come up.`,
        ],
        [(c) => `${c.W} is still alive`, (c) => `${c.Z} is out of the playoffs`, fb((c) => `The bracket got smaller in Week ${c.L}`)]);
    }
  }

  // ----- record book -----
  const book = model.history ? model.history.records : [];
  const isNew = (rec) => rec && rec.season === meta.season && rec.week === L;
  const high = book.find((r) => r.id === 'highWeek');
  const low = book.find((r) => r.id === 'lowWeek');
  const rout = book.find((r) => r.id === 'blowout');
  if (isNew(high) && high.teamId != null && team(high.teamId)) {
    add('record', 100, [high.teamId], { pts: high.value }, { T: lab(high.teamId) },
      [(c) => `${c.T} Sets League Record: ${c.pts}`, fb((c) => `League Scoring Record Falls: ${c.pts}`)],
      [(c) => `${c.pts} points in Week ${c.L} is the highest single-week score in league history. ${c.T} will be mentioning it.`],
      [(c) => `${c.T} set the all-time high: ${c.pts}`, fb((c) => `New all-time high score: ${c.pts}`)]);
  }
  if (isNew(low) && low.teamId != null && team(low.teamId)) {
    add('record', 98, [low.teamId], { pts: low.value }, { T: lab(low.teamId) },
      [(c) => `${c.T} Sets Record. The Bad One.`, fb((c) => `New League Low: ${c.pts} Points`)],
      [(c) => `${c.pts} points in Week ${c.L} is the lowest score this league has ever recorded. ${c.T} now owns a piece of history.`],
      [(c) => `${c.T}: ${c.pts}. A new all-time low.`, fb((c) => `New all-time low score: ${c.pts}`)]);
  }

  // ----- the games -----
  const biggest = decided.slice().sort((a, b) => b.margin - a.margin)[0];
  if (biggest && biggest.margin >= 20) {
    const m = biggest.margin;
    const record = isNew(rout) && rout.teamId === biggest.W;
    add('blowout', record ? 99 : m >= 60 ? 90 : m >= 40 ? 78 : m >= 30 ? 62 : 48, [biggest.W, biggest.Z], gameCtx(biggest), gameNames(biggest),
      record
        ? [(c) => `${c.W} Wins By ${c.m}, A League Record`, fb((c) => `Record Blowout: ${c.m} Points`)]
        : [
          (c) => `${c.W} Beats ${c.Z} By ${c.m}`,
          (c) => `${c.W} Wins By ${c.m}. Send Help.`,
          (c) => `${c.Z} Loses By ${c.m}, Declines Comment`,
          fb((c) => `Mercy Rule Requested After ${c.m}-Point Loss`),
        ],
      record
        ? [(c) => `The ${c.m}-point margin over ${c.Z} is the biggest in league history. ${c.W} did not ease up at any point.`]
        : [
          (c) => `${c.W} scored ${c.wp} in Week ${c.L} and ${c.Z} scored ${c.lp}. It was the biggest margin of the week and it was over early.`,
          (c) => `${c.W} ${c.wp}, ${c.Z} ${c.lp}, a gap of ${c.m}. Both teams set a lineup, and only one of them could tell.`,
          (c) => c.reg && `${c.Z} lost by ${c.m} and is now ${c.zrec}. ${c.W} did not have to do all that, and did.`,
          (c) => !c.reg && `${c.Z} lost by ${c.m}. ${c.W} did not have to do all that, and did.`,
        ],
      [(c) => `${c.W} won by ${c.m}. Send flowers.`, (c) => `${c.Z} lost by ${c.m}. Be nice.`, fb((c) => `${capFirst(withArticle(c.m))}-point blowout in Week ${c.L}`)]);
  }
  const closest = decided.slice().sort((a, b) => a.margin - b.margin)[0];
  if (closest && closest.margin < 5 && closest !== biggest) {
    const m = closest.margin;
    add('heartbreaker', m < 1 ? 95 : m < 2 ? 85 : 70, [closest.Z, closest.W], Object.assign(gameCtx(closest), { tiny: m < 2 }), gameNames(closest),
      [
        (c) => c.tiny && `${c.Z} Loses By ${c.m}. Yes, ${c.m}.`,
        (c) => `${c.W} Survives ${c.Z} By ${c.m}`,
        (c) => c.tiny && `${c.W} Wins By ${c.m}, Ages Visibly`,
        (c) => !c.tiny && `${c.W} Holds On By ${c.m}`,
        (c) => !c.tiny && `${c.Z} Comes Up ${c.m} Short`,
        fb((c) => `${c.m} Points Decide Week ${c.L} Thriller`),
      ],
      [
        (c) => `${c.W} ${c.wp}, ${c.Z} ${c.lp}. The difference was ${c.m}, or roughly one garbage-time catch.`,
        (c) => `${c.Z} lost to ${c.W} by ${c.m} in Week ${c.L}. Every player on that bench is now a suspect.`,
        (c) => `${c.W} beat ${c.Z} by ${c.m}. Nobody involved enjoyed it, including the winner.`,
      ],
      [(c) => c.tiny && `${c.Z} lost by ${c.m}. Yes, ${c.m}.`, (c) => `${c.W} won by ${c.m}. Breathe.`, (c) => !c.tiny && `${c.Z} came up ${c.m} short`, fb((c) => `Week ${c.L} was decided by ${c.m} points`)]);
  }

  // ----- bench blunder -----
  let blunder = null;
  for (const r of decided) {
    const top = F.benchTop[r.Z];
    const swing = benchSwing(top, r.margin);
    if (swing > 0 && (!blunder || swing > blunder.swing)) blunder = { r, top, swing };
  }
  if (blunder) {
    const r = blunder.r;
    const top = blunder.top;
    add('bench', 66 + Math.min(14, blunder.swing), [r.Z, r.W],
      Object.assign(gameCtx(r), { player: top.name, bpts: fmtPts(top.points), low: top.lowName, lowPts: top.lowPoints != null ? fmtPts(top.lowPoints) : '' }), gameNames(r),
      [
        (c) => `${c.Z} Benches ${c.bpts}, Loses By ${c.m}`,
        (c) => `${c.Z} Leaves ${c.bpts} On Bench, Regrets It`,
        fb((c) => `Bench Scores ${c.bpts} In ${c.m}-Point Loss`),
      ],
      [
        (c) => `${c.player} scored ${c.bpts} on the bench for ${c.Z} in Week ${c.L}, in a game lost to ${c.W} by ${c.m}. The lineup was set on purpose.`,
        (c) => `${c.Z} lost to ${c.W} by ${c.m} while ${c.player} put up ${c.bpts} from the bench. The start button remains free to use.`,
        (c) => c.low && `${c.Z} started ${c.low} (${c.lowPts}) and sat ${c.player} (${c.bpts}), then lost to ${c.W} by ${c.m}. The math is not complicated.`,
      ],
      [(c) => `${c.Z} benched ${c.bpts}, lost by ${c.m}`, fb((c) => `${c.bpts} on the bench in ${withArticle(c.m)}-point loss`)]);
  }

  // ----- streaks -----
  let hot = null;
  let cold = null;
  for (const id of model.order) {
    const t = team(id);
    if (t.streak.type === 'W' && t.streak.length >= 4 && (!hot || t.streak.length > hot.streak.length)) hot = t;
    if (t.streak.type === 'L' && t.streak.length >= 4 && (!cold || t.streak.length > cold.streak.length)) cold = t;
  }
  if (hot && F.mode === 'regular') {
    add('streak', 70 + Math.min(8, hot.streak.length), [hot.id],
      { n: hot.streak.length, rec: hot.record.text, ord: ordinal(hot.rank), wk: F.lastLossWeek[hot.id] || 0 }, { T: lab(hot.id) },
      [(c) => `${c.T} Wins ${c.n} Straight`, (c) => c.wk > 0 && `${c.T} Has Not Lost Since Week ${c.wk}`, fb((c) => `Flamingo Count Reaches ${c.n}`)],
      [
        (c) => `${c.T} is ${c.rec} after ${c.n} wins in a row. The flamingos on that lawn are multiplying and the neighbors have concerns.`,
        (c) => c.wk > 0 && `${c.T} last lost in Week ${c.wk}. Since then: ${c.n} wins, ${c.ord} place, and a lawn full of flamingos.`,
      ],
      [(c) => `${c.T} has won ${c.n} straight`, fb((c) => `${c.n} straight wins. ${c.n} flamingos.`)]);
  }
  if (cold && F.mode === 'regular') {
    add('streak', 70 + Math.min(8, cold.streak.length), [cold.id],
      { n: cold.streak.length, nth: ordinal(cold.streak.length), rec: cold.record.text, ord: ordinal(cold.rank), bags: cold.trashBags, wk: F.lastWinWeek[cold.id] || 0 }, { T: lab(cold.id) },
      [(c) => `${c.T} Drops ${c.nth} Straight`, (c) => `${c.T} Losing Streak Hits ${c.n}`, fb((c) => `Trash Bags Pile Up As Streak Hits ${c.n}`)],
      [
        (c) => c.wk > 0 && `${c.T} is ${c.rec} and has not won since Week ${c.wk}. There are ${c.bags} trash bags on that lawn, one per unanswered loss.`,
        (c) => `${c.T} has now lost ${c.n} straight and sits ${c.ord} of ${c.N}. The raccoons have started bringing friends.`,
      ],
      [(c) => `${c.T} has lost ${c.n} straight. Honk.`, fb((c) => `${c.n} straight losses. ${c.bags} trash bags.`)]);
  }

  // ----- standings news -----
  if (F.mode === 'regular') {
    const first = team(model.order[0]);
    if (first.prevRank != null && first.prevRank > 1) {
      const oldId = model.order.find((id) => team(id).prevRank === 1);
      add('throne', 86, oldId != null ? [first.id, oldId] : [first.id],
        { rec: first.record.text, prevOrd: ordinal(first.prevRank), hasOld: oldId != null }, { T: lab(first.id), Old: oldId != null ? lab(oldId) : '' },
        [(c) => `${c.T} Takes Over First Place`, (c) => `New Tenant On The Hill: ${c.T}`, fb(() => `The Hill Has A New Owner`)],
        [
          (c) => c.hasOld && `${c.T} moved into first place at ${c.rec}. ${c.Old} has been issued a smaller house.`,
          (c) => c.hasOld && `${c.T} is the new owner of the Hill after climbing from ${c.prevOrd}. ${c.Old} has been asked to hand back the gate code.`,
          (c) => !c.hasOld && `${c.T} is the new owner of the Hill after climbing from ${c.prevOrd}. The gate code has already been changed.`,
        ],
        [(c) => `${c.T} now runs the Hill`, fb(() => `The Hill has a new owner`)]);
    }
    let up = null;
    let down = null;
    for (const id of model.order) {
      const t = team(id);
      if (t.tierMove === 'up' && t.rank !== 1 && (!up || t.rankDelta > up.rankDelta)) up = t;
      if (t.tierMove === 'down' && (!down || t.rankDelta < down.rankDelta)) down = t;
    }
    for (const t of [up, down]) {
      if (!t) continue;
      const isUp = t.tierMove === 'up';
      add('move', 62 + Math.min(10, Math.abs(t.rankDelta)), [t.id],
        { rec: t.record.text, ord: ordinal(t.rank), prevOrd: ordinal(t.prevRank), tierTitle: TIER_TITLE[t.tier], lives: TIER_LIVES[t.tier], fromHill: t.prevTier === 'hill' }, { T: lab(t.id) },
        isUp
          ? [(c) => `${c.T} Moves Up To ${c.tierTitle}`, fb((c) => `Moving Truck Spotted In ${c.tierTitle}`)]
          : [
            (c) => !c.fromHill && `${c.T} Relocated To ${c.tierTitle}`,
            (c) => !c.fromHill && `${c.T} Falls To ${c.tierTitle}`,
            (c) => c.fromHill && `${c.T} Evicted From The Hill`,
            (c) => c.fromHill && `${c.T} Loses The Hill, Keeps The Memories`,
            fb((c) => `Moving Truck Spotted In ${c.tierTitle}`),
          ],
        isUp
          ? [
            (c) => `${c.T} climbed from ${c.prevOrd} to ${c.ord} and changed neighborhoods. The truck is still out front.`,
            (c) => `${c.T} is ${c.rec} and now lives ${c.lives}. The old neighbors were told by text.`,
          ]
          : [
            (c) => `${c.T} dropped from ${c.prevOrd} to ${c.ord} and now lives ${c.lives}. The moving truck did not need directions.`,
            (c) => `${c.T} is ${c.rec} and has a new, worse address. The old neighbors held a brief ceremony, mostly out of relief.`,
          ],
        isUp ? [(c) => `${c.T} moved up. Truck out front.`] : [(c) => `${c.T} moved down. Wave goodbye.`]);
    }
  }
  if (F.newlyEliminated.length && meta.phase !== 'complete') {
    const t = team(F.newlyEliminated[0]);
    add('eliminated', 74, [t.id], { rec: t.record.text, more: F.newlyEliminated.length - 1 }, { T: lab(t.id) },
      [(c) => `${c.T} Mathematically Eliminated`, (c) => `Math Catches Up With ${c.T}`, fb(() => `Playoff Math Claims Another Team`)],
      [
        (c) => c.more === 0 && `At ${c.rec}, ${c.T} can no longer reach the playoffs. The math was checked twice, then once more for fun.`,
        (c) => c.more > 0 && `At ${c.rec}, ${c.T} can no longer reach the playoffs. ${plural(c.more, 'other team')} went out the same way this week.`,
      ],
      [(c) => `${c.T} is eliminated. Be kind.`]);
  }
  if (F.newlyClinched.length && meta.phase !== 'complete') {
    const t = team(F.newlyClinched[0]);
    add('clinch', 72, [t.id], { rec: t.record.text, more: F.newlyClinched.length - 1 }, { T: lab(t.id) },
      [(c) => `${c.T} Clinches Playoff Spot`, fb(() => `Playoff Spot Clinched On The Hill Side`)],
      [
        (c) => c.more === 0 && `${c.T} is ${c.rec} and can no longer be caught by enough teams to matter. The rest is seeding and ego.`,
        (c) => c.more > 0 && `${c.T} is ${c.rec} and officially in, along with ${plural(c.more, 'other team')} this week. The rest is seeding and ego.`,
      ],
      [(c) => `${c.T} is in the playoffs`]);
  }

  // ----- luck of the week -----
  if (scores.length >= 6) {
    const robbed = decided.filter((r) => weekRank(r.lp) <= 3).sort((a, b) => b.lp - a.lp)[0];
    if (robbed) {
      add('robbed', 68, [robbed.Z, robbed.W], Object.assign(gameCtx(robbed), { wkOrd: ordinal(weekRank(robbed.lp)) }), gameNames(robbed),
        [(c) => `${c.Z} Scores ${c.lp}, Loses Anyway`, (c) => `${c.lp} Points Not Enough For ${c.Z}`, fb((c) => `${c.lp} Points Somehow Not Enough`)],
        [(c) => `${c.Z} put up ${c.lp}, the ${c.wkOrd} highest score of Week ${c.L}, and ran into ${c.W} at ${c.wp}. The schedule offers no refunds.`],
        [(c) => `${c.Z} scored ${c.lp} and lost`]);
    }
    const gifted = decided.filter((r) => weekRank(r.wp) >= scores.length - 2).sort((a, b) => a.wp - b.wp)[0];
    if (gifted) {
      add('gifted', 66, [gifted.W, gifted.Z], Object.assign(gameCtx(gifted), { lowOrd: ordinal(scores.length - weekRank(gifted.wp) + 1) }), gameNames(gifted),
        [(c) => `${c.W} Wins With ${c.wp}. Do Not Ask.`, (c) => `${c.W} Finds A Way With ${c.wp}`, fb((c) => `${c.wp} Points Somehow Enough`)],
        [(c) => `${c.W} scored ${c.wp}, the ${c.lowOrd} lowest total of Week ${c.L}, and still won, because ${c.Z} scored ${c.lp}. A win is a win, and this one was a gift.`],
        [(c) => `${c.W} won with ${c.wp}. Somehow.`]);
    }
  }

  // ----- trophies -----
  const lowId = model.lastWeek ? model.lastWeek.lowScoreId : null;
  const highId = model.lastWeek ? model.lastWeek.highScoreId : null;
  if (lowId != null && team(lowId) && team(lowId).lastWeek) {
    const t = team(lowId);
    add('toilet', 58, [lowId], { pts: fmtPts(t.lastWeek.pts), won: t.lastWeek.won === true }, { T: lab(lowId) },
      [(c) => `Golden Toilet Goes To ${c.T}`, (c) => `${c.T} Scores ${c.pts}, Wins Toilet`, (c) => `${c.T} Posts Week Low Of ${c.pts}`, fb((c) => `Golden Toilet Awarded For ${c.pts} Points`)],
      [
        (c) => !c.won && `${c.pts} points was the lowest score of Week ${c.L}. The golden toilet sits on the lawn of ${c.T} until somebody does worse.`,
        (c) => !c.won && `${c.T} scored ${c.pts} in Week ${c.L} and nobody scored less. The trophy for that is gold and has a lid.`,
        (c) => c.won && `${c.T} scored ${c.pts}, the lowest total of the week, and won anyway. The toilet was delivered regardless.`,
      ],
      [(c) => `${c.T}: ${c.pts} points. Enjoy the toilet.`, fb((c) => `Week ${c.L} low score: ${c.pts}`)]);
  }
  if (highId != null && team(highId) && team(highId).lastWeek && highId !== lowId) {
    const t = team(highId);
    add('spotlight', 55, [highId, t.lastWeek.oppId], { pts: fmtPts(t.lastWeek.pts), m: fmtPts(t.lastWeek.margin) }, { T: lab(highId), Opp: lab(t.lastWeek.oppId) },
      [(c) => `${c.T} Drops ${c.pts}, Leads The League`, (c) => `${c.T} Hangs ${c.pts} On ${c.Opp}`, (c) => `Week ${c.L} High: ${c.T} With ${c.pts}`, fb((c) => `Week ${c.L} High Score: ${c.pts}`)],
      [
        (c) => `${c.T} scored ${c.pts} against ${c.Opp} in Week ${c.L}, the most of anyone. The spotlight is on that house and can be seen from the Dump.`,
        (c) => `${c.pts} points for ${c.T} in Week ${c.L}. ${c.Opp} was standing closest when it happened and lost by ${c.m}.`,
      ],
      [(c) => `${c.T} scored ${c.pts}. Nobody else did.`, fb((c) => `Week ${c.L} high score: ${c.pts}`)]);
  }

  // ----- always-available standings stories -----
  if (F.mode === 'regular') {
    const P = model.cutLine;
    if (P < N) {
      const inT = team(model.order[P - 1]);
      const outT = team(model.order[P]);
      const outCtx = F.ctx[outT.id];
      if (outCtx && outCtx.gap) {
        add('cutline', 46, [inT.id, outT.id],
          { inRec: inT.record.text, gap: outCtx.gap, gapTitle: titleCase(outCtx.gap), left: F.weeksLeft, leftW: plural(F.weeksLeft, 'week') }, { In: lab(inT.id), Out: lab(outT.id) },
          [(c) => `${c.In} In, ${c.Out} Out, For Now`, (c) => `${c.Out} Is ${c.gapTitle} Out`, fb((c) => `Playoff Line Holds By ${c.gapTitle}`)],
          [
            (c) => c.left > 0 && `${c.In} holds the last playoff spot at ${c.inRec}, with ${c.Out} ${c.gap} back and ${c.leftW} to play. Neither of them is sleeping well.`,
            (c) => `${c.In} holds the last playoff spot at ${c.inRec}, with ${c.Out} ${c.gap} back. The "For Sale?" signs are up on both lawns.`,
          ],
          []);
      }
    }
    const first = team(model.order[0]);
    const firstCtx = F.ctx[first.id];
    if (firstCtx && firstCtx.lead && N >= 2 && !(first.prevRank > 1)) {
      add('leader', 40, [first.id], { rec: first.record.text, lead: firstCtx.lead }, { T: lab(first.id), Second: lab(model.order[1]) },
        [(c) => `${c.T} Still Runs The Hill`, (c) => `${c.T} Holds First At ${c.rec}`, fb(() => `No Change At The Top Of The Hill`)],
        [(c) => `${c.T} is ${c.rec}, with ${c.Second} trailing by ${c.lead}. The throne remains occupied.`],
        []);
    }
    if (N >= 3) {
      const last = team(model.order[N - 1]);
      add('dump', 36, [last.id], { rec: last.record.text, ord: ordinal(N) }, { T: lab(last.id) },
        [(c) => `${c.T} Remains In The Dump`, (c) => `Rain Continues Over ${c.T}`, fb(() => `Rain Continues Over The Dump`)],
        [(c) => `${c.T} is ${c.rec}, ${c.ord} of ${c.N}. The rain cloud has renewed its lease.`],
        []);
    }
  }
  if (F.mode === 'post') {
    const P = model.cutLine;
    const top = team(model.order[0]);
    add('topSeed', 45, [top.id], { rec: top.record.text }, { T: lab(top.id) },
      [(c) => `${c.T} Holds The Top Seed`, fb(() => `Top Seed Has Everything To Lose`)],
      [(c) => `${c.T} went ${c.rec} in the regular season and owns the top seed. Anything short of a title now counts as a collapse.`],
      []);
    if (P < N) {
      const out = team(model.order[P]);
      add('missed', 43, [out.id], { rec: out.record.text, ord: ordinal(out.rank) }, { T: lab(out.id) },
        [(c) => `${c.T} Watches Playoffs From Home`, fb(() => `First Team Out Watches From Home`)],
        [(c) => `${c.T} finished ${c.ord} at ${c.rec}, one spot short of the bracket. The consolation games are available, and nobody is making anyone watch.`],
        []);
    }
  }
  if (F.mode === 'post' && decided.length) {
    const r = biggest && biggest.margin < 20 ? biggest : decided.find((g) => g !== biggest && g !== closest);
    if (r) {
      add('result', 44, [r.W, r.Z], gameCtx(r), gameNames(r),
        [(c) => `${c.W} Beats ${c.Z} By ${c.m}`, (c) => `${c.W} Wins By ${c.m} In Week ${c.L}`, fb((c) => `Week ${c.L} Game Decided By ${c.m}`)],
        [(c) => `${c.W} scored ${c.wp} in Week ${c.L} and ${c.Z} scored ${c.lp}. One of them is still playing for something.`],
        []);
    }
  }
  if (F.mode === 'regular' && biggest && biggest.margin < 20) {
    add('result', 42, [biggest.W, biggest.Z], gameCtx(biggest), gameNames(biggest),
      [(c) => `${c.W} Beats ${c.Z} By ${c.m}`, (c) => `${c.W} Wins By ${c.m} In Week ${c.L}`, fb((c) => `Week ${c.L} Game Decided By ${c.m}`)],
      [(c) => `${c.W} scored ${c.wp} in Week ${c.L} and ${c.Z} scored ${c.lp}. That was the most lopsided game of the week, which says something about the week.`],
      []);
  }

  // Once the playoffs are on, games between teams that are out of it are not front-page news.
  if (F.mode === 'post') {
    for (const story of stories) {
      if (story.kind === 'playoff' || !story.teamIds.length) continue;
      if (story.teamIds.every((id) => !model.teams[id].inPlayoffSpot)) story.drama *= 0.6;
    }
  }
  return stories;
}

function forecastStory(model, F) {
  const live = model.matchups.filter((m) => m.status !== 'final' && m.homeProj > 0 && m.awayProj > 0);
  if (!live.length) return null;
  live.sort((a, b) => Math.abs(a.homeProj - a.awayProj) - Math.abs(b.homeProj - b.awayProj) || compareIds(a.homeId, b.homeId));
  const m = live[0];
  const fav = m.homeProj >= m.awayProj;
  const A = fav ? m.homeId : m.awayId;
  const B = fav ? m.awayId : m.homeId;
  return {
    kind: 'forecast',
    drama: 0,
    teamIds: [A, B],
    ctx: makeCtx(F, {
      week: model.meta.week,
      pa: fmtPts(fav ? m.homeProj : m.awayProj),
      pb: fmtPts(fav ? m.awayProj : m.homeProj),
      d: fmtPts(Math.abs(m.homeProj - m.awayProj)),
    }, { A: F.labels[A], B: F.labels[B] }),
    heads: [
      (c) => `Forecast: ${c.A} vs ${c.B}, Too Close To Call`,
      (c) => `Forecast: ${c.A} By ${c.d}, Barely`,
      fb((c) => `Week ${c.week} Forecast: ${titleCase(withArticle(c.d))}-Point Tossup`),
      fb((c) => `Forecast: ${c.d}-Point Spread, Chance Of Regret`),
    ],
    bodies: [
      (c) => `${c.A} is projected for ${c.pa}, ${c.B} for ${c.pb}. That is ${withArticle(c.d)}-point spread, with a strong chance of regret by Monday.`,
      (c) => `Closest matchup on the board: ${c.A} (${c.pa}) against ${c.B} (${c.pb}). Expect scattered second-guessing and a late lead change.`,
    ],
    blimps: [],
  };
}

function historyStory(model, F, rng) {
  const facts = arr(F.onThisWeek);
  if (!facts.length) return null;
  const fact = facts[Math.floor(rng() * facts.length)];
  const fields = { week: fact.week, year: fact.season, pts: fmtPts(fact.pts), oppPts: fmtPts(fact.oppPts), m: fmtPts(fact.margin), factKind: fact.kind };
  return {
    kind: 'history',
    drama: 0,
    teamIds: fact.kind === 'low' ? fact.teamIds.slice(0, fact.selfListed ? 1 : 0) : fact.teamIds.slice(),
    ctx: makeCtx(F, fields, { X: fact.name, Y: fact.oppName }),
    heads: [() => `On This Week In League History`],
    bodies: [
      (c) => c.factKind === 'high' && `Week ${c.week}, ${c.year}: ${c.X} scored ${c.pts} against ${c.Y}, still the best Week ${c.week} anyone here has had.`,
      (c) => c.factKind === 'blowout' && `Week ${c.week}, ${c.year}: ${c.X} beat ${c.Y} by ${c.m}. It is still the most lopsided Week ${c.week} on record.`,
      (c) => c.factKind === 'close' && `Week ${c.week}, ${c.year}: ${c.X} beat ${c.Y} by ${c.m}, the closest Week ${c.week} game on record. One of them is still not over it.`,
      (c) => c.factKind === 'low' && `Week ${c.week}, ${c.year}: ${c.X} scored ${c.pts}, the lowest Week ${c.week} total on record. Nobody has done worse since, so far.`,
    ],
    blimps: [],
  };
}

function buildPaper(model, F) {
  const meta = model.meta;
  const L = F.lastCompletedWeek || 0;
  const rng = rngFor('paper', meta.season, meta.week, L);
  const pool = buildStories(model, F);

  // Lead story first, then the rest by drama, nudged away from repeating the same teams.
  const chosen = [];
  const featured = {};
  while (pool.length && chosen.length < 6) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const overlap = pool[i].teamIds.filter((id) => featured[id]).length;
      const kindRepeat = chosen.some((s) => s.kind === pool[i].kind) ? 8 : 0;
      const score = pool[i].drama - overlap * 12 - kindRepeat;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const story = pool.splice(best, 1)[0];
    chosen.push(story);
    for (const id of story.teamIds) featured[id] = true;
  }
  const extras = [forecastStory(model, F), historyStory(model, F, rng)].filter(Boolean);

  const headlines = [];
  const ids = {};
  for (const story of chosen.concat(extras)) {
    const headline = pickPreferred(story.heads, story.ctx, COPY_LIMITS.headline, rng);
    const body = pickLine(story.bodies, story.ctx, COPY_LIMITS.body, rng, null, '');
    if (!headline || !body) continue;
    let id = `${meta.season}-w${story.kind === 'forecast' || story.kind === 'history' ? meta.week : L}-${story.kind}`;
    if (story.teamIds.length) id += `-${story.teamIds.join('-')}`;
    while (ids[id]) id += 'b';
    ids[id] = true;
    headlines.push({ id, kind: story.kind, headline, body, teamIds: story.teamIds.slice() });
  }

  // The blimp flies the lead story.
  let blimp = null;
  for (const story of chosen) {
    if (!story.blimps.length) continue;
    const upper = story.blimps.map((fn) => {
      const loud = (c) => {
        const s = fn(c);
        return typeof s === 'string' ? s.toUpperCase() : s;
      };
      loud.fallback = fn.fallback;
      return loud;
    });
    blimp = pickPreferred(upper, story.ctx, COPY_LIMITS.blimp, rng);
    if (blimp) break;
  }
  if (!blimp) {
    blimp = meta.phase === 'complete' ? `SEASON OVER. SEE YOU IN SEPTEMBER.` : `WEEK ${meta.week}. SOMEBODY HAS TO LOSE.`;
  }
  return { headlines, blimp };
}

// ---------------------------------------------------------------------------------------------
// Entry point used by derive()
// ---------------------------------------------------------------------------------------------

/**
 * Fills model.teams[id].roast, model.headlines and model.blimp.
 * `facts` carries the few things the copy needs that are not part of the public model.
 */
export function composeCopy(model, facts) {
  const meta = model.meta;
  const ids = model.order.slice().sort(compareIds);
  const labels = facts.labels || teamLabels(ids.map((id) => model.teams[id]));
  const L = facts.lastCompletedWeek || 0;
  const anyPlayed = L > 0 || ids.some((id) => {
    const r = model.teams[id].record;
    return r.wins + r.losses + r.ties > 0;
  });

  let mode = 'regular';
  if (meta.phase === 'complete') mode = 'complete';
  else if (!anyPlayed) mode = 'fresh';
  else if (facts.regularOver) mode = 'post';

  // Words that only ever show up when a template is broken. Never shown, unless a team is
  // actually named that.
  const nameBlob = ids.map((id) => `${labels[id]} ${model.teams[id].name}`).join(' ');
  const banned = ['undefined', 'NaN', 'null', 'Infinity', '[object', EM_DASH].filter((w) => !nameBlob.includes(w));

  const F = {
    mode,
    labels,
    banned,
    lastCompletedWeek: L,
    weeksLeft: Math.max(0, facts.weeksLeft || 0),
    regularOver: !!facts.regularOver,
    benchTop: facts.benchTop || {},
    rosterCrimes: facts.rosterCrimes || {},
    newlyClinched: arr(facts.newlyClinched),
    newlyEliminated: arr(facts.newlyEliminated),
    onThisWeek: arr(facts.onThisWeek),
    lastWinWeek: facts.lastWinWeek || {},
    lastLossWeek: facts.lastLossWeek || {},
    knockedOut: facts.knockedOut || {},
    ctx: {},
  };
  F.seasonJustEnded = mode === 'complete' && !(model.history && model.history.champions.some((ch) => ch.season === meta.season));
  F.alive = mode === 'post' ? ids.filter((id) => model.teams[id].inPlayoffSpot && !F.knockedOut[id]) : [];

  const used = new Set();
  for (const id of ids) {
    const c = teamCtx(model, F, id);
    F.ctx[id] = c;
    const seed = [meta.season, meta.week, id];
    model.teams[id].roast = {
      arrival: arrivalFor(c, rngFor('arrival', ...seed), used),
      mailbox: mailboxFor(c, rngFor('mailbox', ...seed), used),
      sign: signFor(c, rngFor('sign', ...seed), used),
    };
  }

  const paper = buildPaper(model, F);
  model.headlines = paper.headlines;
  model.blimp = paper.blimp;
  return model;
}

// ---------------------------------------------------------------------------------------------
// Helpers for the UI
// ---------------------------------------------------------------------------------------------

const TIER_WELCOME = {
  hill: 'The Hill. Population: 1. The gate code changes every week.',
  heights: 'Playoff Heights. Good lawns, good records, loud opinions.',
  bubble: 'The Bubble. Half this street is moving soon. Nobody knows which half.',
  park: 'Waiver Wire Trailer Park. Scenic landfill views. Raccoons included.',
  dump: 'The Dump. One tent, one rain cloud, and a long way up.',
};

/** One line per neighborhood, for the map. */
export function tierWelcome(tier) {
  return TIER_WELCOME[tier] || '';
}

/** The small JSON-safe record of "what the world looked like" that recapChanges compares against. */
export function snapshot(model) {
  const teams = {};
  if (model && model.teams) {
    for (const id of arr(model.order)) {
      const t = model.teams[id];
      if (!t) continue;
      teams[id] = { rank: t.rank, tier: t.tier, record: t.record.text, trashBags: t.trashBags, toilet: !!t.trophy.toilet };
    }
  }
  const meta = (model && model.meta) || {};
  return { v: 1, season: meta.season || 0, week: meta.week || 0, generatedAt: meta.generatedAt || null, teams };
}

/**
 * What changed for one member since a stored snapshot. Short second-person strings, most
 * important first, at most six. Empty when there is nothing to report.
 */
export function recapChanges(prevSnapshot, model, teamId) {
  const out = [];
  try {
    if (!prevSnapshot || typeof prevSnapshot !== 'object' || !prevSnapshot.teams) return out;
    if (!model || !model.teams || !model.teams[teamId]) return out;
    if (prevSnapshot.season && model.meta.season && prevSnapshot.season !== model.meta.season) {
      return ['New season. Last year has been forgiven. Not forgotten.'];
    }
    const me = model.teams[teamId];
    const was = prevSnapshot.teams[teamId];
    if (!was) return out;
    const labels = teamLabels(model.order.map((id) => model.teams[id]));
    const name = (id) => clip(labels[id] || '', NAME_MAX);
    const prevOf = (id) => prevSnapshot.teams[id] || null;

    // You.
    if (me.rank < was.rank) out.push(`You climbed from ${ordinal(was.rank)} to ${ordinal(me.rank)}.`);
    else if (me.rank > was.rank) out.push(`You slid from ${ordinal(was.rank)} to ${ordinal(me.rank)}.`);
    if (was.tier && me.tier !== was.tier && TIERS[me.tier]) {
      out.push(tierIndex(me.tier) < tierIndex(was.tier)
        ? `You moved up to ${TIER_LONG[me.tier]}.`
        : `You have been relocated to ${TIER_LONG[me.tier]}.`);
    }
    if (was.record && was.record !== me.record.text) out.push(`Your record went from ${was.record} to ${me.record.text}.`);

    const holderId = model.order.find((id) => model.teams[id].trophy.toilet);
    if (me.trophy.toilet && !was.toilet) out.push('The golden toilet was delivered to your lawn.');
    else if (!me.trophy.toilet && was.toilet) {
      out.push(holderId != null && holderId !== teamId
        ? `The golden toilet left your lawn. ${name(holderId)} has it now.`
        : 'The golden toilet left your lawn.');
    }
    const bagDelta = me.trashBags - (was.trashBags || 0);
    if (bagDelta > 0) out.push(`${plural(bagDelta, 'new trash bag')} on your lawn. ${me.trashBags} total.`);
    else if (bagDelta < 0) {
      out.push(me.trashBags === 0 ? 'The garbage truck cleared your lawn.' : `The garbage truck took ${plural(-bagDelta, 'bag')}. ${me.trashBags} left.`);
    }

    // Everyone else.
    const firstId = model.order[0];
    const firstWas = prevOf(firstId);
    if (firstId !== teamId && firstWas && firstWas.rank !== 1) out.push(`${name(firstId)} took over the Hill.`);
    const lastId = model.order[model.order.length - 1];
    const lastWas = prevOf(lastId);
    if (lastId !== teamId && lastId !== firstId && lastWas && lastWas.tier !== 'dump') out.push(`${name(lastId)} moved into the Dump.`);

    const passers = model.order.filter((id) => {
      const p = prevOf(id);
      return id !== teamId && p && p.rank > was.rank && model.teams[id].rank < me.rank;
    });
    if (passers.length === 1) out.push(`${name(passers[0])} passed you in the standings.`);
    else if (passers.length > 1) out.push(`${passers.length} teams passed you in the standings.`);

    const oppId = me.thisWeek ? me.thisWeek.oppId : null;
    const opp = oppId != null ? model.teams[oppId] : null;
    const oppWas = oppId != null ? prevOf(oppId) : null;
    if (opp && oppWas && oppId !== firstId && oppId !== lastId && (opp.tier !== oppWas.tier || Math.abs(opp.rank - oppWas.rank) >= 2)) {
      out.push(`Your opponent this week, ${name(oppId)}, went from ${ordinal(oppWas.rank)} to ${ordinal(opp.rank)}.`);
    }
    if (holderId != null && holderId !== teamId && !was.toilet) {
      const holderWas = prevOf(holderId);
      if (holderWas && !holderWas.toilet) out.push(`${name(holderId)} now has the golden toilet.`);
    }
  } catch (e) {
    return out;
  }
  return out.slice(0, 6);
}
