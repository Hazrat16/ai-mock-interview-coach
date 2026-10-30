// One spoken answer as a pure reducer: interviewer speaks → thinking time → listening → transcribing → ready.
// The hook (useVoiceAnswer) turns state changes into effects: play speech, open/close the mic, send segments
// to speech-to-text. Times are milliseconds on one clock (performance.now() in the browser).
import { measureDelivery, type Delivery } from '@shared/delivery';

export type Segment = {
  id: number;
  startMs: number;
  endMs: number;
  status: 'pending' | 'done' | 'failed';
  text: string;
};

export type VoiceConfig = {
  thinkingMs: number;
  /** Silence after your last words that ends the answer (Settings: end-of-answer silence). */
  silenceMs: number;
  maxAnswerMs: number;
  /** "Sorry, I didn't catch that" at most this many times, then the typed fallback. */
  maxReprompts: number;
  minWords: number;
};

export const DEFAULT_VOICE_CONFIG: Omit<VoiceConfig, 'thinkingMs' | 'silenceMs'> = {
  maxAnswerMs: 4 * 60_000,
  maxReprompts: 2,
  minWords: 3,
};

/** Warn this long before the maximum answer length. */
export const MAX_LENGTH_WARNING_MS = 15_000;

export const REPROMPT = "Sorry, I didn't catch that. Could you say that again?";

type Answering = { questionEndMs: number; segments: Segment[] };

export type VoiceStep =
  /** The interviewer speaks the question (or the reprompt); the mic is closed. */
  | { step: 'speaking'; say: 'question' | 'reprompt'; segments: Segment[] }
  /** Thinking time: the mic is open, silence does not end anything, speaking starts the answer. */
  | ({ step: 'thinking'; until: number } & Answering)
  | ({
      step: 'listening';
      startedAt: number;
      /** You are mid-sentence (between the detector's speech start and end). */
      speaking: boolean;
      lastSpeechEndMs?: number;
    } & Answering)
  /**
   * Waiting for the last segments' text; the mic is closed. `awaitingTail`: the answer ended mid-word, and the
   * detector still has to hand over that last piece (or the hook's timeout gives up on it).
   */
  | ({ step: 'transcribing'; awaitingTail?: boolean; endedAt: number } & Answering)
  | ({ step: 'stt_error'; endedAt: number } & Answering)
  | ({ step: 'paused'; reason: 'user' | 'mic_lost' } & Answering)
  /** Nothing usable was heard after all reprompts: type the answer instead (prefilled with what was heard). */
  | { step: 'fallback'; heard: string }
  /** Final answer, ready to submit. */
  /** `endedAt`: when the answer ended (silence, Done, or length limit), for the turn-latency measurement. */
  | { step: 'ready'; transcript: string; delivery?: Delivery; endedAt: number };

export type VoiceState = VoiceStep & {
  reprompts: number;
  config: VoiceConfig;
  /** Counts utterances (question, repeat, reprompt), so each one is played exactly once. */
  speeches: number;
};

export type VoiceEvent =
  | { type: 'spoken'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'speech_start'; now: number }
  | { type: 'misfire' }
  | { type: 'tail_timeout' }
  | { type: 'segment'; id: number; startMs: number; endMs: number }
  | { type: 'stt_done'; id: number; text: string }
  | { type: 'stt_failed'; id: number }
  | { type: 'done'; now: number }
  | { type: 'pause' }
  | { type: 'mic_lost' }
  | { type: 'resume'; now: number }
  | { type: 'repeat' }
  | { type: 'retry_stt' }
  | { type: 'drop_failed' };

export function initialVoiceState(config: VoiceConfig): VoiceState {
  return { step: 'speaking', say: 'question', segments: [], reprompts: 0, config, speeches: 1 };
}

export const segmentsOf = (s: VoiceState): Segment[] => ('segments' in s ? s.segments : []);
const questionEndOf = (s: VoiceState, fallback: number) => ('questionEndMs' in s ? s.questionEndMs : fallback);
const updateSeg = (segs: Segment[], id: number, patch: Partial<Segment>) =>
  segs.map((g) => (g.id === id ? { ...g, ...patch } : g));

