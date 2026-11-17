// Vandalism: who may egg whom this week, the preset spray tags, and the lines that go with it.
//
// The rule from the original brief: you may vandalize the home of a team you beat, with preset
// tags, eggs and toilet paper only. "A team you beat" means the last completed week. Nothing here
// is free text: every tag and every line is written below or built from real scores.
// Pure and defensive like the rest of the model.

import { str, num, fmtPts, ordinal } from './util.js';

export const VANDAL_ALLOWANCE = { egg: 12, tp: 4, tag: 1 };
export const TAG_MAX = 14; // characters, so a spray tag stays readable on a wall

// Everyone may use these. Teasing, never personal.
export const PRESET_TAGS = [
  { id: 'l', text: 'L' },
  { id: 'owned', text: 'OWNED' },
  { id: 'rentfree', text: 'RENT FREE' },
  { id: 'takel', text: 'TAKE THE L' },
  { id: 'bench', text: 'BENCH THIS' },
  { id: 'fraud', text: 'FRAUD WATCH' },
  { id: 'waiver', text: 'WAIVER BAIT' },
  { id: 'lineup', text: 'NICE LINEUP' },
  { id: 'gg', text: 'GG EZ' },
];

const HOME_NOUN = { hill: 'mansion', heights: 'house', bubble: 'house', park: 'trailer', dump: 'tent' };

const LINES = {
  egg: [
    'Direct hit.',
    'Splat. Worth every penny.',
    'That one is not coming off.',
    'The yolk is on them.',
    'Right on the wall. Beautiful.',
    'Free range. Full send.',
    'Another one for the scrapbook.',
    'Somebody is power washing this weekend.',
  ],
  eggTree: [
    'Got the tree. The tree had it coming.',
    'Hit the tree. It was standing in the way.',
  ],
  eggMiss: [
    'Wide left. Like your kicker.',
    'Missed the house. The lawn had it coming.',
    'That egg is now a lawn ornament.',
    'The house dodged. Respect.',
    'Short. Aim for the house, not the yard.',
  ],
  tp: [
    'Draped. Two-ply, no mercy.',
    'A roll well spent.',
    'Toilet papered. A classic for a reason.',
    'Over the roof and down the gutters.',
  ],
  tpTree: [
    'The trees are dressed for the occasion.',
    'Tree decorated. Very festive.',
  ],
  tpGround: [
    'It is snowing in the yard. Paper snow.',
    'The lawn got papered. Close enough.',
  ],
  tag: [
    'Tagged. The neighbors will talk.',
    'Signed, sealed, sprayed.',
    'Fresh paint. Very fresh.',
  ],
  empty: [
    'Carton empty. Win again next week for a refill.',
    'Out of eggs. Out of rolls. Out of excuses.',
  ],
  leave: [
    'Score settled. For now.',
    'The getaway car is your legs.',
  ],
  // used instead when the target is the Supreme Commissioner's house
  residence: {
    egg: [
      'An egg on the Official Residence. The Supreme Commissioner has been informed.',
      'Egging the Official Residence. The loudspeakers will hear of this.',
    ],
    tp: ['The Official Residence has been redecorated without a permit.'],
    tag: ['Graffiti on the Official Residence. State media will call it a mural.'],
  },
};

/**
 * @param model   the assembled model (teams, order, meta, lastWeek)
 * @param labels  { [teamId]: the name the copy uses for that team }
 * @param o       { regimeTeamId }
 */
export function buildVandalism(model, labels, o = {}) {
  if (!model || !model.teams || !model.lastWeek) return null;
  const W = num(model.lastWeek.week);
  if (!(W > 0)) return null;
  const meta = model.meta || {};
  if (meta.phase === 'preseason') return null;
  // Houses belong to teams, so this feature always names the team (never an owner's first name).
  const who = (id) => (model.teams[id] && str(model.teams[id].name)) || str(labels && labels[id]) || 'somebody';
  const until = meta.phase === 'complete' ? 'until next season' : `until Week ${W + 1} is final`;
  const leader = o.regimeTeamId;

  const rights = {};
  const victims = {};
  const start = {};
  const blurb = {};
  const theirs = {};
  for (const id of model.order || []) {
    const t = model.teams[id];
    const g = t && t.lastWeek;
    if (!g || g.won !== true || g.oppId == null || !model.teams[g.oppId]) continue;
    const target = model.teams[g.oppId];
    const noun = HOME_NOUN[target.tier] || 'house';
    const margin = fmtPts(g.margin);
    rights[id] = {
      targetId: target.id,
      week: W,
      margin: num(g.margin),
      score: `${fmtPts(g.pts)}-${fmtPts(g.oppPts)}`,
      tags: [
        { id: 'score', text: `W ${Math.round(num(g.pts))}-${Math.round(num(g.oppPts))}` },
        { id: 'margin', text: `BY ${margin}` },
        { id: 'week', text: `WEEK ${W} IS MINE` },
      ].filter((x) => x.text.length <= TAG_MAX),
    };
    victims[target.id] = id;
    start[id] = id === leader
      ? `Week ${W}: the Supreme Commissioner beat ${who(target.id)} by ${margin}. This is not vandalism. It is urban planning.`
      : `Week ${W}: you beat ${who(target.id)} by ${margin}. Their ${noun} is fair game ${until}.`;
    blurb[id] = `The ${noun} of ${who(target.id)}, ${ordinal(target.rank)}. A dozen eggs, four rolls, one can of paint.`;
    theirs[target.id] = `Legal target this week. ${who(id)} won the Week ${W} matchup by ${margin}.`;
  }
  if (!Object.keys(rights).length) return null;

  return {
    resultWeek: W,
    allowance: { ...VANDAL_ALLOWANCE },
    rights,
    victims,
    tags: PRESET_TAGS.map((x) => ({ ...x })),
    lines: {
      label: 'Settle the score',
      start,
      blurb,
      egg: LINES.egg.slice(),
      eggTree: LINES.eggTree.slice(),
      eggMiss: LINES.eggMiss.slice(),
      tp: LINES.tp.slice(),
      tpTree: LINES.tpTree.slice(),
      tpGround: LINES.tpGround.slice(),
      tag: LINES.tag.slice(),
      empty: LINES.empty.slice(),
      leave: LINES.leave.slice(),
      residence: { egg: LINES.residence.egg.slice(), tp: LINES.residence.tp.slice(), tag: LINES.residence.tag.slice() },
      card: {
        mine: `Somebody beat you in Week ${W} and was handed a dozen eggs. Check the siding.`,
        theirs,
      },
      postcard: { egg: 'Freshly egged by {name}', tp: 'Toilet papered by {name}', tag: 'Tagged by {name}' },
    },
  };
}
