import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/connection';
import { enqueueSessionEvaluations, retryEvaluation } from '../db/repos/evaluations';
import { getSession } from '../db/repos/sessions';
import { conflict, notFound } from '../errors';
import { EVALUATION_PROMPT_VERSION } from '../evaluation/evaluator';
import { buildReport } from '../evaluation/report';
import { rubricFor } from '../evaluation/rubrics';

export type EvaluationQueue = {
  /** Queues evaluations for a session's answered questions (idempotent); returns how many were added. */
  enqueue: (sessionId: string) => number;
  retry: (evaluationId: string) => boolean;
};

export function evaluationQueue(db: Db, evaluatorModel: () => string, wake: () => void): EvaluationQueue {
  return {
    enqueue(sessionId) {
      const session = getSession(db, sessionId);
      if (!session) return 0;
      const rubric = rubricFor(session.config.interviewType);
      const n = enqueueSessionEvaluations(db, sessionId, rubric, EVALUATION_PROMPT_VERSION, evaluatorModel());
      if (n) wake();
      return n;
    },
    retry(evaluationId) {
      const ok = retryEvaluation(db, evaluationId, evaluatorModel());
      if (ok) wake();
      return ok;
    },
  };
}

export function evaluationRoutes(app: FastifyInstance, db: Db, queue: EvaluationQueue) {
  app.get<{ Params: { id: string } }>('/api/sessions/:id/report', (req) => buildReport(db, req.params.id));

  // For interviews finished before evaluation existed, or ended early: evaluate what was answered.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/evaluate', (req) => {
    const session = getSession(db, req.params.id);
    if (!session) throw notFound('Interview');
    if (session.status !== 'completed') throw conflict('Only finished interviews can be evaluated.');
    queue.enqueue(session.id);
    return buildReport(db, session.id);
  });

  app.post<{ Params: { id: string } }>('/api/evaluations/:id/retry', (req, reply) => {
    if (!queue.retry(req.params.id)) throw notFound('Evaluation');
    return reply.code(202).send({ queued: true });
  });
}
