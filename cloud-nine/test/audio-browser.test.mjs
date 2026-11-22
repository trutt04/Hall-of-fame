// The audio engine in a real browser (headless Chromium through Playwright): every track and every
// sound effect rendered offline through the game's own mixer and measured, the loop seams, the
// melodies (pitch-detected), and the live API (unlock, beat clock, sound off, tab hidden).
// Skips itself when Playwright isn't installed, so `node --test` still runs everywhere.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { loadPlaywright, openPage, renderInPage, startServer } from './audio-harness.mjs';

const pw = loadPlaywright();
const skip = pw ? false : 'Playwright is not installed';
const CEILING_DB = -0.3;

let server = null;
let browser = null;
let page = null;
let errors = [];
let unavailable = null;

before(async () => {
  if (skip) return;
  server = await startServer();
  try {
    browser = await pw.chromium.launch();
  } catch (err) {
    unavailable = 'Chromium could not start: ' + String(err.message || err).split('\n')[0];
    return;
  }
  ({ page, errors } = await openPage(browser, server.base + '/cloud-nine/dev/audio-board.html'));
});

// Playwright can be installed without its browser; then every test here skips instead of failing.
const ready = (t) => {
  if (!unavailable) return true;
  t.skip(unavailable);
  return false;
};

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

const music = (id, opts) => renderInPage(page, server.base, id, opts);
const quietShare = (env, from = 0.1, to = Infinity, floor = -55) => {
  const w = env.slice(Math.ceil(from / 0.05), Number.isFinite(to) ? Math.floor(to / 0.05) : undefined);
  return w.filter((db) => db < floor).length / Math.max(1, w.length);
};

const TRACKS = {
  island: { seconds: 20, rms: [-24, -12] },
  game: { seconds: 15, rms: [-22, -11] },
  tense: { seconds: 15, rms: [-27, -14] },
  routine: { seconds: 15, rms: [-23, -11] },
  birthday: { seconds: 15, rms: [-23, -11] },
  victory: { seconds: 6.5, rms: [-23, -11], playing: 5.2 },
};

test('the sound board loads without console errors', { skip }, async (t) => {
  if (!ready(t)) return;
  assert.equal(await page.title(), 'Cloud Nine: sound board');
  assert.equal(await page.locator('.track').count(), 6);
  assert.equal(await page.locator('.sfx').count(), 31);
  assert.deepEqual(errors, []);
});

for (const [id, spec] of Object.entries(TRACKS)) {
  test(`track "${id}" renders clean: no NaN, under the ceiling, sensible level, never silent`, { skip }, async (t) => {
    if (!ready(t)) return;
    const r = await music(id, { seconds: spec.seconds });
    const info = `${id}: peak ${r.peakDb.toFixed(2)} dBFS, RMS ${r.rmsDb.toFixed(1)} dBFS, bands ${JSON.stringify(r.bands)}`;
    assert.equal(r.nan, 0, info);
    assert.equal(r.clipped, 0, info);
    assert.ok(r.peakDb <= CEILING_DB, 'too hot: ' + info);
    assert.ok(r.peakDb > -9, 'too quiet: ' + info);
    assert.ok(r.rmsDb >= spec.rms[0] && r.rmsDb <= spec.rms[1], 'level out of range: ' + info);
    assert.ok(Math.abs(r.dc) < 0.01, 'DC offset: ' + info);
    assert.ok(quietShare(r.env, 0.1, spec.playing ?? Infinity) < 0.02, 'silent gaps: ' + info);
    // a balanced spectrum: low end present but not swamping the tune, and some sparkle on top
    assert.ok(r.bands.sub <= -3, 'sub-bass dominates: ' + info);
    assert.ok(r.bands.mid >= -18, 'the tune is buried: ' + info);
    assert.ok(r.bands.presence >= -26 && r.bands.air >= -32, 'dull: ' + info);
    // beats arrive on the grid
    const spb = 60 / { island: 104, game: 128, tense: 108, routine: 144, birthday: 112, victory: 160 }[id];
    for (let i = 1; i < r.beats.length; i++) assert.ok(Math.abs(r.beats[i].at - r.beats[i - 1].at - spb) < 1e-6, id + ' beat ' + i);
    assert.deepEqual(r.beats.slice(0, 9).map((b) => b.count), [1, 2, 3, 4, 5, 6, 7, 8, 1].slice(0, Math.min(9, r.beats.length)));
  });
}

