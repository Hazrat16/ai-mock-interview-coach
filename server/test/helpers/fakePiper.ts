import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A valid 16-bit mono PCM WAV of silence. */
export function makeWav(seconds = 0.5, sampleRate = 22050): Buffer {
  const data = Math.round(seconds * sampleRate) * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data, 40);
  return buf;
}

/**
 * Stand-in for the Piper HTTP server. Every /synthesize body is recorded in `requests`.
 * `listen(port)` can start it on a fixed port, e.g. to simulate Piper coming back after a crash.
 */
export async function startFakePiper(opts: { voices?: string[]; port?: number } = {}) {
  const requests: Record<string, unknown>[] = [];
  const voices = opts.voices ?? ['en_US-ljspeech-medium', 'en_US-joe-medium'];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/voices') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(Object.fromEntries(voices.map((v) => [v, { audio: {} }]))));
      }
      if (req.url === '/synthesize' && req.method === 'POST') {
        const body = JSON.parse(raw) as Record<string, unknown>;
        requests.push(body);
        if (!String(body.text ?? '').trim()) {
          res.writeHead(500, { 'content-type': 'text/html' });
          return res.end('<h1>Internal Server Error</h1>');
        }
        res.writeHead(200, { 'content-type': 'audio/wav' });
        return res.end(makeWav());
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
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

export type FakePiper = Awaited<ReturnType<typeof startFakePiper>>;
