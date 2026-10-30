import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { confirmDeleteSchema, DELETE_WORD, RESTORE_WORD, restoreRequestSchema } from '@shared/schemas/data';
import type { Db } from '../db/connection';
import { interviewActive } from '../db/repos/evaluations';
import { dataSummary, deleteAll, deleteTranscripts, exportAll, restoreBackup } from '../data/manage';
import { conflict, HttpError } from '../errors';
import type { SampleStore } from '../speech/samples';

function parse<T>(schema: z.ZodType<T>, value: unknown, word: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, `Type ${word} to confirm.`);
  return result.data;
}

export function dataRoutes(app: FastifyInstance, db: Db, dataDir: string, version: string, samples: SampleStore) {
  const summary = () => dataSummary(db, samples.list().samples.length);
  // Not while an interview is going on: its next answer would land in data that was just replaced or removed.
  const notDuringInterview = () => {
    if (interviewActive(db)) throw conflict('An interview is in progress. Finish or end it first.');
  };

  app.get('/api/data/summary', summary);

  app.get('/api/data/export', (_req, reply) => {
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-disposition', `attachment; filename="interview-coach-export-${day}.json"`)
      .type('application/json')
      .send(JSON.stringify(exportAll(db, version), null, 2));
  });

  app.post('/api/data/restore', async (req) => {
    const { name } = parse(restoreRequestSchema, req.body, RESTORE_WORD);
    notDuringInterview();
    return restoreBackup(db, dataDir, name);
  });

  app.post('/api/data/delete-transcripts', (req) => {
    parse(confirmDeleteSchema, req.body, DELETE_WORD);
    notDuringInterview();
    deleteTranscripts(db);
    return { summary: summary() };
  });

  app.post('/api/data/delete-all', async (req) => {
    parse(confirmDeleteSchema, req.body, DELETE_WORD);
    notDuringInterview();
    deleteAll(db);
    await samples.deleteAll();
    return { summary: summary() };
  });
}
