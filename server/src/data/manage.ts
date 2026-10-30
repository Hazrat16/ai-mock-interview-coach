// Your data (R14, R15): export, restore a backup, delete transcripts, delete everything. Restore first saves
// the current data as a backup. The deletes do not: a backup would keep a copy of what you asked to delete
// (older backups still have it; the Settings page says so).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { DataSummary } from '@shared/schemas/data';
import type { SessionReport } from '@shared/schemas/evaluation';
import { backupDir, createBackup, listBackups } from '../db/backup';
import { type Db, transaction } from '../db/connection';
import { loadMigrations, migrate } from '../db/migrate';
import { listCompanies } from '../db/repos/companies';
import { getDocument, listDocuments } from '../db/repos/documents';
import { resetRunningJobs } from '../db/repos/evaluations';
import { HttpError } from '../errors';
import { buildReport } from '../evaluation/report';

const count = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;

export function dataSummary(db: Db, voiceSamples: number): DataSummary {
  return {
    interviews: count(db, 'SELECT COUNT(*) AS n FROM sessions'),
    answers: count(db, `SELECT COUNT(*) AS n FROM answers WHERE transcript != ''`),
    evaluations: count(db, 'SELECT COUNT(*) AS n FROM evaluations'),
    voiceSamples,
  };
}

/** Everything about your interviews in one readable JSON document: each interview as its report. */
export function exportAll(db: Db, appVersion: string) {
  const ids = db.prepare('SELECT id FROM sessions ORDER BY created_at').all() as { id: string }[];
  const settings = db.prepare('SELECT key, value_json FROM settings ORDER BY key').all() as {
    key: string;
    value_json: string;
  }[];
  return {
    format: 'ai-interview-coach-export',
    formatVersion: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries(settings.map((s) => [s.key, JSON.parse(s.value_json) as unknown])),
    documents: listDocuments(db).map((d) => getDocument(db, d.id)),
    companies: listCompanies(db),
    interviews: ids.map(({ id }): SessionReport => buildReport(db, id)),
  };
}

/**
 * Checks that a file is a database this app can use: readable, intact, with interviews, and not from a
 * newer app version. Returns its schema version.
 */
export function checkBackup(path: string): number {
  let src: DatabaseSync;
  try {
    src = new DatabaseSync(path, { readOnly: true });
  } catch (err) {
    throw new HttpError(400, `Cannot open the backup: ${(err as Error).message}`);
  }
  try {
    const integrity = (src.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    if (integrity !== 'ok') throw new HttpError(400, `The backup is damaged: ${integrity}`);
    const hasSessions = src.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'`).get();
    if (!hasSessions) throw new HttpError(400, 'This file is not an Interview Coach backup.');
    const version = (src.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const latest = loadMigrations().at(-1)!.version;
    if (version > latest) {
      throw new HttpError(400, `The backup is from a newer version of the app (schema ${version}). Update the app.`);
    }
    return version;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `This file is not a usable backup: ${(err as Error).message}`);
  } finally {
    src.close();
  }
}

/**
 * Replaces all data with a backup from the backups folder. The current data is saved first. The live
 * connection stays open: SQLite's backup API copies the file in, and the app sees the restored data at once.
 * An older backup is then brought up to the current schema.
 */
export async function restoreBackup(db: Db, dataDir: string, name: string) {
  // Only files listed in the backups folder, never a path.
  if (!listBackups(dataDir).some((b) => b.name === name)) throw new HttpError(404, `Backup ${name} not found`);
  const path = join(backupDir(dataDir), name);
  checkBackup(path);
  const live = db.location();
  if (!live || !existsSync(live)) throw new Error('restore needs a database file');

  const safetyBackup = await createBackup(db, dataDir, 'pre-restore');
  const src = new DatabaseSync(path, { readOnly: true });
  try {
    await backup(src, live);
  } finally {
    src.close();
  }
  await migrate(db);
  resetRunningJobs(db); // work that was running when the backup was taken starts again
  return { safetyBackup: safetyBackup.split('/').at(-1)!, interviews: count(db, 'SELECT COUNT(*) AS n FROM sessions') };
}

/**
 * Deletes what you said, keeping the interviews: transcripts are emptied, and the evaluations and interview-ready
 * answers (written from them) and the interviewer's notes about your answers are removed.
 */
export function deleteTranscripts(db: Db) {
  transaction(db, () => {
    db.exec(`UPDATE answers SET transcript = ''`);
    db.exec('UPDATE turns SET summary = NULL, quality_signal = NULL');
    db.exec(`DELETE FROM jobs WHERE kind = 'evaluate_answer'`);
    db.exec('DELETE FROM evaluations'); // scores go with them (ON DELETE CASCADE)
    db.exec('DELETE FROM skill_profiles');
    db.exec('DELETE FROM exercises');
  });
}

/**
 * Deletes every interview, everything learned from them, your documents, and the questions written from them or
 * added for companies. Settings and the question bank stay.
 */
export function deleteAll(db: Db) {
  transaction(db, () => {
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM sessions'); // turns, answers, evaluations and scores go with them
    db.exec('DELETE FROM interview_configs WHERE is_template = 0');
    db.exec('DELETE FROM skill_profiles');
    db.exec('DELETE FROM learning_goals');
    db.exec('DELETE FROM exercises');
    db.exec('DELETE FROM documents');
    // Questions written from your resume or job descriptions, and your company questions and predictions.
    db.exec(`DELETE FROM questions WHERE source IN ('user', 'company')`);
  });
}
