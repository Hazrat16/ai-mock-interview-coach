// Recording quality numbers for the STT benchmark: loudness, noise, and how the energy is spread over
// frequencies. For comparing microphones and settings with each other; there is no fixed "good" value
// (M6: laptop-mic recordings with ~1% above 2 kHz still reached 9.9% WER).

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(angle * k);
        const s = Math.sin(angle * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * c - im[b]! * s;
        const xi = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -120);

export type AudioStats = {
  speechDb: number;
  snrDb: number;
  /** Percent of speech energy below 300 Hz (rumble). Piper's synthetic voice: ~12%. */
  lowPct: number;
  /** Percent of speech energy above 2 kHz (consonants). Piper: ~9.5%; this laptop's mic: ~1%. */
  treblePct: number;
};

/** For 16-bit PCM mono WAV with a 44-byte header (what the app records). */
export function audioStats(wav: Buffer): AudioStats {
  const rate = wav.readUInt32LE(24);
  const x = Float64Array.from({ length: (wav.length - 44) / 2 }, (_, i) => wav.readInt16LE(44 + i * 2) / 32768);
  const frame = Math.round(rate * 0.02);
  const levels: number[] = [];
  for (let i = 0; i + frame <= x.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += x[j]! ** 2;
    levels.push(Math.sqrt(sum / frame));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const speech = sorted[Math.floor(sorted.length * 0.9)] ?? 0;

  const N = 512;
  const power = new Float64Array(N / 2);
  for (let i = 0; i + N <= x.length; i += N / 2) {
    let e = 0;
    for (let j = i; j < i + N; j++) e += x[j]! ** 2;
    if (Math.sqrt(e / N) < speech * 0.3) continue; // speech frames only
    const re = Float64Array.from({ length: N }, (_, j) => x[i + j]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N)));
    const im = new Float64Array(N);
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] = power[k]! + re[k]! ** 2 + im[k]! ** 2;
  }
  const share = (lo: number, hi: number) => {
    let total = 0;
    let band = 0;
    for (let k = 1; k < N / 2; k++) {
      const hz = (k * rate) / N;
      if (hz < 80) continue;
      total += power[k]!;
      if (hz >= lo && hz < hi) band += power[k]!;
    }
    return total ? (100 * band) / total : 0;
  };
  return {
    speechDb: db(speech),
    snrDb: db(speech) - db(noise),
    lowPct: share(80, 300),
    treblePct: share(2000, rate / 2),
  };
}
