// Download helper for model files: streams to disk while hashing, keeps the file only if the SHA-256 matches.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

/** True if `path` exists with exactly `bytes` bytes (a finished earlier download). */
export const isComplete = (path: string, bytes: number) => existsSync(path) && statSync(path).size === bytes;

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export async function downloadVerified(url: string, dest: string, sha256: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const hash = createHash('sha256');
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const part = `${dest}.part`;
  await pipeline(
    Readable.fromWeb(res.body as NodeReadableStream) /* DOM vs Node stream types; same object */,
    tap,
    createWriteStream(part),
  );
  const got = hash.digest('hex');
  if (got !== sha256) {
    await rm(part, { force: true });
    throw new Error(`${dest}: SHA-256 mismatch (got ${got}); file not kept`);
  }
  await rename(part, dest);
}

/** MODELS_DIR from .env, checked to exist (the drive may be unmounted). */
export function modelsDir(): string {
  process.loadEnvFile('.env');
  const dir = process.env.MODELS_DIR;
  if (!dir || !existsSync(dir)) {
    console.error(`MODELS_DIR (${dir}) not found. Is the drive mounted? Run: make setup`);
    process.exit(1);
  }
  return dir;
}
