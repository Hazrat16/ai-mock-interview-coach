import { z } from 'zod';
import { VOICE_IDS } from '../voices';

/** User preferences edited in the Settings page. Stored one row per key in the settings table. */
export const settingsSchema = z.object({
  interviewerModel: z.string().min(1),
  evaluatorModel: z.string().min(1),
  showTranscript: z.boolean(),
  /** Silence after the last speech before an answer counts as finished (M7). */
  endOfAnswerSilenceSec: z.number().int().min(2).max(10),
  /** Default thinking time before the microphone opens (M4/M7). */
  defaultThinkingTimeSec: z.number().int().min(0).max(60),
  /** The interviewer reads questions aloud (M5). Off = text only. */
  speakInterviewer: z.boolean(),
  ttsVoice: z.enum(VOICE_IDS),
  /** Speaking speed; 1 is the voice's normal pace. */
  speechRate: z.number().min(0.7).max(1.4),
});

export const settingsPatchSchema = settingsSchema.partial().strict();

export const backupListSchema = z.object({
  dir: z.string(),
  backups: z.array(z.object({ name: z.string(), sizeBytes: z.number(), createdAt: z.string() })),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type BackupList = z.infer<typeof backupListSchema>;
