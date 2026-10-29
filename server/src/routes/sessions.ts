import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { answerRequestSchema, createSessionRequestSchema, sessionStatusSchema } from '@shared/schemas/interview';
import { HttpError } from '../errors';
import type { InterviewEngine } from '../interview/engine';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

type Params = { id: string; turnId: string };

export function sessionRoutes(app: FastifyInstance, engine: InterviewEngine) {
  app.post('/api/sessions', (req) => engine.create(parse(createSessionRequestSchema, req.body)));

  app.get('/api/sessions', (req) => {
    const { status } = parse(z.object({ status: sessionStatusSchema.optional() }), req.query);
    return engine.list(status);
  });

  app.get<{ Params: Params }>('/api/sessions/:id', (req) => engine.detail(req.params.id));

  app.post<{ Params: Params }>('/api/sessions/:id/start', (req) => engine.start(req.params.id));

  app.post<{ Params: Params }>('/api/sessions/:id/turns/:turnId/answer', (req) =>
    engine.answer(req.params.id, req.params.turnId, parse(answerRequestSchema, req.body)),
  );

  app.post<{ Params: Params }>('/api/sessions/:id/turns/:turnId/skip', (req) =>
    engine.skip(req.params.id, req.params.turnId),
  );

  app.post<{ Params: Params }>('/api/sessions/:id/end', (req) => engine.end(req.params.id));

  app.delete<{ Params: Params }>('/api/sessions/:id', (req, reply) => {
    engine.delete(req.params.id);
    return reply.code(204).send();
  });
}
