import { z } from 'zod';
import { JOB_FAMILIES } from './interview';

export const coverageQuerySchema = z.object({ family: z.enum(JOB_FAMILIES) });

export const coverageSchema = z.object({
  family: z.enum(JOB_FAMILIES),
  groups: z.array(
    z.object({
      name: z.string(),
      skills: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          /** Answered questions that practised it. */
          practiced: z.number().int(),
          /** Bank questions for it: 0 means an assessment cannot cover it yet. */
          bankQuestions: z.number().int(),
        }),
      ),
    }),
  ),
});

export type Coverage = z.infer<typeof coverageSchema>;
