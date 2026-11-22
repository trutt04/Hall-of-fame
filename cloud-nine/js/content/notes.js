// Family notes: short messages from the family, shown in the game. Pure.
//
//   FAMILY_NOTES                  [{ from, text }]: empty until the owner sends them (example below)
//   NOTE_LIMITS                   { text: 160, from: 24 }
//   RELATIONS                     the relation words a note may be signed with ("Grandma", "Aunt", ...)
//   cleanNote(raw)                -> { from, text, clipped } | null
//   familyNotes(notes = FAMILY_NOTES) -> the notes that pass cleanNote, in order
//
// Signing rule (kid safety: never a last name). `from` is one or more parts joined by "and", "&"
// or a comma. Each part is one word (a first name like "Maya" or a relation like "Grandma"), or a
// relation and then one first name ("Aunt Kim", "Grandpa Joe", "Great Grandma Rose"). So
// "Kim Smith" is refused, and "Mom and Dad" or "Nana & Papa" are fine.
// Text: one paragraph of at most 160 characters (longer text is clipped at a word, with "..."),
// with no links, emails, @handles or long numbers, and nothing from the blocklist.

import { isBlocked } from './blocklist.js';

export const FAMILY_NOTES = Object.freeze([
  // OWNER: add the family's notes here, one per line, like this example. First names or
  // relations only (never last names), and keep each note short and sweet:
  // { from: 'Grandma', text: 'Happy birthday, sweet flyer! We are so proud of you. Fly high!' },
]);

export const NOTE_LIMITS = Object.freeze({ text: 160, from: 24 });

export const RELATIONS = Object.freeze([
  'mom', 'mommy', 'mama', 'mum', 'mother', 'dad', 'daddy', 'papa', 'father', 'pop', 'pops',
  'parents', 'grandma', 'grandpa', 'granny', 'gran', 'grandad', 'granddad', 'grandmother',
  'grandfather', 'grandparents', 'nana', 'nanna', 'nan', 'nonna', 'nonno', 'abuela', 'abuelo',
  'abuelita', 'abuelito', 'abuelos', 'oma', 'opa', 'lola', 'lolo', 'gigi', 'mimi', 'meemaw',
  'peepaw', 'poppy', 'poppa', 'yaya', 'baba', 'bubbe', 'zayde', 'aunt', 'auntie', 'aunty',
  'aunts', 'tia', 'tio', 'uncle', 'uncles', 'cousin', 'cousins', 'sister', 'sisters', 'sis',
  'brother', 'brothers', 'bro', 'godmother', 'godfather', 'stepmom', 'stepdad', 'coach',
  'coaches', 'teammate', 'teammates', 'friend', 'friends', 'squad', 'family',
]);

const RELATION_SET = new Set(RELATIONS);
const MODIFIERS = new Set(['great', 'big', 'little', 'step', 'god']);
const LETTER = 'A-Za-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u017f';
const WORD_RE = new RegExp(`^[${LETTER}]+(?:['\\u2019-][${LETTER}]+)*$`);
const FROM_CHARS = new RegExp(`^[${LETTER}'\\u2019&, -]+$`);
const NO_GO = /https?:|www\.|\.(?:com|net|org|io|co)\b|@|#|\d{5,}/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff<>{}\\]/g;

const tidy = (s) => s.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function cleanFrom(raw) {
  if (typeof raw !== 'string' || raw.length > 80) return null;
  const s = tidy(raw);
  if (!s || Array.from(s).length > NOTE_LIMITS.from || !FROM_CHARS.test(s)) return null;
  const parts = s.split(/\s*[,&]\s*|\s+and\s+/i);
  for (const part of parts) {
    if (!part) return null;
    const words = part.split(' ');
    if (!words.every((w) => WORD_RE.test(w) && w.toLowerCase() !== 'and')) return null;
    let i = 0;
    while (i < words.length - 1 && MODIFIERS.has(words[i].toLowerCase()) && RELATION_SET.has(words[i + 1].toLowerCase())) i++;
    const rest = words.slice(i);
    if (rest.length === 2 && !RELATION_SET.has(rest[0].toLowerCase())) return null;
    if (rest.length > 2) return null;
  }
  if (isBlocked(s)) return null;
  return s
    .split(' ')
    .map((w) => (w.toLowerCase() === 'and' ? 'and' : cap(w)))
    .join(' ');
}

function clip(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, clipped: false };
  let cut = chars.slice(0, max - 3).join('');
  const space = cut.lastIndexOf(' ');
  if (space > max / 2) cut = cut.slice(0, space);
  cut = cut.replace(/[\s,;:.!?'"-]+$/, '');
  return { text: cut + '...', clipped: true };
}

export function cleanNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const from = cleanFrom(raw.from);
  if (!from || typeof raw.text !== 'string' || raw.text.length > 2000) return null;
  const text = tidy(raw.text);
  if (!text || NO_GO.test(text) || isBlocked(text, { squash: false })) return null;
  const c = clip(text, NOTE_LIMITS.text);
  return Object.freeze({ from, text: c.text, clipped: c.clipped });
}

export function familyNotes(notes = FAMILY_NOTES) {
  if (!Array.isArray(notes)) return [];
  return notes.map(cleanNote).filter(Boolean);
}
