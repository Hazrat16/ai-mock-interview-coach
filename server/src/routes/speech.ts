import type { FastifyInstance } from 'fastify';
import { ttsRequestSchema, type VoiceList } from '@shared/schemas/speech';
import { VOICES } from '@shared/voices';
import type { Settings } from '@shared/schemas/settings';
import type { TextToSpeech } from '../speech/tts';
import type { PiperClient } from '../speech/ttsClient';

export function speechRoutes(app: FastifyInstance, tts: TextToSpeech, piper: PiperClient, settings: () => Settings) {
  // One sentence (or a short text) at a time: the browser splits and pipelines, so playback starts early.
  app.post('/api/speech/tts', async (req, reply) => {
    const body = ttsRequestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid text-to-speech request' });
    const { text, ...overrides } = body.data;
    const spoken = await tts.speak(text, overrides);
    return reply
      .type('audio/wav')
      .header('cache-control', 'no-store')
      .header('x-tts-ms', String(spoken.ms))
      .header('x-tts-cache', spoken.cached ? 'hit' : 'miss')
      .send(spoken.wav);
  });

  app.get('/api/speech/voices', async (): Promise<VoiceList> => {
    const installed = await piper.installedVoices().catch(() => undefined);
    return {
      selected: settings().ttsVoice,
      piperRunning: installed !== undefined,
      voices: VOICES.map(({ id, label, datasetLicense }) => ({
        id,
        label,
        datasetLicense,
        installed: installed?.includes(id) ?? false,
      })),
    };
  });
}
