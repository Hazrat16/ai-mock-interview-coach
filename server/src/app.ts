import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Db } from './db/connection';
import { defaultSettings, getSettings } from './db/repos/settings';
import type { Env } from './env';
import { HttpError } from './errors';
import { type EngineDeps, InterviewEngine } from './interview/engine';
import { OllamaClient, OllamaError, OllamaUnavailableError } from './llm/ollamaClient';
import { StructuredOutputError } from './llm/structured';
import { healthRoutes } from './routes/health';
import { llmRoutes } from './routes/llm';
import { sessionRoutes } from './routes/sessions';
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

/** `engine` overrides interview engine options (tests use short timeouts). */
export async function buildApp(env: Env, db: Db, version: string, engine: Partial<EngineDeps> = {}) {
  // 'warn' keeps per-request lines (logged at info) out of the terminal.
  const app = Fastify({ logger: env.NODE_ENV === 'test' ? false : { level: 'warn' } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  // LLM failures become a readable error plus what to do about it, instead of a bare 500.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof OllamaError) {
      return reply.code(err instanceof OllamaUnavailableError ? 503 : 502).send({ error: err.message, hint: err.hint });
    }
    if (err instanceof StructuredOutputError) {
      app.log.warn({ raw: err.raw.slice(0, 500) }, err.message);
      return reply.code(502).send({ error: 'The model gave an invalid answer twice. Try again.' });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  const llm = new OllamaClient(env.OLLAMA_URL);
  healthRoutes(app, env, db, version);
  settingsRoutes(app, env, db);
  llmRoutes(app, env, llm);
  const defaults = defaultSettings(env);
  sessionRoutes(
    app,
    new InterviewEngine({
      db,
      llm,
      settings: () => getSettings(db, defaults),
      numThread: env.LLM_NUM_THREAD,
      warmUp: env.NODE_ENV !== 'test',
      log: (msg) => app.log.info(msg),
      ...engine,
    }),
  );

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
