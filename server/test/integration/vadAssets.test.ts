import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { parseEnv } from '../../src/env';

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  db = openMemoryDb();
  await migrate(db);
  app = await buildApp(parseEnv({ NODE_ENV: 'test', DATA_DIR: '/tmp/coach' }), db, '0.0.0-test');
});
afterAll(async () => {
  await app.close();
  db.close();
});

describe('GET /vad/:file (speech-detection files, served locally)', () => {
  it.each([
    ['ort-wasm-simd-threaded.wasm', 'application/wasm'],
    ['ort-wasm-simd-threaded.mjs', 'text/javascript'],
    ['vad.worklet.bundle.min.js', 'text/javascript'],
    ['silero_vad_v5.onnx', 'application/octet-stream'],
  ])('serves %s as %s', async (file, type) => {
    const res = await app.inject({ url: `/vad/${file}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(type);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
  });

  it('works with the ?import suffix Vite adds to module imports in development', async () => {
    expect((await app.inject({ url: '/vad/ort-wasm-simd-threaded.mjs?import' })).statusCode).toBe(200);
  });

  it('serves nothing else', async () => {
    for (const url of ['/vad/package.json', '/vad/..%2F..%2Fpackage.json', '/vad/silero_vad_legacy.onnx']) {
      expect((await app.inject({ url })).statusCode).toBe(404);
    }
  });
});
