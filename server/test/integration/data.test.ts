import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { dataSummarySchema, restoreResultSchema } from '@shared/schemas/data';
import { createSessionResponseSchema, sessionDetailSchema } from '@shared/schemas/interview';
import { buildApp } from '../../src/app';
import { type Db, openDb } from '../../src/db/connection';
import { loadMigrations, migrate } from '../../src/db/migrate';
import { seedQuestions } from '../../src/db/repos/questions';
import { parseEnv } from '../../src/env';
import { chatReply, type FakeOllama, startFakeOllama } from '../helpers/fakeOllama';

let fake: FakeOllama | undefined;
let db: Db | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let dir: string;
afterEach(async () => {
  await app?.close();
  db?.close();
  await fake?.close();
  rmSync(dir, { recursive: true, force: true });
  app = db = fake = undefined;
});

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'coach-data-'));
  fake = await startFakeOllama({
    models: ['granite4:3b', 'qwen3.5:4b'],
    chat: [chatReply(JSON.stringify({ summary: 'Ok.', quality_signal: 'ok', action: 'next', follow_up: null }))],
  });
  db = openDb(dir);
  await migrate(db);
  seedQuestions(db);
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: dir, OLLAMA_URL: fake.url });
  app = await buildApp(env, db, '1.2.3-test', { engine: { decisionTimeoutMs: 2000 } });
  return app;
}

const post = (url: string, payload: unknown = {}) => app!.inject({ method: 'POST', url, payload: payload as object });

/** A finished (or, with `stopAfter`, unfinished) interview with typed answers. */
async function interview(answers: string[], stopAfter?: number): Promise<string> {
  const config = {
    jobTitle: 'Backend Engineer',
    jobFamily: 'software_engineering',
    level: 'junior',
    interviewType: 'technical',
    difficulty: 'medium',
    questionCount: answers.length,
    thinkingTimeSec: 10,
    followUpLimit: 0,
  };
  const created = createSessionResponseSchema.parse((await post('/api/sessions', { config, seed: 2 })).json());
  if (created.status !== 'created') throw new Error('not created');
  let d = sessionDetailSchema.parse((await post(`/api/sessions/${created.sessionId}/start`)).json());
  for (const [i, transcript] of answers.entries()) {
    if (i === stopAfter || !d.current) break;
    await post(`/api/sessions/${created.sessionId}/turns/${d.current.id}/answer`, {
      transcript,
      inputMethod: 'typed_fallback',
    });
    d = sessionDetailSchema.parse((await app!.inject({ url: `/api/sessions/${created.sessionId}` })).json());
  }
  await new Promise((r) => setImmediate(r)); // evaluations are queued right after completion
  return created.sessionId;
}

/** Row count and a checksum of every table, including the search index's own tables. */
function fingerprint(d: Db) {
  const tables = d
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const columns = (d.prepare(`PRAGMA table_info("${name}")`).all() as unknown[]).length;
      const order = Array.from({ length: columns }, (_, i) => i + 1).join(', ');
      const rows = d.prepare(`SELECT * FROM "${name}" ORDER BY ${order}`).all();
      const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
      return [name, `${rows.length}:${hash}`];
    }),
  );
}

const summary = async () => dataSummarySchema.parse((await app!.inject({ url: '/api/data/summary' })).json());
const search = async (q: string) => (await app!.inject({ url: `/api/history?q=${q}` })).json() as unknown[];

