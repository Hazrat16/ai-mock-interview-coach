// Turns Whisper's raw segments into the answer text, dropping what is probably not your speech.
import type { RawSegment } from './sttClient';

/** Whisper's own estimate that a segment is silence or noise. 0.6 is the threshold Whisper itself uses. */
export const NO_SPEECH_MAX = 0.6;
/** Average token log-probability below this means a guess (often a hallucination on noise). */
export const LOGPROB_MIN = -1.0;

// Phrases Whisper is known to invent on silence or noise (learned from subtitled video).
const HALLUCINATIONS = [
  /^thanks? (you )?for watching[.!]*$/i,
  /^(please )?(like and )?subscribe[.!]*$/i,
  /^(\[|\()?(blank_audio|silence|music|applause|inaudible|no speech)(\]|\))?$/i,
  /^\.+$/,
];
// Short phrases that are real answers sometimes, but on near-silence are usually invented.
const SUSPICIOUS_ON_QUIET = /^(thank you|thanks|you|bye|okay|so)[.!]*$/i;

export type Segment = RawSegment & {
  kept: boolean;
  reason?: 'no_speech' | 'low_confidence' | 'hallucination' | 'empty';
};

export function classifySegment(s: RawSegment, minLogprob = LOGPROB_MIN): Segment {
  const text = s.text.replace(/\[[^\]]*\]|\([^)]*\)/g, (m) => (HALLUCINATIONS.some((h) => h.test(m)) ? '' : m)).trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return { ...s, text, kept: false, reason: 'empty' };
  if (HALLUCINATIONS.some((h) => h.test(text))) return { ...s, text, kept: false, reason: 'hallucination' };
  if (s.noSpeechProb > NO_SPEECH_MAX) return { ...s, text, kept: false, reason: 'no_speech' };
  if (SUSPICIOUS_ON_QUIET.test(text) && s.noSpeechProb > 0.3)
    return { ...s, text, kept: false, reason: 'hallucination' };
  if (s.avgLogprob < minLogprob) return { ...s, text, kept: false, reason: 'low_confidence' };
  return { ...s, text, kept: true };
}

/** `minLogprob`: confidence threshold (the benchmark compares it with -Infinity, i.e. off). */
export function buildTranscript(segments: RawSegment[], minLogprob = LOGPROB_MIN) {
  const all = segments.map((s) => classifySegment(s, minLogprob));
  const text = all
    .filter((s) => s.kept)
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, segments: all, words: text ? text.split(' ').length : 0 };
}
