// Company preparation (M14, R23): your notes and questions about a company, each with its source and date,
// and questions the model predicted from your notes (always labelled as predictions). Names match without case.
import type { Company, CompanyQuestion } from '@shared/schemas/companies';
import type { InterviewType } from '@shared/schemas/interview';
import type { Provenance } from '@shared/schemas/provenance';
import { type Db, transaction } from '../connection';
import { newId, nowIso } from '../ids';
import type { Question } from './questions';
import { textHash } from './questions';

type QuestionRow = {
  id: string;
  text: string;
  interview_type: InterviewType;
  difficulty: Question['difficulty'];
  provenance: 'user_provided' | 'generated' | 'verified';
  source_note: string | null;
  source_date: string | null;
};

const provenanceOf = (r: Pick<QuestionRow, 'provenance' | 'source_note' | 'source_date'>): Provenance =>
  r.provenance === 'user_provided'
    ? { kind: 'verified', source: r.source_note ?? 'unknown source', date: r.source_date ?? 'no date' }
    : { kind: 'generated' };

export function listCompanies(db: Db): Company[] {
  const names = (
    db
      .prepare(
        `SELECT company AS name, MAX(created_at) AS latest FROM (
           SELECT company, created_at FROM documents WHERE kind = 'company_notes' AND company IS NOT NULL
           UNION ALL SELECT company, created_at FROM questions WHERE source = 'company' AND company IS NOT NULL)
         GROUP BY company COLLATE NOCASE ORDER BY latest DESC`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
  return names.map((name) => getCompany(db, name)!);
}

export function getCompany(db: Db, name: string): Company | undefined {
  const notes = db
    .prepare(
      `SELECT id, title, summary, source_url AS source, source_date AS sourceDate, created_at AS createdAt
       FROM documents WHERE kind = 'company_notes' AND company = ? COLLATE NOCASE ORDER BY created_at`,
    )
    .all(name) as Company['notes'];
  const questions = (
    db
      .prepare(
        `SELECT * FROM questions WHERE source = 'company' AND company = ? COLLATE NOCASE
         ORDER BY provenance = 'generated', created_at, rowid`,
      )
      .all(name) as QuestionRow[]
  ).map((r): CompanyQuestion => ({
    id: r.id,
    text: r.text,
    interviewType: r.interview_type,
    provenance: provenanceOf(r),
  }));
  if (!notes.length && !questions.length) return undefined;
  return { name, notes, questions };
}

export function insertCompanyNote(
  db: Db,
  n: { company: string; title: string; text: string; source: string; sourceDate: string },
): string {
  const id = newId();
  // source_url holds the source as you wrote it: a link, or "recruiter call", "friend who interviewed there"...
  db.prepare(
    `INSERT INTO documents (id, kind, title, company, content_text, summary, provenance, source_url, source_date, created_at)
     VALUES (?, 'company_notes', ?, ?, ?, NULL, 'user_provided', ?, ?, ?)`,
  ).run(id, n.title, n.company, n.text, n.source, n.sourceDate, nowIso());
  return id;
}

type NewCompanyQuestion = {
  text: string;
  difficulty?: Question['difficulty'];
  skills?: string[];
  expectedPoints?: string[];
};

/**
 * Adds questions for a company: yours (`source` and `sourceDate` given) or predictions. A question already in the
 * bank (same text) is skipped and counted as a duplicate.
 */
export function addCompanyQuestions(
  db: Db,
  company: string,
  interviewType: InterviewType,
  questions: NewCompanyQuestion[],
  yours?: { source: string; sourceDate: string },
): { added: number; duplicates: number } {
  const insert = db.prepare(
    `INSERT INTO questions (id, text, text_hash, interview_type, job_family, level_min, level_max, difficulty,
       skill_tags_json, expected_points_json, source, provenance, company, source_note, source_date, created_at)
     VALUES (?, ?, ?, ?, NULL, 'intern', 'lead', ?, ?, ?, 'company', ?, ?, ?, ?, ?)
     ON CONFLICT (text_hash) DO NOTHING`,
  );
  return transaction(db, () => {
    let added = 0;
    for (const q of questions) {
      added += Number(
        insert.run(
          newId(),
          q.text,
          textHash(q.text),
          interviewType,
          q.difficulty ?? 'medium',
          JSON.stringify(q.skills ?? ['company']),
          JSON.stringify(q.expectedPoints ?? []),
          yours ? 'user_provided' : 'generated',
          company,
          yours?.source ?? null,
          yours?.sourceDate ?? null,
          nowIso(),
        ).changes,
      );
    }
    return { added, duplicates: questions.length - added };
  });
}

export function deleteCompanyQuestion(db: Db, id: string): boolean {
  return Number(db.prepare(`DELETE FROM questions WHERE id = ? AND source = 'company'`).run(id).changes) > 0;
}

/** A company's questions of one interview type: yours first, then predictions. */
export function companyCandidates(
  db: Db,
  company: string,
  interviewType: InterviewType,
): { id: string; text: string; verified: boolean }[] {
  return (
    db
      .prepare(
        `SELECT id, text, provenance FROM questions
         WHERE source = 'company' AND company = ? COLLATE NOCASE AND interview_type = ?`,
      )
      .all(company, interviewType) as { id: string; text: string; provenance: string }[]
  ).map((r) => ({ id: r.id, text: r.text, verified: r.provenance === 'user_provided' }));
}

/** The label of a company question; undefined for any other question. */
export function questionProvenance(db: Db, questionId: string): Provenance | undefined {
  const r = db
    .prepare(`SELECT provenance, source_note, source_date FROM questions WHERE id = ? AND source = 'company'`)
    .get(questionId) as Pick<QuestionRow, 'provenance' | 'source_note' | 'source_date'> | undefined;
  return r && provenanceOf(r);
}

/** Your notes about a company that have a summary, for prompts. */
export function companyNoteIds(db: Db, company: string): string[] {
  return (
    db
      .prepare(
        `SELECT id FROM documents WHERE kind = 'company_notes' AND company = ? COLLATE NOCASE AND summary IS NOT NULL
         ORDER BY created_at`,
      )
      .all(company) as { id: string }[]
  ).map((r) => r.id);
}
