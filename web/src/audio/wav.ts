// Audio for Whisper: 16 kHz, mono, 16-bit PCM WAV. Browsers record at 44.1 or 48 kHz, so we downsample here
// (Firefox cannot connect a microphone to an AudioContext running at a different rate).

export const STT_SAMPLE_RATE = 16000;

const TAPS = 63;
const filters = new Map<string, Float32Array>();

/** Low-pass filter (Hamming-windowed sinc) with its cutoff at 90% of the output's Nyquist frequency. */
function lowPass(fromRate: number, toRate: number): Float32Array {
  const key = `${fromRate}/${toRate}`;
  const cached = filters.get(key);
  if (cached) return cached;
  const cutoff = (0.45 * toRate) / fromRate; // cycles per input sample
  const half = (TAPS - 1) / 2;
  const taps = new Float32Array(TAPS);
  let sum = 0;
  for (let k = 0; k < TAPS; k++) {
    const n = k - half;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    taps[k] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (TAPS - 1)));
    sum += taps[k]!;
  }
  for (let k = 0; k < TAPS; k++) taps[k] = taps[k]! / sum; // unity gain for speech frequencies
  filters.set(key, taps);
  return taps;
}

/** Filters out what 16 kHz cannot represent (it would fold back as noise), then keeps every n-th sample. */
export function downsample(input: Float32Array, fromRate: number, toRate = STT_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new Error(`Cannot upsample ${fromRate} Hz to ${toRate} Hz`);
  const ratio = fromRate / toRate;
  const taps = lowPass(fromRate, toRate);
  const half = (TAPS - 1) / 2;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const center = Math.round(i * ratio);
    let acc = 0;
    for (let k = 0; k < TAPS; k++) {
      const j = center + k - half;
      if (j >= 0 && j < input.length) acc += input[j]! * taps[k]!;
    }
    out[i] = acc;
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate = STT_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!)); // clip instead of wrapping around
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Loudness 0..1 (root mean square), for the level meter. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
