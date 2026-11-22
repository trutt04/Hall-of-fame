// The measuring tools the audio tests rely on (js/audio/analysis.js) and the WAV writer (js/audio/wav.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { bands, clickScore, fft, levels, rmsEnvelope, spectrum, toDb, yin } from '../js/audio/analysis.js';
import { encodeWav } from '../js/audio/wav.js';

const SR = 44100;
const tone = (f, secs, { type = 'sine', amp = 0.5 } = {}) => {
  const out = new Float32Array(Math.round(secs * SR));
  for (let i = 0; i < out.length; i++) {
    const ph = (f * i) / SR;
    out[i] = amp * (type === 'saw' ? 2 * (ph - Math.floor(ph + 0.5)) : Math.sin(2 * Math.PI * ph));
  }
  return out;
};

test('levels: peak, RMS, NaN and clip counts', () => {
  const s = tone(440, 1, { amp: 0.5 });
  const lv = levels([s, s]);
  assert.ok(Math.abs(lv.peak - 0.5) < 1e-3);
  assert.ok(Math.abs(lv.rms - 0.5 / Math.SQRT2) < 1e-3);
  assert.ok(Math.abs(lv.peakDb - toDb(lv.peak)) < 1e-9);
  assert.ok(Math.abs(lv.peakDb - toDb(0.5)) < 0.01);
  const bad = Float32Array.from([0, NaN, 1, -1, 0.2]);
  const lb = levels([bad]);
  assert.equal(lb.nan, 1);
  assert.equal(lb.clipped, 2);
});

test('YIN finds the pitch of sines and buzzy tones', () => {
  for (const f of [82.4, 196, 440, 1046.5]) {
    for (const type of ['sine', 'saw']) {
      const r = yin(tone(f, 0.08, { type }), SR, { fmin: 60, fmax: 2400 });
      assert.ok(r, `${type} ${f}`);
      assert.ok(Math.abs(r.f0 / f - 1) < 0.005, `${type} ${f} read as ${r.f0}`);
    }
  }
  assert.equal(yin(new Float32Array(4000), SR), null);
});

test('the FFT puts a sine in its bin, and bands sort energy by register', () => {
  const n = 1024;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
  fft(re, im);
  let best = 0;
  for (let k = 1; k < n / 2; k++) if (re[k] ** 2 + im[k] ** 2 > re[best] ** 2 + im[best] ** 2) best = k;
  assert.equal(best, 37);
  const low = bands(spectrum(tone(120, 1), SR));
  assert.equal(low.bass, 0);
  assert.ok(low.mid < -30);
  const high = bands(spectrum(tone(2000, 1), SR));
  assert.equal(high.mid, 0);
});

test('the click detector notices a discontinuity', () => {
  const s = tone(220, 0.5, { amp: 0.3 });
  const clean = clickScore(s, SR);
  s[10000] += 0.5;
  assert.ok(clickScore(s, SR) > clean * 3, 'a click should stand out');
  assert.equal(rmsEnvelope(new Float32Array(SR), SR, 0.05).length, 20);
});

test('WAV files have a correct header and 16-bit samples', () => {
  const l = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
  const r = new Float32Array(6);
  const wav = encodeWav([l, r], 22050);
  const v = new DataView(wav.buffer);
  const str = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint32(4, true), wav.length - 8);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 22050);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 6 * 2 * 2);
  assert.equal(v.getInt16(44 + 4, true), Math.round(0.5 * 32767));
  assert.equal(v.getInt16(44 + 8, true), Math.round(-0.5 * 32768));
  assert.equal(v.getInt16(44 + 20, true), 32767); // clamped
});
