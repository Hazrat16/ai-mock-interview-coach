import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { healthSchema } from '@shared/schemas/health';
import { buildApp } from '../../src/app';
import { openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { parseEnv } from '../../src/env';

let fake: Server | undefined;
afterEach(() => fake?.close());

/** Starts a stand-in for Ollama's /api/version and /api/tags. Returns its URL. */
async function fakeOllama(installed: string[]): Promise<string> {
  fake = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.40.13' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: installed.map((name) => ({ name })) }));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => fake!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
}

async function health(ollamaUrl: string) {
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: '/tmp/coach', OLLAMA_URL: ollamaUrl });
  const db = openMemoryDb();
  await migrate(db);
  const app = await buildApp(env, db, '0.0.0-test');
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  await app.close();
  db.close();
  return { res, body: healthSchema.parse(res.json()) };
}

describe('GET /api/health', () => {
  it('is ok when Ollama runs with both models', async () => {
    const { res, body } = await health(await fakeOllama(['qwen3.5:4b', 'granite4:3b']));
    expect(res.statusCode).toBe(200);
    expect(body.ollama).toMatchObject({ status: 'ok', version: '0.40.13' });
    expect(body.ollama.available).toEqual(['granite4:3b', 'qwen3.5:4b']);
  });

  it('is degraded with a download hint when a model is missing', async () => {
    const { body } = await health(await fakeOllama(['qwen3.5:4b']));
    expect(body.ollama.status).toBe('degraded');
    expect(body.ollama.detail).toContain('granite4:3b');
    expect(body.ollama.hint).toContain('make models');
  });

  it('is down with a start hint when Ollama is not running', async () => {
    const url = await fakeOllama([]);
    await new Promise((resolve) => fake!.close(resolve)); // free the port: nothing listens there now
    const { res, body } = await health(url);
    expect(res.statusCode).toBe(200);
    expect(body.ollama.status).toBe('down');
    expect(body.ollama.hint).toContain('make deps-up');
  });

  it('sends a same-origin-only content security policy', async () => {
    const { res } = await health(await fakeOllama([]));
    expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
  });
});
