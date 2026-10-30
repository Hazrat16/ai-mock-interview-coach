import { z } from 'zod';
import { interviewTypeSchema, levelSchema } from './interview';
import { provenanceSchema } from './provenance';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 2026-10-30');
const companyName = z.string().trim().min(1).max(120);
/** Where you got it: a link, "recruiter call", "friend who interviewed there"... */
const source = z.string().trim().min(2).max(300);

export const companyNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  source: z.string(),
  sourceDate: z.string(),
  createdAt: z.string(),
});

export const companyQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  interviewType: interviewTypeSchema,
  provenance: provenanceSchema,
});

export const companySchema = z.object({
  name: z.string(),
  notes: z.array(companyNoteSchema),
  questions: z.array(companyQuestionSchema),
});

export const addCompanyNoteSchema = z.object({
  company: companyName,
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(50, 'Paste at least a few sentences.').max(30_000),
  source,
  sourceDate: day,
});

export const addCompanyQuestionsSchema = z.object({
  company: companyName,
  interviewType: interviewTypeSchema,
  /** One question per entry (the page splits lines). */
  questions: z.array(z.string().trim().min(10).max(500)).min(1).max(50),
  source,
  sourceDate: day,
});

export const predictQuestionsSchema = z.object({
  company: companyName,
  interviewType: interviewTypeSchema,
  jobTitle: z.string().trim().min(2).max(100),
  level: levelSchema,
  count: z.number().int().min(1).max(10),
});

export const addQuestionsResultSchema = z.object({ added: z.number().int(), duplicates: z.number().int() });

export type Company = z.infer<typeof companySchema>;
export type CompanyQuestion = z.infer<typeof companyQuestionSchema>;
