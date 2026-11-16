// Makes `npm test` (node --test scripts/test/) work on Node 21 and newer.
//
// Older Node treated a folder argument as "run every file in it". Newer Node tries to load
// the folder as a module, which means this index file. So: on newer Node, load every
// *.test.mjs file in this folder. On older Node do nothing, because the runner already runs
// each test file itself and loading them here too would run everything twice.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeMajor = Number(process.versions.node.split('.')[0]);

if (nodeMajor >= 21) {
  const files = readdirSync(here).filter((name) => /\.test\.(mjs|js|cjs)$/.test(name)).sort();
  for (const name of files) await import(pathToFileURL(path.join(here, name)).href);
}