test('the routine ends on the final pose and rings out cleanly', { skip }, async (t) => {
  if (!ready(t)) return;
  const r = await music('routine', { from: 116, seconds: 8 });
  assert.equal(r.nan, 0);
  assert.ok(r.peakDb <= CEILING_DB);
  // the final hit lands on count 8 of the 36th eight (119.58 s), loud
  const hit = 119.583 - 116 + 0.05;
  const around = r.env.slice(Math.floor(hit / 0.05), Math.floor((hit + 0.4) / 0.05));
  assert.ok(Math.max(...around) > -20, 'no final hit');
  // three seconds of tail, then quiet: nothing left droning
  const tail = r.env.slice(-6);
  assert.ok(Math.max(...tail) < -50, 'still sounding at the end: ' + tail.map((x) => x.toFixed(0)));
});

for (const id of ['island', 'game', 'tense']) {
  test(`"${id}" loops without a seam`, { skip }, async (t) => {
    if (!ready(t)) return;
    const st = await page.evaluate(async ({ base, id }) => {
      const s = (await import(base + '/cloud-nine/js/audio/index.js')).trackStructure(id);
      return { duration: s.duration, loopStart: s.loopStart, sections: s.map((x) => ({ name: x.name, start: x.start })) };
    }, { base: server.base, id });
    const seam = st.duration; // the song wraps here to st.loopStart
    const r = await music(id, { from: seam - 4, seconds: 8, seam });
    const info = `${id} seam: ${JSON.stringify(r.seam)}`;
    assert.equal(r.nan, 0);
    assert.ok(r.seam.quietest > -45, 'a gap at the seam: ' + info);
    assert.ok(Math.abs(r.seam.before - r.seam.after) < 9, 'a level jump at the seam: ' + info);
    assert.ok(r.seam.click < 25, 'a click at the seam: ' + info);
    // the beat grid runs straight through the wrap, and the loop's first section follows
    const spb = r.beats[1].at - r.beats[0].at;
    for (let i = 1; i < r.beats.length; i++) assert.ok(Math.abs(r.beats[i].at - r.beats[i - 1].at - spb) < 1e-6);
    const loopFirst = st.sections.find((s) => Math.abs(s.start - st.loopStart) < 1e-6).name;
    const crossing = r.beats.findIndex((b) => b.section === loopFirst);
    assert.ok(crossing > 0, 'the loop did not come round: ' + r.beats.map((b) => b.section).join(','));
    assert.ok(r.beats.slice(0, crossing).every((b) => b.section === st.sections[st.sections.length - 1].name));
  });
}

const MELODIES = [
  ['island', 'lead', 27.75, 18], // the chorus
  ['island', 'lead2', 64.7, 18], // the bridge flute
  ['game', 'lead', 7.5, 15],
  ['tense', 'pizz', 4.45, 17],
  ['routine', 'lead', 6.7, 13],
  ['routine', 'lead', 106.7, 13], // the finale, after the key change
  ['birthday', 'box', 0, 21],
  ['birthday', 'lead', 21.4, 13],
  ['victory', 'brass', 0, 5],
];
for (const [id, part, from, seconds] of MELODIES) {
  test(`${id} ${part} from ${from} s plays the notes that were written`, { skip }, async (t) => {
    if (!ready(t)) return;
    const r = await music(id, { from, seconds, solo: [part], melody: part });
    const rows = r.melody;
    assert.ok(rows.length >= 8, 'too few notes measured');
    const exact = rows.filter((x) => x.got === x.want).length;
    const chroma = rows.filter((x) => x.got !== null && (((x.got - x.want) % 12) + 12) % 12 === 0).length;
    const info = `${id}/${part}: ${exact}/${rows.length} exact, ${chroma} right note name; misses ${rows.filter((x) => x.got !== x.want).map((x) => x.want + '->' + x.got).join(' ')}`;
    assert.ok(chroma / rows.length >= 0.92, info);
    assert.ok(exact / rows.length >= 0.88, info);
  });
}

