// The Cloud Nine sound board: every track and sound effect, the eight-count beat clock, a spatial
// pad for panning and distance, and offline WAV renders through the same engine. A dev page:
// open cloud-nine/dev/audio-board.html. Tests reach the audio object at window.__audioBoard.audio.

import { MUSIC_IDS, SFX_NAMES, SONGS, createAudio, trackStructure } from '../js/audio/index.js';
import { bands, levels, spectrum } from '../js/audio/analysis.js';
import { channelsOf, renderMusic } from '../js/audio/render.js';
import { encodeWav } from '../js/audio/wav.js';

const $ = (id) => document.getElementById(id);
const audio = createAudio();
window.__audioBoard = { audio, beats: 0, sections: [] };

const TRACK_INFO = {
  island: { emoji: '🏝️', name: 'Sky Island', key: 'F major' },
  game: { emoji: '⚡', name: 'Game On', key: 'E minor' },
  tense: { emoji: '🙈', name: 'Ready Or Not', key: 'D minor' },
  routine: { emoji: '📣', name: 'Hit Zero', key: 'D → E major' },
  birthday: { emoji: '🎂', name: 'Happy Birthday', key: 'C → D major' },
  victory: { emoji: '🏆', name: 'Victory', key: 'C major' },
};
const SFX_EMOJI = {
  tap: '👆', open: '📂', close: '📁', toss: '🚀', whoosh: '💨', sparkle: '✨', land: '☁️', cradle: '🤲',
  cheer: '🙌', crowd: '🏟️', clap: '👏', whistle: '🏁', count: '3️⃣', go: '🟢', bounce: '🏀', throw: '🤾',
  hit: '💥', catch: '🧤', pop: '🫧', found: '👀', freeze: '🧊', unfreeze: '🌞', bowGrab: '🎀', score: '⭐',
  tada: '🎉', aww: '🥰', firework: '🎆', chime: '🔔', step: '👣', jump: '🦘', poms: '🎊',
};
const fmt = (s) => {
  const t = Math.max(0, s);
  return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') + '.' + Math.floor((t % 1) * 10);
};

// ---------------------------------------------------------------- sound on / off
function refreshPower() {
  const b = $('power');
  b.classList.toggle('waiting', !audio.unlocked);
  b.classList.toggle('off', audio.unlocked && !audio.enabled);
  b.textContent = !audio.unlocked ? '🔈 Tap for sound' : audio.enabled ? '🔊 Sound on' : '🔇 Sound off';
  b.setAttribute('aria-pressed', String(audio.unlocked && audio.enabled));
}
$('power').addEventListener('click', () => {
  if (!audio.unlocked) {
    audio.unlock();
    if (!audio.enabled) audio.setEnabled(true);
  } else {
    audio.setEnabled(!audio.enabled);
  }
  refreshPower();
});
// any first tap anywhere unlocks too, like the game will (the power button handles its own taps,
// or this would unlock on pointerdown and its click would then switch the sound straight off)
function firstTap(e) {
  if (e.target && e.target.closest && e.target.closest('#power')) return;
  window.removeEventListener('pointerdown', firstTap, true);
  if (!audio.unlocked) {
    audio.unlock();
    refreshPower();
  }
}
window.addEventListener('pointerdown', firstTap, true);
audio.on('change', refreshPower);

// ---------------------------------------------------------------- music
function trackButtons() {
  const box = $('tracks');
  for (const id of MUSIC_IDS) {
    const info = TRACK_INFO[id];
    const st = trackStructure(id);
    const b = document.createElement('button');
    b.className = 'track';
    b.dataset.track = id;
    const len = st.loop ? 'loops every ' + Math.round(st.duration - st.loopStart) + ' s' : Math.round((st.duration + st.tail) * 10) / 10 + ' s';
    b.innerHTML = `<span class="emoji">${info.emoji}</span><span class="name">${info.name}</span><span class="meta">${SONGS[id].bpm} BPM · ${info.key}<br>${len}</span>`;
    b.addEventListener('click', () => {
      if (!audio.unlocked) audio.unlock();
      audio.music(id, { fade: Number($('fade').value) });
      refreshPower();
    });
    box.appendChild(b);
  }
}
$('stop').addEventListener('click', () => audio.music(null, { fade: Number($('fade').value) }));
$('fade').addEventListener('input', () => { $('fade-out').textContent = Number($('fade').value).toFixed(1) + ' s'; });

function markPlaying() {
  for (const b of document.querySelectorAll('.track')) b.classList.toggle('playing', b.dataset.track === audio.current);
}
audio.on('track', () => {
  markPlaying();
  buildTimeline();
});

