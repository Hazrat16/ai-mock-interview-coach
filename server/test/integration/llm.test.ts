import { afterEach, describe, expect, it } from 'vitest';
import { apiErrorSchema, modelTestResultSchema } from '@shared/schemas/llm';
import { buildApp } from '../../src/app';
import { openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { parseEnv } from '../../src/env';
import { chatReply, type FakeOllama, type FakeReply, startFakeOllama } from '../helpers/fakeOllama';

let fake: FakeOllama | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function testModel(ollamaUrl: string) {
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: '/tmp/coach', OLLAMA_URL: ollamaUrl });
  const db = openMemoryDb();
  await migrate(db);
  const app = await buildApp(env, db, '0.0.0-test');
  const res = await app.inject({ method: 'POST', url: '/api/llm/test', payload: { model: 'qwen3.5:4b' } });
  await app.close();
  return res;
}

async function withReplies(...chat: FakeReply[]) {
  fake = await startFakeOllama({ chat });
  return testModel(fake.url);
}

describe('POST /api/llm/test', () => {
  it('returns the question with speed figures', async () => {
    const res = await withReplies(chatReply('{"question":"Tell me about a hard bug."}'));
    expect(res.statusCode).toBe(200);
    expect(modelTestResultSchema.parse(res.json())).toMatchObject({
      question: 'Tell me about a hard bug.',
      outputTokensPerSec: 30,
      loadSeconds: 0.5,
      attempts: 1,
    });
  });

  it('explains a missing model', async () => {
    const res = await withReplies({ status: 404, body: { error: "model 'qwen3.5:4b' not found" } });
    expect(res.statusCode).toBe(502);
    expect(apiErrorSchema.parse(res.json()).hint).toContain('make models');
  });

  it('explains that Ollama is not running', async () => {
    const res = await testModel('http://127.0.0.1:9');
    expect(res.statusCode).toBe(503);
    expect(apiErrorSchema.parse(res.json()).hint).toContain('make deps-up');
  });

  it('reports a model that answers invalid JSON twice', async () => {
    const res = await withReplies(chatReply('not json'));
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('invalid answer twice');
  });
});
