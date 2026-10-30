import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import type { Db } from './connection';

export type BackupInfo = { name: string; sizeBytes: number; createdAt: string };

/** 20261030-142433-123: to the millisecond, so two backups in the same second do not overwrite each other. */
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '');

export const backupDir = (dataDir: string) => join(dataDir, 'backups');

/** Copies the live database with SQLite's online backup API (safe while the app is running). */
export async function createBackup(db: Db, dataDir: string, prefix = 'coach'): Promise<string> {
  const dir = backupDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let path = join(dir, `${prefix}-${stamp()}.db`);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${prefix}-${stamp()}-${n}.db`);
  await backup(db, path);
  return path;
}

export function listBackups(dataDir: string): BackupInfo[] {
  let names: string[];
  try {
    names = readdirSync(backupDir(dataDir)).filter((n) => n.endsWith('.db'));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const s = statSync(join(backupDir(dataDir), name));
      return { name, sizeBytes: s.size, createdAt: s.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest `keep` backups whose names start with prefix; deletes older ones. */
export function pruneBackups(dataDir: string, prefix: string, keep: number) {
  for (const b of listBackups(dataDir)
    .filter((b) => b.name.startsWith(`${prefix}-`))
    .slice(keep)) {
    rmSync(join(backupDir(dataDir), b.name));
  }
}
