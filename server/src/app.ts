import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Db } from './db/connection';
import type { Env } from './env';
import { healthRoutes } from './routes/health';
import { settingsRoutes } from './routes/settings';

const WEB_DIST = fileURLToPath(new URL('../../dist/web', import.meta.url));

// Everything is served from this origin; nothing may load from or talk to the internet.
// 'wasm-unsafe-eval' and blob: are needed later for the in-browser voice detector (M7).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(env: Env, db: Db, version: string) {
  // 'warn' keeps per-request lines (logged at info) out of the terminal.
  const app = Fastify({ logger: env.NODE_ENV === 'test' ? false : { level: 'warn' } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  healthRoutes(app, env, db, version);
  settingsRoutes(app, env, db);

  // Production: serve the built UI. In development Vite serves it and proxies /api here.
  if (env.NODE_ENV === 'production') {
    if (!existsSync(WEB_DIST)) throw new Error('dist/web not found. Run: npm run build');
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api/')
        ? reply.sendFile('index.html') // client-side routes
        : reply.code(404).send({ error: 'Not found' }),
    );
  }

  return app;
}
