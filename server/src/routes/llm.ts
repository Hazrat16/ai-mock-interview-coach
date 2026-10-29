import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type ModelTestResult, modelTestRequestSchema } from '@shared/schemas/llm';
import type { Env } from '../env';
import type { OllamaClient } from '../llm/ollamaClient';
import { structuredChat } from '../llm/structured';

const testReplySchema = z.object({ question: z.string().min(5) });

export function llmRoutes(app: FastifyInstance, env: Env, llm: OllamaClient) {
  // A small real request, so the Settings page can show that a model works and how fast it is.
  app.post('/api/llm/test', async (req, reply) => {
    const body = modelTestRequestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'model is required' });

    const started = performance.now();
    const result = await structuredChat(llm, {
      model: body.data.model,
      schema: testReplySchema,
      messages: [
        { role: 'system', content: 'You are a job interviewer. Reply in JSON.' },
        { role: 'user', content: 'Ask one short behavioral interview question for a junior software engineer.' },
      ],
      options: { temperature: 0.7, num_predict: 120, num_thread: env.LLM_NUM_THREAD },
      keepAlive: '10m',
      timeoutMs: 180_000,
    });
    const last = result.metrics.at(-1)!;
    const sec = (ms: number) => Math.round(ms / 100) / 10;
    return {
      model: body.data.model,
      seconds: sec(performance.now() - started),
      loadSeconds: sec(result.metrics.reduce((s, m) => s + m.loadMs, 0)),
      outputTokensPerSec: last.outputMs ? Math.round((last.outputTokens / last.outputMs) * 10_000) / 10 : 0,
      attempts: result.attempts,
      question: result.data.question,
    } satisfies ModelTestResult;
  });
}
