#!/usr/bin/env node
// Render Cloud Nine's music to WAV files in headless Chromium, through the game's own engine (the
// same mixer, limiter and scheduler), and print each render's level and spectrum.
//
//   node cloud-nine/dev/audio-render.mjs [--out DIR] [--seconds 20] [--from 0] [track ...]
//
// Tracks default to island, routine and birthday; files go to DIR (default: the system temp
// folder, never the repo). Needs Playwright with Chromium. Audio files are never committed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPlaywright, openPage, renderInPage, startServer } from '../test/audio-harness.mjs';

const args = process.argv.slice(2);
let out = path.join(os.tmpdir(), 'cloud-nine-audio');
let seconds = 20;
let from = 0;
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--seconds') seconds = Number(args[++i]);
  else if (args[i] === '--from') from = Number(args[++i]);
  else ids.push(args[i]);
}
if (!ids.length) ids.push('island', 'routine', 'birthday');

const pw = loadPlaywright();
if (!pw) {
  console.error('Playwright is not installed.');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const server = await startServer();
const browser = await pw.chromium.launch();
try {
  const { page, errors } = await openPage(browser, server.base + '/cloud-nine/dev/audio-board.html');
  for (const id of ids) {
    const r = await renderInPage(page, server.base, id, { seconds, from, wav: true });
    const file = path.join(out, `cloud-nine-${id}${from ? '-from' + from + 's' : ''}-${seconds}s.wav`);
    fs.writeFileSync(file, Buffer.from(r.wav, 'base64'));
    console.log(`${file}\n  peak ${r.peakDb.toFixed(2)} dBFS, RMS ${r.rmsDb.toFixed(1)} dBFS, bands (dB) ${JSON.stringify(r.bands)}`);
  }
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server.close();
}
