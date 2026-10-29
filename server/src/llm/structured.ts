import { z } from 'zod';
import type { ChatMessage, ChatMetrics, ChatRequest, OllamaClient } from './ollamaClient';

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    /** The model's last raw output, for logs and debugging. */
    readonly raw: string,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

export type StructuredResult<T> = {
  data: T;
  /** 1 = valid first time, 2 = needed the repair retry. */
  attempts: number;
  metrics: ChatMetrics[];
};

type Check<T> = { ok: true; data: T } | { ok: false; problem: string };

function check<T>(schema: z.ZodType<T>, content: string, doneReason: string): Check<T> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    const cut = doneReason === 'length' ? ' (the reply was cut off: too long)' : '';
    return { ok: false, problem: `the reply was not valid JSON${cut}` };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, problem: z.prettifyError(parsed.error) };
}

/**
 * Chat call whose reply must be JSON matching `schema`. Ollama constrains the output to the schema's
 * JSON form; Zod then checks everything else (ranges, enums). On failure the model gets one chance to
 * fix its reply, given the exact problem.
 */
export async function structuredChat<T>(
  client: OllamaClient,
  req: Omit<ChatRequest, 'format'> & { schema: z.ZodType<T> },
): Promise<StructuredResult<T>> {
  const { schema, ...chatReq } = req;
  const format = z.toJSONSchema(schema) as Record<string, unknown>;
  const metrics: ChatMetrics[] = [];

  const first = await client.chat({ ...chatReq, format });
  metrics.push(first.metrics);
  const firstCheck = check(schema, first.content, first.doneReason);
  if (firstCheck.ok) return { data: firstCheck.data, attempts: 1, metrics };

  const repairMessages: ChatMessage[] = [
    ...chatReq.messages,
    { role: 'assistant', content: first.content },
    {
      role: 'user',
      content: `Your reply was invalid: ${firstCheck.problem}\nReply again with only the corrected JSON.`,
    },
  ];
  const second = await client.chat({ ...chatReq, messages: repairMessages, format });
  metrics.push(second.metrics);
  const secondCheck = check(schema, second.content, second.doneReason);
  if (secondCheck.ok) return { data: secondCheck.data, attempts: 2, metrics };

  throw new StructuredOutputError(`Model output was invalid twice: ${secondCheck.problem}`, second.content);
}