test('every sound effect renders: audible, under the ceiling, no NaN, and it stops', { skip }, async (t) => {
  if (!ready(t)) return;
  const names = await page.evaluate(async (base) => (await import(base + '/cloud-nine/js/audio/sfx.js')).SFX_NAMES, server.base);
  assert.equal(names.length, 31);
  const report = [];
  for (const name of names) {
    for (const pitch of [1, 1.5]) {
      const r = await renderInPage(page, server.base, null, { sfx: name, seconds: 3.2, pitch });
      // how loud it is while it sounds (the 50 ms windows above -60 dB)
      const on = r.env.filter((db) => db > -60);
      const active = 10 * Math.log10(on.reduce((sum, db) => sum + 10 ** (db / 10), 0) / Math.max(1, on.length));
      const info = `${name} x${pitch}: peak ${r.peakDb.toFixed(1)} dBFS, active ${active.toFixed(1)} dB, ends ${r.end.toFixed(2)} s`;
      if (pitch === 1) report.push(info);
      // one family of sounds: nothing blasts, nothing whispers (footsteps are meant to be subtle)
      assert.ok(active <= -14 && active >= (name === 'step' ? -40 : -36), 'out of family: ' + info);
      assert.equal(r.nan, 0, info);
      assert.ok(r.peakDb <= CEILING_DB, 'too hot: ' + info);
      assert.ok(r.peakDb > -24, 'too quiet: ' + info);
      assert.ok(Math.max(...r.env) > -42, 'barely audible: ' + info);
      assert.ok(r.end > 0.05 && r.end < 3, 'bad length: ' + info);
      // nothing left humming at the end of the render
      assert.ok(Math.max(...r.env.slice(-4)) < -60, 'still sounding: ' + info);
    }
  }
  if (process.env.C9_AUDIO_VERBOSE) console.log(report.join('\n'));
});

test('effects duck the music a little, and spatial effects pan and fade with distance', { skip }, async (t) => {
  if (!ready(t)) return;
  const res = await page.evaluate(async (base) => {
    const R = await import(base + '/cloud-nine/js/audio/render.js');
    const A = await import(base + '/cloud-nine/js/audio/analysis.js');
    // The music alone vs the music with a referee's whistle (a 2.9 kHz tone). Below 400 Hz the
    // whistle adds nothing, so any change down there is the music being ducked.
    const plain = await R.renderMusic('island', { from: 28, seconds: 4 });
    const ducked = await R.renderMusic('island', { from: 28, seconds: 4, sfx: [{ name: 'whistle', at: 1.0 }] });
    const lowRms = (buf, a, b) => {
      const c = R.channelsOf(buf)[0];
      const k = 1 - Math.exp((-2 * Math.PI * 400) / buf.sampleRate);
      let y1 = 0;
      let y2 = 0;
      let s = 0;
      let n = 0;
      for (let i = 0; i < Math.floor(b * buf.sampleRate); i++) {
        y1 += k * (c[i] - y1);
        y2 += k * (y1 - y2);
        if (i >= Math.floor(a * buf.sampleRate)) {
          s += y2 * y2;
          n++;
        }
      }
      return 10 * Math.log10(s / n);
    };
    const duckDb = lowRms(ducked.buffer, 1.1, 1.3) - lowRms(plain.buffer, 1.1, 1.3);
    const recovered = lowRms(ducked.buffer, 3.4, 3.9) - lowRms(plain.buffer, 3.4, 3.9);
    // panning: an effect placed to the right is louder on the right
    const right = await R.renderSfx('chime', { pan: 0.8 });
    const [l, r] = R.channelsOf(right.buffer).map((c) => A.levels([c]).rmsDb);
    return { duckDb, recovered, lr: r - l };
  }, server.base);
  assert.ok(res.duckDb < -1 && res.duckDb > -6, 'duck depth ' + res.duckDb.toFixed(2) + ' dB');
  assert.ok(Math.abs(res.recovered) < 0.6, 'the music came back: ' + res.recovered.toFixed(2));
  assert.ok(res.lr > 6, 'pan ' + res.lr.toFixed(1));
});

