/** Client for whisper.cpp's whisper-server (POST /inference, verbose_json). */

export class SttError extends Error {
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
export class SttUnavailableError extends SttError {}

export type RawSegment = { start: number; end: number; text: string; noSpeechProb: number; avgLogprob: number };
export type RawTranscript = { text: string; durationSec: number; segments: RawSegment[] };

type VerboseJson = {
  text?: string;
  duration?: number;
  error?: string;
  segments?: { start?: number; end?: number; text?: string; no_speech_prob?: number; avg_logprob?: number }[];
};

const RETRY_DELAYS_MS = [1000, 2000, 3000]; // covers a Docker restart of a crashed whisper-server

export class WhisperClient {
  constructor(
    private readonly baseUrl: string,
    private readonly retryDelaysMs: number[] = RETRY_DELAYS_MS,
  ) {}

  /**
   * `prompt` biases recognition toward expected words (e.g. the question: "Kubernetes", "PostgreSQL").
   * Audio is sent from memory; whisper-server reads it without writing a file.
   */
  async transcribe(wav: Buffer, opts: { prompt?: string; timeoutMs?: number } = {}): Promise<RawTranscript> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(wav, opts);
      } catch (err) {
        const delay = this.retryDelaysMs[attempt];
        if (!(err instanceof SttUnavailableError) || delay === undefined) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async healthy(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async send(wav: Buffer, opts: { prompt?: string; timeoutMs?: number }): Promise<RawTranscript> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'answer.wav');
    form.set('response_format', 'verbose_json');
    form.set('temperature', '0');
    if (opts.prompt) form.set('prompt', opts.prompt);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/inference`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new SttError(
          `Speech recognition took longer than ${Math.round(timeoutMs / 1000)} s`,
          'The computer may be busy. Try again.',
          { cause: err },
        );
      }
      throw new SttUnavailableError(`Whisper is not reachable at ${this.baseUrl}`, 'Start it with: make deps-up', {
        cause: err,
      });
    }
    const json = (await res.json().catch(() => ({}))) as VerboseJson;
    if (!res.ok || json.error) throw new SttError(`Whisper failed: ${json.error ?? `HTTP ${res.status}`}`);
    return {
      text: (json.text ?? '').trim(),
      durationSec: json.duration ?? 0,
      segments: (json.segments ?? []).map((s) => ({
        start: s.start ?? 0,
        end: s.end ?? 0,
        text: (s.text ?? '').trim(),
        noSpeechProb: s.no_speech_prob ?? 0,
        avgLogprob: s.avg_logprob ?? 0,
      })),
    };
  }
}
