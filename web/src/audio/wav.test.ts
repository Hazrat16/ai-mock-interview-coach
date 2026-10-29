import { describe, expect, it } from 'vitest';
import { parseWav } from '../../../server/src/speech/wav';
import { downsample, encodeWav, rms } from './wav';

const sine = (hz: number, rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit PCM file the server accepts', () => {
    const wav = Buffer.from(encodeWav(sine(440, 16000, 1.5)));
    expect(parseWav(wav)).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationSec: 1.5 });
  });

  it('stores samples as little-endian integers and clips out-of-range values', () => {
    const view = new DataView(encodeWav(Float32Array.from([0, 1, -1, 2, -3])));
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});

describe('downsample', () => {
  it('turns 48 kHz into 16 kHz with the same duration and keeps speech-band tones', () => {
    const out = downsample(sine(300, 48000, 1), 48000);
    expect(out.length).toBe(16000);
    expect(rms(out)).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it('handles 44.1 kHz (not a whole-number ratio)', () => {
    expect(downsample(sine(300, 44100, 2), 44100).length).toBe(32000);
  });

  it('removes most of a tone above the 8 kHz limit instead of folding it into speech', () => {
    expect(rms(downsample(sine(12000, 48000, 1), 48000))).toBeLessThan(0.01); // was 0.35
  });

  it('refuses to upsample', () => {
    expect(() => downsample(new Float32Array(10), 8000)).toThrow(/upsample/);
  });
});
