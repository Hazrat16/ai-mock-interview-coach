import type { EvaluationResult, EvaluationView } from '@shared/schemas/evaluation';
import { rubricByKey } from '../../evaluation/rubrics';
import type { Rubric } from '../../evaluation/rubrics';
import { type Db, transaction } from '../connection';
import { newId, nowIso } from '../ids';

type EvaluationRow = {
  id: string;
  answer_id: string;
  status: EvaluationView['status'];
  rubric_key: string;
  rubric_version: number;
  prompt_version: number;
  model_tag: string;
  overall_score: number | null;
  result_json: string | null;
  unsupported_evidence_count: number;
  error: string | null;
  duration_ms: number | null;
};

function toView(r: EvaluationRow): EvaluationView {
  return {
    id: r.id,
    status: r.status,
    rubricKey: r.rubric_key,
    rubricVersion: r.rubric_version,
    rubricTitle: rubricByKey(r.rubric_key)?.title ?? r.rubric_key,
    model: r.model_tag,
    overallScore: r.overall_score,
    unsupportedEvidence: r.unsupported_evidence_count,
    error: r.error,
    durationMs: r.duration_ms,
    result: r.result_json ? (JSON.parse(r.result_json) as EvaluationResult) : null,
  };
}

function addJob(db: Db, evaluationId: string, now: string) {
  db.prepare(
    `INSERT INTO jobs (id, kind, payload_json, status, created_at, updated_at)
     VALUES (?, 'evaluate_answer', ?, 'pending', ?, ?)`,
  ).run(newId(), JSON.stringify({ evaluationId }), now, now);
}

/**
 * Queues one evaluation per answered main question of a session (its follow-ups are evaluated with it).
 * Idempotent: questions that already have an evaluation are left alone. Returns how many were queued.
 */
export function enqueueSessionEvaluations(
  db: Db,
  sessionId: string,
  rubric: Rubric,
  promptVersion: number,
  model: string,
): number {
  return transaction(db, () => {
    const answers = db
      .prepare(
        `SELECT a.id FROM turns t JOIN answers a ON a.turn_id = t.id
         WHERE t.session_id = ? AND t.kind = 'main'
           AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.answer_id = a.id)
         ORDER BY t.seq`,
      )
      .all(sessionId) as { id: string }[];
    const now = nowIso();
    const insert = db.prepare(
      `INSERT INTO evaluations (id, answer_id, status, rubric_key, rubric_version, prompt_version, model_tag, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
    );
    for (const a of answers) {
      const id = newId();
      insert.run(id, a.id, rubric.key, rubric.version, promptVersion, model, now);
      addJob(db, id, now);
    }
    return answers.length;
  });
}

export type Job = { id: string; evaluationId: string; attempts: number };

/** Takes the oldest pending job and marks it (and its evaluation) running. */
export function claimNextJob(db: Db): Job | undefined {
  return transaction(db, () => {
    const row = db
      .prepare(
        `SELECT id, payload_json, attempts FROM jobs WHERE status = 'pending' AND kind = 'evaluate_answer'
         ORDER BY created_at, rowid LIMIT 1`,
      )
      .get() as { id: string; payload_json: string; attempts: number } | undefined;
    if (!row) return undefined;
    const now = nowIso();
    db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(
      now,
      row.id,
    );
    const { evaluationId } = JSON.parse(row.payload_json) as { evaluationId: string };
    db.prepare(`UPDATE evaluations SET status = 'running', error = NULL WHERE id = ?`).run(evaluationId);
    return { id: row.id, evaluationId, attempts: row.attempts + 1 };
  });
}

/** After a crash or restart: work that was running is pending again. Returns how many were reset. */
export function resetRunningJobs(db: Db): number {
  return transaction(db, () => {
    const now = nowIso();
    const n = db
      .prepare(`UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'running'`)
      .run(now).changes;
    db.prepare(`UPDATE evaluations SET status = 'pending' WHERE status = 'running'`).run();
    return Number(n);
  });
}

/** Puts a job back in the queue without counting it as failed (e.g. Ollama was not running). */
export function requeueJob(db: Db, job: Job, error: string) {
  transaction(db, () => {
    db.prepare(`UPDATE jobs SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`).run(
      error,
      nowIso(),
      job.id,
    );
    db.prepare(`UPDATE evaluations SET status = 'pending', error = ? WHERE id = ?`).run(error, job.evaluationId);
  });
}

export function completeEvaluation(
  db: Db,
  job: Job,
  e: {
    model: string;
    /** Null for an interview-ready answer written without scoring. */
    overall: number | null;
    result: EvaluationResult;
    unsupported: number;
    durationMs: number;
    skills: Record<string, string>;
  },
) {
  transaction(db, () => {
    db.prepare(
      `UPDATE evaluations SET status = 'done', model_tag = ?, overall_score = ?, result_json = ?,
         unsupported_evidence_count = ?, error = NULL, duration_ms = ? WHERE id = ?`,
    ).run(e.model, e.overall, JSON.stringify(e.result), e.unsupported, e.durationMs, job.evaluationId);
    db.prepare('DELETE FROM evaluation_scores WHERE evaluation_id = ?').run(job.evaluationId);
    const insert = db.prepare(
      `INSERT INTO evaluation_scores (evaluation_id, criterion_key, skill_key, score, weight, evidence_json, rationale)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of e.result.criteria) {
      insert.run(
        job.evaluationId,
        c.key,
        e.skills[c.key] ?? c.key,
        c.score,
        c.weight,
        JSON.stringify(c.evidence),
        c.rationale,
      );
    }
    db.prepare(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), job.id);
  });
}

