// The nickname and note blocklist, kept in its own file. Pure.
//
//   isBlocked(text, { squash = true } = {}) -> true when the text holds a blocked word
//   BLOCKLIST_SIZE                          -> { anywhere, words }: how many entries each list has
//   blockedEntries()                        -> { anywhere: [...], words: [...] } decoded, for tests only
//
// The words are stored ROT13-encoded so they never sit in plain sight in a public repo that a kid
// might browse. They are decoded once, when the module loads. Never print them (tests use indexes).
//
// Two lists, because short words hide inside harmless names ("class", "Cassie", "skill"):
//   ANYWHERE  long, unambiguous roots, matched anywhere in the text
//   WORDS     short words, matched only as a whole word (with an optional plural s)
// and three more for put-downs typed as one word, where each half alone is fine in a name
// ("Pigeon", "Facey", "Bagley") and only the join is caught:
//   HALVES + TAILS   a rude first half joined to a body or put-down word, anywhere in the text
//   ENDINGS          a put-down at the end of a longer word (a name, then the put-down)
//   STARTS           a put-down at the start of a word with 3 or more letters after it
// NAMES_OK holds real first names that happen to contain a root from the lists; they pass when
// they are a whole word. Add to it if a real kid's name is ever refused.
//
// Normalization before matching: lower case; accents and look-alike Cyrillic or Greek letters folded
// to plain Latin; leetspeak (0 1 3 4 5 7 @ $ ! and friends) mapped to letters, trying 1 and | as
// both i and l; every letter may repeat ("baaad" matches "bad"); s and z are interchangeable.
// Spacing tricks: with squash on (nicknames), the letters are also joined across spaces and dots,
// so spaced-out words are caught. Squash is off for sentences (notes), where joining words would
// catch innocent phrases; runs of single letters ("b a d") are still joined in both modes.

const ANYWHERE_ROT13 = [
  'shpx', 'shx', 'shd', 'sphx', 'cuhpx', 'fuvg', 'fulg', 'ovgpu', 'ovngpu', 'phag', 'avttre',
  'avttn', 'snttbg', 'sntbg', 'juber', 'fyhg', 'cravf', 'intvan', 'cbea', 'frkl', 'qvyqb', 'jnax',
  'gjng', 'wvmm', 'onfgneq', 'nffubyr', 'nefrubyr', 'qhzonff', 'wnpxnff', 'onqnff', 'fznegnff',
  'qvpxurnq', 'ohggubyr', 'ohggurnq', 'ohggsnpr', 'cbbcurnq', 'qbhpur', 'uvgyre', 'ergneq',
  'zbyrfg', 'xxx', 'fghcvq', 'vqvbg', 'fhvpvqr', 'xvyylbh', 'xvyyhefrys', 'genaal', 'jrgonpx',
  'enturnq', 'craqrwb', 'pnoeba', 'puvatn', 'zvreqn',
  'cbbc', 'htyl', 'fgvax', 'fzryy', 'sngnff', 'yneqnff', 'vungr', 'ungrlbh', 'fuhghc', 'xvyyure', 'xvyyuvz', 'tbgbqvr',
  'hfhpx', 'ovtohgg', 'guhaqreguvtu', 'onyyfnpx', 'cuhx', 'cuhd', 'sipx', 'ogpu', 'orlbgpu', 'olbgpu',
];

const WORDS_ROT13 = [
  'nff', 'nefr', 'ohgg', 'ohz', 'cbbc', 'cbbcl', 'cbbcvr', 'crr', 'crrcrr', 'sneg', 'snegl', 'frk',
  'qvpx', 'pbpx', 'phz', 'gvg', 'gvgf', 'gvggl', 'gvggvrf', 'obbo', 'obbof', 'obbol', 'obbovrf',
  'nany', 'nahf', 'snt', 'uryy', 'penc', 'penccl', 'fhpx', 'fhpxf', 'fhpxre', 'xvyy', 'xvyyre',
  'xvyyn', 'qvr', 'ungr', 'ungre', 'qhzo', 'qhzzl', 'zbeba', 'ybfre', 'htyl', 'shtyl', 'sng',
  'snggl', 'sngfb', 'puhool', 'fxvaal', 'fzryyl', 'fgvaxl', 'fgvaxf', 'jrveqb', 'sernx', 'crqb',
  'anmv', 'encvfg', 'xlf', 'jgs', 'fgsh', 'ahqr', 'ahqrf', 'anxrq', 'crei', 'creireg', 'gubg',
  'ubr', 'cvzc', 'chgn', 'chgb', 'phyb', 'iretn', 'qnza', 'qnzavg', 'cvff', 'cvffrq', 'cvffl',
  'puvax', 'fcvp', 'xvxr', 'tbbx', 'pbba', 'wnc', 'gheq', 'jrrjrr', 'jvrare', 'jrvare', 'tbeqn', 'tbeqb', 'gbagn',
  'rfghcvqn', 'rfghcvqb',
];

const HALVES_ROT13 = [
  'sng', 'qhzo', 'cbbc', 'crr', 'sneg', 'ohgg', 'yneq', 'cvt', 'jrveq', 'fabg', 'obbtre', 'ones', 'chxr', 'gheq', 'nff',
  'ohz', 'tebff', 'ynzr', 'penc', 'cvff', 'pel', 'zbeba', 'ybfre', 'snegl', 'sernx', 'gbvyrg', 'areq', 'qbex', 'puhool',
];

const TAILS_ROT13 = [
  'snpr', 'urnq', 'oenva', 'ohgg', 'oerngu', 'cnagf', 'ont', 'srrg', 'sbbg', 'abfr', 'ubyr', 'jvcr', 'ung', 'purrxf', 'yvcf',
  'yrtf', 'fnpx', 'jnq', 'tvey', 'obl', 'xvq', 'onol', 'nff', 'cvt', 'pbj', 'zbhgu', 'rnef', 'ohpxrg', 'ohz', 'yneq', 'qhzo',
];

