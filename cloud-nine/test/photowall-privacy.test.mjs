// The photo wall's privacy promise, checked in the code: the photos (and their captions, their count,
// even whether there are any) never go over the network. The photo wall's modules don't import
// anything from js/net/ (not even through another module), never call fetch, XMLHttpRequest,
// sendBeacon, WebSocket or any other way out, never touch world.net, and never put text in as markup;
// the net never imports them. Also: the manager's and the viewer's words follow the house copy rules,
// and their stylesheet keeps text at 16px and up with big tap targets. (dev/photo-check.cjs proves
// the same in a real browser, with a room of two tabs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, normalize, relative } from 'node:path';
import { copyProblems } from './content-copy-rules.mjs';
import { MANAGER_TEXT, ADD_PROBLEMS } from '../js/ui/photo-manager.js';
import { VIEWER_TEXT } from '../js/ui/photo-viewer.js';
import { PROMPTS, NUDGE_LINE, WALL_TITLE } from '../js/world/photowall.js';
import { EMPTY_LINES } from '../js/art/photowall-art.js';
import { BEACON_KINDS } from '../js/world/beacons.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// Every module of the photo wall: the world part, its art, the store, and the two screens.
export const PHOTO_MODULES = ['js/world/photowall.js', 'js/art/photowall-art.js', 'js/core/photos.js', 'js/ui/photo-manager.js', 'js/ui/photo-viewer.js'];

// The code with comments blanked out (strings, templates and regex literals kept, line breaks kept),
// so a comment can say what the code never does. The same stripper as test/compat-rules.test.mjs.
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

// The modules a file imports (static and dynamic, string specifiers), as paths from cloud-nine/.
function importsOf(file) {
  const code = stripComments(read(file));
  const out = [];
  const re = /\bimport\s*(?:[\w${},*\s]+\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bexport\s+[\w${},*\s]+\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(re)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith('.')) {
      out.push(spec);
      continue;
    }
    out.push(relative(root, normalize(join(root, dirname(file), spec))).split('\\').join('/'));
  }
  return out;
}
function reachable(start) {
  const seen = new Set();
  const todo = [start];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!f.endsWith('.js') || !existsSync(join(root, f))) continue;
    for (const g of importsOf(f)) todo.push(g);
  }
  return seen;
}

