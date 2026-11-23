// Shared copy checks for the content tests (not a test file itself).
//
//   copyProblems(text, label, { max, praise }) -> [] when the text follows the house rules
//
// Every string a player reads: no dashes or curly quotes (the house style), no leftover junk,
// no doubled or stray spaces, and a length cap. Praise copy (hype lines and quick-cheers) is also
// checked for looks, bodies, food, mean words and gendered group words.

export const DASHES = /[\u2013\u2014]/;
export const CURLY = /[\u2018\u2019\u201c\u201d]/;
export const JUNK = /undefined|\bnull\b|NaN|\[object|[{}<>]/;
export const LOOKS = /\b(pretty|beautiful|gorgeous|cute|ugly|skinny|thin|fat|weight|diet|body|bodies|figure|makeup|hair|outfit|(look|looks|looking) (good|great|amazing|cute|nice|fab\w*))\b/i;
export const FOOD = /\b(cake|cupcakes?|candy|cookies?|snacks?|sugar|sweets|treats?|pizza|donuts?|icing|frosting|sprinkles|eat|eating|yummy|delicious|tasty|hungry|food|popsicles?|dinner|lunch|breakfast)\b/i;
export const MEAN = /\b(lose|lost|loser|losing|fail|failed|failure|worst|terrible|awful|stupid|dumb|idiot|crash|crashed|die|died|dead|death|cry|crying|tears|hurt|kill|killed|shame|ashamed|embarrass\w*|sucks|bad)\b/i;
export const GENDERED = /\b(girls?|guys|boys?|ladies|gentlemen)\b/i;

export function copyProblems(text, label, { max = 120, praise = false } = {}) {
  const out = [];
  if (typeof text !== 'string' || !text) return [`${label}: not a non-empty string`];
  if (DASHES.test(text)) out.push(`${label}: has a dash: ${text}`);
  if (CURLY.test(text)) out.push(`${label}: has a curly quote: ${text}`);
  if (JUNK.test(text)) out.push(`${label}: has junk: ${text}`);
  if (/\s{2,}/.test(text) || text !== text.trim()) out.push(`${label}: stray spaces: ${text}`);
  if (text.length > max) out.push(`${label}: ${text.length} > ${max}: ${text}`);
  if (praise) {
    if (LOOKS.test(text)) out.push(`${label}: about looks: ${text}`);
    if (FOOD.test(text)) out.push(`${label}: about food: ${text}`);
    if (MEAN.test(text)) out.push(`${label}: mean or sad word: ${text}`);
    if (GENDERED.test(text)) out.push(`${label}: gendered group word: ${text}`);
  }
  return out;
}
