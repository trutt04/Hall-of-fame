// Every word Hit Zero says. Pure data and picking: no DOM. Hype, sweet, funny, never mean:
// compliments are about skill, timing, effort and spirit, and a miss is just a bobble.
//
//   JUDGES                         [{ id, name, category, critter }]   the panel, left to right
//   judgeLine(id, card, s, rng)    -> what judge `id` says about result `s` (Contract judge.js summary)
//   verdictWord(ev, rng)           -> the word that pops over the lane ('PERFECT!', 'STUNT!', 'OOPS!' ...)
//   comboCall(n)                   -> '25 IN A ROW!'
//   shakeItOff(rng)                -> a kind line after a streak breaks
//   countInCall(count)             -> the coach's count-in for count 1..8 of the eight before the first note
//   resultTitle(s)                 -> { big, sub }   the banner over the judges
//   sectionCall(label)             -> 'STUNTS!'
//   HOW_TO, CALIBRATE              short how-to and calibration words

const pick = (list, rng = Math.random) => list[Math.floor(rng() * list.length) % list.length];

export const JUDGES = [
  { id: 'motions', name: 'Professor Hoot', category: 'Motions', critter: 'owl' },
  { id: 'spirit', name: 'Sparkle', category: 'Spirit', critter: 'unicorn' },
  { id: 'stunts', name: 'Nimbus', category: 'Stunts', critter: 'cloud' },
];

const LINES = {
  motions: {
    zero: ['Hoo-hoo-HIT ZERO! Every motion right on the count!', 'Not one bobble. Those motions were textbook!', "Sharp, tight, on time. I'm framing this one!"],
    great: ['Those motions were SHARP!', 'Tight timing! I could hear every count.', 'Crisp arms, clean counts. Lovely!'],
    good: ["Nice motions! Lock in a few more counts and that's a zero!", 'Solid counting! A couple wobbles, and you kept going.', 'Great arms! Your timing is getting tighter.'],
    okay: ['I saw some super sharp moments in there!', 'Good effort! Keep counting those eights.', 'Nice work! Every practice makes motions sharper.'],
    tough: ['Shake it off, full out next time!', 'Every champion starts somewhere. Run it back!', 'Brave performance! Try Level 1 to warm up those counts.'],
  },
  spirit: {
    zero: ['HIT ZERO! I felt that spirit all the way up on Cloud Nine!', 'The crowd is going WILD! Full out start to finish!', 'Pure spirit, zero bobbles. Iconic!'],
    great: ['So much spirit! The bleachers are shaking!', 'Full out energy! I love it!', 'You made the whole crowd cheer!'],
    good: ['Great energy! Keep it going all the way to the last count!', 'Big spirit! Your streaks were awesome.', 'That was so fun to watch!'],
    okay: ["I see that spirit! Let's hear it even louder!", 'Big smiles, big heart. Love it!', "You never stopped. That's real spirit!"],
    tough: ['Shake it off, full out next time!', 'Spirit never quits, and neither do you!', "Mat talk from me: you've got this!"],
  },
  stunts: {
    zero: ['Every stunt hit! That pyramid was sky high!', "Stuck every landing. That's how you hit zero on Cloud Nine!", 'Rock solid stunts. Not one wobble!'],
    great: ['Those holds were rock steady!', 'Stunts were solid! Great squeeze!', 'Strong stunts and clean holds!'],
    good: ['Nice stunts! Hold them just a tiny bit longer next time.', 'Good holds! Your stunts are getting stronger.', 'Solid stunting! Keep those hands on it.'],
    okay: ['Good tries on those stunts! Squeeze and hold!', "Stunts are tricky. You're getting there!", 'Keep both hands on the two-lane stunts!'],
    tough: ['Shake it off, full out next time!', 'Stunts take practice. Run it back!', 'Every flyer wobbles sometimes. Try again!'],
  },
};

