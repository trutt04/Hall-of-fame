// Older devices: rules that keep Cloud Nine loading on iOS/iPadOS Safari 15.0+ (hand-me-down iPads),
// Android Chrome 100+ and Samsung Internet 18+. One piece of syntax Safari 15 can't parse makes it
// refuse the whole module, and the kid sees nothing at all; an API it lacks throws where it's used.
// Reads the source as text, so it runs under node --test with no browser.
//
//   - syntax: no regex lookbehind or class static blocks (both Safari 16.4), no import attributes,
//     regex modifiers or `using`, no hashbang. Checked in the game modules and in three.js.
//   - APIs Safari 15.0 doesn't have are not used at all, or only behind a feature check in that file
//   - CSS: no @layer, @container, color-mix() or nesting; dvh/svh units and overflow-wrap:anywhere
//     (Safari 15.4) come after a fallback declaration; :focus-visible never shares a selector list
//   - solo and offline play load and run with no BroadcastChannel or Web Locks (Safari 15.4)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
function filesIn(dir, ext) {
  const out = [];
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...filesIn(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
const MODULES = filesIn('js', '.js');
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// ------------------------------------------------------------------------------------------ syntax

const SYNTAX = [
  [/\(\?<[=!]/, 'regex lookbehind (?<= or (?<! (Safari 16.4): match the text before it instead'],
  [/\bstatic\s*\{/, 'class static block (Safari 16.4): set it up after the class'],
  [/\b(?:with|assert)\s*\{\s*type\s*:/, 'import attributes / assertions (not in Safari 15)'],
  [/\(\?[ims]+(?:-[ims]+)?:/, 'regex modifiers (?i:...) (not in Safari 15)'],
  [/(?:^|[;{}\n])\s*(?:await\s+)?using\s+[A-Za-z_$][\w$]*\s*=/, '`using` declaration (not in Safari 15)'],
];

test('every module and three.js parse in Safari 15: no lookbehind, static blocks or newer syntax', () => {
  assert.ok(MODULES.length > 100, 'found the game modules');
  for (const file of [...MODULES, 'lib/three.module.min.js']) {
    const src = read(file);
    assert.ok(!src.startsWith('#!'), file + ' starts with a hashbang');
    for (const [re, what] of SYNTAX) {
      const m = re.exec(src);
      assert.equal(m, null, m ? `${file}:${lineOf(src, m.index)} uses ${what}: "${src.slice(m.index, m.index + 40)}"` : '');
    }
  }
});

// -------------------------------------------------------------------------------------------- APIs

// The code with comments blanked out (strings, templates and regex literals kept, line breaks kept),
// so a comment can name an API without tripping the rules below.
function stripComments(src) {
  const KEYWORD_BEFORE_REGEX = /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|instanceof|new|delete|void|throw|yield|await|of)\s*$/;
  function scan(start, inTemplate) {
    let out = '';
    let i = start;
    let depth = 0;
    let prev = ''; // the last character of code that isn't a space: a regex can't follow ) ] or a name
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (inTemplate && c === '}' && depth === 0) return { out, end: i + 1 };
      if (c === '/' && d === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && d === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e < 0 ? src.length : e + 2;
        out += src.slice(i, end).replace(/[^\n]/g, ' ');
        i = end;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        out += src.slice(i, j + 1);
        i = j + 1;
        prev = c;
        continue;
      }
      if (c === '`') {
        let j = i + 1;
        out += '`';
        while (j < src.length && src[j] !== '`') {
          if (src[j] === '\\') {
            out += src.slice(j, j + 2);
            j += 2;
          } else if (src[j] === '$' && src[j + 1] === '{') {
            const inner = scan(j + 2, true);
            out += '${' + inner.out + '}';
            j = inner.end;
          } else out += src[j++];
        }
        out += '`';
        i = j + 1;
        prev = '`';
        continue;
      }
      if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || KEYWORD_BEFORE_REGEX.test(out))) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length && src[j] !== '\n' && (src[j] !== '/' || inClass)) {
          if (src[j] === '\\') j++;
          else if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          j++;
        }
        j++;
        while (j < src.length && /[a-z]/i.test(src[j])) j++;
        out += src.slice(i, j);
        i = j;
        prev = '/';
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return { out, end: i };
  }
  return scan(0, false).out;
}

const CODE = new Map(MODULES.map((f) => [f, stripComments(read(f))]));

test('the comment stripper keeps code and line numbers, and drops only comments', () => {
  const src = "const a = 'x // y'; // gone\nconst r = /\\/\\/[a/]+/g; /* gone\n too */ const t = `${a /* gone */}${`in`}`; x = 4 / 2; // gone";
  const out = stripComments(src);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(!out.includes('gone'), out);
  for (const kept of ["'x // y'", '/\\/\\/[a/]+/g', '`in`', 'x = 4 / 2']) assert.ok(out.includes(kept), kept + ' kept in: ' + out);
  for (const [file, code] of CODE) assert.equal(code.split('\n').length, read(file).split('\n').length, file);
});

// Not in Safari 15.0 (or in Chrome 100), and not worth a fallback: don't use them.
const BANNED = [
  [/\bstructuredClone\b/, 'structuredClone (Safari 15.4)'],
  [/\bObject\.hasOwn\b/, 'Object.hasOwn (Safari 15.4): use Object.prototype.hasOwnProperty.call'],
  [/\.findLast(?:Index)?\(/, 'findLast / findLastIndex (Safari 15.4)'],
  [/\.(?:toSorted|toReversed|toSpliced|with)\(/, 'toSorted / toReversed / toSpliced / with (Safari 16): copy, then sort'],
  [/\bPromise\.(?:withResolvers|try)\b/, 'Promise.withResolvers / Promise.try (Safari 17.4 / 18.2)'],
  [/\b(?:Object|Map)\.groupBy\b/, 'Object.groupBy / Map.groupBy (Safari 17.4)'],
  [/\.(?:union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, 'Set methods (Safari 17)'],
  [/(?<!Object)\.(?:values|keys|entries)\(\)\s*\.(?:map|filter|find|forEach|some|every|reduce|flatMap|take|drop|toArray)\(/, 'iterator helpers (Safari 18.4): spread into an array first'],
  [/\bIterator\.from\b/, 'Iterator.from (Safari 18.4)'],
  [/\brequestIdleCallback\b/, 'requestIdleCallback (never in Safari): use setTimeout'],
  [/\bOffscreenCanvas\b/, 'OffscreenCanvas (Safari 16.4): use a <canvas>'],
  [/\bAbortSignal\.(?:timeout|any)\b/, 'AbortSignal.timeout / any (Safari 16 / 17.4)'],
  [/\brandomUUID\b/, 'crypto.randomUUID (Safari 15.4): use crypto.getRandomValues'],
  [/\bArray\.fromAsync\b/, 'Array.fromAsync (Safari 16.4)'],
  [/\bURL\.(?:canParse|parse)\b/, 'URL.canParse / URL.parse (Safari 17 / 18): try new URL()'],
  [/\bRegExp\.escape\b/, 'RegExp.escape (Safari 18.2)'],
  [/\.(?:checkVisibility|showModal|showPopover|startViewTransition)\(/, 'checkVisibility, <dialog> showModal, popovers, view transitions (Safari 15.4 and later)'],
  [/\.(?:getCoalescedEvents|getPredictedEvents)\(/, 'getCoalescedEvents / getPredictedEvents (not in Safari 15)'],
  [/\.(?:roundRect|createConicGradient)\(/, 'canvas roundRect / createConicGradient (Safari 16): draw the path with arcTo'],
  [/\.(?:isWellFormed|toWellFormed)\(/, 'isWellFormed / toWellFormed (Safari 16.4)'],
  // Array and String at() take one argument; the art kit's Geo.at(x, y, z, ...) takes several
  [/\.at\((?:[^,()]|\([^()]*\))*\)/, 'at() (Safari 15.4): use [i] or [length - 1]'],
];
const OWN_AT = /\bsmoother$/; // the rhythm clock's own at(perfMs)

test('no API that Safari 15.0 lacks is used (the game must load and play on iPadOS 15)', () => {
  for (const [file, code] of CODE) {
    for (const [re, what] of BANNED) {
      const g = new RegExp(re.source, 'g');
      for (const m of code.matchAll(g)) {
        if (what.startsWith('at()') && OWN_AT.test(code.slice(0, m.index))) continue;
        assert.fail(`${file}:${lineOf(code, m.index)} uses ${what}: "${code.slice(m.index, m.index + 40)}"`);
      }
    }
  }
});

// Missing on some target (Safari 15.0, iOS, Firefox) but used for extras: a file that uses one must
// also test for it (typeof X, !X, X &&, X ||, X ?, if (X), 'X' in ...).
const GUARDED = [
  'BroadcastChannel', 'ResizeObserver', 'navigator.share', 'navigator.canShare', 'navigator.audioSession',
  'navigator.userActivation', 'navigator.wakeLock', 'navigator.vibrate', 'navigator.getBattery', 'navigator.connection',
  'screen.orientation', 'requestFullscreen', 'webkitRequestFullscreen', 'cancelAndHoldAtTime', 'getOutputTimestamp',
  'outputLatency', 'createStereoPanner',
];

test('APIs that some targets lack are only used behind a feature check in the same file', () => {
  for (const [file, code] of CODE) {
    for (const name of GUARDED) {
      const n = name.replace(/\./g, '\\.');
      const use = new RegExp(`(?<![\\w$])(?:[\\w$]+\\.)*${n}\\b`).exec(code);
      if (!use) continue;
      const recv = '(?:[\\w$]+\\.)*';
      const guard = new RegExp([
        `typeof\\s+${recv}${n}\\b`,
        `!\\s*${recv}${n}\\b`,
        `(?<![\\w$])${recv}${n}\\s*(?:&&|\\|\\||\\?)`,
        `\\bif\\s*\\(\\s*${recv}${n}\\s*\\)`,
        `&&\\s*${recv}${n}\\s*[;)]`,
        `['"]${name.split('.').pop()}['"]\\s+in\\b`,
      ].join('|'));
      assert.ok(guard.test(code), `${file}:${lineOf(code, use.index)} uses ${name} without checking it exists (Safari 15 or another target lacks it)`);
    }
  }
});

test('nothing makes a BroadcastChannel while a module loads', () => {
  for (const [file, code] of CODE) {
    const m = /^\S.*\bnew\s+(?:BroadcastChannel|BC)\(/m.exec(code);
    assert.equal(m, null, m ? `${file}:${lineOf(code, m.index)} makes a BroadcastChannel at the top level` : '');
  }
});

test('solo and offline play load and run without BroadcastChannel or Web Locks (Safari 15.0 to 15.3)', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  delete globalThis.BroadcastChannel;
  try {
    assert.equal(typeof globalThis.BroadcastChannel, 'undefined');
    if (globalThis.navigator) assert.ok(!globalThis.navigator.locks, 'this node has no Web Locks either');
    // imported only now, so their top level runs with no BroadcastChannel
    const { createNet } = await import('../js/net/index.js');
    const { localAvailable } = await import('../js/net/transport-local.js');
    const { createStandinNet } = await import('../js/ui/standins.js');
    assert.equal(localAvailable(), false);
    for (const mode of ['offline', 'auto']) {
      const net = createNet({ mode, helpers: {} });
      try {
        assert.equal(net.mode, 'offline', mode + ' picks offline here');
        const code = await net.createRoom({ nick: 'Bailey', look: {} });
        assert.ok(code && net.isHost, mode + ': solo room made');
        const bot = net.addBot({ nick: 'Sparkle', look: {} });
        assert.ok(bot && net.players.size === 2, mode + ': bot friend added');
        net.sendState({ x: 1, y: 0, z: 2, h: 0, anim: 'idle' });
        net.send('emote', { id: 'yay' });
        net.leaveRoom();
      } finally {
        if (typeof net.dispose === 'function') net.dispose();
      }
    }
    const standin = createStandinNet();
    const code = await standin.createRoom({ nick: 'Bailey', look: {} });
    assert.ok(code, 'the stand-in net makes a solo room');
    standin.leaveRoom();
  } finally {
    if (saved) Object.defineProperty(globalThis, 'BroadcastChannel', saved);
  }
});

// --------------------------------------------------------------------------------------------- CSS

// Each block of a stylesheet: the chain of selectors and at-rules it sits in, and its declarations.
function cssBlocks(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const stack = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    buf = '';
    const top = stack[stack.length - 1];
    const k = t.indexOf(':');
    if (top && k > 0 && t[0] !== '@') top.decls.push({ prop: t.slice(0, k).trim().toLowerCase(), value: t.slice(k + 1).trim() });
  };
  for (const ch of css) {
    if (ch === '{') {
      stack.push({ prelude: buf.trim(), decls: [] });
      buf = '';
    } else if (ch === '}') {
      flush();
      const b = stack.pop();
      if (b) blocks.push({ chain: [...stack.map((s) => s.prelude), b.prelude], decls: b.decls });
    } else if (ch === ';') flush();
    else buf += ch;
  }
  return blocks;
}

function stylesheets() {
  const out = filesIn('css', '.css').map((f) => ({ name: f, css: read(f) }));
  // stylesheets the modules inject themselves (const CSS = `...`)
  for (const f of MODULES) {
    for (const m of read(f).matchAll(/const (?:CSS|STYLE|css)\s*=\s*`([\s\S]*?)`;/g)) out.push({ name: f + ' (CSS)', css: m[1].replace(/\$\{[^}]*\}/g, 'x') });
  }
  return out;
}

const NEW_VIEWPORT = /\d(?:dvh|svh|lvh|dvw|svw|lvw|dvi|dvb|dvmin|dvmax|svmin|svmax|lvmin|lvmax)\b/;
// :has() is Safari 15.4 (and Chrome 105, Samsung 20): a rule that uses it is dropped there whole
const HAS_OK = new Set(['.c9-card:has(.c9do-card)']); // the to-do card is just narrower without it

test('the stylesheets keep working on Safari 15: fallbacks first, nothing it would drop whole', () => {
  const sheets = stylesheets();
  assert.ok(sheets.length >= 6, 'found the stylesheets');
  for (const { name, css } of sheets) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const banned = /@layer\b|@container\b|@scope\b|color-mix\(|light-dark\(|\boklch\(|\boklab\(/.exec(bare);
    assert.equal(banned, null, banned ? `${name} uses ${banned[0]} (Safari 15.4 or later): everything inside is ignored on iPadOS 15` : '');
    for (const { chain, decls } of cssBlocks(css)) {
      const where = name + ' ' + chain.join(' > ');
      const rules = chain.filter((p) => !p.startsWith('@') && !/^(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*$/.test(p));
      assert.ok(rules.length <= 1 && !rules.some((p) => p.includes('&')), where + ': nested CSS (Safari 16.5)');
      for (const p of chain) {
        if (p.startsWith('@media')) assert.ok(!/[<>]/.test(p), where + ': media range syntax (Safari 16.4)');
        if (!p.startsWith('@') && p.includes(':focus-visible')) {
          for (const part of p.split(',')) assert.ok(part.includes(':focus-visible'), where + ': :focus-visible (Safari 15.4) shares a selector list, so Safari 15 drops the whole rule');
        }
        if (!p.startsWith('@') && p.includes(':has(')) {
          for (const part of p.split(',')) assert.ok(!part.includes(':has(') || HAS_OK.has(part.trim()), where + ': :has() (Safari 15.4) drops the rule there');
        }
      }
      const guarded = chain.some((p) => p.startsWith('@supports') && /[dsl]v[hw]|[dsl]vmin|[dsl]vmax/.test(p));
      decls.forEach((d, i) => {
        const before = decls.slice(0, i).filter((e) => e.prop === d.prop);
        if (NEW_VIEWPORT.test(d.value) && !guarded) {
          assert.ok(before.some((e) => !NEW_VIEWPORT.test(e.value)), `${where}: ${d.prop}:${d.value} needs a vh fallback before it (dvh is Safari 15.4)`);
        }
        if (d.prop === 'overflow-wrap' && d.value === 'anywhere') {
          assert.ok(before.some((e) => e.value === 'break-word'), `${where}: overflow-wrap:anywhere needs overflow-wrap:break-word before it (Safari 15.4)`);
        }
      });
    }
  }
});
