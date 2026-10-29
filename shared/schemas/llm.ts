import { z } from 'zod';

export const modelTestRequestSchema = z.object({ model: z.string().min(1) });

export const modelTestResultSchema = z.object({
  model: z.string(),
  /** Wall time of the whole request, including loading the model if it was not in memory. */
  seconds: z.number(),
  loadSeconds: z.number(),
  outputTokensPerSec: z.number(),
  /** 2 if the first reply failed validation and the repair retry was needed. */
  attempts: z.number(),
  question: z.string(),
});

/** Error body for failures the user can act on. */
export const apiErrorSchema = z.object({ error: z.string(), hint: z.string().optional() });

export type ModelTestResult = z.infer<typeof modelTestResultSchema>;
