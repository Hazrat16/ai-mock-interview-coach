import type { DocumentContext, DocumentDetail, DocumentKind, DocumentView } from '@shared/schemas/documents';
import type { Db } from '../connection';
import { newId, nowIso } from '../ids';

type Row = {
  id: string;
  kind: DocumentKind;
  title: string;
  company: string | null;
  content_text: string;
  summary: string | null;
  created_at: string;
  interviews: number;
};

const SELECT = `SELECT d.*, (SELECT COUNT(*) FROM session_documents sd WHERE sd.document_id = d.id) AS interviews
                FROM documents d`;

const toView = (r: Row): DocumentView => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  company: r.company,
  summary: r.summary,
  chars: r.content_text.length,
  createdAt: r.created_at,
  interviews: r.interviews,
});

export function insertDocument(
  db: Db,
  d: { kind: DocumentKind; title: string; company?: string; text: string; summary: string | null },
): string {
  const id = newId();
  db.prepare(
    `INSERT INTO documents (id, kind, title, company, content_text, summary, provenance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'user_provided', ?)`,
  ).run(id, d.kind, d.title, d.company ?? null, d.text, d.summary, nowIso());
  return id;
}

/** Job descriptions and resumes, newest first. */
export function listDocuments(db: Db): DocumentView[] {
  return (
    db.prepare(`${SELECT} WHERE d.kind IN ('job_description', 'resume') ORDER BY d.created_at DESC`).all() as Row[]
  ).map(toView);
}

export function getDocument(db: Db, id: string): DocumentDetail | undefined {
  const r = db.prepare(`${SELECT} WHERE d.id = ?`).get(id) as Row | undefined;
  return r && { ...toView(r), text: r.content_text };
}

export function setSummary(db: Db, id: string, summary: string) {
  db.prepare('UPDATE documents SET summary = ? WHERE id = ?').run(summary, id);
}

/** Interviews based on it stay (they keep their questions); only the link goes. */
export function deleteDocument(db: Db, id: string): boolean {
  return Number(db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes) > 0;
}

export function linkSessionDocument(db: Db, sessionId: string, documentId: string) {
  db.prepare('INSERT INTO session_documents (session_id, document_id) VALUES (?, ?)').run(sessionId, documentId);
}

const MAX_CONTEXT_CHARS = 2400; // ~600 tokens, even with several company notes

/** The summary of what an interview is based on, for the interviewer's and the answer writer's prompts. */
export function sessionDocumentContext(db: Db, sessionId: string): DocumentContext | undefined {
  const rows = db
    .prepare(
      `SELECT d.kind, d.summary FROM session_documents sd JOIN documents d ON d.id = sd.document_id
       WHERE sd.session_id = ? AND d.summary IS NOT NULL ORDER BY d.created_at`,
    )
    .all(sessionId) as DocumentContext[];
  if (!rows.length) return undefined;
  return {
    kind: rows[0]!.kind,
    summary: rows
      .map((r) => r.summary)
      .join('\n\n')
      .slice(0, MAX_CONTEXT_CHARS),
  };
}
