import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Db } from './db/connection';
import { defaultSettings, getSettings } from './db/repos/settings';
import type { Env } from './env';
import { HttpError } from './errors';
import { type EngineDeps, InterviewEngine } from './interview/engine';
import { FIXED_PHRASES } from './interview/phrases';
import { OllamaClient, OllamaError, OllamaUnavailableError } from './llm/ollamaClient';
import { StructuredOutputError } from './llm/structured';
import { healthRoutes } from './routes/health';
import { JobRunner } from './evaluation/jobRunner';
import { evaluationQueue, evaluationRoutes } from './routes/evaluations';
import { llmRoutes } from './routes/llm';
import { speechRoutes } from './routes/speech';
import { sttRoutes } from './routes/stt';
import { vadAssetRoutes } from './routes/vadAssets';
import { sessionRoutes } from './routes/sessions';
import { settingsRoutes } from './routes/settings';
import { PhraseCache } from './speech/phraseCache';
import { SampleStore } from './speech/samples';
import { SttError, SttUnavailableError, WhisperClient } from './speech/sttClient';
import { TextToSpeech } from './speech/tts';
import { PiperClient, TtsError, TtsUnavailableError } from './speech/ttsClient';

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

export type AppOptions = {
  /** Interview engine overrides (tests use short timeouts). */
  engine?: Partial<EngineDeps>;
  /** Waits before retrying an unreachable Piper / Whisper (tests use none). */
  ttsRetryDelaysMs?: number[];
  sttRetryDelaysMs?: number[];
};

export async function buildApp(env: Env, db: Db, version: string, options: AppOptions = {}) {
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
    if (err instanceof TtsError || err instanceof SttError) {
      const unavailable = err instanceof TtsUnavailableError || err instanceof SttUnavailableError;
      return reply.code(unavailable ? 503 : 502).send({ error: err.message, hint: err.hint });
    }
    if (err instanceof StructuredOutputError) {
      app.log.warn({ raw: err.raw.slice(0, 500) }, err.message);
      return reply.code(502).send({ error: 'The model gave an invalid answer twice. Try again.' });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  const defaults = defaultSettings(env);
  const settings = () => getSettings(db, defaults);
  const llm = new OllamaClient(env.OLLAMA_URL);
  const piper = new PiperClient(env.PIPER_URL, options.ttsRetryDelaysMs);
  const tts = new TextToSpeech(piper, new PhraseCache(join(env.DATA_DIR, 'tts-cache')), settings);
  const whisper = new WhisperClient(env.WHISPER_URL, options.sttRetryDelaysMs);
  healthRoutes(app, env, db, version, { piper, whisper });
  settingsRoutes(app, env, db);
  llmRoutes(app, env, llm);
  speechRoutes(app, tts, piper, settings);
  vadAssetRoutes(app);
  sttRoutes(app, whisper, env.WHISPER_MODEL, new SampleStore(join(env.DATA_DIR, 'stt-samples')));
  if (env.NODE_ENV !== 'test') {
    // Fixed phrases get cached audio right away, so the first interview never waits for them.
    app.addHook('onListen', async () => {
      void tts.prewarm(FIXED_PHRASES, (msg) => console.log(msg)); // in the background; listen does not wait
    });
  }
  // Evaluations run in the background after an interview (not in tests: they drive a JobRunner themselves).
  const runner = new JobRunner({
    db,
    llm,
    fallbackModel: env.FALLBACK_MODEL,
    numThread: env.LLM_NUM_THREAD,
    log: (msg) => console.log(msg),
  });
  const queue = evaluationQueue(
    db,
    () => settings().evaluatorModel,
    () => runner.wake(),
  );
  evaluationRoutes(app, db, queue);
  if (env.NODE_ENV !== 'test') {
    app.addHook('onListen', async () => runner.start());
    app.addHook('onClose', async () => runner.stop());
  }

  sessionRoutes(
    app,
    new InterviewEngine({
      db,
      llm,
      settings,
      numThread: env.LLM_NUM_THREAD,
      warmUp: env.NODE_ENV !== 'test',
      log: (msg) => app.log.info(msg),
      // After the engine's own transaction has finished.
      onCompleted: (sessionId) =>
        setImmediate(() => {
          if (!db.isOpen) return; // the app is shutting down; "Evaluate this interview" in the report catches up
          try {
            queue.enqueue(sessionId);
          } catch (err) {
            app.log.error(err, 'could not queue evaluations');
          }
        }),
      ...options.engine,
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
