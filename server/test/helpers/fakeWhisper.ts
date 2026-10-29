import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeSegment = { text: string; no_speech_prob?: number; avg_logprob?: number; start?: number; end?: number };

/**
 * Stand-in for whisper-server. /inference answers with `segments` (or `segments(fields)`), and records each
 * request's form fields (`file` as its byte length) in `requests`.
 */
export async function startFakeWhisper(
  opts: { segments?: FakeSegment[] | ((fields: Record<string, string | number>) => FakeSegment[]) } = {},
) {
  const requests: Record<string, string | number>[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      if (req.url === '/health') return res.writeHead(200).end('{"status":"ok"}');
      if (req.url !== '/inference') return res.writeHead(404).end();
      // Parse the multipart body the same way a server would.
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': req.headers['content-type'] ?? '' },
      }).formData();
      const fields: Record<string, string | number> = {};
      for (const [k, v] of form) fields[k] = typeof v === 'string' ? v : v.size;
      requests.push(fields);
      const segments = typeof opts.segments === 'function' ? opts.segments(fields) : (opts.segments ?? []);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          task: 'transcribe',
          language: 'english',
          duration: 2,
          text: segments.map((s) => s.text).join(''),
          segments: segments.map((s, id) => ({ id, start: 0, end: 1, no_speech_prob: 0.01, avg_logprob: -0.2, ...s })),
        }),
      );
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

export type FakeWhisper = Awaited<ReturnType<typeof startFakeWhisper>>;
