// Microphone with voice activity detection (Silero VAD v5 via @ricky0123/vad-web, all files served by this
// app from /vad/). Hands over each stretch of speech as 16 kHz audio, so it can be transcribed while you
// keep talking. The microphone is only open between open() and close().
import { MicVAD } from '@ricky0123/vad-web';
import { MicPermissionError, type MicOptions, MicRecorder } from './recorder';
import { rms } from './wav';

export type VoiceInputEvents = {
  onSpeechStart: (now: number) => void;
  /** One stretch of speech: 16 kHz mono samples, with start and end on the performance.now() clock. */
  onSegment: (audio: Float32Array, startMs: number, endMs: number) => void;
  /** Speech started but was too short to count (a cough, a click). */
  onMisfire: () => void;
  /** The microphone stopped delivering audio (unplugged, or turned off in the system). */
  onMicLost: () => void;
  onLevel?: (level: number) => void;
};

// Pauses inside a sentence shorter than this stay in the same segment.
const REDEMPTION_MS = 800;
const PRE_SPEECH_PAD_MS = 300;
const MIN_SPEECH_MS = 250;
const SAMPLE_RATE = 16000;

const constraints = (opts: MicOptions): MediaStreamConstraints => ({
  audio: {
    channelCount: 1,
    deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
    // With laptop speakers (D3) echo cancellation keeps the interviewer's voice out of your answer.
    echoCancellation: opts.processing ?? true,
    noiseSuppression: opts.processing ?? true,
    autoGainControl: opts.processing ?? true,
  },
});

async function getMic(opts: MicOptions, onLost: () => void): Promise<MediaStream> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints(opts));
  } catch (err) {
    const name = (err as Error).name;
    throw new MicPermissionError(
      name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it with the icon left of the address bar, then click Enable microphone again.'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No microphone found. Plug one in or pick another one in Settings.'
          : `Could not open the microphone: ${(err as Error).message}`,
      { cause: err },
    );
  }
  // 'ended' fires when the device goes away, not when we stop the track ourselves.
  for (const track of stream.getAudioTracks()) track.addEventListener('ended', onLost);
  return stream;
}

/**
 * Runs open/close one after another. Without this, a close() that arrives while open() is still starting
 * is ignored by the detector, and the microphone would stay on.
 */
class Serial {
  private last: Promise<unknown> = Promise.resolve();
  run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.last.then(op, op);
    this.last = next.catch(() => undefined);
    return next;
  }
}

/** Voice input with automatic speech detection. */
export class VoiceInput {
  readonly automatic = true;
  private open_ = false;
  private vad!: MicVAD;
  private readonly serial = new Serial();

  private constructor() {}

  /** Loads the detector (~17 MB, from this app). Does not touch the microphone yet. */
  static async create(events: VoiceInputEvents, mic: MicOptions): Promise<VoiceInput> {
    const self = new VoiceInput();
    self.vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      startOnLoad: false,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: REDEMPTION_MS,
      preSpeechPadMs: PRE_SPEECH_PAD_MS,
      minSpeechMs: MIN_SPEECH_MS,
      // When the answer ends mid-word (Done, pause), hand over what was said so far.
      submitUserSpeechOnPause: true,
      ortConfig: (ort) => {
        ort.env.logLevel = 'error';
        ort.env.wasm.numThreads = 1; // threads need cross-origin isolation; one is plenty for a VAD
      },
      getStream: () => getMic(mic, () => events.onMicLost()),
      resumeStream: () => getMic(mic, () => events.onMicLost()),
      onSpeechStart: () => events.onSpeechStart(performance.now()),
      onVADMisfire: () => events.onMisfire(),
      onSpeechEnd: (audio) => {
        // The detector reports the end after REDEMPTION_MS of quiet (or right away when paused).
        const endMs = self.open_ ? performance.now() - REDEMPTION_MS : performance.now();
        const startMs = endMs - (audio.length / SAMPLE_RATE) * 1000;
        events.onSegment(audio, startMs, endMs);
      },
      onFrameProcessed: (_p, frame) => events.onLevel?.(rms(frame)),
    });
    return self;
  }

  get isOpen() {
    return this.open_;
  }

  open() {
    return this.serial.run(async () => {
      if (this.open_) return;
      this.open_ = true;
      try {
        await this.vad.start();
        if (this.vad.errored) throw new Error(this.vad.errored);
      } catch (err) {
        this.open_ = false;
        throw err;
      }
    });
  }

  /** Releases the microphone (the browser's recording indicator goes off). Speech in progress is handed over. */
  close() {
    return this.serial.run(async () => {
      if (!this.open_) return;
      this.open_ = false;
      await this.vad.pause();
    });
  }

  destroy() {
    return this.serial.run(async () => {
      this.open_ = false;
      await this.vad.destroy();
    });
  }
}

/**
 * Fallback when the detector cannot load: records while open, and hands over everything as one segment
 * when closed. No automatic end of answer; you press Done.
 */
export class ManualVoiceInput {
  readonly automatic = false;
  private recorder?: MicRecorder;
  private openedAt = 0;
  private readonly serial = new Serial();

  constructor(
    private readonly events: VoiceInputEvents,
    private readonly mic: MicOptions,
  ) {}

  get isOpen() {
    return this.recorder !== undefined;
  }

  open() {
    return this.serial.run(async () => {
      if (this.recorder) return;
      this.recorder = await MicRecorder.start((level) => this.events.onLevel?.(level), this.mic);
      this.openedAt = performance.now();
    });
  }

  close() {
    return this.serial.run(async () => {
      const r = this.recorder;
      if (!r) return;
      this.recorder = undefined;
      const { wav, seconds } = await r.stop();
      if (seconds < 0.3) return;
      const samples = new Int16Array((await wav.arrayBuffer()).slice(44));
      const audio = Float32Array.from(samples, (v) => v / 32768);
      this.events.onSegment(audio, this.openedAt, this.openedAt + seconds * 1000);
    });
  }

  destroy() {
    return this.serial.run(async () => {
      await this.recorder?.cancel();
      this.recorder = undefined;
    });
  }
}

export type AnyVoiceInput = VoiceInput | ManualVoiceInput;

/** The automatic detector, or the manual fallback if its files cannot be loaded. */
export async function createVoiceInput(
  events: VoiceInputEvents,
  mic: MicOptions,
): Promise<{ input: AnyVoiceInput; fallbackReason?: string }> {
  try {
    return { input: await VoiceInput.create(events, mic) };
  } catch (err) {
    console.warn('[vad] falling back to manual recording', err);
    return {
      input: new ManualVoiceInput(events, mic),
      fallbackReason: `Automatic speech detection could not load (${(err as Error).message}). Press Done when you finish each answer.`,
    };
  }
}
