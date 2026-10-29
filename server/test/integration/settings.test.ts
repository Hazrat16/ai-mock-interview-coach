import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupListSchema, settingsSchema } from '@shared/schemas/settings';
import { buildApp } from '../../src/app';
import { type Db, openDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { parseEnv } from '../../src/env';

let dataDir: string;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'coach-test-'));
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: dataDir, OLLAMA_URL: 'http://127.0.0.1:9' });
  db = openDb(dataDir);
  await migrate(db, { dataDir });
  app = await buildApp(env, db, '0.0.0-test');
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const getSettings = async () => settingsSchema.parse((await app.inject({ url: '/api/settings' })).json());
const put = (body: unknown) => app.inject({ method: 'PUT', url: '/api/settings', payload: body as object });

describe('settings API', () => {
  it('returns defaults on a fresh database', async () => {
    expect(await getSettings()).toEqual({
      interviewerModel: 'granite4:3b',
      evaluatorModel: 'qwen3.5:4b',
      showTranscript: true,
      endOfAnswerSilenceSec: 4,
      defaultThinkingTimeSec: 10,
      speakInterviewer: true,
      ttsVoice: 'en_US-ljspeech-medium',
      speechRate: 1,
    });
  });

  it('saves a partial update and keeps it after reopening the database', async () => {
    const res = await put({ showTranscript: false, endOfAnswerSilenceSec: 6 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ showTranscript: false, endOfAnswerSilenceSec: 6, defaultThinkingTimeSec: 10 });

    db.close();
    const reopened = new DatabaseSync(join(dataDir, 'coach.db'));
    const rows = reopened.prepare('SELECT key, value_json FROM settings ORDER BY key').all();
    expect(rows).toEqual([
      { key: 'endOfAnswerSilenceSec', value_json: '6' },
      { key: 'showTranscript', value_json: 'false' },
    ]);
    reopened.close();
    db = openDb(dataDir); // for afterEach
  });

  it('rejects out-of-range and unknown settings without saving anything', async () => {
    expect((await put({ endOfAnswerSilenceSec: 60 })).statusCode).toBe(400);
    expect((await put({ showTranscript: false, nope: 1 })).statusCode).toBe(400);
    expect((await getSettings()).showTranscript).toBe(true);
  });

  it('falls back to the default when a stored value is no longer valid', async () => {
    db.prepare("INSERT INTO settings VALUES ('endOfAnswerSilenceSec', '99', '2026-01-01')").run();
    expect((await getSettings()).endOfAnswerSilenceSec).toBe(4);
  });
});

describe('backups API', () => {
  it('creates a backup that contains the same data', async () => {
    await put({ defaultThinkingTimeSec: 20 });
    const created = await app.inject({ method: 'POST', url: '/api/backups' });
    expect(created.statusCode).toBe(201);
    const { path } = created.json() as { path: string };

    const copy = new DatabaseSync(path);
    expect(copy.prepare("SELECT value_json FROM settings WHERE key = 'defaultThinkingTimeSec'").get()).toEqual({
      value_json: '20',
    });
    copy.close();

    const list = backupListSchema.parse((await app.inject({ url: '/api/backups' })).json());
    expect(list.backups).toHaveLength(1);
    expect(path).toContain(list.backups[0]!.name);
  });
});
