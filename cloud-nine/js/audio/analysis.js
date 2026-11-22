// Listening without ears: level, spectrum, pitch and click measurements on rendered audio. Pure
// (plain arrays in, numbers out), so it runs in node tests and in the browser on a render.
//
//   levels(channels) -> { peak, peakDb, rms, rmsDb, nan, clipped, dc }
//   rmsEnvelope(ch, sr, win = 0.05) -> Float32Array of RMS per window
//   spectrum(ch, sr, { size, from, to, maxFrames }) -> { freqs, power }   averaged Hann-windowed FFT
//   bands(spec, edges?) -> { sub, bass, lowmid, mid, presence, air } in dB (relative to the loudest band)
//   yin(frame, sr, { fmin, fmax, threshold }) -> { f0, clarity } | null    the YIN pitch detector
//   clickScore(ch, sr) -> the worst sample-to-sample jump, as a multiple of the local RMS
//   toDb(x)

export const toDb = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export function levels(channels) {
  let peak = 0;
  let sum = 0;
  let n = 0;
  let nan = 0;
  let clipped = 0;
  let dc = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += x * x;
      dc += x;
      n++;
    }
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  return { peak, peakDb: toDb(peak), rms, rmsDb: toDb(rms), nan, clipped, dc: n ? dc / n : 0 };
}

export function rmsEnvelope(ch, sr, win = 0.05) {
  const size = Math.max(1, Math.round(sr * win));
  const out = new Float32Array(Math.floor(ch.length / size));
  for (let w = 0; w < out.length; w++) {
    let s = 0;
    for (let i = w * size; i < (w + 1) * size; i++) s += ch[i] * ch[i];
    out[w] = Math.sqrt(s / size);
  }
  return out;
}

// in-place iterative radix-2 FFT; re and im have a power-of-two length
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function spectrum(ch, sr, { size = 4096, from = 0, to = null, maxFrames = 400 } = {}) {
  const start = Math.floor(from * sr);
  const stop = Math.min(ch.length, to === null ? ch.length : Math.floor(to * sr));
  const frames = Math.max(1, Math.floor((stop - start) / size));
  const step = Math.max(1, Math.floor(frames / maxFrames));
  const power = new Float64Array(size / 2);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  let used = 0;
  for (let f = 0; f < frames; f += step) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const off = start + f * size;
    if (off + size > ch.length) break;
    for (let i = 0; i < size; i++) re[i] = ch[off + i] * win[i];
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  if (used) for (let k = 0; k < power.length; k++) power[k] /= used;
  const freqs = new Float64Array(size / 2);
  for (let k = 0; k < freqs.length; k++) freqs[k] = (k * sr) / size;
  return { freqs, power };
}

export const BAND_EDGES = { sub: [20, 60], bass: [60, 250], lowmid: [250, 1000], mid: [1000, 4000], presence: [4000, 8000], air: [8000, 16000] };

export function bands({ freqs, power }, edges = BAND_EDGES) {
  const raw = {};
  for (const [name, [lo, hi]] of Object.entries(edges)) {
    let s = 0;
    for (let k = 0; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] < hi) s += power[k];
    raw[name] = s;
  }
  const top = Math.max(...Object.values(raw), 1e-30);
  const out = {};
  for (const [name, s] of Object.entries(raw)) out[name] = Math.round(10 * Math.log10(Math.max(s, 1e-30) / top) * 10) / 10;
  return out;
}

// YIN (de Cheveigne and Kawahara 2002): the cumulative mean normalized difference function,
// its first dip under the threshold, refined by parabolic interpolation.
export function yin(frame, sr, { fmin = 60, fmax = 2400, threshold = 0.15 } = {}) {
  const maxTau = Math.min(Math.floor(sr / fmin), Math.floor(frame.length / 2));
  const minTau = Math.max(2, Math.floor(sr / fmax));
  if (maxTau <= minTau + 2) return null;
  const W = frame.length - maxTau;
  const d = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = frame[i] - frame[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  const cm = new Float64Array(maxTau + 1);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau];
    cm[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tau = -1;
  for (let t = minTau; t < maxTau; t++) {
    if (cm[t] < threshold) {
      while (t + 1 < maxTau && cm[t + 1] < cm[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // nothing under the threshold: take the global minimum if it is convincing at all
    let best = minTau;
    for (let t = minTau; t < maxTau; t++) if (cm[t] < cm[best]) best = t;
    if (cm[best] > 0.35) return null;
    tau = best;
  }
  const a = cm[tau - 1];
  const b = cm[tau];
  const c = cm[tau + 1] ?? b;
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const t = tau + Math.max(-1, Math.min(1, shift));
  return { f0: sr / t, clarity: 1 - b };
}

export function clickScore(ch, sr, win = 0.01) {
  const size = Math.max(16, Math.round(sr * win));
  let worst = 0;
  for (let w = 1; w + 1 < Math.floor(ch.length / size); w++) {
    let s = 0;
    for (let i = (w - 1) * size; i < (w + 2) * size; i++) s += ch[i] * ch[i];
    const local = Math.sqrt(s / (3 * size));
    if (local < 1e-4) continue;
    let jump = 0;
    for (let i = w * size + 1; i < (w + 1) * size; i++) jump = Math.max(jump, Math.abs(ch[i] - ch[i - 1]));
    worst = Math.max(worst, jump / local);
  }
  return worst;
}
