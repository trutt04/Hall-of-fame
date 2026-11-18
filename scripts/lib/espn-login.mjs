/**
 * espn-login.mjs
 *
 * The owner's ESPN login, read from two environment variables that GitHub Actions fills from
 * encrypted Actions Secrets:
 *
 *   ESPN_S2     the espn_s2 browser cookie (long, percent-encoded)
 *   ESPN_SWID   the SWID browser cookie (a GUID, normally wrapped in curly braces)
 *
 * THOSE TWO VALUES ARE THE LOGIN. Anyone holding them can act as the owner on ESPN, so this
 * file exists to make leaking them hard:
 *
 *   - the values are never interpolated into a message, a log line or an error
 *   - only `cookie` (the finished header string) ever leaves here, and only espn-client.mjs
 *     uses it, only for league-scoped requests, only over https to ESPN
 *   - `scrub()` is the last line of defence: every string the sync prints or writes goes
 *     through it, so a value that somehow reached a message is replaced by [redacted]
 *   - `note` is the owner-facing explanation of a misconfiguration. It never names a value,
 *     not even its length or a prefix.
 *
 * Forgiving on input, strict on what is sent: a human copying cookies out of a browser may
 * keep the quotes, the braces, the "SWID=" prefix, a trailing semicolon or stray whitespace.
 * All of that is cleaned off, and the SWID braces are put back on the way out because that is
 * the form ESPN itself sets.
 */

/** Printed in place of any secret value that reaches a string. */
export const REDACTED = '[redacted]';

/**
 * Short needles would redact innocent text (and tell an attacker nothing useful anyway), so
 * only values at least this long are scrubbed. Both real cookies are far longer.
 */
const MIN_SCRUB_LENGTH = 8;

/**
 * Some strings are cut to a maximum length BEFORE they reach the scrubber: a detail is sliced
 * to 160 or 300 characters, normalize caps a text field at 80. A cut always leaves a PREFIX of
 * whatever it cut, so prefixes are needles too, from this length upward in these steps. Half a
 * login is still too much to publish. 32 characters is far longer than any coincidence with
 * ordinary league text, and the step bounds what a cut in the middle of a step can leave
 * behind at 5 characters of a value hundreds long. The floor is low on purpose: normalize caps a
 * team abbrev at 12 characters and a first name at 20, so a higher floor would let a short slice
 * of a login through those two sinks. 10 characters of base64 is still far past coincidence.
 */
const MIN_PARTIAL_LENGTH = 10;
const PARTIAL_STEP = 6;

/**
 * What status.json says when a signed-in request was still refused. A FIXED sentence: the
 * detail is published on the public web, so it carries no value, no length and no host.
 */
export const LOGIN_EXPIRED_DETAIL =
  'The ESPN login saved in the GitHub secrets no longer works: ESPN answered 401 for the signed-in request, ' +
  'and the league is not public either. Copy espn_s2 and SWID from your browser again and update the two secrets.';

/** Said when a secret exists but nothing usable survived cleaning (a bare name, braces, quotes). */
const EMPTY_VALUE_NOTE =
  'One of the two ESPN login secrets holds no usable value: after the quotes, braces and any "SWID=" in front are ' +
  'taken off there is nothing left, so this run asked ESPN without a login. Open that secret with its pencil icon ' +
  'and paste just the value from the browser.';

/** The two environment variables, in the order the owner sets them up. */
export const LOGIN_ENV = Object.freeze(['ESPN_S2', 'ESPN_SWID']);

/** Cookie values travel in a header: printable ASCII, no space, no semicolon, no line breaks. */
const HEADER_SAFE = /^[\x21-\x3a\x3c-\x7e]+$/;
const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** Spellings a human might paste as the "name" half of a name=value pair. */
const ALIASES = { espn_s2: ['espn_s2', 'espns2', 'espn-s2'], swid: ['swid'] };

