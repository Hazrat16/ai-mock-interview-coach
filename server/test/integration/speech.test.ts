import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { healthSchema } from '@shared/schemas/health';
import { voiceListSchema } from '@shared/schemas/speech';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { parseEnv } from '../../src/env';
import { parseWav } from '../../src/speech/wav';
import { type FakePiper, startFakePiper } from '../helpers/fakePiper';

let fake: FakePiper | undefined;
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

async function setup(piperUrl?: string, voices?: string[]) {
  if (!piperUrl) fake = await startFakePiper({ voices });
  dataDir = mkdtempSync(join(tmpdir(), 'coach-speech-'));
  db = openMemoryDb();
  await migrate(db);
  const env = parseEnv({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    OLLAMA_URL: 'http://127.0.0.1:9',
    PIPER_URL: piperUrl ?? fake!.url,
  });
  app = await buildApp(env, db, '0.0.0-test', { ttsRetryDelaysMs: [] });
}

const tts = (payload: object) => app.inject({ method: 'POST', url: '/api/speech/tts', payload });

describe('POST /api/speech/tts', () => {
  it('returns a WAV in the selected voice and speed, then serves it from the cache', async () => {
    await setup();
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ttsVoice: 'en_US-joe-medium', speechRate: 1.25 },
    });

    const first = await tts({ text: 'Tell me about yourself.' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('audio/wav');
    expect(first.headers['x-tts-cache']).toBe('miss');
    expect(parseWav(first.rawPayload).sampleRate).toBe(22050);
    expect(fake!.requests).toEqual([{ text: 'Tell me about yourself.', voice: 'en_US-joe-medium', length_scale: 0.8 }]);

    const second = await tts({ text: 'Tell me about yourself.' });
    expect(second.headers['x-tts-cache']).toBe('hit');
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
    expect(fake!.requests).toHaveLength(1);
  });

  it('accepts a voice override for "Test voice" without saving it', async () => {
    await setup();
    await tts({ text: 'Hello.', voice: 'en_US-norman-medium', speechRate: 1 });
    expect(fake!.requests[0]).toMatchObject({ voice: 'en_US-norman-medium', length_scale: 1 });
    expect((await app.inject({ url: '/api/settings' })).json()).toMatchObject({ ttsVoice: 'en_US-ljspeech-medium' });
  });

  it('rejects empty text and unknown voices', async () => {
    await setup();
    expect((await tts({ text: '   ' })).statusCode).toBe(400);
    expect((await tts({ text: 'Hi.', voice: 'en_US-lessac-medium' })).statusCode).toBe(400);
    expect(fake!.requests).toHaveLength(0);
  });

  it('answers 503 with a start hint when Piper is down', async () => {
    await setup('http://127.0.0.1:9');
    const res = await tts({ text: 'Hello.' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ hint: expect.stringContaining('make deps-up') });
  });
});

describe('voices and health', () => {
  it('lists the catalog with what is installed', async () => {
    await setup(undefined, ['en_US-ljspeech-medium']);
    const list = voiceListSchema.parse((await app.inject({ url: '/api/speech/voices' })).json());
    expect(list.piperRunning).toBe(true);
    expect(list.selected).toBe('en_US-ljspeech-medium');
    expect(list.voices.find((v) => v.id === 'en_US-ljspeech-medium')).toMatchObject({ installed: true });
    expect(list.voices.find((v) => v.id === 'en_US-joe-medium')).toMatchObject({ installed: false });
    expect(list.voices.every((v) => v.datasetLicense.length > 0)).toBe(true);
  });

  it('reports TTS in health: ok, missing voice, down', async () => {
    await setup(undefined, ['en_US-ljspeech-medium']);
    const health = async () => healthSchema.parse((await app.inject({ url: '/api/health' })).json()).tts;
    expect(await health()).toMatchObject({ status: 'ok', voice: 'en_US-ljspeech-medium' });
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { ttsVoice: 'en_US-joe-medium' } });
    expect(await health()).toMatchObject({ status: 'degraded', hint: expect.stringContaining('make voices') });
    await fake!.close();
    fake = undefined;
    expect(await health()).toMatchObject({ status: 'down', hint: expect.stringContaining('make deps-up') });
  });
});
