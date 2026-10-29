// Speaks interviewer text: splits it into sentences, plays the first as soon as it is synthesized,
// and synthesizes the next one while the current one plays.
import { splitSentences } from '@shared/text/sentences';

export type SpeakResult = 'done' | 'stopped' | 'failed';

export type PlayerState =
  | { status: 'idle' | 'speaking' }
  /** The browser refuses audio until the user clicks; the text is still on screen. */
  | { status: 'blocked' }
  | { status: 'error'; message: string };

/** Pause between sentences; Piper adds none and back-to-back sentences sound rushed. */
const SENTENCE_GAP_SEC = 0.18;

class SpeechError extends Error {}
class AudioBlockedError extends Error {}

type Overrides = { voice?: string; speechRate?: number };

export class SpeechPlayer {
  private ctx?: AudioContext;
  private source?: AudioBufferSourceNode;
  private abort?: AbortController;
  /** Bumped by stop() and each new speak(), so older work notices it is stale and quits. */
  private generation = 0;
  private last?: { text: string; opts: Overrides };
  private state: PlayerState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  private setState(state: PlayerState) {
    this.state = state;
    for (const l of this.listeners) l();
  }

  /**
   * Browsers allow audio only after a click or key press. Call this from an event handler
   * (or right after one); returns whether audio can play now.
   */
  async unlock(): Promise<boolean> {
    this.ctx ??= new AudioContext();
    if (this.ctx.state !== 'running') {
      // Without a user gesture resume() never settles, so don't wait for it forever.
      await Promise.race([this.ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
    }
    return this.ctx.state === 'running';
  }

  get unlocked() {
    return this.ctx?.state === 'running';
  }

  stop() {
    this.generation++;
    this.abort?.abort();
    try {
      this.source?.stop();
    } catch {
      // not started yet
    }
    this.source = undefined;
    if (this.state.status === 'speaking') this.setState({ status: 'idle' });
  }

  /** Speaks the last text again (also the way to retry after an error or a blocked start). */
  repeat() {
    return this.last ? this.speak(this.last.text, this.last.opts) : Promise.resolve<SpeakResult>('done');
  }

  /**
   * Resolves 'done' when everything was spoken, 'stopped' if stop() or another speak() cut it short,
   * 'failed' on an error (details in getState()). Never throws: the text stays on screen either way.
   */
  async speak(text: string, opts: Overrides & { onFirstAudio?: (ms: number) => void } = {}): Promise<SpeakResult> {
    this.stop();
    const gen = this.generation;
    this.last = { text, opts };
    this.setState({ status: 'speaking' });
    try {
      const result = await this.run(text, opts, gen);
      if (result === 'done' && gen === this.generation) this.setState({ status: 'idle' });
      return result;
    } catch (err) {
      if (gen !== this.generation) return 'stopped';
      this.setState(
        err instanceof AudioBlockedError ? { status: 'blocked' } : { status: 'error', message: (err as Error).message },
      );
      return 'failed';
    }
  }

  private async run(text: string, opts: Overrides & { onFirstAudio?: (ms: number) => void }, gen: number) {
    const abort = (this.abort = new AbortController());
    if (!(await this.unlock())) throw new AudioBlockedError();
    const ctx = this.ctx!;
    const started = performance.now();
    const sentences = splitSentences(text);

    const synth = async (sentence: string) => {
      const res = await fetch('/api/speech/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: sentence, voice: opts.voice, speechRate: opts.speechRate }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
        throw new SpeechError(
          [body.error ?? `Speech failed (HTTP ${res.status})`, body.hint].filter(Boolean).join('. '),
        );
      }
      return ctx.decodeAudioData(await res.arrayBuffer()); // also resamples 22.05 kHz to the device rate
    };

    let next: Promise<AudioBuffer> | undefined = sentences[0] ? synth(sentences[0]) : undefined;
    for (let i = 0; next; i++) {
      let buffer: AudioBuffer;
      try {
        buffer = await next;
      } catch (err) {
        if (gen !== this.generation) return 'stopped' as const;
        throw err instanceof SpeechError ? err : new SpeechError(`Could not play speech (${(err as Error).message})`);
      }
      if (gen !== this.generation) return 'stopped' as const;
      const following = sentences[i + 1];
      next = following ? synth(following) : undefined;
      next?.catch(() => undefined); // handled when awaited; avoids an "unhandled rejection" if we stop first

      if (i === 0) {
        const ms = Math.round(performance.now() - started);
        opts.onFirstAudio?.(ms);
        console.info(`[tts] first audio after ${ms} ms (${sentences.length} sentence(s))`);
      }
      await this.play(ctx, buffer, i === 0 ? 0 : SENTENCE_GAP_SEC);
      if (gen !== this.generation) return 'stopped' as const;
    }
    return 'done' as const;
  }

  private play(ctx: AudioContext, buffer: AudioBuffer, delaySec: number) {
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => resolve(); // also fires after stop()
      this.source = source;
      source.start(ctx.currentTime + delaySec);
    });
  }
}

/** One player for the whole app, so only one voice ever speaks at a time. */
export const player = new SpeechPlayer();
