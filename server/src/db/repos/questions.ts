import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  DIFFICULTIES,
  INTERVIEW_TYPES,
  type InterviewConfig,
  JOB_FAMILIES,
  LEVELS,
  type Level,
  TRACKS,
} from '@shared/schemas/interview';
import { type Db, transaction } from '../connection';
import { newId, nowIso } from '../ids';

const SEED_DIR = fileURLToPath(new URL('../../../../seed/questions', import.meta.url));

export type Question = {
  id: string;
  text: string;
  interviewType: (typeof INTERVIEW_TYPES)[number];
  jobFamily: string | null;
  levelMin: Level;
  levelMax: Level;
  difficulty: (typeof DIFFICULTIES)[number];
  skills: string[];
  expectedPoints: string[];
  source: 'seed' | 'generated' | 'user' | 'company';
};

const seedQuestionSchema = z.object({
  text: z.string().min(10),
  family: z.enum(JOB_FAMILIES).optional(),
  tracks: z.array(z.enum(TRACKS)).min(1).optional(),
  levels: z.tuple([z.enum(LEVELS), z.enum(LEVELS)]),
  difficulty: z.enum(DIFFICULTIES),
  skills: z.array(z.string()).min(1),
  expected: z.array(z.string()).min(1),
});

/** Normalized so that trivial differences (case, punctuation, spacing) count as the same question. */
export const textHash = (text: string) =>
  createHash('sha256')
    .update(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    )
    .digest('hex');

export const levelIndex = (level: Level) => LEVELS.indexOf(level);

type NewQuestion = Omit<Question, 'id'> & {
  provenance: 'verified' | 'user_provided' | 'generated';
  tracks?: readonly (typeof TRACKS)[number][];
};

/** Inserts questions that are not in the bank yet; returns how many were added. */
export function insertQuestions(db: Db, questions: NewQuestion[]): number {
  const insert = db.prepare(
    `INSERT INTO questions (id, text, text_hash, interview_type, job_family, level_min, level_max, difficulty,
       skill_tags_json, expected_points_json, tracks_json, source, provenance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (text_hash) DO NOTHING`,
  );
  return transaction(db, () => {
    let added = 0;
    for (const q of questions) {
      const r = insert.run(
        newId(),
        q.text,
        textHash(q.text),
        q.interviewType,
        q.jobFamily,
        q.levelMin,
        q.levelMax,
        q.difficulty,
        JSON.stringify(q.skills),
        JSON.stringify(q.expectedPoints),
        JSON.stringify(q.tracks ?? []),
        q.source,
        q.provenance,
        nowIso(),
      );
      added += Number(r.changes);
    }
    return added;
  });
}

/** Loads seed/questions/<interview_type>.json into the bank. Safe to run on every start. */
export function seedQuestions(db: Db, dir = SEED_DIR): number {
  const questions: NewQuestion[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const interviewType = z.enum(INTERVIEW_TYPES).parse(file.replace(/\.json$/, ''));
    const items = z.array(seedQuestionSchema).parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    for (const q of items) {
      questions.push({
        text: q.text,
        interviewType,
        jobFamily: q.family ?? null,
        levelMin: q.levels[0],
        levelMax: q.levels[1],
        difficulty: q.difficulty,
        skills: q.skills,
        expectedPoints: q.expected,
        tracks: q.tracks,
        source: 'seed',
        provenance: 'verified',
      });
    }
  }
  const added = insertQuestions(db, questions);
  // Seed questions stored by an earlier version keep their ids (history points at them) but take the current tracks.
  const setTracks = db.prepare(`UPDATE questions SET tracks_json = ? WHERE text_hash = ? AND source = 'seed'`);
  transaction(db, () => {
    for (const q of questions) setTracks.run(JSON.stringify(q.tracks ?? []), textHash(q.text));
  });
  return added;
}

type Row = {
  id: string;
  text: string;
  interview_type: Question['interviewType'];
  job_family: string | null;
  level_min: Level;
  level_max: Level;
  difficulty: Question['difficulty'];
  skill_tags_json: string;
  expected_points_json: string;
  source: Question['source'];
};

const fromRow = (r: Row): Question => ({
  id: r.id,
  text: r.text,
  interviewType: r.interview_type,
  jobFamily: r.job_family,
  levelMin: r.level_min,
  levelMax: r.level_max,
  difficulty: r.difficulty,
  skills: JSON.parse(r.skill_tags_json),
  expectedPoints: JSON.parse(r.expected_points_json),
  source: r.source,
});

/**
 * Questions of this type that suit the level and either the track, when one is chosen, or else the job family
 * (or any family). A track replaces the family: Data questions must be reachable from a Software engineering setup.
 * Any difficulty.
 */
export function findCandidates(
  db: Db,
  f: { interviewType: string; jobFamily: string; level: Level; track?: InterviewConfig['track'] },
): Question[] {
  const rows = db
    // Not 'user' (written from your resume or a job description) or 'company' (Companies page): those are asked
    // only in interviews based on them.
    .prepare(
      `SELECT * FROM questions WHERE interview_type = ?1
         AND (CASE WHEN ?3 IS NULL THEN job_family IS NULL OR job_family = ?2
                   ELSE EXISTS (SELECT 1 FROM json_each(tracks_json) WHERE value = ?3) END)
         AND source IN ('seed', 'generated')
       ORDER BY id`,
    )
    .all(f.interviewType, f.jobFamily, f.track ?? null) as Row[];
  const lvl = levelIndex(f.level);
  return rows.map(fromRow).filter((q) => levelIndex(q.levelMin) <= lvl && lvl <= levelIndex(q.levelMax));
}

/** Ids of questions with these texts, in the same order (after insertQuestions; a repeat reuses the stored one). */
export function idsForTexts(db: Db, texts: string[]): string[] {
  const find = db.prepare('SELECT id FROM questions WHERE text_hash = ?');
  return texts.map((t) => (find.get(textHash(t)) as { id: string }).id);
}

export function getQuestion(db: Db, id: string): Question | undefined {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as Row | undefined;
  return row && fromRow(row);
}

/** Ids of bank questions asked in the most recent `sessions` sessions. */
export function recentlyAskedIds(db: Db, sessions: number): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.question_id AS id FROM turns t
       WHERE t.question_id IS NOT NULL
         AND t.session_id IN (SELECT id FROM sessions WHERE status != 'planned' ORDER BY created_at DESC LIMIT ?)`,
    )
    .all(sessions) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
