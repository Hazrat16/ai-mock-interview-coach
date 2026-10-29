/** Client for the Piper HTTP server (POST /synthesize -> WAV). */
import { parseWav } from './wav';

export class TtsError extends Error {
  constructor(
    message: string,
    /** What the user can do about it, shown in the UI. */
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class TtsUnavailableError extends TtsError {}

export type SynthesizeOptions = {
  voice: string;
  /** Piper's phoneme length: above 1 is slower, below 1 faster. */
  lengthScale: number;
  timeoutMs?: number;
};

const RETRY_DELAYS_MS = [1000, 2000, 3000]; // ~6 s: long enough for Docker to restart a crashed Piper (~4 s)

export class PiperClient {
  constructor(
    private readonly baseUrl: string,
    private readonly retryDelaysMs: number[] = RETRY_DELAYS_MS,
  ) {}

  async synthesize(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(text, opts);
      } catch (err) {
        const delay = this.retryDelaysMs[attempt];
        if (!(err instanceof TtsUnavailableError) || delay === undefined) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /** Voice names Piper has on disk. */
  async installedVoices(timeoutMs = 2000): Promise<string[]> {
    const res = await this.fetch('/voices', { signal: AbortSignal.timeout(timeoutMs) });
    return Object.keys((await res.json()) as Record<string, unknown>).sort();
  }

  private async send(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const res = await this.fetch('/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice: opts.voice, length_scale: opts.lengthScale }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const wav = Buffer.from(await res.arrayBuffer());
    try {
      parseWav(wav);
    } catch (err) {
      throw new TtsError(`Piper returned a bad audio file: ${(err as Error).message}`, undefined, { cause: err });
    }
    return wav;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new TtsError('Piper did not answer in time', 'The computer may be busy. Try again.', { cause: err });
      }
      throw new TtsUnavailableError(`Piper is not reachable at ${this.baseUrl}`, 'Start it with: make deps-up', {
        cause: err,
      });
    }
    if (!res.ok) throw new TtsError(`Piper returned HTTP ${res.status}`);
    return res;
  }
}
