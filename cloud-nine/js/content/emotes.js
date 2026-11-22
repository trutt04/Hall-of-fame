// Preset quick-cheers: the only way players talk to each other (kid-safety rule: no free text).
//
//   EMOTES          [{ id, text, icon, iconId, anim, sfx }] in display order (16 of them)
//                   icon   an emoji from the original 2010 to 2016 sets, so every phone and tablet has it
//                   iconId a plain name, so the app can draw its own icon instead of the emoji
//                   anim   a Contract 3 animation for the sender's character to play
//                   sfx    a Contract 6 sound name to play with it
//   EMOTE_IDS       the ids, in the same order
//   cleanEmote(id)  -> the emote for a known id, or null. Use it on everything from the network.

const emote = (id, text, icon, iconId, anim, sfx) => Object.freeze({ id, text, icon, iconId, anim, sfx });

export const EMOTES = Object.freeze([
  emote('hi', 'Hi!', '\u{1F44B}', 'wave', 'wave', 'chime'),
  emote('letsGo', "Let's go!", '\u{1F4E3}', 'megaphone', 'cheer', 'cheer'),
  emote('overHere', 'Over here!', '\u{1F64B}', 'hand', 'wave', 'pop'),
  emote('foundYou', 'Found you!', '\u{1F440}', 'eyes', 'clap', 'found'),
  emote('youGotThis', 'You got this!', '\u{1F31F}', 'star', 'punch', 'sparkle'),
  emote('niceOne', 'Nice one!', '\u{1F44F}', 'clap', 'clap', 'clap'),
  emote('fullOut', 'Full out!', '\u2728', 'sparkles', 'highV', 'poms'),
  emote('hitZero', 'Hit zero!', '\u{1F4AF}', 'hundred', 'touchdown', 'tada'),
  emote('stickIt', 'Stick it!', '\u{1F3AF}', 'target', 'tMotion', 'pop'),
  emote('goTeam', 'Go team!', '\u{1F380}', 'bow', 'daggers', 'poms'),
  emote('readyOk', 'Ready? OK!', '\u{1F64C}', 'hands', 'clasp', 'clap'),
  emote('unfreezeMe', 'Unfreeze me!', '\u2744\ufe0f', 'snowflake', 'wave', 'pop'),
  emote('wooHoo', 'Woo hoo!', '\u{1F389}', 'confetti', 'dance', 'cheer'),
  emote('thankYou', 'Thank you!', '\u{1F496}', 'heart', 'wave', 'chime'),
  emote('goodGame', 'Good game!', '\u{1F91D}', 'handshake', 'clap', 'clap'),
  emote('happyBirthday', 'Happy birthday!', '\u{1F382}', 'cake', 'cheer', 'tada'),
]);

export const EMOTE_IDS = Object.freeze(EMOTES.map((e) => e.id));

const BY_ID = new Map(EMOTES.map((e) => [e.id, e]));

export function cleanEmote(id) {
  if (typeof id !== 'string' || id.length > 32) return null;
  return BY_ID.get(id) || null;
}
