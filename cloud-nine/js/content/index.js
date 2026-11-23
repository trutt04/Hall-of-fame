// Cloud Nine's words and pure data (Contract 8), in one place for world.content:
//
//   import * as content from './content/index.js';
//   content.hype('tossLand', { name, height, tricks }, rng)
//
// Modules (each documents its own interface in its header comment):
//   hype.js          hype(situation, ctx, rng) and the lines in hype-lines-*.js
//   emotes.js        EMOTES quick-cheers, cleanEmote(id)
//   names.js         randomNick(rng), cleanNick(raw) (blocklist.js holds the words it refuses)
//   birthday.js      birthdayInfo(date, BIRTHDAY)
//   notes.js         FAMILY_NOTES, cleanNote(raw), familyNotes()
//   glossary.js      GLOSSARY, TRICKS, MOTIONS, trickLabel(id)
//   howto.js         HOWTO cards, gameTitle(id)
//   collectibles.js  SPIRIT_STICKS and their unlocks
// Everything here is pure: no three.js, no DOM, no storage, no network.

export * from './hype.js';
export * from './emotes.js';
export * from './names.js';
export * from './birthday.js';
export * from './notes.js';
export * from './glossary.js';
export * from './howto.js';
export * from './collectibles.js';
