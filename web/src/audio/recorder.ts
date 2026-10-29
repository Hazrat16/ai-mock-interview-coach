// Microphone recording to a 16 kHz WAV for Whisper. The microphone is on only between start() and stop()/cancel().
import workletUrl from './captureWorklet.ts?worker&url';
import { downsample, encodeWav, rms, STT_SAMPLE_RATE } from './wav';

export class MicPermissionError extends Error {}

export type Recording = { wav: Blob; seconds: number };

export type MicOptions = {
  /** A specific microphone (from listMicrophones); default: the system default. */
  deviceId?: string;
  /**
   * The browser's echo cancellation, noise suppression and automatic gain. On by default: the interviewer
   * plays through the laptop speakers (D3), and M6 measured 9.9% WER with it on.
   */
  processing?: boolean;
};

/** Microphones the browser can use. Labels are empty until microphone permission was granted once. */
export async function listMicrophones(): Promise<{ deviceId: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export class MicRecorder {
  private readonly chunks: Float32Array[] = [];
  private flushed?: () => void;

  private constructor(
    private readonly stream: MediaStream,
    private readonly ctx: AudioContext,
    private readonly node: AudioWorkletNode,
    /** The microphone actually used, as the browser names it. */
    readonly deviceLabel: string,
  ) {}

  /** Asks for the microphone (the browser shows its permission prompt the first time). Call from a click. */
  static async start(onLevel?: (level: number, seconds: number) => void, opts: MicOptions = {}): Promise<MicRecorder> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
          echoCancellation: opts.processing ?? true,
          noiseSuppression: opts.processing ?? true,
          autoGainControl: opts.processing ?? true,
        },
      });
    } catch (err) {
      const name = (err as Error).name;
      throw new MicPermissionError(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in the browser (the icon left of the address bar) and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug one in or check the system sound settings.'
            : name === 'OverconstrainedError'
              ? 'The selected microphone is not available any more. Pick another one.'
              : `Could not open the microphone: ${(err as Error).message}`,
        { cause: err },
      );
    }
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      // No outputs: the node is a sink, so nothing is played back (no echo) and it still runs.
      const node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 });
      const recorder = new MicRecorder(stream, ctx, node, stream.getAudioTracks()[0]?.label ?? '');
      node.port.onmessage = (e: MessageEvent<Float32Array | 'flushed'>) => {
        if (e.data === 'flushed') return recorder.flushed?.();
        recorder.chunks.push(e.data);
        onLevel?.(rms(e.data), recorder.seconds);
      };
      ctx.createMediaStreamSource(stream).connect(node);
      return recorder;
    } catch (err) {
      for (const t of stream.getTracks()) t.stop();
      await ctx.close();
      throw err;
    }
  }

  get seconds() {
    return this.chunks.reduce((n, c) => n + c.length, 0) / this.ctx.sampleRate;
  }

  /** Stops the microphone and returns the recording as a 16 kHz mono WAV. */
  async stop(): Promise<Recording> {
    await new Promise<void>((resolve) => {
      this.flushed = resolve;
      this.node.port.postMessage('flush');
      setTimeout(resolve, 500); // never hang if the audio thread is gone
    });
    const rate = this.ctx.sampleRate;
    await this.release();
    const all = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of this.chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    const samples = downsample(all, rate);
    return { wav: new Blob([encodeWav(samples)], { type: 'audio/wav' }), seconds: samples.length / STT_SAMPLE_RATE };
  }

  /** Stops the microphone and discards the audio. */
  async cancel() {
    this.chunks.length = 0;
    await this.release();
  }

  private async release() {
    for (const t of this.stream.getTracks()) t.stop(); // the browser's recording indicator turns off
    this.node.disconnect();
    if (this.ctx.state !== 'closed') await this.ctx.close();
  }
}
