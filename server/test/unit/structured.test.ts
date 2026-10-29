import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaClient } from '../../src/llm/ollamaClient';
import { StructuredOutputError, structuredChat } from '../../src/llm/structured';
import { chatReply, type FakeOllama, startFakeOllama } from '../helpers/fakeOllama';

const schema = z.object({ action: z.enum(['follow_up', 'next']), score: z.number().int().min(0).max(4) });

let fake: FakeOllama | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function run(...replies: ReturnType<typeof chatReply>[]) {
  fake = await startFakeOllama({ chat: replies });
  return structuredChat(new OllamaClient(fake.url), {
    model: 'qwen3.5:4b',
    schema,
    messages: [{ role: 'user', content: 'decide' }],
  });
}

describe('structuredChat', () => {
  it('returns parsed data and sends the JSON schema as the format', async () => {
    const result = await run(chatReply('{"action":"next","score":3}'));
    expect(result).toMatchObject({ data: { action: 'next', score: 3 }, attempts: 1 });
    expect(fake!.requests[0]!.format).toMatchObject({
      type: 'object',
      properties: { action: { enum: ['follow_up', 'next'] } },
    });
  });

  it('repairs invalid JSON with one retry that explains the problem', async () => {
    const result = await run(chatReply('{"action": "next", '), chatReply('{"action":"next","score":2}'));
    expect(result).toMatchObject({ data: { score: 2 }, attempts: 2 });
    const retry = fake!.requests[1]!.messages as { role: string; content: string }[];
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: '{"action": "next", ' });
    expect(retry.at(-1)!.content).toContain('not valid JSON');
  });

  it('repairs a value outside the allowed range', async () => {
    const result = await run(chatReply('{"action":"next","score":9}'), chatReply('{"action":"next","score":4}'));
    expect(result.attempts).toBe(2);
    expect((fake!.requests[1]!.messages as { content: string }[]).at(-1)!.content).toMatch(/score/);
  });

  it('says the reply was cut off when generation hit the token limit', async () => {
    await run(chatReply('{"action":"ne', { done_reason: 'length' }), chatReply('{"action":"next","score":1}'));
    expect((fake!.requests[1]!.messages as { content: string }[]).at(-1)!.content).toContain('cut off');
  });

  it('gives up after the repair also fails', async () => {
    const err = await run(chatReply('nope'), chatReply('still nope')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect((err as StructuredOutputError).raw).toBe('still nope');
  });
});