describe('backup, delete all, restore', () => {
  it('restores to an identical state (row counts and checksums of every table)', async () => {
    await setup();
    await interview(['I would add an index on the email column.', 'A mutex around the counter.']);
    await interview(['Sharding by user id.']);
    const before = fingerprint(db!);
    // Finishing an interview queues evaluations (interview-ready answers).
    expect(await summary()).toMatchObject({ interviews: 2, answers: 3, evaluations: 3 });

    const backup = (await post('/api/backups')).json<{ path: string }>().path.split('/').at(-1)!;
    expect((await post('/api/data/delete-all', { confirm: 'DELETE' })).statusCode).toBe(200);
    expect(await summary()).toEqual({ interviews: 0, answers: 0, evaluations: 0, voiceSamples: 0 });
    expect(await search('index')).toEqual([]);
    expect(fingerprint(db!)).not.toEqual(before);
    // Settings and the question bank stay.
    expect(db!.prepare('SELECT COUNT(*) AS n FROM questions').get()).toEqual({ n: expect.any(Number) });
    expect((db!.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n).toBeGreaterThan(50);

    const res = await post('/api/data/restore', { name: backup, confirm: 'RESTORE' });
    expect(res.statusCode).toBe(200);
    const result = restoreResultSchema.parse(res.json());
    expect(result.interviews).toBe(2);
    expect(result.safetyBackup).toMatch(/^pre-restore-.*\.db$/);
    expect(fingerprint(db!)).toEqual(before);
    expect((await search('index')).length).toBe(1); // the search index came back too

    // The safety backup holds the data from just before: empty. Restoring it undoes the restore.
    await post('/api/data/restore', { name: result.safetyBackup, confirm: 'RESTORE' });
    expect((await summary()).interviews).toBe(0);
  });

  it('asks for the confirmation word, and only restores files from the backups folder', async () => {
    await setup();
    await interview(['Something.']);
    expect((await post('/api/data/delete-all', {})).statusCode).toBe(400);
    expect((await post('/api/data/delete-all', { confirm: 'delete' })).json()).toEqual({
      error: 'Type DELETE to confirm.',
    });
    expect((await post('/api/data/delete-transcripts', { confirm: 'yes' })).statusCode).toBe(400);
    expect((await post('/api/data/restore', { name: 'x.db', confirm: 'DELETE' })).statusCode).toBe(400);
    expect((await post('/api/data/restore', { name: 'nope.db', confirm: 'RESTORE' })).statusCode).toBe(404);
    expect((await post('/api/data/restore', { name: '../coach.db', confirm: 'RESTORE' })).statusCode).toBe(404);
    expect((await summary()).interviews).toBe(1);
  });

  it('refuses a damaged or foreign file, and a backup from a newer app', async () => {
    await setup();
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'backups', 'junk.db'), 'not a database at all, just text that is long enough to matter');
    const other = new DatabaseSync(join(dir, 'backups', 'other.db'));
    other.exec('CREATE TABLE notes (x)');
    other.close();
    const newer = new DatabaseSync(join(dir, 'backups', 'newer.db'));
    newer.exec('CREATE TABLE sessions (id); PRAGMA user_version = 999');
    newer.close();

    for (const name of ['junk.db', 'other.db', 'newer.db']) {
      const res = await post('/api/data/restore', { name, confirm: 'RESTORE' });
      expect(res.statusCode, name).toBe(400);
    }
    expect((await post('/api/data/restore', { name: 'newer.db', confirm: 'RESTORE' })).json()).toEqual({
      error: expect.stringContaining('newer version'),
    });
  });

  it('brings an older backup up to the current schema', async () => {
    await setup();
    mkdirSync(join(dir, 'backups'), { recursive: true });
    const old = new DatabaseSync(join(dir, 'backups', 'old.db'));
    await migrate(old, { migrations: loadMigrations().slice(0, 1) }); // before the search index
    seedQuestions(old);
    old.exec(`
      INSERT INTO interview_configs (id, job_title, job_family, level, interview_type, difficulty, question_count, created_at)
        VALUES ('c', 'Dev', 'software_engineering', 'junior', 'technical', 'medium', 1, '2026-10-01');
      INSERT INTO sessions (id, config_id, config_snapshot_json, mode, status, plan_json, interviewer_model, created_at)
        VALUES ('s', 'c', '{"jobTitle":"Dev","level":"junior","interviewType":"technical"}', 'random', 'completed',
                '{"seed":1,"questionIds":["q"]}', 'granite4:3b', '2026-10-01');
      INSERT INTO turns (id, session_id, seq, kind, question_text) VALUES ('t', 's', 1, 'main', 'Explain caching.');
      INSERT INTO answers (id, turn_id, transcript, input_method, created_at)
        VALUES ('a', 't', 'Redis keeps hot keys in memory.', 'typed_fallback', '2026-10-01');`);
    old.close();

    expect((await post('/api/data/restore', { name: 'old.db', confirm: 'RESTORE' })).statusCode).toBe(200);
    expect(db!.prepare('PRAGMA user_version').get()).toEqual({ user_version: loadMigrations().at(-1)!.version });
    expect((await search('redis')).length).toBe(1);
  });

  it('does nothing while an interview is going on', async () => {
    await setup();
    await interview(['First answer.', 'Second.'], 1);
    expect((await post('/api/data/delete-all', { confirm: 'DELETE' })).statusCode).toBe(409);
    expect((await summary()).interviews).toBe(1);
  });
});

describe('delete transcripts', () => {
  it('removes what you said and what was written from it, and keeps the interviews', async () => {
    await setup();
    const id = await interview(['I would add an index on the email column.']);
    db!
      .exec(`INSERT INTO evaluations (id, answer_id, status, rubric_key, rubric_version, prompt_version, model_tag, result_json, created_at)
              SELECT 'ev1', id, 'done', 'technical', 1, 1, 'qwen3.5:4b', '{"exampleAnswer":"I would add an index"}', '2026-10-30'
              FROM answers`);
    db!.exec(`UPDATE turns SET summary = 'Suggested an index on email.'`);

    expect((await post('/api/data/delete-transcripts', { confirm: 'DELETE' })).statusCode).toBe(200);
    expect(await summary()).toMatchObject({ interviews: 1, answers: 0, evaluations: 0 });
    expect(db!.prepare(`SELECT transcript FROM answers`).all()).toEqual([{ transcript: '' }]);
    expect(db!.prepare(`SELECT summary FROM turns WHERE summary IS NOT NULL`).all()).toEqual([]);
    expect(await search('email')).toEqual([]);
    const all = JSON.stringify(fingerprint(db!)) + JSON.stringify(db!.prepare('SELECT * FROM answers_fts').all());
    expect(all).not.toContain('email');
    // The interview and its questions are still there.
    expect((await app!.inject({ url: `/api/sessions/${id}/report` })).statusCode).toBe(200);
  });
});

describe('export', () => {
  it('downloads every interview as readable JSON', async () => {
    await setup();
    await interview(['I would add an index on the email column.']);
    const res = await app!.inject({ url: '/api/data/export' });
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="interview-coach-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = res.json<{ format: string; appVersion: string; interviews: { items: unknown[] }[] }>();
    expect(body).toMatchObject({ format: 'ai-interview-coach-export', formatVersion: 1, appVersion: '1.2.3-test' });
    expect(body.interviews).toHaveLength(1);
    expect(JSON.stringify(body.interviews[0])).toContain('I would add an index on the email column.');
  });
});
