import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelMissingError,
  OllamaClient,
  OllamaTimeoutError,
  OllamaUnavailableError,
} from '../../src/llm/ollamaClient';
import { chatReply, type FakeOllama, startFakeOllama } from '../helpers/fakeOllama';

let fake: FakeOllama | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const ask = (client: OllamaClient, model = 'qwen3.5:4b', timeoutMs?: number) =>
  client.chat({ model, messages: [{ role: 'user', content: 'hi' }], timeoutMs });

describe('OllamaClient.chat', () => {
  it('returns the content and timings in milliseconds, with thinking disabled', async () => {
    fake = await startFakeOllama({ chat: [chatReply('hello')] });
    const result = await ask(new OllamaClient(fake.url));
    expect(result).toEqual({
      content: 'hello',
      doneReason: 'stop',
      metrics: { totalMs: 2000, loadMs: 500, promptTokens: 40, promptMs: 400, outputTokens: 30, outputMs: 1000 },
    });
    expect(fake.requests[0]).toMatchObject({ model: 'qwen3.5:4b', stream: false, think: false });
  });

  it('reports a missing model with the download command', async () => {
    fake = await startFakeOllama({ chat: [{ status: 404, body: { error: "model 'x' not found" } }] });
    const err = await ask(new OllamaClient(fake.url), 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelMissingError);
    expect((err as ModelMissingError).hint).toContain('make models');
  });

  it('reports Ollama not running with the start command', async () => {
    const err = await ask(new OllamaClient('http://127.0.0.1:9')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OllamaUnavailableError);
    expect((err as OllamaUnavailableError).hint).toContain('make deps-up');
  });

  it('times out instead of waiting forever', async () => {
    fake = await startFakeOllama({ chat: [{ ...chatReply('late'), delayMs: 2000 }] });
    await expect(ask(new OllamaClient(fake.url), 'qwen3.5:4b', 100)).rejects.toBeInstanceOf(OllamaTimeoutError);
  });

  it('retries without `think` for a model that has no thinking mode, and remembers it', async () => {
    fake = await startFakeOllama({
      chat: [{ status: 400, body: { error: '"granite4:3b" does not support thinking' } }, chatReply('ok')],
    });
    const client = new OllamaClient(fake.url);
    expect((await ask(client, 'granite4:3b')).content).toBe('ok');
    await ask(client, 'granite4:3b');
    expect(fake.requests.map((r) => 'think' in r)).toEqual([true, false, false]);
  });
});