export function failEvaluation(db: Db, job: Job, error: string, durationMs: number) {
  transaction(db, () => {
    db.prepare(`UPDATE evaluations SET status = 'failed', error = ?, duration_ms = ? WHERE id = ?`).run(
      error,
      durationMs,
      job.evaluationId,
    );
    db.prepare(`UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`).run(
      error,
      nowIso(),
      job.id,
    );
  });
}

/** "Retry evaluation": queues a failed (or finished) evaluation again. False if it does not exist. */
export function retryEvaluation(db: Db, evaluationId: string, model: string): boolean {
  return transaction(db, () => {
    const found = db.prepare('SELECT status FROM evaluations WHERE id = ?').get(evaluationId) as
      { status: string } | undefined;
    if (!found) return false;
    if (found.status === 'pending' || found.status === 'running') return true; // already queued
    db.prepare(
      `UPDATE evaluations SET status = 'pending', error = NULL, overall_score = NULL, result_json = NULL,
         unsupported_evidence_count = 0, duration_ms = NULL, model_tag = ? WHERE id = ?`,
    ).run(model, evaluationId);
    db.prepare('DELETE FROM evaluation_scores WHERE evaluation_id = ?').run(evaluationId);
    addJob(db, evaluationId, nowIso());
    return true;
  });
}

export function getEvaluation(db: Db, id: string) {
  const r = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id) as EvaluationRow | undefined;
  return r && { ...toView(r), answerId: r.answer_id };
}

/** Latest evaluation per answer, keyed by answer id. */
export function evaluationsForSession(db: Db, sessionId: string): Map<string, EvaluationView> {
  const rows = db
    .prepare(
      `SELECT e.* FROM evaluations e JOIN answers a ON a.id = e.answer_id JOIN turns t ON t.id = a.turn_id
       WHERE t.session_id = ? ORDER BY e.created_at`,
    )
    .all(sessionId) as EvaluationRow[];
  return new Map(rows.map((r) => [r.answer_id, toView(r)]));
}

/**
 * True while someone is in an interview: a session in progress with activity in the last `withinMs`.
 * Evaluations wait meanwhile, so they never compete with the live interviewer for the LLM.
 * A session left open and forgotten stops counting after `withinMs`.
 */
export function interviewActive(db: Db, now = Date.now(), withinMs = 10 * 60_000): boolean {
  const since = new Date(now - withinMs).toISOString();
  const row = db
    .prepare(
      `SELECT 1 FROM sessions s WHERE s.status = 'in_progress' AND (
         s.started_at >= ?
         OR EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND t.asked_at >= ?)
         OR EXISTS (SELECT 1 FROM turns t JOIN answers a ON a.turn_id = t.id WHERE t.session_id = s.id AND a.created_at >= ?)
       ) LIMIT 1`,
    )
    .get(since, since, since);
  return row !== undefined;
}
