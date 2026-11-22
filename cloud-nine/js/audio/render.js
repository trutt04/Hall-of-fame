// Offline renders through the very same mixer, track player and effects the game uses: the tests
// measure them, the sound board saves them as WAVs. Browser only (OfflineAudioContext).
//
//   renderMusic(id, { seconds = 15, from = 0, sampleRate = 44100, seed = 1, solo, mute, sfx, hop = 0.05 })
//       -> { buffer, beats: [{ n, count, eight, at, section }], notes: [{ part, at, dur, midi, notes, vel }], structure }
//       `from` starts at that song time (seconds); solo/mute are part names; sfx: [{ name, at, pitch, volume, pan }]
//       Scheduling copies the live loop: the render pauses every `hop` seconds and schedules 100 ms ahead.
//   renderSfx(name, { seconds = 3, pitch, volume, pan, sampleRate, seed }) -> { buffer, end }
//   channelsOf(buffer) -> [left, right]

import { LOOKAHEAD, trackStructure } from './index.js';
import { createMixer } from './mixer.js';
import { createTrack } from './player.js';
import { triggerSfx } from './sfx.js';
import { SONGS } from './songs.js';
import { createKit } from './synth.js';

const START = 0.05; // a breath of silence before the first note

export function channelsOf(buffer) {
  const out = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

export async function renderMusic(id, { seconds = 15, from = 0, sampleRate = 44100, seed = 1, solo = null, mute = null, sfx = [], hop = 0.05 } = {}) {
  const song = SONGS[id];
  if (!song) throw new Error('no track "' + id + '"');
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const mixer = createMixer(ctx);
  mixer.out.gain.value = 1;
  mixer.setTempo(song.bpm);
  const kit = createKit(ctx, seed);
  const beats = [];
  const notes = [];
  let track = null;
  track = createTrack({
    ctx,
    mixer,
    kit,
    song,
    at: START,
    seed,
    from,
    solo,
    mute,
    onStep(step, when) {
      if (step.beat) beats.push({ ...step.beat, at: when, section: step.section });
      for (const ev of step.events) {
        notes.push({ part: ev.part, inst: ev.inst, at: when, dur: ev.len * track.stepDur, midi: ev.midi, notes: ev.notes, vel: ev.vel, section: step.section });
      }
    },
  });
  for (const s of sfx) triggerSfx(kit, mixer, s.name, s.at, { level: s.volume ?? 1, pan: s.pan ?? 0, pitch: s.pitch ?? 1 });
  track.scheduleUntil(LOOKAHEAD);
  for (let t = hop; t < seconds - hop; t += hop) {
    ctx.suspend(t).then(() => {
      track.scheduleUntil(ctx.currentTime + LOOKAHEAD);
      return ctx.resume();
    }).catch(() => {});
  }
  const buffer = await ctx.startRendering();
  return { buffer, beats, notes, structure: trackStructure(id), stepDur: track.stepDur, t0: track.t0 };
}

export async function renderSfx(name, { seconds = 3, pitch = 1, volume = 1, pan = 0, sampleRate = 44100, seed = 1 } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const mixer = createMixer(ctx);
  mixer.out.gain.value = 1;
  const kit = createKit(ctx, seed);
  const res = triggerSfx(kit, mixer, name, START, { level: volume, pan, pitch });
  const buffer = await ctx.startRendering();
  return { buffer, end: res ? res.end : 0 };
}
