// Shared by the audio browser test (audio-browser.test.mjs) and the WAV render script
// (dev/audio-render.mjs): a tiny static server for the repo, and a headless Chromium page that can
// import Cloud Nine's modules. Not a test file itself (the runner only picks up *.test.mjs).
//
//   const server = await startServer()         -> { base, close() }   on 127.0.0.1, a free port
//   const pw = loadPlaywright()                 -> the playwright module, or null when it isn't installed
//   const { page, errors } = await openPage(browser, url)    errors collects console errors and page errors
//   await renderInPage(page, base, id, opts)    -> analysis of an offline render (see below)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function startServer(root = REPO) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    const file = path.join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

export function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch (err) {
    return null;
  }
}

export async function openPage(browser, url, { width = 1000, height = 800 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  return { page, errors };
}

// Render a track (or one effect) offline in the page and measure it there; only numbers come back.
//   opts: { seconds, from, solo, sfx: name (render an effect instead), wav: true (also return the
//           WAV as base64), melody: part (YIN on each of that part's notes), seam: song time to
//           inspect around (loop seams) }
export function renderInPage(page, base, id, opts = {}) {
  return page.evaluate(async ({ base, id, opts }) => {
    const R = await import(base + '/cloud-nine/js/audio/render.js');
    const A = await import(base + '/cloud-nine/js/audio/analysis.js');
    const T = await import(base + '/cloud-nine/js/audio/theory.js');
    const W = await import(base + '/cloud-nine/js/audio/wav.js');
    const r = opts.sfx
      ? await R.renderSfx(opts.sfx, { seconds: opts.seconds ?? 3, pitch: opts.pitch ?? 1 })
      : await R.renderMusic(id, { seconds: opts.seconds ?? 15, from: opts.from ?? 0, solo: opts.solo ?? null });
    const buffer = r.buffer;
    const sr = buffer.sampleRate;
    const ch = R.channelsOf(buffer);
    const mono = new Float32Array(ch[0].length);
    for (let i = 0; i < mono.length; i++) mono[i] = (ch[0][i] + ch[1][i]) / 2;
    const lv = A.levels(ch);
    const env = Array.from(A.rmsEnvelope(mono, sr, 0.05), (x) => (x > 0 ? 20 * Math.log10(x) : -200));
    const out = {
      peakDb: lv.peakDb,
      rmsDb: lv.rmsDb,
      nan: lv.nan,
      clipped: lv.clipped,
      dc: lv.dc,
      env,
      click: A.clickScore(mono, sr),
      bands: A.bands(A.spectrum(mono, sr, { size: 4096 })),
      seconds: mono.length / sr,
    };
    if (r.beats) out.beats = r.beats.map((b) => ({ n: b.n, count: b.count, eight: b.eight, at: b.at, section: b.section }));
    if (r.end !== undefined) out.end = r.end;
    if (opts.melody) {
      const rows = [];
      for (const n of r.notes) {
        if (n.part !== opts.melody || n.midi === undefined || n.dur < 0.1) continue;
        const a = Math.floor((n.at + 0.03) * sr);
        const len = Math.floor(Math.min(0.09, n.dur - 0.035) * sr);
        if (len < 1200 || a + len > mono.length) continue;
        const y = A.yin(mono.subarray(a, a + len), sr, { fmin: 70, fmax: 2500 });
        const got = y ? Math.round(T.freqToMidi(y.f0)) : null;
        rows.push({ at: n.at, want: n.midi, got });
      }
      out.melody = rows;
    }
    if (opts.seam !== undefined) {
      // around a loop seam: the RMS either side and the worst jump right at it
      const at = (opts.seam - (opts.from ?? 0)) + 0.05; // render time of the seam (renders start 50 ms in)
      const slice = (a, b) => mono.subarray(Math.max(0, Math.floor(a * sr)), Math.min(mono.length, Math.floor(b * sr)));
      const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
      out.seam = {
        before: 20 * Math.log10(rms(slice(at - 2, at)) + 1e-12),
        after: 20 * Math.log10(rms(slice(at, at + 2)) + 1e-12),
        click: A.clickScore(slice(at - 0.5, at + 0.5), sr),
        quietest: Math.min(...env.slice(Math.floor((at - 1) / 0.05), Math.floor((at + 1) / 0.05))),
      };
    }
    if (opts.wav) {
      const bytes = W.encodeWav(ch, sr);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.wav = btoa(bin);
    }
    return out;
  }, { base, id, opts });
}
