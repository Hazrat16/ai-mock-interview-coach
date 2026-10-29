// Own-voice recordings for the speech-to-text benchmark. Saved only on an explicit click in Settings
// (interview audio is never stored), private to this user, and removable with one button.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SttSampleList } from '@shared/schemas/stt';

type Meta = { reference: string; durationSec: number; createdAt: string; mic?: string; processing?: boolean };

export class SampleStore {
  constructor(readonly dir: string) {}

  async save(wav: Buffer, reference: string, durationSec: number, how: Pick<Meta, 'mic' | 'processing'> = {}) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const createdAt = new Date().toISOString();
    const id = createdAt.replace(/[:.]/g, '-');
    await writeFile(join(this.dir, `${id}.wav`), wav, { mode: 0o600 });
    await writeFile(
      join(this.dir, `${id}.json`),
      JSON.stringify({ reference, durationSec, createdAt, ...how } satisfies Meta),
      {
        mode: 0o600,
      },
    );
    return id;
  }

  list(): SttSampleList {
    if (!existsSync(this.dir)) return { dir: this.dir, samples: [] };
    const samples = readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && existsSync(join(this.dir, f.replace(/\.json$/, '.wav'))))
      .sort()
      .map((f) => ({ id: f.replace(/\.json$/, ''), ...(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Meta) }));
    return { dir: this.dir, samples };
  }

  wavPath(id: string) {
    return join(this.dir, `${id}.wav`);
  }

  /** Deletes the recordings and their texts (only files this store wrote). */
  async deleteAll() {
    if (!existsSync(this.dir)) return 0;
    const files = readdirSync(this.dir).filter((f) => /\.(wav|json)$/.test(f));
    await Promise.all(files.map((f) => rm(join(this.dir, f), { force: true })));
    return files.filter((f) => f.endsWith('.wav')).length;
  }
}
