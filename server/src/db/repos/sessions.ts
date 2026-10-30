import type { AnswerRequest, InterviewConfig } from '@shared/schemas/interview';
import type { Db } from '../connection';
import { newId, nowIso } from '../ids';

export type SessionStatus = 'planned' | 'in_progress' | 'paused' | 'completed' | 'abandoned';
export type SessionPlan = { seed: number; questionIds: string[] };

export type SessionRow = {
  id: string;
  status: SessionStatus;
  config: InterviewConfig;
  plan: SessionPlan;
  interviewerModel: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type TurnRow = {
  id: string;
  sessionId: string;
  seq: number;
  kind: 'main' | 'follow_up';
  parentTurnId: string | null;
  questionId: string | null;
  questionText: string;
  difficulty: string | null;
  summary: string | null;
  qualitySignal: 'weak' | 'ok' | 'strong' | null;
  askedAt: string | null;
  answer: { id: string; transcript: string; createdAt: string } | null;
};

export function insertSession(
  db: Db,
  s: { config: InterviewConfig; plan: SessionPlan; mode: string; interviewerModel: string },
): string {
  const now = nowIso();
  const configId = newId();
  const c = s.config;
  db.prepare(
    `INSERT INTO interview_configs (id, job_title, job_family, level, interview_type, difficulty, question_count,
       duration_minutes, thinking_time_sec, follow_up_limit, custom_instructions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    configId,
    c.jobTitle,
    c.jobFamily,
    c.level,
    c.interviewType,
    c.difficulty,
    c.questionCount,
    c.durationMinutes ?? null,
    c.thinkingTimeSec,
    c.followUpLimit,
    c.customInstructions ?? null,
    now,
  );
  const id = newId();
  db.prepare(
    `INSERT INTO sessions (id, config_id, config_snapshot_json, mode, status, plan_json, interviewer_model, created_at)
     VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)`,
  ).run(id, configId, JSON.stringify(c), s.mode, JSON.stringify(s.plan), s.interviewerModel, now);
  return id;
}

type SessionDbRow = {
  id: string;
  status: SessionStatus;
  config_snapshot_json: string;
  plan_json: string;
  interviewer_model: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

const toSession = (r: SessionDbRow): SessionRow => ({
  id: r.id,
  status: r.status,
  config: JSON.parse(r.config_snapshot_json),
  plan: JSON.parse(r.plan_json),
  interviewerModel: r.interviewer_model,
  createdAt: r.created_at,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

export function getSession(db: Db, id: string): SessionRow | undefined {
  const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionDbRow | undefined;
  return r && toSession(r);
}

export function listSessions(db: Db, status?: SessionStatus, limit = 50) {
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM turns t JOIN answers a ON a.turn_id = t.id
                    WHERE t.session_id = s.id AND t.kind = 'main') AS answered
       FROM sessions s WHERE (?1 IS NULL OR s.status = ?1) ORDER BY s.created_at DESC LIMIT ?2`,
    )
    .all(status ?? null, limit) as (SessionDbRow & { answered: number })[];
  return rows.map((r) => ({ ...toSession(r), answered: r.answered }));
}

export function setStatus(db: Db, id: string, status: SessionStatus) {
  const now = nowIso();
  db.prepare(
    `UPDATE sessions SET status = ?,
       started_at = CASE WHEN ? = 'in_progress' THEN COALESCE(started_at, ?) ELSE started_at END,
       ended_at = CASE WHEN ? IN ('completed', 'abandoned') THEN ? ELSE ended_at END
     WHERE id = ?`,
  ).run(status, status, now, status, now, id);
}

/** Deletes the session; turns and answers go with it (ON DELETE CASCADE). */
export function deleteSession(db: Db, id: string): boolean {
  const configId = (db.prepare('SELECT config_id FROM sessions WHERE id = ?').get(id) as { config_id: string })
    ?.config_id;
  const removed = Number(db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes) > 0;
  if (configId) {
    db.prepare(
      'DELETE FROM interview_configs WHERE id = ? AND is_template = 0 AND NOT EXISTS (SELECT 1 FROM sessions WHERE config_id = ?)',
    ).run(configId, configId);
  }
  return removed;
}

type TurnDbRow = {
  id: string;
  session_id: string;
  seq: number;
  kind: 'main' | 'follow_up';
  parent_turn_id: string | null;
  question_id: string | null;
  question_text: string;
  difficulty: string | null;
  summary: string | null;
  quality_signal: TurnRow['qualitySignal'];
  asked_at: string | null;
  answer_id: string | null;
  transcript: string | null;
  answered_at: string | null;
};

/** All turns of a session in order, each with its answer if any. */
export function getTurns(db: Db, sessionId: string): TurnRow[] {
  const rows = db
    .prepare(
      `SELECT t.*, a.id AS answer_id, a.transcript, a.created_at AS answered_at
       FROM turns t LEFT JOIN answers a ON a.turn_id = t.id WHERE t.session_id = ? ORDER BY t.seq`,
    )
    .all(sessionId) as TurnDbRow[];
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    seq: r.seq,
    kind: r.kind,
    parentTurnId: r.parent_turn_id,
    questionId: r.question_id,
    questionText: r.question_text,
    difficulty: r.difficulty,
    summary: r.summary,
    qualitySignal: r.quality_signal,
    askedAt: r.asked_at,
    answer: r.answer_id ? { id: r.answer_id, transcript: r.transcript!, createdAt: r.answered_at! } : null,
  }));
}

export function insertTurn(
  db: Db,
  t: {
    sessionId: string;
    seq: number;
    kind: 'main' | 'follow_up';
    parentTurnId?: string;
    questionId?: string;
    questionText: string;
    difficulty?: string;
  },
): string {
  const id = newId();
  db.prepare(
    `INSERT INTO turns (id, session_id, seq, kind, parent_turn_id, question_id, question_text, difficulty, asked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    t.sessionId,
    t.seq,
    t.kind,
    t.parentTurnId ?? null,
    t.questionId ?? null,
    t.questionText,
    t.difficulty ?? null,
    nowIso(),
  );
  return id;
}

export function updateTurnInsight(db: Db, turnId: string, summary: string, quality: TurnRow['qualitySignal']) {
  db.prepare('UPDATE turns SET summary = ?, quality_signal = ? WHERE id = ?').run(summary, quality, turnId);
}

/** The question as it was last asked (reworded after "I don't understand"). */
export function updateTurnQuestion(db: Db, turnId: string, questionText: string) {
  db.prepare('UPDATE turns SET question_text = ? WHERE id = ?').run(questionText, turnId);
}

export function insertAnswer(db: Db, a: AnswerRequest & { turnId: string }): string {
  const id = newId();
  const wordCount = a.transcript.split(/\s+/).filter(Boolean).length;
  const delivery = a.voice?.delivery;
  db.prepare(
    `INSERT INTO answers (id, turn_id, transcript, input_method, stt_model, duration_ms, speaking_ms, word_count,
       delivery_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    a.turnId,
    a.transcript,
    a.inputMethod,
    a.voice?.sttModel ?? null,
    a.durationMs ?? delivery?.answerMs ?? null,
    delivery?.speakingMs ?? null,
    wordCount,
    delivery ? JSON.stringify(delivery) : null,
    nowIso(),
  );
  return id;
}
