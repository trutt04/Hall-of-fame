// Cheer words, each with a kid-friendly one-liner. Pure data plus two lookups.
//
//   GLOSSARY            [{ id, word, kind, meaning }] in reading order
//                       kind: 'team' | 'stunt' | 'trick' | 'position' | 'motion' | 'routine' | 'gear'
//   TRICKS              { id: label } for the flyer tricks and body positions (Contract 3 anim names)
//   MOTIONS             { id: label } for the arm motions (Contract 3 anim names)
//   glossaryEntry(id)   -> the entry or null
//   trickLabel(id)      -> "toe touch", "high V", ... or null for an unknown id
//
// Labels are lower case so they read well mid-sentence; hype capitalizes a line's first letter.

import { BIRTHDAY } from '../config.js';

const FLYER_NAME = typeof BIRTHDAY.name === 'string' && BIRTHDAY.name ? BIRTHDAY.name : 'the birthday flyer';

export const TRICKS = Object.freeze({
  toeTouch: 'toe touch',
  pike: 'pike',
  kickDouble: 'kick double',
  twist: 'twist',
  liberty: 'liberty',
  heelStretch: 'heel stretch',
  scorpion: 'scorpion',
  bowArrow: 'bow and arrow',
  arabesque: 'arabesque',
});

export const MOTIONS = Object.freeze({
  highV: 'high V',
  lowV: 'low V',
  tMotion: 'T motion',
  touchdown: 'touchdown',
  daggers: 'daggers',
  punch: 'punch',
  clasp: 'clasp',
});

const entry = (id, word, kind, meaning) => Object.freeze({ id, word, kind, meaning });

export const GLOSSARY = Object.freeze([
  // the team
  entry('flyer', 'Flyer', 'team', `The one who flies! Flyers go up in stunts and get tossed high. That's ${FLYER_NAME}'s spot.`),
  entry('base', 'Base', 'team', 'Bases lift, toss and catch the flyer. Strong, steady and always there.'),
  entry('backSpot', 'Back spot', 'team', 'Stands behind the stunt, helps lift and keeps the flyer safe.'),
  entry('squad', 'Squad', 'team', 'Your team! In cheer, nobody flies alone.'),
  // stunts
  entry('stunt', 'Stunt', 'stunt', 'When the bases lift a flyer up high. Teamwork you can see!'),
  entry('extension', 'Extension', 'stunt', "The flyer stands way up high on the bases' straight arms."),
  entry('basketToss', 'Basket toss', 'stunt', 'The bases throw the flyer high into the air, then catch them.'),
  entry('cradle', 'Cradle', 'stunt', 'The catch at the end: the bases scoop the flyer safely out of the air.'),
  entry('pyramid', 'Pyramid', 'stunt', 'Lots of stunts linked together into one big shape.'),
  // tricks in the air
  entry('toeTouch', 'Toe touch', 'trick', "Legs out wide to the sides, arms in a T. You don't really touch your toes!"),
  entry('pike', 'Pike', 'trick', 'Both legs straight out in front, together, and reach for your toes.'),
  entry('kickDouble', 'Kick double', 'trick', 'A big high kick, then two full spins on the way down. Super advanced!'),
  entry('twist', 'Twist', 'trick', 'Spin all the way around in the air, staying straight and tight.'),
  // flyer body positions
  entry('liberty', 'Liberty', 'position', 'Balance on one leg up high, other foot tucked by your knee.'),
  entry('heelStretch', 'Heel stretch', 'position', 'Up on one leg, holding your other heel high in front of you.'),
  entry('scorpion', 'Scorpion', 'position', 'Grab your back foot and pull it up behind your head.'),
  entry('bowArrow', 'Bow and arrow', 'position', 'One leg pulled up high, arm across it, like drawing a bow.'),
  entry('arabesque', 'Arabesque', 'position', 'One leg stretched straight back, arms out. Ballet in the sky!'),
  // arm motions
  entry('highV', 'High V', 'motion', 'Both arms up and out in a big V. Proud and strong!'),
  entry('lowV', 'Low V', 'motion', 'Both arms down and out, like an upside down V.'),
  entry('tMotion', 'T motion', 'motion', 'Arms straight out to the sides, like the letter T.'),
  entry('touchdown', 'Touchdown', 'motion', 'Both arms straight up, like a referee calling a touchdown.'),
  entry('daggers', 'Daggers', 'motion', 'Fists by your shoulders, elbows tucked in tight. Sharp!'),
  entry('punch', 'Punch', 'motion', 'One arm punches straight up, the other hand on your hip.'),
  entry('clasp', 'Clasp', 'motion', 'Hands clasped together in front of you with a clap.'),
  entry('sharp', 'Sharp motions', 'motion', 'Snap into each motion fast and clean, then hold it still.'),
  // the routine
  entry('eightCount', 'Eight-count', 'routine', 'Cheer music is counted 1 to 8, over and over. 5, 6, 7, 8!'),
  entry('routine', 'Routine', 'routine', 'About two and a half minutes of stunts, jumps, tumbling and dance.'),
  entry('tumbling', 'Tumbling', 'routine', 'Flips, cartwheels and handsprings across the mat.'),
  entry('fullOut', 'Full out', 'routine', 'Performing at full energy, every motion, every count.'),
  entry('matTalk', 'Mat talk', 'routine', 'Cheering your teammates on from the side of the mat.'),
  entry('deduction', 'Deduction', 'routine', 'A few points the judges take off for a wobble or a slip.'),
  entry('hitZero', 'Hit Zero', 'routine', 'A routine with zero deductions. A perfect one! The best words in cheer.'),
  entry('judges', 'Judges', 'routine', 'The panel that scores the routine. Hit every count!'),
  // gear
  entry('bow', 'Cheer bow', 'gear', 'The big cheer bow! Bigger is better, and sparkly is best.'),
  entry('poms', 'Poms', 'gear', 'Fluffy shakers that make every motion pop.'),
  entry('spiritStick', 'Spirit stick', 'gear', 'A prize for the squad with the most spirit. Find 12 on the island!'),
]);

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]));

export function glossaryEntry(id) {
  return (typeof id === 'string' && BY_ID.get(id)) || null;
}

export function trickLabel(id) {
  if (typeof id !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(TRICKS, id)) return TRICKS[id];
  if (Object.prototype.hasOwnProperty.call(MOTIONS, id)) return MOTIONS[id];
  return null;
}
