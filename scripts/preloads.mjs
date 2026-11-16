// Keeps the "load these files up front" list in world/index.html in step with the code.
//
// The world is about fifty small files that import each other. Left alone, a phone finds them
// one layer at a time, which is slow on a weak signal. With the list, it asks for all of them
// at once. Nothing breaks if the list goes stale; the page just loads slower, and `npm test`
// says so.
//
//   node scripts/preloads.mjs           rewrite the list in world/index.html
//   node scripts/preloads.mjs --check   exit 1 if the list is out of date

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORLD_DIR = path.join(ROOT, 'world');
export const PAGE = path.join(WORLD_DIR, 'index.html');
const ENTRY = 'js/main.js';
const START = '<!-- modulepreload:start (written by "npm run preloads", not by hand) -->';
const END = '<!-- modulepreload:end -->';

const IMPORT_PATTERNS = [
  /\bimport\s+[^'"()]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bexport\s+[^'"()]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
];

function importsOf(file) {
  const code = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const found = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const m of code.matchAll(pattern)) found.push(m[1]);
  }
  return found;
}

/** Every file the entry module pulls in, nearest first, as paths relative to world/. */
export function moduleList() {
  const seen = new Set([ENTRY]);
  const queue = [ENTRY];
  const out = [];
  while (queue.length) {
    const rel = queue.shift();
    const abs = path.join(WORLD_DIR, rel);
    if (rel.endsWith('.min.js')) continue; // vendored bundles import nothing
    for (const spec of importsOf(abs)) {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (seen.has(next) || next.startsWith('..')) continue;
      if (!fs.existsSync(path.join(WORLD_DIR, next))) continue;
      seen.add(next);
      queue.push(next);
      out.push(next);
    }
  }
  // The 3D library is by far the biggest file, so it goes first.
  out.sort((a, b) => Number(b.includes('/three.')) - Number(a.includes('/three.')));
  return out;
}

export function preloadBlock(list = moduleList()) {
  return [START, ...list.map((href) => `<link rel="modulepreload" href="${href}">`), END].join('\n');
}

/** Returns the page text with a fresh list, or null when the markers are missing. */
export function withFreshList(html) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1 || b < a) return null;
  return html.slice(0, a) + preloadBlock() + html.slice(b + END.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const fresh = withFreshList(html);
  if (fresh == null) {
    console.error('world/index.html is missing the modulepreload markers.');
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    if (fresh !== html) {
      console.error('The preload list in world/index.html is out of date. Run: npm run preloads');
      process.exit(1);
    }
    console.log(`Preload list is up to date (${moduleList().length} files).`);
  } else if (fresh !== html) {
    fs.writeFileSync(PAGE, fresh);
    console.log(`Preload list rewritten (${moduleList().length} files).`);
  } else {
    console.log(`Preload list already up to date (${moduleList().length} files).`);
  }
}
