// Deterministic mono PCM silence: valid browser audio, with no external fixture.
export function createWavFixture(byteLength = 16_044) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 44 || byteLength % 2) throw new Error('WAV byte length must be even and >= 44.');
  const bytes = new Uint8Array(byteLength), view = new DataView(bytes.buffer);
  const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, byteLength - 44, true);
  return bytes;
}
