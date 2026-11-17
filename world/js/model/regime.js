// The league's running joke: the commissioner as Supreme Leader. This writes the propaganda.
//
// Everything here is spin on real numbers from the model, so it changes every week by itself.
// Pure and defensive like the rest of the model. The joke is about the commissioner's power
// and his record, never anything personal.

import { str, num, ordinal, fmtPts, fmtTotal, plural, rngFor, shuffled } from './util.js';

export const REGIME_LIMITS = { slogan: 26, broadcast: 112, plaque: 96, headline: 60, body: 230 };

const fits = (limit) => (s) => typeof s === 'string' && s.length > 0 && s.length <= limit;

/**
 * @param model  the assembled model (teams, order, cutLine, meta)
 * @param labels { [teamId]: the name the copy uses for that team }
 * @param cfg    { teamId, title } from config.js REGIME, or null to switch the joke off
 * @param lastCompletedWeek  the last fully played week, if any
 */
export function buildRegime(model, labels, cfg, lastCompletedWeek) {
  if (!cfg || cfg.teamId == null || !model || !model.teams) return null;
  const t = model.teams[cfg.teamId];
  if (!t) return null;
  const meta = model.meta || {};
  const N = num(meta.teamCount) || model.order.length;
  const P = num(model.cutLine);
  const title = str(cfg.title) || 'Supreme Commissioner';
  const name = str(t.owner) || 'the Commish';
  const NAME = name.toUpperCase();
  const who = (id) => str(labels && labels[id]) || (model.teams[id] ? model.teams[id].name : 'somebody');
  const ord = ordinal(t.rank);
  const rec = t.record || { wins: 0, losses: 0, ties: 0, text: '0-0' };
  const played = rec.wins + rec.losses + rec.ties;
  const week = num(meta.week);
  const lastWeekNo = num(lastCompletedWeek) > 0 ? num(lastCompletedWeek) : Math.max(1, week - 1);
  const rng = rngFor('regime', num(meta.season), week, cfg.teamId);

  // ---- loudspeakers: the facts first, then the standing orders
  const facts = [];
  if (played === 0) {
    facts.push(`The season has not begun. The ${title} has already won it. Details to follow.`);
  } else {
    if (t.rank === 1) facts.push(`The ${title} is in first place. The standings have been verified by the ${title}.`);
    else if (t.rank === N) facts.push('The standings are being displayed upside down this week. Technicians have been reassigned.');
    else if (t.rank === P + 1) facts.push('The playoff line has been moved for security reasons. It will be moved back when it is safe.');
    else if (t.rank <= P) facts.push(`${ord} place. A strategic position. First place has been declared a decoy.`);
    else facts.push(`${ord} place is the new first place. Update your maps.`);

    if (rec.losses > 0 && rec.wins > 0) {
      facts.push(`Official record: ${played}-0. The ${plural(rec.losses, 'loss', 'losses')} on file ${rec.losses === 1 ? 'is' : 'are'} under review by the ${title}.`);
    } else if (rec.wins === 0) {
      facts.push(`The ${title} has chosen not to win yet. Patience is mandatory.`);
    } else {
      facts.push(`${rec.text}. Undefeated, and this time it is not a typo.`);
    }

    const lw = t.lastWeek;
    if (lw && lw.won === false && num(lw.margin) > 0) {
      facts.push(`State media confirms a Week ${lastWeekNo} victory by ${fmtPts(lw.margin)}. Do not check the scoreboard.`);
    } else if (lw && lw.won === true) {
      facts.push(`A glorious Week ${lastWeekNo} victory over ${who(lw.oppId)}. Attendance at the parade is compulsory.`);
    }

    const tw = t.thisWeek;
    if (tw && tw.status === 'live') {
      const gap = fmtPts(Math.abs(num(tw.pts) - num(tw.oppPts)));
      if (num(tw.pts) < num(tw.oppPts)) facts.push(`The ${title} trails ${who(tw.oppId)} by ${gap}. The scoreboard operator has been spoken to.`);
      else if (num(tw.pts) > num(tw.oppPts)) facts.push(`The ${title} leads ${who(tw.oppId)} by ${gap}. Applause may begin.`);
    } else if (tw && tw.status === 'pre') {
      facts.push(`This week ${who(tw.oppId)} has the honor of losing to the ${title}.`);
    }

    const s = t.streak || {};
    if (s.type === 'L' && s.length >= 2) facts.push(`${s.length} straight tactical retreats. Morale has never been higher.`);
    if (s.type === 'W' && s.length >= 2) facts.push(`${s.length} straight wins. Each one is now a public holiday.`);
    if (num(t.pointsAgainst) > 0) facts.push(`Points scored against the ${title} (${fmtTotal(t.pointsAgainst)}) have been classified.`);
  }
  const orders = [
    'Trade vetoes are a form of love.',
    'All rulings are final. Especially the wrong ones.',
    `Report collusion to the League Office. The League Office is also ${name}.`,
    'Reminder: the waiver order is whatever it needs to be.',
    `Citizens are reminded that ${name} reads the group chat. All of it.`,
    'Lineup lock is at kickoff. Loyalty lock is permanent.',
    'Complaints may be submitted in writing. They will be laminated and ignored.',
    'League dues are voluntary, in the sense that everything here is voluntary.',
    'Smile when passing a portrait. Somebody is keeping count.',
    `Rule changes take effect immediately, or earlier, at the discretion of the ${title}.`,
  ];
  const ok = fits(REGIME_LIMITS.broadcast);
  // alternate: a fact, an order, a fact... so the news is never buried
  const f = shuffled(facts.filter(ok), rng);
  const o = shuffled(orders.filter(ok), rng);
  const broadcasts = [];
  for (let i = 0; i < Math.max(f.length, 5); i++) {
    if (f[i]) broadcasts.push(f[i]);
    if (o[i]) broadcasts.push(o[i]);
  }

  // ---- posters and banners
  const standing = played === 0 ? 'FIRST. IN ADVANCE.' : t.rank === 1 ? 'FIRST. AS FORETOLD.' : `${ord.toUpperCase()} BY CHOICE`;
  const slogans = [standing].concat(shuffled([
    'THE COMMISH SEES ALL',
    'ALL RULINGS ARE FINAL',
    `ONE LEAGUE. ONE ${NAME}.`,
    'VETO IS LOVE',
    `${NAME} PROVIDES. ${NAME} DECIDES.`,
    'PRAISE THE WAIVER ORDER',
    'LOYALTY BEFORE LINEUPS',
    'DUES ARE DUE',
    'HE DRAFTED FIRST IN SPIRIT',
    'TRUST THE PROCESS. HIS.',
  ], rng)).filter(fits(REGIME_LIMITS.slogan)).slice(0, 8);

  // ---- the monument and the busts
  const monument = {
    title: `Monument to the ${title}`,
    plaque: 'ERECTED BY UNANIMOUS VOTE',
    lines: [
      'The vote was 1 to 0.',
      played === 0 ? 'Depicted here before the season, already victorious.'
        : rec.losses === 0 ? `Depicted here at ${rec.text}. For once the plaque did not have to round up.`
          : `Depicted here at ${rec.text}, which the plaque rounds up to undefeated.`,
      'Leave flowers, or a waiver claim. He sees both.',
    ],
  };
  const home = t.tier;
  const bustLine = {
    hill: 'A gift to first place, so they remember who allows it.',
    heights: 'Installed so the playoff teams have someone to thank.',
    bubble: 'Placed here to calm the neighborhood. It has not worked.',
    park: 'The raccoons salute it every morning. Attendance is taken.',
    dump: 'Weatherproof. Seagull tested. Still watching.',
  };
  const busts = {};
  for (const key of Object.keys(bustLine)) {
    busts[key] = key === home && key !== 'hill' ? 'Hometown hero. He lives just over there, by choice.' : bustLine[key];
    if (key === 'hill' && home === 'hill') busts[key] = 'He lives right here. The bust is so the mansion never feels alone.';
  }

  // ---- the portrait beside every front door
  const doorPool = shuffled([
    'Dusted weekly. Inspections are a surprise.',
    'The eyes follow you to the mailbox.',
    'Displayed at the regulation height of very high.',
    'Straightened daily. Somebody checks.',
    'A gift from the League Office. Returning it is not an option.',
    'Hung by order. Admired by order.',
    'The frame is bolted on. So is the gratitude.',
    'Polished every Tuesday, win or lose.',
    'Required by the bylaws, which he wrote.',
    'It was here when they moved in. It will be here after.',
    'Smiling is recommended while reading this.',
    'The nail is league property.',
  ], rng);
  const doors = {};
  model.order.forEach((id, i) => {
    const o2 = model.teams[id];
    let line = doorPool[i % doorPool.length];
    if (id === t.id) line = 'The only portrait in town hung with real enthusiasm.';
    else if (o2.rank === N) line = o2.tier === 'dump' ? 'Nailed to the tent pole. Regulations are regulations.' : 'Hung in last place, where it can keep an eye on things.';
    else if (t.lastWeek && t.lastWeek.oppId === id && t.lastWeek.won === false) line = `Hung extra high after Week ${lastWeekNo}. That result is still under investigation.`;
    else if (o2.rank < t.rank && o2.rank === 1) line = 'Hung slightly crooked. It has been noted.';
    doors[id] = line;
  });

  // ---- his own address
  const residence = {
    hill: 'Official Residence. Finally, a house that matches the portraits.',
    heights: 'Official Residence. Modest, by his own decree.',
    bubble: 'Official Residence. The beige is a security measure.',
    park: 'Official Residence (temporary). The mansion is being fumigated.',
    dump: 'Official Residence (very temporary). The tent is a statement about humility.',
  }[home] || 'Official Residence.';

  // ---- state media: last week, as it officially happened
  let stateMedia;
  const lw = t.lastWeek;
  if (lw && lw.won === false) {
    stateMedia = {
      headline: `Commish Wins Week ${lastWeekNo} In A Landslide`,
      body: `The ${title} defeated ${who(lw.oppId)} by a margin too large to print. Anyone who saw ${fmtPts(lw.oppPts)} to ${fmtPts(lw.pts)} is mistaken and has been reseated.`,
      correction: `Other scoreboards say he lost by ${fmtPts(lw.margin)}. They are being recalibrated.`,
    };
  } else if (lw && lw.won === true) {
    stateMedia = {
      headline: 'Commish Wins Again, As Scheduled',
      body: `The ${title} beat ${who(lw.oppId)} ${fmtPts(lw.pts)} to ${fmtPts(lw.oppPts)}. The margin of ${fmtPts(lw.margin)} was approved in advance.`,
      correction: 'This one actually happened. State media is as surprised as you are.',
    };
  } else {
    stateMedia = {
      headline: 'Season Declared A Success In Advance',
      body: `The ${title} has reviewed the coming season and found it glorious. Results will be announced before the games, to save time.`,
      correction: 'No games were harmed in the making of this announcement.',
    };
  }
  if (!fits(REGIME_LIMITS.headline)(stateMedia.headline)) stateMedia.headline = 'Commish Triumphs Again';
  if (!fits(REGIME_LIMITS.body)(stateMedia.body)) stateMedia.body = `The ${title} has triumphed again. Details are classified.`;

  return {
    teamId: t.id,
    name,
    title,
    slogans,
    broadcasts,
    monument,
    busts,
    doors,
    portrait: { title: 'Official Portrait', caption: `${name}, ${title}. Eternal Chairman of the Waiver Wire.` },
    residence,
    stateMedia,
  };
}
