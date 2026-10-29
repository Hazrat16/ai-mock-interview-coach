import { z } from 'zod';

export const componentStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  detail: z.string(),
  /** What to do when status is not ok, e.g. a command to run. */
  hint: z.string().optional(),
});

export const healthSchema = z.object({
  app: z.object({ status: z.literal('ok'), version: z.string() }),
  ollama: componentStatusSchema.extend({
    version: z.string().optional(),
    models: z.array(z.object({ name: z.string(), installed: z.boolean() })),
    /** Every model downloaded in Ollama, for the model picker. */
    available: z.array(z.string()),
  }),
  tts: componentStatusSchema.extend({ voice: z.string() }),
  stt: componentStatusSchema.extend({ model: z.string() }),
  memory: z.object({ availableGb: z.number(), totalGb: z.number(), low: z.boolean() }),
});

export type ComponentStatus = z.infer<typeof componentStatusSchema>;
export type Health = z.infer<typeof healthSchema>;
