import { z } from 'zod';

/** Company notes arrive with M14. */
export const DOCUMENT_KINDS = ['job_description', 'resume'] as const;
export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const documentViewSchema = z.object({
  id: z.string(),
  kind: documentKindSchema,
  title: z.string(),
  company: z.string().nullable(),
  /** Written by the local model when the document is added; null if that failed (try again). */
  summary: z.string().nullable(),
  chars: z.number().int(),
  createdAt: z.string(),
  /** Interviews based on it. */
  interviews: z.number().int(),
});

export const documentDetailSchema = documentViewSchema.extend({ text: z.string() });

/** Pasted text. Files are uploaded as the raw body to /api/documents/upload?kind=…&title=… instead. */
export const createDocumentSchema = z.object({
  kind: documentKindSchema,
  title: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).optional(),
  text: z.string().trim().min(50, 'Paste at least a few sentences.').max(30_000),
});

export const uploadQuerySchema = z.object({
  kind: documentKindSchema,
  title: z.string().trim().min(1).max(120),
});

/** After adding a document or summarizing it again. */
export const documentResultSchema = z.object({
  document: documentDetailSchema,
  /** Why the summary could not be written (e.g. Ollama not running); the document is saved anyway. */
  summaryError: z.string().nullable(),
});

export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentView = z.infer<typeof documentViewSchema>;
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
