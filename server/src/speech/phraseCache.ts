// Disk cache of synthesized interviewer sentences. Fixed phrases (acknowledgments, the closing) and bank
// questions repeat across interviews, so most audio is served without Piper, even while the LLM uses the CPU.
// Only interviewer text is cached, never the user's answers.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CacheKey = { voice: string; lengthScale: number; text: string };

export class PhraseCache {
  /** Number of cached files; counted when the first file is written (the folder is created then too). */
  private count?: number;

  constructor(
    readonly dir: string,
    private readonly maxFiles = 2000,
  ) {}

  private path({ voice, lengthScale, text }: CacheKey) {
    const hash = createHash('sha256').update(`${voice}\n${lengthScale}\n${text}`).digest('hex');
    return join(this.dir, `${hash.slice(0, 32)}.wav`);
  }

  async get(key: CacheKey): Promise<Buffer | undefined> {
    try {
      return await readFile(this.path(key));
    } catch {
      return undefined;
    }
  }

  async set(key: CacheKey, wav: Buffer) {
    if (this.count === undefined) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this.count = readdirSync(this.dir).filter((f) => f.endsWith('.wav')).length;
    }
    const path = this.path(key);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, wav, { mode: 0o600 });
    await rename(tmp, path); // atomic: a reader never sees half a file
    if (++this.count > this.maxFiles) await this.prune();
  }

  /** Removes the oldest fifth of the files. */
  private async prune() {
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith('.wav'))
      .map((f) => ({ f, t: statSync(join(this.dir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    const remove = files.slice(0, Math.ceil(files.length / 5));
    await Promise.all(remove.map(({ f }) => rm(join(this.dir, f), { force: true })));
    this.count = files.length - remove.length;
  }
}