test('no photo wall module reaches js/net/, directly or through another module', () => {
  for (const f of PHOTO_MODULES) assert.ok(existsSync(join(root, f)), f + ' exists');
  for (const f of PHOTO_MODULES) {
    for (const spec of importsOf(f)) {
      assert.ok(!/(^|\/)net\//.test(spec), f + ' imports ' + spec);
      assert.ok(!/^https?:|^\/\//.test(spec), f + ' loads code from the network: ' + spec);
    }
    for (const g of reachable(f)) assert.ok(!g.startsWith('js/net/'), f + ' reaches ' + g);
  }
  // and the other way round: the net knows nothing of the photos
  const net = readdirSync(join(root, 'js/net')).filter((n) => n.endsWith('.js')).map((n) => 'js/net/' + n);
  assert.ok(net.length >= 5);
  for (const f of net) {
    for (const g of reachable(f)) assert.ok(!PHOTO_MODULES.includes(g) && !/photo/i.test(g), f + ' reaches ' + g);
  }
});

// Every way a page can send something out, and touching the game's net at all.
const WAYS_OUT = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bRTCPeerConnection\b|\bRTCDataChannel\b/, 'WebRTC'],
  [/\bBroadcastChannel\b/, 'BroadcastChannel (the local rooms talk over it)'],
  [/\.postMessage\s*\(/, 'postMessage'],
  [/\bnew\s+(?:Shared)?Worker\b|\bimportScripts\b|\bserviceWorker\b/, 'a worker'],
  [/\bnavigator\.share\b|\bcanShare\b/, 'the share sheet'],
  [/\bwindow\.open\s*\(|\blocation\.(?:href|assign|replace)\b|\bhistory\.(?:pushState|replaceState)\b/, 'a page, a link or the address bar'],
  [/\.net\b|\bnet\s*\.|\bnet\s*[,)}]|['"]net['"]|\bcreateNet\b/, 'the game\'s net (world.net)'],
  [/\bsendState\b|\bupdateMe\b|\bsetGame\b|\.send\s*\(/, 'a net call'],
  [/\.(?:innerHTML|outerHTML)\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\bDOMParser\b|\bcreateContextualFragment\b/, 'text put in as markup'],
  [/\.src\s*=\s*['"`]https?:|\.href\s*=/, 'an address'],
];

test('the photo wall never calls a way out of the device, never touches the net, never writes markup', () => {
  for (const f of PHOTO_MODULES) {
    const code = stripComments(read(f));
    for (const [re, what] of WAYS_OUT) {
      const m = new RegExp(re.source, 'g').exec(code);
      assert.equal(m, null, m ? f + ':' + lineOf(code, m.index) + ' uses ' + what + ': "' + code.slice(m.index, m.index + 50).trim() + '"' : '');
    }
  }
  // the photos only ever become blob: URLs for an <img> on this device, and those are given back
  for (const f of ['js/ui/photo-manager.js', 'js/ui/photo-viewer.js']) {
    const code = stripComments(read(f));
    assert.ok(/URL\.createObjectURL/.test(code) && /URL\.revokeObjectURL/.test(code), f + ' gives its blob URLs back');
  }
  // the decoded pictures painted on the wall are let go
  assert.ok(/\.close\(\)/.test(stripComments(read('js/world/photowall.js'))), 'ImageBitmaps are closed');
});

test('main.js gives the photo wall nothing of the net, and the net nothing of the photo wall', () => {
  const code = stripComments(read('js/main.js'));
  const start = code.indexOf("optional('./world/photowall.js')");
  assert.ok(start > 0, 'main.js loads the photo wall lazily');
  const install = code.slice(start, code.indexOf('function closePhotoWall', start));
  assert.ok(!/\bnet\b/.test(install), 'nothing of the net goes into installPhotoWall');
  // no net call anywhere mentions the photo wall
  for (const m of code.matchAll(/\bnet\.(?:send|sendState|sendStateFor|setGame|updateMe|createRoom|joinRoom)\s*\(([^;]*)/g)) {
    assert.ok(!/photo/i.test(m[1]), 'a net call carries something of the photos: ' + m[0].slice(0, 80));
  }
});

test('the photo wall\'s words follow the house rules', () => {
  const words = [];
  const add = (label, v) => {
    if (typeof v === 'string') words.push([label, v]);
    else if (typeof v === 'function') {
      // the counts take numbers, the rest a name or a device
      if (v.length === 2) words.push([label, v(2, 5)], [label + '(1, 1)', v(1, 1)]);
      else if (/tip|from|birthday/.test(label)) words.push([label, v('iPad')], [label + '(Zuzu)', v('Zuzu')], [label + '()', v('')]);
      else words.push([label, v(1)], [label + '(3)', v(3)]);
    }
    else if (Array.isArray(v)) v.forEach((x, i) => add(label + i, x));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) add(label + '.' + k, v[k]);
  };
  add('manager', MANAGER_TEXT);
  add('problems', ADD_PROBLEMS);
  add('viewer', VIEWER_TEXT);
  add('prompts', PROMPTS);
  add('nudge', NUDGE_LINE);
  add('title', WALL_TITLE);
  add('empty', EMPTY_LINES);
  add('beacon', BEACON_KINDS.find((k) => k.id === 'photoWall').label);
  const problems = [];
  for (const [label, text] of words) problems.push(...copyProblems(text, label, { max: 280 }));
  assert.deepEqual(problems, []);
  // the promise is said plainly where she adds photos
  assert.equal(MANAGER_TEXT.privacy, "Photos stay on this device. They're never uploaded, and no one in a room can see them.");
  assert.equal(MANAGER_TEXT.removeWhy, 'It stays in your camera roll.');
  assert.equal(ADD_PROBLEMS.decode, "That photo didn't open here. Try a JPG or PNG.");
});

// every px value a font-size can come out at its smallest (as test/mobile-rules.test.mjs reads them)
function smallestFontSizes(css) {
  const out = [];
  const re = /font-size\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(css))) {
    const v = m[1].trim();
    const clamp = /^clamp\(\s*([\d.]+)px/.exec(v);
    const px = /^([\d.]+)px$/.exec(v);
    if (clamp) out.push({ v, px: Number(clamp[1]), at: m.index });
    else if (px) out.push({ v, px: Number(px[1]), at: m.index });
    else out.push({ v, px: NaN, at: m.index });
  }
  return out;
}

test('the manager and the viewer: text 16px and up, buttons 48px and up, safe areas kept', () => {
  const css = read('css/photowall.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const sizes = smallestFontSizes(css);
  assert.ok(sizes.length > 20);
  for (const f of sizes) assert.ok(f.px >= 16, 'font-size ' + f.v + ' near "' + css.slice(Math.max(0, f.at - 60), f.at).split('\n').pop() + '"');
  // the things she taps
  for (const sel of ['.c9pw-x', '.c9pw-chip', '.c9pw-tool', '.c9pw-cap', '.c9pw-clear', '.c9pv-edge', '.c9pw-tile']) {
    const block = new RegExp('(?:^|[}\\s,])' + sel.replace('.', '\\.') + '[,{][^}]*\\}').exec(css) || new RegExp(sel.replace('.', '\\.') + '\\{[^}]*\\}').exec(css);
    assert.ok(block, sel + ' is styled');
    const h = /(?:min-height|height)\s*:\s*([\d.]+)px/.exec(block[0]);
    assert.ok(h && Number(h[1]) >= 48, sel + ' is at least 48px tall (' + (h && h[1]) + ')');
  }
  for (const inset of ['--sab', '--sat', '--sal', '--sar']) assert.ok(css.includes('var(' + inset + ')'), 'keeps to the safe area: ' + inset);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media \(orientation:landscape\) and \(max-height:520px\)/, 'a layout for a phone on its side');
});
