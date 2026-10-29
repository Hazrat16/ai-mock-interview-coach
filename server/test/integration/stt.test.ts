import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { healthSchema } from '@shared/schemas/health';
import { sttResultSchema, sttSampleListSchema } from '@shared/schemas/stt';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { parseEnv } from '../../src/env';
import { makeWav } from '../helpers/fakePiper';
import { type FakeSegment, type FakeWhisper, startFakeWhisper } from '../helpers/fakeWhisper';

let fake: FakeWhisper | undefined;
let db: Db;
let dataDir: string;
let app: Awaited<ReturnType<typeof buildApp>>;

afterEach(async () => {
  await app?.close();
  db?.close();
  await fake?.close();
  fake = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function setup(segments?: FakeSegment[], whisperUrl?: string) {
  if (!whisperUrl) fake = await startFakeWhisper({ segments });
  dataDir = mkdtempSync(join(tmpdir(), 'coach-stt-'));
  db = openMemoryDb();
  await migrate(db);
  const env = parseEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    OLLAMA_URL: 'http://127.0.0.1:9',
    PIPER_URL: 'http://127.0.0.1:9',
    WHISPER_URL: whisperUrl ?? fake!.url,
  });
  app = await buildApp(env, db, '0.0.0-test', { sttRetryDelaysMs: [] });
}

const wav16k = (seconds = 2) => makeWav(seconds, 16000);
const stt = (body: Buffer | string, url = '/api/stt', type = 'audio/wav') =>
  app.inject({ method: 'POST', url, payload: body, headers: { 'content-type': type } });

describe('POST /api/stt', () => {
  it('returns the filtered transcript and passes the question as a prompt', async () => {
    await setup([
      { text: ' I would shard by user ID.' },
      { text: ' Thanks for watching!' },
      { text: ' mumble', no_speech_prob: 0.9 },
    ]);
    const res = await stt(wav16k(), `/api/stt?prompt=${encodeURIComponent('How would you scale PostgreSQL?')}`);
    expect(res.statusCode).toBe(200);
    const body = sttResultSchema.parse(res.json());
    expect(body).toMatchObject({ text: 'I would shard by user ID.', words: 6, model: 'ggml-base.en.bin' });
    expect(body.segments.map((s) => s.reason)).toEqual([undefined, 'hallucination', 'no_speech']);
    expect(fake!.requests[0]).toMatchObject({
      response_format: 'verbose_json',
      temperature: '0',
      prompt: 'How would you scale PostgreSQL?',
      file: wav16k().length,
    });
  });

  it('never writes the audio to disk', async () => {
    await setup([{ text: ' Hello.' }]);
    await stt(wav16k());
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it('rejects non-WAV, empty, and too-long recordings before calling Whisper', async () => {
    await setup([{ text: ' x' }]);
    expect((await stt('hello', '/api/stt', 'text/plain')).statusCode).toBe(415);
    expect((await stt(Buffer.from('not a wav file at all, just some bytes to be long enough'))).statusCode).toBe(400);
    expect((await stt(makeWav(0.01, 16000))).statusCode).toBe(400);
    expect((await stt(makeWav(181, 16000))).statusCode).toBe(413);
    expect(fake!.requests).toHaveLength(0);
  });

  it('answers 503 with a start hint when Whisper is down', async () => {
    await setup(undefined, 'http://127.0.0.1:9');
    const res = await stt(wav16k());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ hint: expect.stringContaining('make deps-up') });
  });
});

describe('benchmark recordings', () => {
  it('saves only on request, lists them, and deletes them all', async () => {
    await setup([{ text: ' Hi.' }]);
    const ref = 'I enjoy solving hard problems with my team.';
    const saved = await stt(
      wav16k(3),
      `/api/stt/samples?reference=${encodeURIComponent(ref)}&mic=Headset&processing=false`,
    );
    expect(saved.statusCode).toBe(201);
    const list = sttSampleListSchema.parse((await app.inject({ url: '/api/stt/samples' })).json());
    expect(list.samples).toEqual([
      expect.objectContaining({ reference: ref, durationSec: 3, mic: 'Headset', processing: false }),
    ]);

    const del = await app.inject({ method: 'DELETE', url: '/api/stt/samples' });
    expect(del.json()).toEqual({ deleted: 1 });
    expect(readdirSync(join(dataDir, 'stt-samples'))).toEqual([]);
  });

  it('requires the sentence that was read', async () => {
    await setup();
    expect((await stt(wav16k(), '/api/stt/samples')).statusCode).toBe(400);
    expect(existsSync(join(dataDir, 'stt-samples'))).toBe(false);
  });
});

describe('health', () => {
  it('reports Whisper ok, then down with a hint', async () => {
    await setup([]);
    const health = async () => healthSchema.parse((await app.inject({ url: '/api/health' })).json()).stt;
    expect(await health()).toMatchObject({ status: 'ok', model: 'ggml-base.en.bin' });
    await fake!.close();
    fake = undefined;
    expect(await health()).toMatchObject({ status: 'down', hint: expect.stringContaining('make deps-up') });
  });
});
