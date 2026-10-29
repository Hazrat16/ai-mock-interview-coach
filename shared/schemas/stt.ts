import { z } from 'zod';

export const sttSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  kept: z.boolean(),
  /** Why a segment was left out of the answer. */
  reason: z.enum(['no_speech', 'low_confidence', 'hallucination', 'empty']).optional(),
});

export const sttResultSchema = z.object({
  text: z.string(),
  words: z.number().int(),
  durationSec: z.number(),
  /** Time Whisper took, in ms. */
  ms: z.number(),
  model: z.string(),
  segments: z.array(sttSegmentSchema),
});

/** Your own recordings, saved only when you click "Save for benchmark" (used by make bench-stt). */
export const sttSampleListSchema = z.object({
  dir: z.string(),
  samples: z.array(
    z.object({
      id: z.string(),
      reference: z.string(),
      durationSec: z.number(),
      createdAt: z.string(),
      /** How it was recorded, to compare microphones and settings in the benchmark. */
      mic: z.string().optional(),
      processing: z.boolean().optional(),
    }),
  ),
});

export type SttResult = z.infer<typeof sttResultSchema>;
export type SttSampleList = z.infer<typeof sttSampleListSchema>;