// ---------------------------------------------------------------- the eight-count
const dots = [];
for (let i = 1; i <= 8; i++) {
  const d = document.createElement('div');
  d.className = 'dot' + (i === 1 || i === 5 ? ' big' : '');
  d.textContent = String(i);
  $('counts').appendChild(d);
  dots.push(d);
}
let lastBeat = null;
audio.beat.on('beat', (b) => {
  window.__audioBoard.beats++;
  lastBeat = b;
  dots.forEach((d, i) => {
    d.classList.toggle('on', i === b.count - 1);
    d.classList.toggle('done', i < b.count - 1);
  });
});
audio.beat.on('section', (s) => {
  window.__audioBoard.sections.push(s.name);
  $('section').textContent = s.title;
});
audio.beat.on('end', () => {
  dots.forEach((d) => d.classList.remove('on', 'done'));
  $('section').textContent = 'The end!';
});

const SECTION_COLORS = ['#ff2e93', '#a96bff', '#ff7ad1', '#7b5cff', '#ff8cc6', '#b89cf0', '#ff5fae', '#8f6bff', '#e64fb0'];
let timelineFor = null;
function buildTimeline() {
  const st = audio.beat.structure;
  const box = $('timeline');
  if (timelineFor === (st && st.id)) return;
  timelineFor = st && st.id;
  for (const seg of [...box.querySelectorAll('.seg')]) seg.remove();
  if (!st) return;
  st.forEach((s, i) => {
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.flex = String(s.end - s.start);
    seg.style.background = SECTION_COLORS[i % SECTION_COLORS.length];
    seg.style.opacity = String(0.55 + 0.45 * s.energy);
    seg.title = `${s.title}: eight ${s.firstEight}, ${s.eights} eights`;
    seg.innerHTML = `<span>${s.title}</span>`;
    box.insertBefore(seg, $('playhead'));
  });
}

// ---------------------------------------------------------------- spectrum and playhead
const scope = $('scope');
const sctx = scope.getContext('2d');
let bins = null;
function frame() {
  requestAnimationFrame(frame);
  const st = audio.beat.structure;
  if (st && audio.beat.playing) {
    let t = audio.beat.time();
    if (st.loop && t > st.duration) t = st.loopStart + ((t - st.loopStart) % (st.duration - st.loopStart));
    $('playhead').style.left = Math.max(0, Math.min(100, (t / st.duration) * 100)) + '%';
    const eight = lastBeat ? lastBeat.eight : 1;
    const next = Math.max(0, (audio.beat.nextBeatTime() - audio.beat.time()) * 1000);
    $('clock').textContent = `${fmt(audio.beat.time())} · eight ${eight} · ${audio.beat.bpm} BPM · next beat in ${next.toFixed(0)} ms`;
  } else {
    $('clock').textContent = audio.unlocked ? 'quiet' : 'sound starts on your first tap';
  }
  const an = audio.unlocked ? audio.analyser() : null;
  if (an && an.maxDecibels !== -22) {
    an.minDecibels = -88;
    an.maxDecibels = -22;
  }
  const w = scope.width;
  const h = scope.height;
  sctx.clearRect(0, 0, w, h);
  if (!an) return;
  if (!bins || bins.length !== an.frequencyBinCount) bins = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(bins);
  const n = 64;
  const bw = w / n;
  const grad = sctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#a96bff');
  grad.addColorStop(1, '#ff7ad1');
  sctx.fillStyle = grad;
  for (let i = 0; i < n; i++) {
    // log-spaced bars from about 40 Hz to 16 kHz
    const f0 = 40 * Math.pow(400, i / n);
    const f1 = 40 * Math.pow(400, (i + 1) / n);
    const k0 = Math.floor((f0 / (an.context.sampleRate / 2)) * bins.length);
    const k1 = Math.max(k0 + 1, Math.floor((f1 / (an.context.sampleRate / 2)) * bins.length));
    let v = 0;
    for (let k = k0; k < k1 && k < bins.length; k++) v = Math.max(v, bins[k]);
    const bh = (v / 255) * (h - 6);
    sctx.fillRect(i * bw + 2, h - bh, bw - 4, bh);
  }
}

// ---------------------------------------------------------------- sound effects
const pad = $('pad');
const pctx = pad.getContext('2d');
const PAD_METERS = 22; // edge of the map
let source = null; // { x, z } in meters, or null for "right here"
audio.setListener(0, 0, 0); // at the origin, facing +Z: the top of the map

