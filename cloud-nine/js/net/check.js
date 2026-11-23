// The online-play check (index.html?check=online, firebase/SETUP.md step 8): is Firebase set up the
// way SETUP.md says, tried from one device? It does what the game does, one stage at a time, with
// the game's own transport and the same SDK (from Google, the pinned version), and when a stage
// fails it names the SETUP.md step to fix. js/ui/netcheck.js shows it. Pure: no DOM.
//
//   runOnlineCheck({ config, sdk, loadSdk, timeoutMs, onChange }) -> Promise<report>
//     config      the Firebase settings (default: js/net/firebase-config.js)
//     sdk         { app, auth, database } to use instead of loading one (tests: tools/fake-firebase.mjs)
//     loadSdk     () -> Promise<sdk>; default: the game's loader, loadFirebaseSdk()
//     timeoutMs   how long each stage waits for an answer (default 10 s)
//     onChange(report)   after every change, for the card
//   report   { done, ok, lines, first }   ok: every line passed; first: the first failed line, or null
//   line     { id, title, state, text, step, code }
//            state 'waiting' | 'running' | 'pass' | 'fail' | 'skip' (not tried: an earlier line failed)
//            step: the SETUP.md step to look at ('3', '2 and 7', 'end' for the part at the end of the
//            guide), or null; code: what Firebase said (auth/..., PERMISSION_DENIED), or null
//   settingsProblem(config) -> { text, step } | null      explainSignIn(err) -> { text, step }
//
// The lines, in order. A failed line skips the ones after it, except the clean-up, which always runs:
//   settings  the five values are filled in (isConfigured)
//   sdk       the Firebase code loads from Google
//   signin    anonymous sign-in works
//   database  the game's room code makes a throwaway room and joins it, then reads it back
//   safety    the two things the rules must refuse are refused: listing every room, and writing
//             into another player's entry. If either is allowed, the rules are too open (step 3).
//   cleanup   the test room is left and removed, then read again to be sure it is gone
//
// What it sends: an anonymous sign-in, and a room with one player called "Setup check" with a blank
// look. Nothing about the device or the people using it. Everything it writes is removed again (the
// rules let a host remove its own room once nobody is in it), then its anonymous account is deleted.
// If the page closes half way, Firebase removes the player, and the room too, by itself.

import { FIREBASE_CONFIG, isConfigured } from './firebase-config.js';
import { createFirebaseTransport, loadFirebaseSdk, isDenied } from './transport-firebase.js';
import { makeRoomCode } from './codes.js';
import { isId } from './validate.js';

export const CHECK_TIMEOUT_MS = 10000;
export const TEST_NICK = 'Setup check';
const TEST_ENTRY = Object.freeze({ nick: TEST_NICK, look: '{}', bot: false });
const KEYS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const noop = () => {};
const SINK = Object.freeze({ meta: noop, player: noop, state: noop, event: noop, game: noop, removed: noop, resync: noop });

export const CHECK_LINES = Object.freeze([
  Object.freeze({ id: 'settings', title: 'Settings pasted' }),
  Object.freeze({ id: 'sdk', title: 'The Firebase code loads' }),
  Object.freeze({ id: 'signin', title: 'Anonymous sign-in works' }),
  Object.freeze({ id: 'database', title: 'The database answers' }),
  Object.freeze({ id: 'safety', title: 'The safety rules hold' }),
  Object.freeze({ id: 'cleanup', title: 'Clean up' }),
]);

// Everything the card says about a line. Short and plain: the reader set this up from SETUP.md.
export const SAY = Object.freeze({
  settingsOk: 'All five values are filled in.',
  placeholders: 'The game still has the PASTE-… placeholders. See step 7.',
  badUrl: "The databaseURL doesn't look right: it starts with https:// and ends in firebaseio.com or firebasedatabase.app. See steps 6 and 7.",
  sdkOk: 'Loaded from Google.',
  sdk: "Couldn't reach Google. Check the internet. Some school networks block it; try home Wi-Fi.",
  signinOk: 'Signed in with an anonymous ID.',
  signinOff: 'Anonymous sign-in is switched off. Turn it on: see step 4.',
  signinDomain: "This web address isn't on Firebase's list of authorized domains. See step 5.",
  signinKey: "Firebase doesn't know this apiKey. Copy the settings again: see step 7.",
  signinLocked: 'The key is locked to other web addresses. See "lock the key to the game\'s address" at the end of the guide.',
  signinBusy: 'Firebase saw a lot of sign-ins from this network just now. Wait a few minutes, then run the check again.',
  signinNet: "Couldn't reach Google's sign-in. Check the internet. Some school networks block it; try home Wi-Fi.",
  signinOther: "Sign-in didn't work. Check steps 4 and 7.",
  databaseOk: 'Made a test room, read it back.',
  rulesMissing: "The database said no: the rules weren't pasted. See step 3.",
  noAnswer: "The database didn't answer. Check the databaseURL: it's the address at the top of the Realtime Database page. See steps 2 and 7.",
  readBack: "The test room didn't read back right. Paste the rules again: see step 3.",
  safetyOk: 'Nobody can list rooms or change other players.',
  safetyUnsure: "Couldn't finish this check: the database stopped answering. Run the check again.",
  cleanupOk: 'Left and removed the test room.',
  nothingToTidy: 'Nothing to tidy up.',
  skipped: 'Not checked yet: fix the line above first.',
});

