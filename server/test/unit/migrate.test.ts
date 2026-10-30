import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { listBackups } from '../../src/db/backup';
import { assertNotFuse, openMemoryDb } from '../../src/db/connection';
import { loadMigrations, migrate } from '../../src/db/migrate';

const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );
const version = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

let dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'coach-test-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('migrate', () => {
  it('creates the full schema on an empty database', async () => {
    const db = openMemoryDb();
    const result = await migrate(db);
    expect(result).toMatchObject({ from: 0, to: loadMigrations().at(-1)!.version });
    expect(tables(db)).toEqual(
      expect.arrayContaining(['settings', 'sessions', 'turns', 'answers', 'evaluations', 'evaluation_scores', 'jobs']),
    );
  });

  it('is a no-op when already up to date', async () => {
    const db = openMemoryDb();
    await migrate(db);
    const latest = loadMigrations().at(-1)!.version;
    expect(await migrate(db)).toMatchObject({ from: latest, to: latest, backup: undefined });
  });

  it('rolls back a failing migration and keeps the previous version', async () => {
    const db = openMemoryDb();
    const migrations = [
      { version: 1, name: '0001_ok.sql', sql: 'CREATE TABLE a (x INTEGER);' },
      { version: 2, name: '0002_bad.sql', sql: 'CREATE TABLE b (x INTEGER); INSERT INTO missing VALUES (1);' },
    ];
    await expect(migrate(db, { migrations })).rejects.toThrow(/0002_bad\.sql failed and was rolled back/);
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual(['a']); // table b from the failed migration is gone
  });

  it('refuses a database from a newer app version', async () => {
    const db = openMemoryDb();
    db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer than this app/);
  });

  it('backs up an existing database before upgrading it', async () => {
    const dataDir = tempDir();
    const db = new DatabaseSync(join(dataDir, 'coach.db'));
    const v1 = [{ version: 1, name: '0001_a.sql', sql: 'CREATE TABLE a (x INTEGER); INSERT INTO a VALUES (42);' }];
    await migrate(db, { dataDir, migrations: v1 });
    expect(listBackups(dataDir)).toHaveLength(0); // a brand-new database needs no backup

    const v2 = [...v1, { version: 2, name: '0002_b.sql', sql: 'CREATE TABLE b (x INTEGER);' }];
    const result = await migrate(db, { dataDir, migrations: v2 });
    expect(result.backup).toMatch(/pre-migration-v1-.*\.db$/);
    const copy = new DatabaseSync(result.backup!);
    expect(copy.prepare('SELECT x FROM a').get()).toEqual({ x: 42 });
    expect(tables(copy)).toEqual(['a']); // taken before the upgrade
    copy.close();
    db.close();
  });
});

describe('assertNotFuse', () => {
  it('rejects a FUSE filesystem such as NTFS via ntfs-3g', () => {
    expect(() => assertNotFuse('/x', () => ({ type: 0x65735546 }))).toThrow(/FUSE\/NTFS/);
  });

  it('accepts ext4', () => {
    expect(() => assertNotFuse('/x', () => ({ type: 0xef53 }))).not.toThrow();
  });

  it('accepts the real temp directory', () => {
    const d = tempDir();
    expect(existsSync(d)).toBe(true);
    expect(() => assertNotFuse(d)).not.toThrow();
  });
});