test('the live API: silent until a tap, then music, beats, sound off, tab hidden, dispose', { skip }, async (t) => {
  if (!ready(t)) return;
  const base = server.base;
  await page.evaluate(async (base) => {
    localStorage.removeItem('c9.sound.v1');
    const { createAudio } = await import(base + '/cloud-nine/js/audio/index.js');
    const a = createAudio();
    window.__t = { a, beats: [], ends: [], sections: [] };
    a.beat.on('beat', (b) => window.__t.beats.push(b));
    a.beat.on('section', (s) => window.__t.sections.push(s.name));
    a.beat.on('end', (e) => window.__t.ends.push(e.id));
    const b = document.createElement('button');
    b.id = 'unlock-test';
    b.textContent = 'unlock';
    b.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:60px;z-index:9';
    b.onclick = () => a.unlock();
    document.body.appendChild(b);
  }, base);
  const before = await page.evaluate(() => {
    const { a } = window.__t;
    return { unlocked: a.unlocked, state: a.state, enabled: a.enabled, sfx: a.sfx('tap'), music: a.music('island'), playing: a.beat.playing, time: a.beat.time() };
  });
  assert.deepEqual(before, { unlocked: false, state: 'locked', enabled: true, sfx: false, music: false, playing: false, time: 0 });

  await page.click('#unlock-test');
  await page.waitForTimeout(2600);
  const on = await page.evaluate(() => {
    const { a, beats, sections } = window.__t;
    return {
      state: a.state, current: a.current, playing: a.beat.playing, bpm: a.beat.bpm, time: a.beat.time(), next: a.beat.nextBeatTime(),
      structure: a.beat.structure && a.beat.structure.id, beats: beats.map((b) => ({ n: b.n, count: b.count, eight: b.eight, time: b.time })), sections: sections.slice(),
      tap: a.sfx('tap'), unknown: a.sfx('kazoo'), spatial: (a.setListener(0, 0, 0), a.sfx('sparkle', { x: -5, z: 2, volume: 0.8, pitch: 1.2 })),
      far: a.sfx('chime', { x: 900, z: 0 }),
    };
  });
  assert.equal(on.state, 'running');
  assert.equal(on.current, 'island'); // asked for before the tap, started on it
  assert.equal(on.playing, true);
  assert.equal(on.bpm, 104);
  assert.equal(on.structure, 'island');
  assert.ok(on.time > 1.5 && on.time < 3, 'music time ' + on.time);
  assert.ok(on.next > on.time && on.next - on.time <= 60 / 104 + 1e-6);
  assert.ok(on.beats.length >= 3, 'beats ' + on.beats.length);
  on.beats.forEach((b, i) => {
    assert.equal(b.n, i);
    assert.equal(b.count, (i % 8) + 1);
    assert.equal(b.eight, Math.floor(i / 8) + 1);
    assert.ok(Math.abs(b.time - (i * 60) / 104) < 1e-9);
  });
  assert.deepEqual(on.sections, ['intro']);
  assert.equal(on.tap, true);
  assert.equal(on.unknown, false);
  assert.equal(on.spatial, true);
  assert.equal(on.far, false); // too far away to hear

  // the routine publishes its structure as the rhythm game reads it, and its beats start again
  // from its own first downbeat: n 0, count 1, eight 1, on the same clock as beat.time()
  const routine = await page.evaluate(() => {
    const { a } = window.__t;
    window.__t.beats.length = 0;
    a.music('routine', { fade: 0.2 });
    const st = a.beat.structure;
    return {
      current: a.current, bpm: a.beat.bpm, isArray: Array.isArray(st), eights: st.eights,
      shape: st.map((s) => [s.name, s.eights]), again: a.music('routine'),
    };
  });
  assert.deepEqual(routine, {
    current: 'routine', bpm: 144, isArray: true, eights: 36, again: true,
    shape: [['intro', 2], ['opening', 4], ['standing', 4], ['stunts', 6], ['pyramid', 4], ['jumps', 4], ['running', 4], ['dance', 4], ['finale', 4]],
  });
  await page.waitForTimeout(1300);
  const firstBeats = await page.evaluate(() => ({ beats: window.__t.beats.map((b) => [b.n, b.count, b.eight, b.time, b.section]), now: window.__t.a.beat.time() }));
  assert.deepEqual(firstBeats.beats[0], [0, 1, 1, 0, 'intro']);
  assert.deepEqual(firstBeats.beats[1], [1, 2, 1, 60 / 144, 'intro']);
  const lastSeen = firstBeats.beats[firstBeats.beats.length - 1][3];
  assert.ok(firstBeats.now >= lastSeen && firstBeats.now - lastSeen < 60 / 144 + 0.05, 'beat times and time() share a clock');

  // sound off: remembered, the context sleeps, the clock stops; a track asked for meanwhile waits
  await page.evaluate(() => {
    window.__t.a.setEnabled(false);
    window.__t.a.music('game');
  });
  await page.waitForTimeout(700);
  const off = await page.evaluate(() => ({ stored: localStorage.getItem('c9.sound.v1'), state: window.__t.a.state, playing: window.__t.a.beat.playing, current: window.__t.a.current, enabled: window.__t.a.enabled }));
  assert.deepEqual(off, { stored: '0', state: 'suspended', playing: false, current: null, enabled: false });
  await page.evaluate(() => window.__t.a.setEnabled(true));
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ stored: localStorage.getItem('c9.sound.v1'), state: window.__t.a.state, current: window.__t.a.current, bpm: window.__t.a.beat.bpm }));
  assert.deepEqual(back, { stored: '1', state: 'running', current: 'game', bpm: 128 });

  // a new page remembers "off"
  const remembered = await page.evaluate(async (base) => {
    localStorage.setItem('c9.sound.v1', '0');
    const { createAudio } = await import(base + '/cloud-nine/js/audio/index.js');
    const b = createAudio();
    const was = b.enabled;
    b.dispose();
    localStorage.setItem('c9.sound.v1', '1');
    return was;
  }, base);
  assert.equal(remembered, false);

  // the tab goes into the background: everything sleeps; it comes back where it was
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  const hidden = await page.evaluate(() => ({ state: window.__t.a.state, playing: window.__t.a.beat.playing }));
  assert.deepEqual(hidden, { state: 'suspended', playing: false });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => ({ state: window.__t.a.state, playing: window.__t.a.beat.playing, current: window.__t.a.current }));
  assert.deepEqual(shown, { state: 'running', playing: true, current: 'game' });

  // the victory sting plays out, then the world music it was asked for takes over
  await page.evaluate(() => {
    window.__t.a.music('victory', { fade: 0.2 });
    window.__t.a.music('island');
  });
  const during = await page.evaluate(() => window.__t.a.current);
  assert.equal(during, 'victory');
  await page.waitForTimeout(5600);
  const afterSting = await page.evaluate(() => ({ current: window.__t.a.current, ends: window.__t.ends.slice() }));
  assert.equal(afterSting.current, 'island');
  assert.deepEqual(afterSting.ends, ['victory']);

  await page.evaluate(() => window.__t.a.dispose());
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => ({ state: window.__t.a.state, sfx: window.__t.a.sfx('tap'), music: window.__t.a.music('game') }));
  assert.deepEqual(closed, { state: 'closed', sfx: false, music: false });
  assert.deepEqual(errors, []);
});
