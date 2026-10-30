import { z } from 'zod';
import { deliverySchema } from '../delivery';

export const LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead'] as const;
export const INTERVIEW_TYPES = ['hr', 'behavioral', 'technical', 'coding', 'system_design'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const JOB_FAMILIES = ['software_engineering', 'data', 'product', 'design', 'other'] as const;

export const levelSchema = z.enum(LEVELS);
export const interviewTypeSchema = z.enum(INTERVIEW_TYPES);
export const difficultySchema = z.enum(DIFFICULTIES);

export const interviewConfigSchema = z.object({
  jobTitle: z.string().trim().min(2).max(100),
  jobFamily: z.enum(JOB_FAMILIES),
  level: levelSchema,
  interviewType: interviewTypeSchema,
  /** 'adaptive' starts at medium; real adapting arrives in M12. */
  difficulty: z.enum([...DIFFICULTIES, 'adaptive']),
  questionCount: z.number().int().min(1).max(15),
  durationMinutes: z.number().int().min(5).max(120).optional(),
  thinkingTimeSec: z.number().int().min(0).max(60),
  followUpLimit: z.number().int().min(0).max(2),
  customInstructions: z.string().trim().max(1000).optional(),
});

export const createSessionRequestSchema = z.object({
  config: interviewConfigSchema,
  /** Seed for reproducible question selection; random when omitted. */
  seed: z.number().int().min(0).optional(),
  /** What to do when the bank has fewer matching questions than requested. */
  onShortfall: z.enum(['ask', 'generate', 'reduce']).default('ask'),
  /** A job description or resume: its questions are written from it by the local model (M13). */
  documentId: z.string().optional(),
});

export const createSessionResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), sessionId: z.string(), questionCount: z.number(), generated: z.number() }),
  z.object({ status: z.literal('needs_decision'), available: z.number(), requested: z.number() }),
]);

/** A question as presented to the candidate. */
export const turnViewSchema = z.object({
  id: z.string(),
  seq: z.number(),
  kind: z.enum(['main', 'follow_up']),
  text: z.string(),
  /** 1-based number of the main question this turn belongs to. */
  questionNumber: z.number(),
  totalQuestions: z.number(),
});

export const answerRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(20_000),
  inputMethod: z.enum(['voice', 'typed_fallback']).default('typed_fallback'),
  durationMs: z.number().int().min(0).optional(),
  /** Spoken answers only (M7). */
  voice: z.object({ sttModel: z.string().max(100), delivery: deliverySchema }).optional(),
});
export type AnswerRequest = z.infer<typeof answerRequestSchema>;

/** What the interviewer says and asks next. `next` is null when the interview is over. */
export const turnResultSchema = z.object({
  ack: z.string(),
  /** Spoken before the next main question ("Next question."); empty for follow-ups. */
  lead: z.string(),
  next: turnViewSchema.nullable(),
  closing: z.string().nullable(),
});

export const sessionStatusSchema = z.enum(['planned', 'in_progress', 'paused', 'completed', 'abandoned']);

export const sessionDetailSchema = z.object({
  id: z.string(),
  status: sessionStatusSchema,
  config: interviewConfigSchema,
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  intro: z.string(),
  turns: z.array(
    turnViewSchema.extend({
      answer: z.object({ transcript: z.string(), createdAt: z.string() }).nullable(),
    }),
  ),
  /** The open question waiting for an answer, if any. */
  current: turnViewSchema.nullable(),
});

export const sessionSummarySchema = z.object({
  id: z.string(),
  status: sessionStatusSchema,
  jobTitle: z.string(),
  interviewType: interviewTypeSchema,
  createdAt: z.string(),
  answered: z.number(),
  totalQuestions: z.number(),
});

export type InterviewConfig = z.infer<typeof interviewConfigSchema>;
export type CreateSessionRequest = z.input<typeof createSessionRequestSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type TurnView = z.infer<typeof turnViewSchema>;
export type TurnResult = z.infer<typeof turnResultSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type Level = z.infer<typeof levelSchema>;