export function tooOpenText(listed, wrote) {
  const what = listed && wrote ? 'see every room and change other players' : listed ? 'see every room' : 'change other players';
  return 'Warning: the rules are too open. Anyone could ' + what + '. Paste the rules again: see step 3.';
}

export function leftoverText(code, denied) {
  return (
    "Couldn't remove the test room " + code + '. Nothing personal is in it. To tidy it: Firebase, Realtime Database, Data tab, rooms, ' + code +
    ', then the bin icon.' + (denied ? ' If this keeps happening, paste the rules again (step 3).' : '')
  );
}

function timeoutError(what) {
  const e = new Error('timed out ' + what);
  e.timedOut = true;
  return e;
}

// The transport's own time limits say 'timed out ...' too.
function isTimeout(err) {
  return !!err && (err.timedOut === true || /^timed out\b/.test(String(err.message || '')));
}

function withTimeout(p, ms, what) {
  let timer = null;
  return Promise.race([
    Promise.resolve(p),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(timeoutError(what)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function codeOf(err) {
  const c = err && err.code;
  return typeof c === 'string' && c ? c.slice(0, 120) : null;
}

function randomId(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
  return s;
}

const isPlaceholder = (v) => typeof v === 'string' && /PASTE|YOUR[-_ ]/i.test(v);

export function settingsProblem(config) {
  if (isConfigured(config)) return null;
  const c = config && typeof config === 'object' ? config : {};
  if (KEYS.some((k) => isPlaceholder(c[k]))) return { text: SAY.placeholders, step: '7' };
  const missing = KEYS.filter((k) => typeof c[k] !== 'string' || c[k].length < 4);
  if (missing.length) return { text: 'Some values are missing: ' + missing.join(', ') + '. See step 7.', step: '7' };
  return { text: SAY.badUrl, step: '6 and 7' };
}

// The codes firebase@10.14.1 gives for a failed anonymous sign-in. Server errors it doesn't know
// become their message in lower case with dashes, e.g. 'auth/api-key-not-valid.-please-pass-a-valid-api-key.'
// or 'auth/requests-from-referer-https://...-are-blocked.' (a key restricted to other addresses).
export function explainSignIn(err) {
  const c = String(codeOf(err) || '').replace(/^auth\//, '');
  if (c === 'operation-not-allowed' || c === 'admin-restricted-operation' || c === 'configuration-not-found') return { text: SAY.signinOff, step: '4' };
  if (c === 'unauthorized-domain') return { text: SAY.signinDomain, step: '5' };
  if (c === 'invalid-api-key' || /^api-key-(?:not-valid|expired)/.test(c)) return { text: SAY.signinKey, step: '7' };
  if (/^requests-(?:from|to)-/.test(c)) return { text: SAY.signinLocked, step: 'end' };
  if (c === 'too-many-requests') return { text: SAY.signinBusy, step: null };
  if (c === 'network-request-failed' || c === 'timeout' || isTimeout(err)) return { text: SAY.signinNet, step: null };
  return { text: SAY.signinOther, step: '4 and 7' };
}

// The SDK the transport gets: the same functions, except that the check sees the moment sign-in
// finishes and gets the transport's own database connection for the two safety probes.
function tap(S, seen, onSignedIn) {
  const auth = Object.assign({}, S.auth, {
    signInAnonymously(a) {
      return S.auth.signInAnonymously(a).then((cred) => {
        const user = cred && cred.user;
        if (user && isId(user.uid) && !seen.closed) {
          seen.user = user;
          onSignedIn();
        }
        return cred;
      });
    },
  });
  const database = Object.assign({}, S.database, {
    getDatabase(app) {
      seen.db = S.database.getDatabase(app);
      return seen.db;
    },
  });
  return { app: S.app, auth, database };
}

export async function runOnlineCheck({ config = FIREBASE_CONFIG, sdk = null, loadSdk = loadFirebaseSdk, timeoutMs = CHECK_TIMEOUT_MS, onChange = null } = {}) {
  const lines = CHECK_LINES.map((l) => ({ id: l.id, title: l.title, state: 'waiting', text: '', step: null, code: null }));
  const line = Object.fromEntries(lines.map((l) => [l.id, l]));
  const report = { done: false, ok: false, lines, first: null };
  const ms = Math.max(1, Number(timeoutMs) || CHECK_TIMEOUT_MS);

  function emit() {
    if (typeof onChange !== 'function') return;
    try {
      onChange(report);
    } catch (err) {
      console.error('[c9 check] the card could not update', err);
    }
  }
  function set(id, state, text = '', step = null, code = null) {
    Object.assign(line[id], { state, text, step, code });
    emit();
  }
  const fail = (id, f, code = null) => set(id, 'fail', f.text, f.step, code);

  let S = null;
  let t = null;
  const seen = { user: null, db: null, closed: false };
  // what to tidy: the room (made: ours for sure; unsure: its creation went quiet half way) and the
  // stray entry a safety probe may have managed to write
  const made = { code: null, unsure: null, stray: [] };

  async function stages() {
    set('settings', 'running');
    const bad = settingsProblem(config);
    if (bad) return fail('settings', bad);
    set('settings', 'pass', SAY.settingsOk);

    set('sdk', 'running');
    try {
      S = sdk || (await withTimeout(loadSdk(), ms, 'loading Firebase'));
      if (!S || !S.app || !S.auth || !S.database) throw new Error('the Firebase code is incomplete');
    } catch (err) {
      return fail('sdk', { text: SAY.sdk, step: null });
    }
    set('sdk', 'pass', SAY.sdkOk);

    // Sign-in, then the database link: the transport does both in connect(), as for the game.
    set('signin', 'running');
    t = createFirebaseTransport({
      config,
      sdk: tap(S, seen, () => {
        if (line.signin.state !== 'running') return;
        set('signin', 'pass', SAY.signinOk);
        set('database', 'running');
      }),
      tuning: { signInTimeoutMs: ms, connectTimeoutMs: ms, readTimeoutMs: ms, writeTimeoutMs: ms },
    });
    try {
      await t.connect();
    } catch (err) {
      if (line.signin.state !== 'pass') return fail('signin', explainSignIn(err), codeOf(err));
      return fail('database', isDenied(err) ? { text: SAY.rulesMissing, step: '3' } : { text: SAY.noAnswer, step: '2 and 7' }, codeOf(err));
    }

    // A throwaway room, made and joined through the game's own room code, then read back.
    const D = S.database;
    try {
      for (let i = 0; i < 3 && !made.code; i++) {
        const code = makeRoomCode();
        made.unsure = code;
        const r = await t.create(code);
        made.unsure = null;
        if (r === 'ok') made.code = code;
      }
      // a fresh code is never in use: refused three times means the rules said no
      if (!made.code) return fail('database', { text: SAY.rulesMissing, step: '3' });
      await t.enter(made.code, TEST_ENTRY, SINK);
      // if this page closes half way, Firebase removes my entry and the room together, in one go
      const gone = { meta: null, ['players/' + t.id]: null, ['state/' + t.id]: null };
      const room = D.ref(seen.db, 'rooms/' + made.code);
      await withTimeout(Promise.resolve().then(() => D.onDisconnect(room).update(gone)), ms, 'arming').catch(noop);
      const back = await t.probe(made.code);
      const mine = back && back.players && back.players[t.id];
      if (!back || !back.meta || back.meta.hostId !== t.id || !mine || mine.nick !== TEST_NICK) {
        return fail('database', { text: SAY.readBack, step: '3' });
      }
    } catch (err) {
      if (isDenied(err)) made.unsure = null; // refused: nothing was written
      return fail('database', isDenied(err) ? { text: SAY.rulesMissing, step: '3' } : { text: SAY.noAnswer, step: '2 and 7' }, codeOf(err));
    }
    set('database', 'pass', SAY.databaseOk);

    // The two things the rules must refuse. Allowed means anyone could do it. (The SDK's get() says
    // 'Permission denied' with no code, so any answer but yes or silence counts as refused.)
    set('safety', 'running');
    async function tryIt(fn) {
      let p;
      try {
        p = fn();
      } catch (err) {
        return 'unsure'; // never asked
      }
      try {
        await withTimeout(p, ms, 'checking the rules');
        return 'allowed';
      } catch (err) {
        return isTimeout(err) ? 'unsure' : 'refused';
      }
    }
    // one room at most, in case the rules are open and it all comes back
    const listing = await tryIt(() => D.get(D.query(D.ref(seen.db, 'rooms'), D.orderByKey(), D.limitToFirst(1))));
    // an id like a real anonymous id that isn't this page's
    const other = D.ref(seen.db, 'rooms/' + made.code + '/players/' + randomId(28));
    const writing = await tryIt(() => D.set(other, { nick: 'Not me', look: '{}', bot: false, joinedAt: D.serverTimestamp() }));
    if (writing !== 'refused') made.stray.push(other);
    if (listing === 'allowed' || writing === 'allowed') return fail('safety', { text: tooOpenText(listing === 'allowed', writing === 'allowed'), step: '3' });
    if (listing !== 'refused' || writing !== 'refused') return fail('safety', { text: SAY.safetyUnsure, step: null });
    set('safety', 'pass', SAY.safetyOk);
  }

  // Leave the room, remove it, look again to be sure, then close everything down.
  async function tidy() {
    seen.closed = true;
    if (!t) return set('cleanup', 'skip', SAY.nothingToTidy);
    const D = S.database;
    let code = made.code || made.unsure;
    let clean = true;
    let denied = false;
    const quietly = async (fn) => {
      try {
        return await withTimeout(fn(), ms, 'tidying up');
      } catch (err) {
        clean = false;
        if (isDenied(err)) denied = true;
        return null;
      }
    };
    if (code) set('cleanup', 'running');
    for (const ref of made.stray) await quietly(() => D.remove(ref));
    await t.exit(); // my player entry and position, and the transport's own disconnect jobs
    if (code && !made.code) {
      // the room was being made when the database went quiet: it is ours only if it says so
      const m = await quietly(() => D.get(D.ref(seen.db, 'rooms/' + code + '/meta')));
      if (m && !(m.exists() && m.val() && m.val().hostId === t.id)) code = null;
    }
    if (code) {
      const meta = D.ref(seen.db, 'rooms/' + code + '/meta');
      if (await quietly(() => D.remove(meta).then(() => true))) {
        await withTimeout(D.onDisconnect(D.ref(seen.db, 'rooms/' + code)).cancel(), ms, 'tidying up').catch(noop);
        const [m, p] = await Promise.all([quietly(() => D.get(meta)), quietly(() => D.get(D.ref(seen.db, 'rooms/' + code + '/players')))]);
        if (!m || !p || m.exists() || p.exists()) clean = false;
      }
    }
    // the anonymous account goes too, once nothing is left that needs it to be removed
    if (clean && seen.user && typeof S.auth.deleteUser === 'function') {
      await withTimeout(S.auth.deleteUser(seen.user), ms, 'deleting the test account').catch(noop);
    }
    t.dispose();
    if (clean && !code) return set('cleanup', 'skip', SAY.nothingToTidy);
    if (clean) return set('cleanup', 'pass', SAY.cleanupOk);
    return fail('cleanup', { text: leftoverText(code || made.unsure, denied), step: denied ? '3' : null });
  }

  emit();
  try {
    await stages();
  } catch (err) {
    console.error('[c9 check] the check stopped', err);
    const at = lines.find((l) => l.state === 'running');
    if (at && at.id !== 'cleanup') fail(at.id, { text: 'Something unexpected went wrong. Run the check again.', step: null });
  }
  // the lines not tried: the first one says why, the others stay quiet
  const untried = lines.filter((l) => l.id !== 'cleanup' && l.state === 'waiting');
  for (const l of untried) l.state = 'skip';
  if (untried.length) untried[0].text = SAY.skipped;
  try {
    await tidy();
  } catch (err) {
    console.error('[c9 check] tidying up stopped', err);
    fail('cleanup', { text: leftoverText(made.code || '(unknown)', false), step: null });
  }
  report.done = true;
  report.first = lines.find((l) => l.state === 'fail') || null;
  report.ok = lines.every((l) => l.state === 'pass');
  emit();
  return report;
}
