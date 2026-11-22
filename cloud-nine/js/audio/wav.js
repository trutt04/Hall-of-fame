// 16-bit PCM WAV encoding. Pure: used by the sound board's "save a WAV" button and the render script.
//
//   encodeWav([left, right], sampleRate) -> Uint8Array (a complete .wav file)

export function encodeWav(channels, sampleRate) {
  const nch = channels.length;
  const frames = channels[0].length;
  const bytes = 44 + frames * nch * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, frames * nch * 2, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i] || 0));
      v.setInt16(o, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
