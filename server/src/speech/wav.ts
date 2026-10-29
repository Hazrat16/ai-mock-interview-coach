// WAV header reading, shared by text-to-speech (Piper output) and speech-to-text (browser recordings).

export class InvalidWavError extends Error {}

export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; durationSec: number };

/** Reads the header of a PCM WAV file; throws if it is not one (e.g. an HTML error page). */
export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new InvalidWavError('not a WAV file');
  }
  // Walk the chunks: "fmt " has the format, "data" the samples.
  let offset = 12;
  let fmt: Omit<WavInfo, 'durationSec'> | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      if (buf.readUInt16LE(offset + 8) !== 1) throw new InvalidWavError('not PCM (only 16-bit PCM WAV is supported)');
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      if (!fmt) break;
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
      const dataBytes = Math.min(size, buf.length - offset - 8);
      return { ...fmt, durationSec: dataBytes / bytesPerSecond };
    }
    offset += 8 + size + (size % 2);
  }
  throw new InvalidWavError('incomplete WAV file');
}