const ENDINGS_ROT13 = ['fhpx', 'fhk', 'ybfre', 'vfsng', 'vfqhzo', 'vfjrveq', 'vftebff', 'vfonq'];

const STARTS_ROT13 = ['ybfre', 'ungr', 'tebff', 'qhzo', 'zbeba', 'jrveqb'];

const NAMES_OK_ROT13 = ['xfuvgvw', 'qvxfuvgn', 'fuvgny', 'shxn', 'qhzoyrqber'];

const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

const ANYWHERE = ANYWHERE_ROT13.map(rot13);
const WORDS = WORDS_ROT13.map(rot13);
const HALVES = HALVES_ROT13.map(rot13);
const TAILS = TAILS_ROT13.map(rot13);
const ENDINGS = ENDINGS_ROT13.map(rot13);
const STARTS = STARTS_ROT13.map(rot13);
const NAMES_OK = new Set(NAMES_OK_ROT13.map(rot13));

export const BLOCKLIST_SIZE = Object.freeze({ anywhere: ANYWHERE.length, words: WORDS.length, halves: HALVES.length, tails: TAILS.length, endings: ENDINGS.length, starts: STARTS.length });

export function blockedEntries() {
  return { anywhere: ANYWHERE.slice(), words: WORDS.slice(), halves: HALVES.slice(), tails: TAILS.slice(), endings: ENDINGS.slice(), starts: STARTS.slice() };
}

// Every letter may repeat; s and z stand in for each other; '#' (a leetspeak 1 or |) is i or l.
const letterPattern = (word) =>
  Array.from(word, (ch) => {
    if (ch === 's' || ch === 'z') return '[sz]+';
    if (ch === 'i' || ch === 'l') return `[${ch}#]+`;
    return ch + '+';
  }).join('');
const ANYWHERE_RE = new RegExp(ANYWHERE.map(letterPattern).join('|'));
const WORD_RE = new RegExp('^(?:' + WORDS.map(letterPattern).join('|') + ')[sz]?$');
const JOINED_RE = new RegExp('(?:' + HALVES.map(letterPattern).join('|') + ')(?:' + TAILS.map(letterPattern).join('|') + ')');
const ENDING_RE = new RegExp('^[a-z#]{2,}(?:' + ENDINGS.map(letterPattern).join('|') + ')[sz]?$');
const START_RE = new RegExp('^(?:' + STARTS.map(letterPattern).join('|') + ')[a-z#]{3,}$');
const hit = (t) => WORD_RE.test(t) || ANYWHERE_RE.test(t) || JOINED_RE.test(t) || ENDING_RE.test(t) || START_RE.test(t);
// For words joined across spaces: the match has to start where a typed word starts.
const ANYWHERE_START_RE = new RegExp('^(?:' + ANYWHERE.map(letterPattern).join('|') + ')');
const JOINED_START_RE = new RegExp('^' + JOINED_RE.source);
const hitJoin = (t) => WORD_RE.test(t) || ANYWHERE_START_RE.test(t) || JOINED_START_RE.test(t) || ENDING_RE.test(t) || START_RE.test(t);

const LEET = {
  '0': 'o', '1': '#', '|': '#', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '+': 't', '#': ' ', '\u20ac': 'e', '\u00a3': 'l', '\u00a1': 'i', '\u00df': 'ss',
};
const LOOKALIKE = {
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u0451': 'e', '\u043a': 'k', '\u043c': 'm', '\u043d': 'h',
  '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i',
  '\u0458': 'j', '\u0455': 's', '\u0501': 'd', '\u0261': 'g', '\u03b1': 'a', '\u03b2': 'b', '\u03b5': 'e',
  '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v', '\u03bf': 'o', '\u03c1': 'p', '\u03c4': 't', '\u03c5': 'u',
  '\u03c7': 'x',
};

function letters(text) {
  const s = String(text).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '');
  let out = '';
  for (const ch of s) out += LOOKALIKE[ch] || LEET[ch] || ch;
  return out;
}

// Runs of two or more single-letter tokens, joined: ["b", "a", "d"] -> "bad".
function singleLetterRuns(tokens) {
  const runs = [];
  let run = '';
  for (const t of tokens) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 1) runs.push(run);
      run = '';
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function blockedIn(normalized, squash) {
  // a real name from NAMES_OK counts as a gap, so it never joins its neighbours either
  const parts = normalized.split(/[^a-z#]+/).filter(Boolean);
  const okAt = parts.map((t) => NAMES_OK.has(t));
  const tokens = parts.filter((t, i) => !okAt[i]);
  if (!tokens.length) return false;
  const runs = singleLetterRuns(tokens);
  for (const t of tokens) if (hit(t)) return true;
  for (const r of runs) if (hit(r)) return true;
  if (!squash) return false;
  // Words joined across spaces ("Fu Ck"), never across an allowed name. A joined word only counts
  // when it starts where a typed word starts, so two real names side by side ("Rowan K", "Raj Izzy")
  // pass, while a word split in two is still caught.
  let group = [];
  const groups = [group];
  parts.forEach((t, i) => (okAt[i] ? groups.push((group = [])) : group.push(t)));
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      let span = g[i];
      for (let j = i + 1; j < g.length; j++) if (hitJoin((span += g[j]))) return true;
    }
  }
  return false;
}

export function isBlocked(text, { squash = true } = {}) {
  if (typeof text !== 'string' || !text) return false;
  if (text.length > 4000) return true; // far longer than any name or note: refuse it
  return blockedIn(letters(text), squash);
}
