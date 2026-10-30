import { z } from 'zod';
import { deliverySchema } from '../delivery';
import { turnViewSchema } from './interview';

export const evidenceSchema = z.object({
  quote: z.string(),
  /** False when the quote could not be found in the transcript (the model may have invented it). */
  supported: z.boolean(),
});

export const criterionResultSchema = z.object({
  key: z.string(),
  name: z.string(),
  weight: z.number(),
  score: z.number().int().min(0).max(4),
  rationale: z.string(),
  evidence: z.array(evidenceSchema),
  /** What this score means, from the rubric's anchors. */
  anchor: z.string(),
});

/** What is stored in evaluations.result_json and shown in the report. */
export const evaluationResultSchema = z.object({
  criteria: z.array(criterionResultSchema),
  strengths: z.array(z.string()),
  mistakes: z.array(z.string()),
  missingConcepts: z.array(z.string()),
  suggestions: z.array(z.string()),
  exampleAnswer: z.string(),
  followUpExercise: z.string(),
});

export const evaluationViewSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed']),
  rubricKey: z.string(),
  rubricVersion: z.number().int(),
  rubricTitle: z.string(),
  model: z.string(),
  overallScore: z.number().int().min(0).max(100).nullable(),
  unsupportedEvidence: z.number().int(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  result: evaluationResultSchema.nullable(),
});

export const reportItemSchema = z.object({
  questionNumber: z.number().int(),
  /** The main question and its follow-ups, with the answers; evaluated together. */
  thread: z.array(
    turnViewSchema.extend({
      answer: z
        .object({ transcript: z.string(), inputMethod: z.enum(['voice', 'typed_fallback']), delivery: deliverySchema.nullable() })
        .nullable(),
    }),
  ),
  /** What a good answer covers, from the question bank (empty for a question no longer in the bank). */
  keyPoints: z.array(z.string()),
  evaluation: evaluationViewSchema.nullable(),
});

export const sessionReportSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  config: z.object({ jobTitle: z.string(), level: z.string(), interviewType: z.string() }),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  items: z.array(reportItemSchema),
  /** Mean of the finished evaluations' overall scores; null until one is done. */
  average: z.number().nullable(),
  progress: z.object({ done: z.number(), pending: z.number(), failed: z.number(), total: z.number() }),
  /** Spoken answers only; shown separately from the content scores. */
  delivery: z
    .object({
      answers: z.number(),
      wordsPerMinute: z.number(),
      longPauses: z.number(),
      fillerWords: z.number(),
      responseLatencyMs: z.number(),
    })
    .nullable(),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type EvaluationView = z.infer<typeof evaluationViewSchema>;
export type SessionReport = z.infer<typeof sessionReportSchema>;
