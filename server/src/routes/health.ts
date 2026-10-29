import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/connection';
import { defaultSettings, getSettings } from '../db/repos/settings';
import type { Env } from '../env';
import { checkTts, getHealth } from '../runtime/health';
import type { PiperClient } from '../speech/ttsClient';

export function healthRoutes(app: FastifyInstance, env: Env, db: Db, version: string, piper: PiperClient) {
  const defaults = defaultSettings(env);
  app.get('/api/health', () => {
    const s = getSettings(db, defaults);
    const wanted = [...new Set([s.interviewerModel, s.evaluatorModel, env.FALLBACK_MODEL])];
    return getHealth(env, version, wanted, () => checkTts(piper, s.ttsVoice));
  });
}
