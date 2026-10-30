// How an answer was spoken (not what was said): pace, pauses, filler words. Shown as coaching hints,
// never used for the content score. Whisper often drops "um"/"uh", so the filler count is a lower bound.
import { z } from 'zod';

export const deliverySchema = z.object({
  /** From your first word to your last, in ms. */
  answerMs: z.number().int().min(0),
  /** Time actually speaking (sum of speech segments), in ms. */
  speakingMs: z.number().int().min(0),
  wordsPerMinute: z.number().min(0),
  /** Silences of LONG_PAUSE_MS or more between speech segments. */
  longPauses: z.number().int().min(0),
  /** "um", "uh", "you know", ... as transcribed. Approximate: Whisper often leaves them out. */
  fillerWords: z.number().int().min(0),
  /** From the end of the question to your first word (includes thinking time), in ms. */
  responseLatencyMs: z.number().int().min(0),
  segments: z.number().int().min(0),
});
export type Delivery = z.infer<typeof deliverySchema>;

export const LONG_PAUSE_MS = 3000;
const FILLERS = /\b(u+m+|u+h+|e+r+m+|h+m+|you know|i mean)\b/gi;

export type SpokenSegment = { startMs: number; endMs: number; text: string };

/** `questionEndMs`: when the interviewer stopped speaking; all times on the same clock. */
export function measureDelivery(segments: SpokenSegment[], questionEndMs: number): Delivery | undefined {
  const spoken = segments.filter((s) => s.text.trim()).sort((a, b) => a.startMs - b.startMs);
  if (!spoken.length) return undefined;
  const first = spoken[0]!;
  const last = spoken.at(-1)!;
  const speakingMs = spoken.reduce((sum, s) => sum + Math.max(0, s.endMs - s.startMs), 0);
  const text = spoken.map((s) => s.text).join(' ');
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  let longPauses = 0;
  for (let i = 1; i < spoken.length; i++) if (spoken[i]!.startMs - spoken[i - 1]!.endMs >= LONG_PAUSE_MS) longPauses++;
  return {
    answerMs: Math.round(last.endMs - first.startMs),
    speakingMs: Math.round(speakingMs),
    wordsPerMinute: speakingMs ? Math.round((words / speakingMs) * 60_000) : 0,
    longPauses,
    fillerWords: text.match(FILLERS)?.length ?? 0,
    responseLatencyMs: Math.max(0, Math.round(first.startMs - questionEndMs)),
    segments: spoken.length,
  };
}
