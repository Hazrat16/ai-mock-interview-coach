// The session report (R9): every question with its follow-ups and answers, the evaluation of each question,
// the session average, and delivery metrics kept apart from the content scores.
import type { Delivery } from '@shared/delivery';
import type { SessionReport } from '@shared/schemas/evaluation';
import type { Db } from '../db/connection';
import { evaluationsForSession } from '../db/repos/evaluations';
import { getSession, getTurns } from '../db/repos/sessions';
import { notFound } from '../errors';
import { average } from './scoring';

export function buildReport(db: Db, sessionId: string): SessionReport {
  const session = getSession(db, sessionId);
  if (!session) throw notFound('Interview');
  const turns = getTurns(db, sessionId);
  const answerRows = db
    .prepare(
      `SELECT a.turn_id, a.input_method, a.delivery_json FROM answers a JOIN turns t ON t.id = a.turn_id
       WHERE t.session_id = ?`,
    )
    .all(sessionId) as { turn_id: string; input_method: 'voice' | 'typed_fallback'; delivery_json: string | null }[];
  const answerMeta = new Map(answerRows.map((r) => [r.turn_id, r]));
  const evaluations = evaluationsForSession(db, sessionId);

  const items: SessionReport['items'] = [];
  let questionNumber = 0;
  for (const main of turns.filter((t) => t.kind === 'main')) {
    questionNumber++;
    const thread = turns
      .filter((t) => t.id === main.id || t.parentTurnId === main.id)
      .map((t) => {
        const meta = answerMeta.get(t.id);
        return {
          id: t.id,
          seq: t.seq,
          kind: t.kind,
          text: t.questionText,
          questionNumber,
          totalQuestions: session.plan.questionIds.length,
          answer: t.answer
            ? {
                transcript: t.answer.transcript,
                inputMethod: meta?.input_method ?? 'typed_fallback',
                delivery: meta?.delivery_json ? (JSON.parse(meta.delivery_json) as Delivery) : null,
              }
            : null,
        };
      });
    items.push({
      questionNumber,
      thread,
      evaluation: main.answer ? (evaluations.get(main.answer.id) ?? null) : null,
    });
  }

  const evals = items.map((i) => i.evaluation).filter((e) => e !== null);
  const deliveries = items.flatMap((i) => i.thread.flatMap((t) => (t.answer?.delivery ? [t.answer.delivery] : [])));
  const mean = (f: (d: Delivery) => number) => Math.round(deliveries.reduce((s, d) => s + f(d), 0) / deliveries.length);

  return {
    sessionId,
    status: session.status,
    config: {
      jobTitle: session.config.jobTitle,
      level: session.config.level,
      interviewType: session.config.interviewType,
    },
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    items,
    average: average(evals.flatMap((e) => (e.status === 'done' && e.overallScore !== null ? [e.overallScore] : []))),
    progress: {
      done: evals.filter((e) => e.status === 'done').length,
      pending: evals.filter((e) => e.status === 'pending' || e.status === 'running').length,
      failed: evals.filter((e) => e.status === 'failed').length,
      total: items.filter((i) => i.thread[0]?.answer).length,
    },
    delivery: deliveries.length
      ? {
          answers: deliveries.length,
          wordsPerMinute: mean((d) => d.wordsPerMinute),
          longPauses: deliveries.reduce((s, d) => s + d.longPauses, 0),
          fillerWords: deliveries.reduce((s, d) => s + d.fillerWords, 0),
          responseLatencyMs: mean((d) => d.responseLatencyMs),
        }
      : null,
  };
}
