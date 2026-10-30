import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addCompanyNoteSchema, addCompanyQuestionsSchema, predictQuestionsSchema } from '@shared/schemas/companies';
import type { Settings } from '@shared/schemas/settings';
import type { Db } from '../db/connection';
import {
  addCompanyQuestions,
  deleteCompanyQuestion,
  getCompany,
  insertCompanyNote,
  listCompanies,
} from '../db/repos/companies';
import { setSummary } from '../db/repos/documents';
import { summarizeDocument } from '../documents/summarize';
import { HttpError, notFound } from '../errors';
import type { InterviewEngine } from '../interview/engine';
import type { OllamaClient } from '../llm/ollamaClient';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

/** Company preparation (M14, R23): your notes and questions with their sources, and labelled predictions. */
export function companyRoutes(
  app: FastifyInstance,
  db: Db,
  engine: InterviewEngine,
  llm: OllamaClient,
  settings: () => Settings,
  numThread?: number,
) {
  app.get('/api/companies', () => listCompanies(db));

  app.post('/api/companies/notes', async (req) => {
    const note = parse(addCompanyNoteSchema, req.body);
    const id = insertCompanyNote(db, note);
    let summaryError: string | null = null;
    try {
      const summary = await summarizeDocument(
        llm,
        { model: settings().evaluatorModel, numThread },
        'company_notes',
        note.text,
      );
      setSummary(db, id, summary);
    } catch (err) {
      summaryError = (err as Error).message;
    }
    return { company: getCompany(db, note.company)!, summaryError };
  });

  app.post('/api/companies/questions', (req) => {
    const q = parse(addCompanyQuestionsSchema, req.body);
    return addCompanyQuestions(
      db,
      q.company,
      q.interviewType,
      q.questions.map((text) => ({ text })),
      { source: q.source, sourceDate: q.sourceDate },
    );
  });

  app.post('/api/companies/predict', async (req) => {
    const p = parse(predictQuestionsSchema, req.body);
    return engine.predictForCompany(p.company, { ...p, difficulty: 'medium' }, p.count);
  });

  app.delete<{ Params: { id: string } }>('/api/companies/questions/:id', (req, reply) => {
    if (!deleteCompanyQuestion(db, req.params.id)) throw notFound('Question');
    return reply.code(204).send();
  });
}