function tierOf(card, s) {
  if (s && s.hitZero) return 'zero';
  if (card >= 9) return 'great';
  if (card >= 8) return 'good';
  if (card >= 6.5) return 'okay';
  return 'tough';
}

export function judgeLine(id, card, s, rng = Math.random) {
  const set = LINES[id] || LINES.spirit;
  if (s && s.hitZero && s.levelId === 7 && id === 'stunts' && rng() < 0.6) return "Level 7 and a HIT ZERO? That's Worlds ready!";
  return pick(set[tierOf(card, s)], rng);
}

export function verdictWord(ev, rng = Math.random) {
  if (!ev) return '';
  if (ev.type === 'done') return pick(ev.lanes && ev.lanes.length > 1 ? ['STUCK IT!', 'LOCKED IN!'] : ['HELD IT!', 'SOLID!', 'LOCKED!'], rng);
  if (ev.type === 'drop') return 'WOBBLE!';
  if (ev.type === 'miss') return 'OOPS!';
  if (ev.type !== 'hit') return '';
  if (ev.lanes && ev.lanes.length > 1) return ev.verdict === 'perfect' ? pick(['STUNT!', 'HIT IT!'], rng) : 'NICE STUNT!';
  return ev.verdict === 'perfect' ? 'PERFECT!' : 'GOOD!';
}

export function comboCall(n) {
  if (n >= 100) return n + ' IN A ROW! LEGEND!';
  if (n >= 50) return n + ' IN A ROW! UNSTOPPABLE!';
  return n + ' IN A ROW!';
}

export function shakeItOff(rng = Math.random) {
  return pick(['Shake it off!', 'Keep going!', 'You got this!', 'Back in it!', 'Next count!'], rng);
}

// The count-in eight, counts 1..8: the coach's "Ready? OK! 5, 6, 7, 8!"
const COUNT_IN = ['READY?', '', 'OK!', '', '5', '6', '7', '8!'];
export function countInCall(count) {
  return COUNT_IN[count - 1] || '';
}

export function sectionCall(label) {
  return String(label || '').toUpperCase() + '!';
}

export function resultTitle(s) {
  const bobbles = (s.miss || 0) + (s.drop || 0);
  if (s.hitZero && s.allPerfect) return { big: 'HIT ZERO!', sub: 'Every single count PERFECT. Legendary!' };
  if (s.hitZero) return { big: 'HIT ZERO!', sub: 'Zero deductions. A perfect routine!' };
  if (bobbles <= 3) return { big: 'SO CLOSE!', sub: 'Just ' + bobbles + (bobbles === 1 ? ' bobble' : ' bobbles') + ' away from HIT ZERO!' };
  if (s.accuracy >= 0.75) return { big: 'GREAT ROUTINE!', sub: 'Full out next time and go for the zero!' };
  return { big: 'YOU DID IT!', sub: 'Every routine makes you stronger. Run it back!' };
}

export const HOW_TO = {
  tap: 'Tap',
  tapLine: 'Tap the lane as a gem hits the line.',
  hold: 'Hold the stunt',
  holdLine: 'Keep holding until the ribbon ends.',
  stunt: 'Two-lane stunt',
  stuntLine: 'Tap both lanes at once.',
  keys: 'Keys: A S D or the arrow keys.',
};

export const CALIBRATE = {
  title: 'Timing check',
  intro: 'Listen, then tap the pom-pom on every beat you hear. It keeps your taps on time, even with wireless headphones.',
  needSound: 'Turn the sound on to check your timing.',
  listen: 'Listen to the beat...',
  go: 'Tap on every beat!',
  keep: 'Keep tapping!',
  done: 'All set!',
  messy: 'Those taps were all over the place. Want to try again?',
};

export function latencyText(ms) {
  if (Math.abs(ms) < 10) return 'Right on the beat!';
  return 'Your taps land ' + Math.abs(ms) + ' ms ' + (ms > 0 ? 'after' : 'before') + ' the beat. Hit Zero will match you.';
}
