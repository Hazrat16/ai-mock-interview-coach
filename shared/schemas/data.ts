import { z } from 'zod';

/** Typed by the user before an action that overwrites or deletes data (R14). */
export const RESTORE_WORD = 'RESTORE';
export const DELETE_WORD = 'DELETE';

export const dataSummarySchema = z.object({
  interviews: z.number().int(),
  answers: z.number().int(),
  /** Interview-ready answers and evaluations. */
  evaluations: z.number().int(),
  /** Speech-check recordings (Settings); interview audio is never stored. */
  voiceSamples: z.number().int(),
});

export const restoreRequestSchema = z.object({ name: z.string().min(1), confirm: z.literal(RESTORE_WORD) });
export const confirmDeleteSchema = z.object({ confirm: z.literal(DELETE_WORD) });

export const restoreResultSchema = z.object({
  /** The data as it was just before the restore. */
  safetyBackup: z.string(),
  interviews: z.number().int(),
});

/** No safety backup for deletes: it would keep a copy of what you asked to delete. */
export const deleteResultSchema = z.object({ summary: dataSummarySchema });

export type DataSummary = z.infer<typeof dataSummarySchema>;
