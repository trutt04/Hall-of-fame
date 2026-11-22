// How-to-play cards: a title, one-line blurb, 3 short steps and one tip per activity.
//
//   HOWTO           { basketToss, hideSeek, freezeTag, dodgeball, captureBow, hitZero }
//                   each { id, title, icon, iconId, blurb, steps: [3 strings], tip }
//   HOWTO_ORDER     the ids in menu order
//   howTo(id)       -> the card or null
//   gameTitle(id)   -> "Freeze Tag" for 'freezeTag', or null for an unknown id
//
// The keys of the four games match MODES in js/games/index.js (Contract 5). Steps work for touch,
// mouse and keyboard alike, so a card never has to know which device it is on.

const card = (id, title, icon, iconId, blurb, steps, tip) =>
  Object.freeze({ id, title, icon, iconId, blurb, steps: Object.freeze(steps), tip });

export const HOWTO = Object.freeze({
  basketToss: card('basketToss', 'Basket Toss', '\u{1F938}', 'toss',
    'Fly sky high and stick the landing on a cloud!', [
      'Step onto a sparkly toss pad and tap Basket toss!',
      'On 5, 6, 7, 8 your bases throw you sky high!',
      'Swipe or press arrows for tricks, then land on the cloud.',
    ], 'Friends standing on the base spots send you even higher!'),
  hideSeek: card('hideSeek', 'Hide and Seek', '\u{1F648}', 'peek',
    'Hide in the garden while the seeker counts!', [
      'The seeker covers their eyes and counts.',
      'Everyone else hides: a hedge, a tent, even a cloud!',
      'Seeker: get close to a hider and tap to find them.',
    ], 'Pick a spot the seeker would never guess!'),
  freezeTag: card('freezeTag', 'Freeze Tag', '\u2744\ufe0f', 'snowflake',
    'Tag to freeze, stand close to unfreeze!', [
      'If you are it, tag players to freeze them.',
      'Frozen? Strike a pose until a friend saves you.',
      'Stand next to a frozen friend to unfreeze them!',
    ], 'Rescue your frozen friends fast. Teamwork wins!'),
  dodgeball: card('dodgeball', 'Dodgeball', '\u{1F3D0}', 'ball',
    'Team Pink and Team Purple, ready to play!', [
      'Stay on your team\'s side of the middle line.',
      'Grab a ball and throw it at the other team.',
      'Dodge their throws, or catch one for a big play!',
    ], 'Watch the ball, not the thrower. Then catch it!'),
  captureBow: card('captureBow', 'Capture the Bow', '\u{1F380}', 'bow',
    'Grab the other team\'s bow and bring it home!', [
      'Sneak to the other team\'s base and grab their bow.',
      'Carry it all the way back to your base to score!',
      'Guard your own bow: tag anyone who takes it.',
    ], 'Split up! Some friends guard, some go grab.'),
  hitZero: card('hitZero', 'Hit Zero', '\u{1F4AF}', 'hundred',
    'Tap to the beat and perform a perfect routine!', [
      'Notes slide down 3 lanes, one for each cheer motion.',
      'Tap each note right as it reaches the line.',
      'At the end, the judges score your routine!',
    ], 'Miss nothing and you Hit Zero: a perfect routine!'),
});

export const HOWTO_ORDER = Object.freeze(['basketToss', 'hideSeek', 'freezeTag', 'dodgeball', 'captureBow', 'hitZero']);

export function howTo(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(HOWTO, id) ? HOWTO[id] : null;
}

export function gameTitle(id) {
  const c = howTo(id);
  return c ? c.title : null;
}
