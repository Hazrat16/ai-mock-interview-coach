import { z } from 'zod';
import { interviewTypeSchema, levelSchema, sessionStatusSchema } from './interview';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 2026-10-30');

/** GET /api/history query. Filters combine; `q` searches questions and answers (whole words or word starts). */
export const historyQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: interviewTypeSchema.optional(),
  level: levelSchema.optional(),
  /** Inclusive, by the day the interview was created (UTC). */
  from: day.optional(),
  to: day.optional(),
});

/** Marks around the matched words in a snippet; the web page turns them into highlights. */
export const MATCH_START = '\u0002';
export const MATCH_END = '\u0003';

export const historyItemSchema = z.object({
  id: z.string(),
  status: sessionStatusSchema,
  jobTitle: z.string(),
  interviewType: interviewTypeSchema,
  level: levelSchema,
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  answered: z.number().int(),
  totalQuestions: z.number().int(),
  /** The first question asked, to tell similar interviews apart; null before it was asked. */
  firstQuestion: z.string().nullable(),
  /** With a search: where the words were found (up to 3 per interview), both with the words marked. */
  matches: z.array(z.object({ questionText: z.string(), snippet: z.string() })),
});

/** Spoken answers of one interview, averaged the same way as in its report. */
export const deliveryPointSchema = z.object({
  sessionId: z.string(),
  date: z.string(),
  answers: z.number().int(),
  wordsPerMinute: z.number(),
  fillerWordsPerAnswer: z.number(),
  longPausesPerAnswer: z.number(),
});

export const dashboardSchema = z.object({
  interviews: z.object({ completed: z.number().int(), inProgress: z.number().int(), total: z.number().int() }),
  questionsAnswered: z.number().int(),
  /** Sum of completed interviews' durations (start to end). */
  practiceMinutes: z.number().int(),
  lastPracticedAt: z.string().nullable(),
  /** Completed interviews per type. */
  byType: z.array(z.object({ interviewType: interviewTypeSchema, count: z.number().int() })),
  /** Skill tags of the bank questions you answered, most practised first. */
  topics: z.array(z.object({ tag: z.string(), count: z.number().int() })),
  /** Oldest first, completed interviews with spoken answers only. */
  delivery: z.array(deliveryPointSchema),
  recent: z.array(historyItemSchema),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type DeliveryPoint = z.infer<typeof deliveryPointSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
