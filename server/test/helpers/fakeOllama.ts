import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeReply = { status?: number; body: unknown; delayMs?: number };

/** A successful /api/chat body with the given assistant content. */
export function chatReply(content: string, extra: Record<string, unknown> = {}): FakeReply {
  return {
    body: {
      message: { role: 'assistant', content },
      done_reason: 'stop',
      total_duration: 2_000_000_000,
      load_duration: 500_000_000,
      prompt_eval_count: 40,
      prompt_eval_duration: 400_000_000,
      eval_count: 30,
      eval_duration: 1_000_000_000,
      ...extra,
    },
  };
}

/**
 * Stand-in for Ollama. /api/chat answers with `chat` replies in order (the last one repeats).
 * Every /api/chat request body is recorded in `requests`.
 */
export async function startFakeOllama(opts: { models?: string[]; chat?: FakeReply[] } = {}) {
  const requests: Record<string, unknown>[] = [];
  const queue = [...(opts.chat ?? [])];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        if (res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/api/version') return send(200, { version: '0.40.13' });
      if (req.url === '/api/tags') return send(200, { models: (opts.models ?? []).map((name) => ({ name })) });
      if (req.url === '/api/chat') {
        requests.push(JSON.parse(raw));
        const reply = queue.length > 1 ? queue.shift()! : queue[0];
        if (!reply) return send(500, { error: 'no scripted reply' });
        return setTimeout(() => send(reply.status ?? 200, reply.body), reply.delayMs ?? 0);
      }
      send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type FakeOllama = Awaited<ReturnType<typeof startFakeOllama>>;