const keyOf = (part) => (part.includes('=') ? part.slice(0, part.indexOf('=')).trim().toLowerCase() : null);

/**
 * Clean one pasted value. `which` is 'espn_s2' or 'swid'.
 * Handles: surrounding whitespace and quotes, a whole "name=value" pair, several pairs
 * separated by semicolons or newlines, a trailing semicolon, and (for SWID) curly braces.
 */
export function cleanLoginValue(raw, which) {
  let value = String(raw ?? '').trim();
  if (!value) return '';
  // Quotes survive a copy out of a terminal or a JSON blob surprisingly often.
  value = value.replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
  if (!value) return '';

  const parts = value.split(/[;\n\r]+/).map((p) => p.trim()).filter(Boolean);
  const names = ALIASES[which] ?? [which];
  const mine = parts.find((p) => names.includes(keyOf(p) ?? ''));
  if (mine) value = mine.slice(mine.indexOf('=') + 1).trim();
  else if (parts.length > 1) value = parts[0]; // a pasted pair we could not name: keep the first
  else if (names.includes(keyOf(value) ?? '')) value = value.slice(value.indexOf('=') + 1).trim();

  value = value.replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
  // The braces belong to the SWID cookie, but they are put back on the way out, not kept here.
  if (which === 'swid') value = value.replace(/^\{+/, '').replace(/\}+$/, '').trim();
  return value;
}

function variantsOf(value) {
  const out = [value];
  try {
    out.push(encodeURIComponent(value));
  } catch { /* nothing to add */ }
  try {
    out.push(decodeURIComponent(value));
  } catch { /* a lone % is not decodable, which is fine */ }
  out.push(`{${value}}`, value.replace(/^\{+/, '').replace(/\}+$/, ''));
  // The data files are scrubbed as serialized JSON, where a quote or a backslash in a value
  // would have become \" or \\ and so would no longer match the plain form.
  const escaped = JSON.stringify(value).slice(1, -1);
  if (escaped !== value) out.push(escaped);
  return out;
}

/** Every form of one value worth searching for: the whole thing, and its longer prefixes. */
function needlesFor(value) {
  const forms = variantsOf(value);
  const out = [...forms];
  for (const form of forms) {
    for (let n = MIN_PARTIAL_LENGTH; n < form.length; n += PARTIAL_STEP) out.push(form.slice(0, n));
  }
  return out;
}

/**
 * Build the scrubber: a function that replaces every occurrence of any secret value, in plain,
 * url-encoded, JSON-escaped or cut-short form, with [redacted]. Plain string search, so a value
 * full of regex metacharacters is handled too. Longest needle first, so a whole value is never
 * replaced by its own prefix plus a readable tail. With nothing to hide it is the identity
 * function, which keeps the no-secrets path byte-for-byte as it was.
 */
export function makeScrub(values = []) {
  const needles = [...new Set(values.filter(Boolean).flatMap((v) => needlesFor(String(v))))]
    .filter((n) => n.length >= MIN_SCRUB_LENGTH)
    .sort((a, b) => b.length - a.length); // longest first, so a braced value is not half-redacted
  if (needles.length === 0) return (text) => text;
  // Case-insensitive: a sink may change case on the way through (firstNameOnly title-cases what
  // it keeps), and a case-folded half of a login is still a leak. Matching is done on lowered
  // copies while the ORIGINAL text is spliced, so nothing else about the string is disturbed.
  const lowered = needles.map((n) => n.toLowerCase());
  return (text) => {
    if (typeof text !== 'string' || text === '') return text;
    let out = text;
    for (const needle of lowered) {
      for (;;) {
        const at = out.toLowerCase().indexOf(needle);
        if (at < 0) break;
        out = out.slice(0, at) + REDACTED + out.slice(at + needle.length);
      }
    }
    return out;
  };
}

