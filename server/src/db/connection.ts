import { mkdirSync, statfsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const FUSE_MAGIC = 0x65735546; // statfs f_type of FUSE mounts, e.g. NTFS via ntfs-3g

/** SQLite locking and WAL shared memory are unreliable on FUSE, so refuse to put the database there. */
export function assertNotFuse(dir: string, statfs: (p: string) => { type: number } = statfsSync) {
  if (statfs(dir).type === FUSE_MAGIC) {
    throw new Error(
      `DATA_DIR ${dir} is on a FUSE/NTFS drive; SQLite needs a Linux filesystem. Change DATA_DIR in .env.`,
    );
  }
}

function applyPragmas(db: Db, fileBacked: boolean) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (fileBacked) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
}

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  assertNotFuse(dataDir);
  const db = new DatabaseSync(`${dataDir}/coach.db`);
  applyPragmas(db, true);
  return db;
}

/** For tests. */
export function openMemoryDb(): Db {
  const db = new DatabaseSync(':memory:');
  applyPragmas(db, false);
  return db;
}

/** Runs fn inside BEGIN/COMMIT; rolls back and rethrows on error. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
