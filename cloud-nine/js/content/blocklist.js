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
];

const WORDS_ROT13 = [
  'nff', 'nefr', 'ohgg', 'ohz', 'cbbc', 'cbbcl', 'cbbcvr', 'crr', 'crrcrr', 'sneg', 'snegl', 'frk',
  'qvpx', 'pbpx', 'phz', 'gvg', 'gvgf', 'gvggl', 'gvggvrf', 'obbo', 'obbof', 'obbol', 'obbovrf',
  'nany', 'nahf', 'snt', 'uryy', 'penc', 'penccl', 'fhpx', 'fhpxf', 'fhpxre', 'xvyy', 'xvyyre',
  'xvyyn', 'qvr', 'ungr', 'ungre', 'qhzo', 'qhzzl', 'zbeba', 'ybfre', 'htyl', 'shtyl', 'sng',
  'snggl', 'sngfb', 'puhool', 'fxvaal', 'fzryyl', 'fgvaxl', 'fgvaxf', 'jrveqb', 'sernx', 'crqb',
  'anmv', 'encvfg', 'xlf', 'jgs', 'fgsh', 'ahqr', 'ahqrf', 'anxrq', 'crei', 'creireg', 'gubg',
  'ubr', 'cvzc', 'chgn', 'chgb', 'phyb', 'iretn', 'qnza', 'qnzavg', 'cvff', 'cvffrq', 'cvffl',
  'puvax', 'fcvp', 'xvxr', 'tbbx', 'pbba', 'wnc',
];

const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

const ANYWHERE = ANYWHERE_ROT13.map(rot13);
const WORDS = WORDS_ROT13.map(rot13);

export const BLOCKLIST_SIZE = Object.freeze({ anywhere: ANYWHERE.length, words: WORDS.length });

export function blockedEntries() {
  return { anywhere: ANYWHERE.slice(), words: WORDS.slice() };
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
  const tokens = normalized.split(/[^a-z#]+/).filter(Boolean);
  if (!tokens.length) return false;
  const runs = singleLetterRuns(tokens);
  const whole = tokens.join('');
  for (const t of tokens) if (WORD_RE.test(t) || ANYWHERE_RE.test(t)) return true;
  for (const r of runs) if (WORD_RE.test(r) || ANYWHERE_RE.test(r)) return true;
  if (!squash) return false;
  if (ANYWHERE_RE.test(whole) || WORD_RE.test(whole)) return true;
  for (let i = 0; i + 1 < tokens.length; i++) if (WORD_RE.test(tokens[i] + tokens[i + 1])) return true;
  return false;
}

export function isBlocked(text, { squash = true } = {}) {
  if (typeof text !== 'string' || !text) return false;
  if (text.length > 4000) return true; // far longer than any name or note: refuse it
  return blockedIn(letters(text), squash);
}