/**
 * Read the login from the environment.
 * Returns { state, cookie, scrub, note }:
 *   state   'none'     neither secret is set: the public attempt, exactly as before
 *           'ready'    both are set and usable: `cookie` is the header to send
 *           'partial'  only one is set (a misconfiguration; no login is sent)
 *           'unusable' both are set but one cannot go in a header (no login is sent)
 *   cookie  the finished "espn_s2=...; SWID={...}" header string, or null
 *   scrub   see makeScrub
 *   note    one or two plain sentences for the owner, or null. Never names a value.
 */
export function readLogin(env = process.env) {
  const rawS2 = env.ESPN_S2;
  const rawSwid = env.ESPN_SWID;
  const s2 = cleanLoginValue(rawS2, 'espn_s2');
  const swid = cleanLoginValue(rawSwid, 'swid');
  // "Set but holds nothing we can use" is a different mistake from "not set at all", and it
  // sends the owner to a different place, so the two are not reported with one sentence.
  const setButEmpty = (raw, cleaned) => !cleaned && String(raw ?? '').trim() !== '';
  // Built from the raw and the cleaned forms, whatever the state: a half-set secret is still
  // a secret, and a value we refuse to send must still never be printed.
  const scrub = makeScrub([String(rawS2 ?? '').trim(), String(rawSwid ?? '').trim(), s2, swid]);
  const nothing = (state, note = null) => ({ state, cookie: null, scrub, note });

  if (!s2 && !swid) {
    // Both empty, but if a value was pasted and nothing survived cleaning, say so: otherwise
    // the owner reads "none set" while looking at two secrets that are plainly there.
    if (setButEmpty(rawS2, s2) || setButEmpty(rawSwid, swid)) {
      return nothing('partial', EMPTY_VALUE_NOTE);
    }
    return nothing('none');
  }
  if (!s2 || !swid) {
    return nothing(
      'partial',
      setButEmpty(rawS2, s2) || setButEmpty(rawSwid, swid)
        ? EMPTY_VALUE_NOTE
        : 'Only one of the two ESPN login secrets is set. Both ESPN_S2 and ESPN_SWID are needed, so this run asked ESPN ' +
          'without a login. Add the missing one in Settings, Secrets and variables, Actions.',
    );
  }
  if (!HEADER_SAFE.test(s2) || !HEADER_SAFE.test(swid)) {
    return nothing(
      'unusable',
      'One of the two ESPN login secrets holds a character that cannot be sent to ESPN (a line break, a space or a ' +
      'stray semicolon, most likely), so this run asked ESPN without a login. Copy the value again, on its own, and ' +
      'update the secret.',
    );
  }

  // Notes on a login that IS used: they describe the shape of a known copying mistake, never
  // the value. A false alarm costs nothing, because the value is sent either way.
  const notes = [];
  if (!GUID.test(swid)) {
    notes.push(
      'The ESPN_SWID secret does not look like the usual {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX} shape. It was used ' +
      'anyway. If ESPN refuses the login, copy the whole value again, braces included.',
    );
  }
  // A real espn_s2 is percent-encoded, so it always carries % signs. None at all almost always
  // means the browser's cookie panel was showing the decoded value (Chrome has a "Show
  // URL-decoded" tick box that stays ticked), and ESPN refuses the decoded bytes. Without this
  // note the only advice the owner gets is "copy it again", which reproduces the same value.
  if (!s2.includes('%')) {
    notes.push(
      'The ESPN_S2 secret has no % signs in it, which usually means it was copied with the "Show URL-decoded" box ' +
      'ticked in the browser\'s cookie panel. It was used anyway. If ESPN refuses the login, untick that box and ' +
      'copy the value again.',
    );
  }

  return {
    state: 'ready',
    // The SWID braces are what ESPN itself sets, so they go back on here. Uppercase SWID and
    // lowercase espn_s2 are the names every working client sends.
    cookie: `espn_s2=${s2}; SWID={${swid}}`,
    scrub,
    note: notes.length ? notes.join(' ') : null,
  };
}
