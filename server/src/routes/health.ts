import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/connection';
import { defaultSettings, getSettings } from '../db/repos/settings';
import type { Env } from '../env';
import { checkStt, checkTts, getHealth } from '../runtime/health';
import type { WhisperClient } from '../speech/sttClient';
import type { PiperClient } from '../speech/ttsClient';

export function healthRoutes(
  app: FastifyInstance,
  env: Env,
  db: Db,
  version: string,
  speech: { piper: PiperClient; whisper: WhisperClient },
) {
  const defaults = defaultSettings(env);
  app.get('/api/health', () => {
    const s = getSettings(db, defaults);
    const wanted = [...new Set([s.interviewerModel, s.evaluatorModel, env.FALLBACK_MODEL])];
    return getHealth(
      env,
      version,
      wanted,
      () => checkTts(speech.piper, s.ttsVoice),
      () => checkStt(speech.whisper, env.WHISPER_MODEL),
    );
  });
}