/** All segments are in: decide between submitting, asking again, the typed fallback, or an STT error. */
function settle(s: VoiceState & Answering & { step: 'transcribing' }): VoiceState {
  if (s.awaitingTail || s.segments.some((g) => g.status === 'pending')) return s;
  if (s.segments.some((g) => g.status === 'failed')) return { ...s, step: 'stt_error' };
  const done = s.segments.filter((g) => g.text.trim());
  const transcript = done
    .map((g) => g.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ');
  const words = transcript ? transcript.split(' ').length : 0;
  const base = { reprompts: s.reprompts, config: s.config, speeches: s.speeches };
  if (words >= s.config.minWords) {
    return { ...base, step: 'ready', transcript, delivery: measureDelivery(done, s.questionEndMs), endedAt: s.endedAt };
  }
  if (s.reprompts < s.config.maxReprompts) {
    return { ...base, reprompts: s.reprompts + 1, step: 'speaking', say: 'reprompt', segments: [] };
  }
  return { ...base, step: 'fallback', heard: transcript };
}

function finish(s: VoiceState & Answering, now: number): VoiceState {
  const midWord = s.step === 'listening' && s.speaking;
  return settle({
    reprompts: s.reprompts,
    config: s.config,
    speeches: s.speeches,
    step: 'transcribing',
    questionEndMs: s.questionEndMs,
    segments: s.segments,
    awaitingTail: midWord,
    endedAt: now,
  });
}

export function voiceReduce(s: VoiceState, e: VoiceEvent): VoiceState {
  const next = step(s, e);
  // A new utterance starts when we enter 'speaking', or when 'repeat' restarts it.
  const newUtterance = next.step === 'speaking' && next !== s && (s.step !== 'speaking' || e.type === 'repeat');
  return newUtterance ? { ...next, speeches: s.speeches + 1 } : next;
}

function step(s: VoiceState, e: VoiceEvent): VoiceState {
  const base = { reprompts: s.reprompts, config: s.config, speeches: s.speeches };
  switch (e.type) {
    case 'spoken': {
      if (s.step !== 'speaking') return s;
      // Mid-answer repeat: go straight back to listening with what you said so far.
      if (s.segments.length) {
        return {
          ...base,
          step: 'listening',
          questionEndMs: e.now,
          segments: s.segments,
          startedAt: e.now,
          speaking: false,
          lastSpeechEndMs: e.now,
        };
      }
      if (s.config.thinkingMs <= 0) {
        return { ...base, step: 'listening', questionEndMs: e.now, segments: [], startedAt: e.now, speaking: false };
      }
      return { ...base, step: 'thinking', questionEndMs: e.now, segments: [], until: e.now + s.config.thinkingMs };
    }
    case 'tick': {
      if (s.step === 'thinking' && e.now >= s.until) {
        return {
          ...base,
          step: 'listening',
          questionEndMs: s.questionEndMs,
          segments: s.segments,
          startedAt: e.now,
          speaking: false,
        };
      }
      if (s.step !== 'listening') return s;
      if (e.now - s.startedAt >= s.config.maxAnswerMs) return finish(s, e.now);
      const silentFor = s.lastSpeechEndMs === undefined ? 0 : e.now - s.lastSpeechEndMs;
      if (!s.speaking && s.segments.length > 0 && silentFor >= s.config.silenceMs) return finish(s, e.now);
      return s;
    }
    case 'speech_start':
      if (s.step === 'thinking') {
        return {
          ...base,
          step: 'listening',
          questionEndMs: s.questionEndMs,
          segments: s.segments,
          startedAt: e.now,
          speaking: true,
        };
      }
      return s.step === 'listening' ? { ...s, speaking: true } : s;
    case 'misfire':
    case 'tail_timeout':
      if (s.step === 'listening' && e.type === 'misfire') return { ...s, speaking: false };
      if (s.step === 'transcribing' && s.awaitingTail) return settle({ ...s, awaitingTail: false });
      return s;
    case 'segment': {
      const seg: Segment = { id: e.id, startMs: e.startMs, endMs: e.endMs, status: 'pending', text: '' };
      if (s.step === 'listening') {
        return { ...s, segments: [...s.segments, seg], speaking: false, lastSpeechEndMs: e.endMs };
      }
      if (s.step === 'thinking') {
        // The detector can report a segment without a separate start event: the answer has begun.
        return {
          ...base,
          step: 'listening',
          questionEndMs: s.questionEndMs,
          segments: [seg],
          startedAt: e.startMs,
          speaking: false,
          lastSpeechEndMs: e.endMs,
        };
      }
      // Finished just as the answer ended (Done pressed mid-word, or pause): keep it.
      if (s.step === 'transcribing') return { ...s, segments: [...s.segments, seg], awaitingTail: false };
      if (s.step === 'paused') return { ...s, segments: [...s.segments, seg] };
      return s;
    }
    case 'stt_done':
    case 'stt_failed': {
      const segments = segmentsOf(s);
      if (!segments.some((g) => g.id === e.id)) return s;
      const patch: Partial<Segment> = e.type === 'stt_done' ? { status: 'done', text: e.text } : { status: 'failed' };
      const next = { ...s, segments: updateSeg(segments, e.id, patch) } as VoiceState;
      return next.step === 'transcribing' ? settle(next) : next;
    }
    case 'done':
      if (s.step === 'listening' || s.step === 'thinking') return finish(s, e.now);
      return s;
    case 'pause':
    case 'mic_lost': {
      if (s.step === 'fallback' || s.step === 'ready' || s.step === 'paused') return s;
      if (s.step === 'transcribing' || s.step === 'stt_error') return s; // nothing to stop; the mic is already closed
      return {
        ...base,
        step: 'paused',
        reason: e.type === 'pause' ? 'user' : 'mic_lost',
        questionEndMs: questionEndOf(s, 0),
        segments: segmentsOf(s),
      };
    }
    case 'resume':
      if (s.step !== 'paused') return s;
      // Before you said anything: hear the question again. Mid-answer: carry on listening (silence timer restarts).
      if (!s.segments.length) return { ...base, step: 'speaking', say: 'question', segments: [] };
      return {
        ...base,
        step: 'listening',
        questionEndMs: s.questionEndMs,
        segments: s.segments,
        startedAt: e.now,
        speaking: false,
        lastSpeechEndMs: e.now,
      };
    case 'repeat':
      if (s.step === 'thinking' || s.step === 'listening' || s.step === 'paused' || s.step === 'speaking') {
        return { ...base, step: 'speaking', say: 'question', segments: segmentsOf(s) };
      }
      return s;
    case 'retry_stt':
      if (s.step !== 'stt_error') return s;
      return {
        ...s,
        step: 'transcribing',
        segments: s.segments.map((g) => (g.status === 'failed' ? { ...g, status: 'pending' as const } : g)),
      };
    case 'drop_failed':
      if (s.step !== 'stt_error') return s;
      return settle({ ...s, step: 'transcribing', segments: s.segments.filter((g) => g.status !== 'failed') });
  }
}

/** Seconds left in the visible end-of-answer countdown, or undefined when it is not running. */
export function silenceCountdown(s: VoiceState, now: number): number | undefined {
  if (s.step !== 'listening' || s.speaking || !s.segments.length || s.lastSpeechEndMs === undefined) return undefined;
  const silent = now - s.lastSpeechEndMs;
  // Show it only for the last 3 seconds, so normal pauses between sentences are not distracting.
  const left = s.config.silenceMs - silent;
  return left <= 3000 ? Math.max(0, Math.ceil(left / 1000)) : undefined;
}

/** Whether the microphone should be open in this state. */
export const micOpen = (s: VoiceState) => s.step === 'thinking' || s.step === 'listening';
