import type { Settings } from '@shared/schemas/settings';
import type { PhraseCache } from './phraseCache';
import type { PiperClient } from './ttsClient';

export type Spoken = { wav: Buffer; cached: boolean; ms: number };

/** Speech rate (1 = normal, higher = faster) to Piper's length scale (higher = slower). */
export const lengthScaleFor = (rate: number) => Math.round((1 / rate) * 1000) / 1000;

export class TextToSpeech {
  constructor(
    private readonly piper: PiperClient,
    private readonly cache: PhraseCache,
    private readonly settings: () => Settings,
  ) {}

  async speak(text: string, overrides: { voice?: Settings['ttsVoice']; speechRate?: number } = {}): Promise<Spoken> {
    const s = this.settings();
    const key = {
      voice: overrides.voice ?? s.ttsVoice,
      lengthScale: lengthScaleFor(overrides.speechRate ?? s.speechRate),
      text,
    };
    const started = performance.now();
    const hit = await this.cache.get(key);
    if (hit) return { wav: hit, cached: true, ms: Math.round(performance.now() - started) };
    const wav = await this.piper.synthesize(text, { voice: key.voice, lengthScale: key.lengthScale });
    await this.cache.set(key, wav);
    return { wav, cached: false, ms: Math.round(performance.now() - started) };
  }

  /** Synthesizes fixed phrases in the background so the first interview already has them cached. */
  async prewarm(phrases: string[], log: (msg: string) => void) {
    let made = 0;
    for (const p of phrases) {
      try {
        if (!(await this.speak(p)).cached) made++;
      } catch (err) {
        log(`TTS prewarm stopped: ${(err as Error).message}`);
        return;
      }
    }
    if (made) log(`TTS prewarm: ${made} phrase(s) synthesized`);
  }
}
