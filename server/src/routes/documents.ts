import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createDocumentSchema, type DocumentKind, uploadQuerySchema } from '@shared/schemas/documents';
import type { Settings } from '@shared/schemas/settings';
import type { Db } from '../db/connection';
import { deleteDocument, getDocument, insertDocument, listDocuments, setSummary } from '../db/repos/documents';
import { documentText, MAX_UPLOAD_BYTES } from '../documents/text';
import { summarizeDocument } from '../documents/summarize';
import { HttpError, notFound } from '../errors';
import type { OllamaClient } from '../llm/ollamaClient';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

/** Resumes and job descriptions (M13). Text is extracted and summarized on this computer. */
export function documentRoutes(
  app: FastifyInstance,
  db: Db,
  llm: OllamaClient,
  settings: () => Settings,
  numThread?: number,
) {
  /** Summarizes and stores the summary; a failure (e.g. Ollama not running) is returned, not thrown. */
  const summarize = async (id: string, kind: DocumentKind, text: string) => {
    try {
      setSummary(db, id, await summarizeDocument(llm, { model: settings().evaluatorModel, numThread }, kind, text));
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  const add = async (d: { kind: DocumentKind; title: string; company?: string; text: string }) => {
    const id = insertDocument(db, { ...d, summary: null });
    const summaryError = await summarize(id, d.kind, d.text);
    return { document: getDocument(db, id)!, summaryError };
  };

  app.get('/api/documents', () => listDocuments(db));

  app.get<{ Params: { id: string } }>('/api/documents/:id', (req) => {
    const doc = getDocument(db, req.params.id);
    if (!doc) throw notFound('Document');
    return doc;
  });

  app.post('/api/documents', (req) => add(parse(createDocumentSchema, req.body)));

  // File uploads: the raw file is the body. The parsers apply to this route only (a plugin scope).
  void app.register(async (scope) => {
    for (const type of ['application/pdf', 'text/plain', 'application/octet-stream']) {
      scope.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) =>
        done(null, body),
      );
    }
    scope.post('/api/documents/upload', async (req) => {
      const { kind, title } = parse(uploadQuerySchema, req.query);
      if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the file as the request body.');
      return add({ kind, title, text: await documentText(req.body) });
    });
  });

  app.post<{ Params: { id: string } }>('/api/documents/:id/summarize', async (req) => {
    const doc = getDocument(db, req.params.id);
    if (!doc) throw notFound('Document');
    const summaryError = await summarize(doc.id, doc.kind, doc.text);
    return { document: getDocument(db, doc.id)!, summaryError };
  });

  app.delete<{ Params: { id: string } }>('/api/documents/:id', (req, reply) => {
    if (!deleteDocument(db, req.params.id)) throw notFound('Document');
    return reply.code(204).send();
  });
}
