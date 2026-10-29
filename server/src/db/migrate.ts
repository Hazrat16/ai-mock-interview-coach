import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, pruneBackups } from './backup';
import { type Db, transaction } from './connection';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));
const KEEP_PRE_MIGRATION_BACKUPS = 3;

type Migration = { version: number; name: string; sql: string };

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ version: Number(name.slice(0, 4)), name, sql: readFileSync(join(dir, name), 'utf8') }));
}

const userVersion = (db: Db) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

/**
 * Applies pending migrations, each in its own transaction, tracked by PRAGMA user_version.
 * If dataDir is given and the database already has data, a backup is taken first.
 */
export async function migrate(db: Db, opts: { dataDir?: string; migrations?: Migration[] } = {}) {
  const migrations = opts.migrations ?? loadMigrations();
  const current = userVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(`Database is at schema version ${current}, newer than this app (${latest}). Update the app.`);
  }
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return { from: current, to: current, backup: undefined };

  let backupPath: string | undefined;
  if (opts.dataDir && current > 0) {
    backupPath = await createBackup(db, opts.dataDir, `pre-migration-v${current}`);
    pruneBackups(opts.dataDir, 'pre-migration', KEEP_PRE_MIGRATION_BACKUPS);
  }

  for (const m of pending) {
    try {
      transaction(db, () => {
        db.exec(m.sql);
        db.exec(`PRAGMA user_version = ${m.version}`);
      });
    } catch (err) {
      const restore = backupPath ? ` A backup from before the migration is at ${backupPath}.` : '';
      throw new Error(`Migration ${m.name} failed and was rolled back: ${(err as Error).message}.${restore}`, {
        cause: err,
      });
    }
  }
  return { from: current, to: latest, backup: backupPath };
}
