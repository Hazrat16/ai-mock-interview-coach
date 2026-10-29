import { z } from 'zod';
import { VOICE_IDS } from '../voices';

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  /** Overrides for "Test voice" in Settings, before the choice is saved. */
  voice: z.enum(VOICE_IDS).optional(),
  speechRate: z.number().min(0.7).max(1.4).optional(),
});

export const voiceListSchema = z.object({
  selected: z.enum(VOICE_IDS),
  /** False when Piper is not running, so installation is unknown. */
  piperRunning: z.boolean(),
  voices: z.array(
    z.object({ id: z.enum(VOICE_IDS), label: z.string(), datasetLicense: z.string(), installed: z.boolean() }),
  ),
});

export type TtsRequest = z.infer<typeof ttsRequestSchema>;
export type VoiceList = z.infer<typeof voiceListSchema>;
