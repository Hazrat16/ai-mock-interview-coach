// History search (R12) and the dashboard numbers (R13), straight from SQL. Interviews created but never
// started ('planned') are left out everywhere. Scores are left out while scoring is off (shared/features.ts).
import { type Dashboard, type HistoryItem, type HistoryQuery, MATCH_END, MATCH_START } from '@shared/schemas/history';
import type { InterviewConfig } from '@shared/schemas/interview';
import type { Db } from '../connection';
import type { SessionPlan, SessionStatus } from './sessions';

const MATCHES_PER_INTERVIEW = 3;

/**
 * Turns what was typed into an FTS5 query: every word must appear, as a whole word or the start of one
 * ("index" finds "indexes"). Quotes and operators are dropped, so no input can break the query.
 */
export function ftsQuery(q: string): string | undefined {
  const words = q.match(/[\p{L}\p{N}]+/gu);
  return words?.length ? words.map((w) => `"${w}"*`).join(' ') : undefined;
}

type Match = { questionText: string; snippet: string };

function searchAnswers(db: Db, query: string): Map<string, Match[]> {
  const rows = db
    .prepare(
      `SELECT t.session_id, highlight(answers_fts, 1, ?1, ?2) AS question_text,
         snippet(answers_fts, 2, ?1, ?2, '…', 12) AS snippet
       FROM answers_fts JOIN answers a ON a.id = answers_fts.answer_id JOIN turns t ON t.id = a.turn_id
       WHERE answers_fts MATCH ?3 ORDER BY bm25(answers_fts), t.seq`,
    )
    .all(MATCH_START, MATCH_END, query) as { session_id: string; question_text: string; snippet: string }[];
  const bySession = new Map<string, Match[]>();
  for (const r of rows) {
    const list = bySession.get(r.session_id) ?? [];
    if (list.length < MATCHES_PER_INTERVIEW) list.push({ questionText: r.question_text, snippet: r.snippet });
    bySession.set(r.session_id, list);
  }
  return bySession;
}

type SessionListRow = {
  id: string;
  status: SessionStatus;
  config_snapshot_json: string;
  plan_json: string;
  created_at: string;
  ended_at: string | null;
  answered: number;
  first_question: string | null;
};

/** Interviews, newest first, with every filter applied. */
export function searchHistory(db: Db, query: HistoryQuery, limit = 100): HistoryItem[] {
  const fts = query.q ? ftsQuery(query.q) : undefined;
  const matches = fts ? searchAnswers(db, fts) : undefined;
  if (matches?.size === 0) return [];
  const rows = db
    .prepare(
      `SELECT s.id, s.status, s.config_snapshot_json, s.plan_json, s.created_at, s.ended_at,
         (SELECT COUNT(*) FROM turns t JOIN answers a ON a.turn_id = t.id
          WHERE t.session_id = s.id AND t.kind = 'main') AS answered,
         (SELECT question_text FROM turns t WHERE t.session_id = s.id AND t.kind = 'main'
          ORDER BY t.seq LIMIT 1) AS first_question
       FROM sessions s
       WHERE s.status != 'planned'
         AND (?1 IS NULL OR json_extract(s.config_snapshot_json, '$.interviewType') = ?1)
         AND (?2 IS NULL OR json_extract(s.config_snapshot_json, '$.level') = ?2)
         AND (?3 IS NULL OR s.created_at >= ?3)
         AND (?4 IS NULL OR s.created_at < date(?4, '+1 day'))
         AND (?5 IS NULL OR s.id IN (SELECT value FROM json_each(?5)))
       ORDER BY s.created_at DESC LIMIT ?6`,
    )
    .all(
      query.type ?? null,
      query.level ?? null,
      query.from ?? null,
      query.to ?? null,
      matches ? JSON.stringify([...matches.keys()]) : null,
      limit,
    ) as SessionListRow[];
  return rows.map((r) => {
    const config = JSON.parse(r.config_snapshot_json) as InterviewConfig;
    return {
      id: r.id,
      status: r.status,
      jobTitle: config.jobTitle,
      interviewType: config.interviewType,
      level: config.level,
      createdAt: r.created_at,
      endedAt: r.ended_at,
      answered: r.answered,
      totalQuestions: (JSON.parse(r.plan_json) as SessionPlan).questionIds.length,
      firstQuestion: r.first_question,
      matches: matches?.get(r.id) ?? [],
    };
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function dashboardStats(db: Db, topicLimit = 12): Dashboard {
  const one = <T>(sql: string) => db.prepare(sql).get() as T;
  const interviews = one<{ completed: number; in_progress: number; total: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE status IN ('in_progress', 'paused')) AS in_progress,
            COUNT(*) AS total
     FROM sessions WHERE status != 'planned'`,
  );
  const answered = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM answers a JOIN turns t ON t.id = a.turn_id JOIN sessions s ON s.id = t.session_id
     WHERE t.kind = 'main' AND s.status != 'planned'`,
  );
  const practice = one<{ minutes: number | null; last: string | null }>(
    `SELECT SUM(CASE WHEN status = 'completed' AND started_at IS NOT NULL AND ended_at IS NOT NULL
                     THEN (julianday(ended_at) - julianday(started_at)) * 1440 END) AS minutes,
            MAX(COALESCE(ended_at, started_at)) AS last
     FROM sessions WHERE status != 'planned'`,
  );
  const byType = db
    .prepare(
      `SELECT json_extract(config_snapshot_json, '$.interviewType') AS interviewType, COUNT(*) AS count
       FROM sessions WHERE status = 'completed' GROUP BY 1 ORDER BY count DESC, interviewType`,
    )
    .all() as Dashboard['byType'];
  const topics = db
    .prepare(
      `SELECT tag.value AS tag, COUNT(*) AS count
       FROM turns t JOIN answers a ON a.turn_id = t.id JOIN sessions s ON s.id = t.session_id
         JOIN questions q ON q.id = t.question_id, json_each(q.skill_tags_json) AS tag
       WHERE t.kind = 'main' AND s.status != 'planned'
       GROUP BY tag.value ORDER BY count DESC, tag LIMIT ?`,
    )
    .all(topicLimit) as Dashboard['topics'];
  const delivery = db
    .prepare(
      `SELECT s.id AS sessionId, s.created_at AS date, COUNT(*) AS answers,
         AVG(json_extract(a.delivery_json, '$.wordsPerMinute')) AS wpm,
         SUM(json_extract(a.delivery_json, '$.fillerWords')) AS fillers,
         SUM(json_extract(a.delivery_json, '$.longPauses')) AS pauses
       FROM sessions s JOIN turns t ON t.session_id = s.id JOIN answers a ON a.turn_id = t.id
       WHERE s.status = 'completed' AND a.delivery_json IS NOT NULL
       GROUP BY s.id ORDER BY s.created_at`,
    )
    .all() as { sessionId: string; date: string; answers: number; wpm: number; fillers: number; pauses: number }[];

  return {
    interviews: { completed: interviews.completed, inProgress: interviews.in_progress, total: interviews.total },
    questionsAnswered: answered.n,
    practiceMinutes: Math.round(practice.minutes ?? 0),
    lastPracticedAt: practice.last,
    byType,
    topics,
    delivery: delivery.map((d) => ({
      sessionId: d.sessionId,
      date: d.date,
      answers: d.answers,
      wordsPerMinute: Math.round(d.wpm),
      fillerWordsPerAnswer: round1(d.fillers / d.answers),
      longPausesPerAnswer: round1(d.pauses / d.answers),
    })),
    recent: searchHistory(db, {}, 5),
  };
}