function drawPad() {
  const s = pad.width;
  const c = s / 2;
  const k = c / PAD_METERS;
  pctx.clearRect(0, 0, s, s);
  pctx.lineWidth = 2;
  for (const r of [5, 10, 20]) {
    pctx.strokeStyle = '#e1d1f0';
    pctx.beginPath();
    pctx.arc(c, c, r * k, 0, Math.PI * 2);
    pctx.stroke();
    pctx.fillStyle = '#b3a5c2';
    pctx.font = '600 22px ui-rounded, system-ui, sans-serif';
    pctx.fillText(r + ' m', c + 4, c - r * k + 22);
  }
  // the listener: a triangle facing up (forward)
  pctx.fillStyle = '#2b2233';
  pctx.beginPath();
  pctx.moveTo(c, c - 18);
  pctx.lineTo(c - 13, c + 12);
  pctx.lineTo(c + 13, c + 12);
  pctx.closePath();
  pctx.fill();
  if (source) {
    // right on the map is the listener's right, which is -X in the world when facing +Z
    const px = c - source.x * k;
    const py = c - source.z * k;
    pctx.fillStyle = '#ff2e93';
    pctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 9 : 22;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      pctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
    }
    pctx.closePath();
    pctx.fill();
  }
}
pad.addEventListener('pointerdown', (e) => {
  const r = pad.getBoundingClientRect();
  const c = r.width / 2;
  const mx = ((e.clientX - r.left - c) / c) * PAD_METERS; // meters to the listener's right
  const mz = ((c - (e.clientY - r.top)) / c) * PAD_METERS; // meters ahead
  source = Math.hypot(mx, mz) < 1.5 ? null : { x: -mx, z: mz };
  $('pad-help').textContent = source
    ? `Sounds now come from ${Math.hypot(mx, mz).toFixed(1)} m away, ${mx > 0.5 ? 'on your right' : mx < -0.5 ? 'on your left' : 'straight ' + (mz > 0 ? 'ahead' : 'behind')}. Tap the middle to bring them back.`
    : "Tap the map to put the sounds somewhere around you: you're in the middle, facing up. The rings are 5, 10 and 20 meters.";
  drawPad();
});

function sfxButtons() {
  const box = $('sfx');
  for (const name of SFX_NAMES) {
    const b = document.createElement('button');
    b.className = 'sfx';
    b.dataset.sfx = name;
    b.innerHTML = `<span class="emoji">${SFX_EMOJI[name] || '🔊'}</span><span>${name}</span>`;
    b.addEventListener('click', () => {
      if (!audio.unlocked) {
        audio.unlock();
        refreshPower();
      }
      const opts = { volume: Number($('vol').value), pitch: Number($('pitch').value) };
      if (source) Object.assign(opts, source);
      // a freshly unlocked context may need a moment to start running
      const play = () => audio.sfx(name, opts);
      if (!play()) setTimeout(play, 120);
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 220);
    });
    box.appendChild(b);
  }
}
for (const [id, out, digits] of [['vol', 'vol-out', 2], ['pitch', 'pitch-out', 2]]) {
  $(id).addEventListener('input', () => { $(out).textContent = Number($(id).value).toFixed(digits); });
}

// ---------------------------------------------------------------- offline render
for (const id of MUSIC_IDS) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = TRACK_INFO[id].name;
  $('rtrack').appendChild(o);
}
let lastUrl = null;
$('rgo').addEventListener('click', async () => {
  const id = $('rtrack').value;
  const secs = Math.max(2, Math.min(130, Number($('rsecs').value) || 20));
  $('rgo').disabled = true;
  $('rstats').textContent = 'Rendering…';
  const t0 = performance.now();
  try {
    const { buffer } = await renderMusic(id, { seconds: secs });
    const ch = channelsOf(buffer);
    const lv = levels(ch);
    const mono = new Float32Array(ch[0].length);
    for (let i = 0; i < mono.length; i++) mono[i] = (ch[0][i] + ch[1][i]) / 2;
    const b = bands(spectrum(mono, buffer.sampleRate));
    const wav = encodeWav(ch, buffer.sampleRate);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    $('rplay').src = lastUrl;
    $('rplay').hidden = false;
    $('rdl').href = lastUrl;
    $('rdl').download = `cloud-nine-${id}-${secs}s.wav`;
    $('rdl').hidden = false;
    $('rstats').textContent = `${TRACK_INFO[id].name}: ${secs} s in ${Math.round(performance.now() - t0)} ms\n`
      + `peak ${lv.peakDb.toFixed(2)} dBFS · RMS ${lv.rmsDb.toFixed(1)} dBFS · ${lv.nan} NaN\n`
      + 'bands (dB): ' + Object.entries(b).map(([k, v]) => `${k} ${v}`).join(' · ');
  } catch (err) {
    $('rstats').textContent = 'Render failed: ' + err.message;
  } finally {
    $('rgo').disabled = false;
  }
});

// ---------------------------------------------------------------- status line
function status() {
  const ctx = audio.context;
  const lat = ctx ? ` · latency ${Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000)} ms · ${ctx.sampleRate} Hz` : '';
  $('status').textContent = `audio ${audio.state} · ${audio.enabled ? 'sound on' : 'sound off'} (remembered) · track ${audio.current || 'none'}${lat}`;
  markPlaying();
}
setInterval(status, 500);

trackButtons();
sfxButtons();
drawPad();
refreshPower();
status();
requestAnimationFrame(frame);
