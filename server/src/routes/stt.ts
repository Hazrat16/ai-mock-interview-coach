import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SttResult } from '@shared/schemas/stt';
import { HttpError } from '../errors';
import type { SampleStore } from '../speech/samples';
import type { WhisperClient } from '../speech/sttClient';
import { buildTranscript } from '../speech/transcript';
import { InvalidWavError, parseWav } from '../speech/wav';

/** Longest audio accepted in one request. Answers are sent in segments (M7), so this is generous. */
const MAX_SECONDS = 180;
const BODY_LIMIT = 12 * 1024 * 1024; // 180 s at 16 kHz 16-bit mono is ~5.8 MB; allows 32 kHz too

const queryLimit = z.string().trim().max(500);

export function sttRoutes(app: FastifyInstance, whisper: WhisperClient, model: string, samples: SampleStore) {
  // Raw WAV bodies (no multipart): the browser sends the encoded recording as is.
  app.addContentTypeParser('audio/wav', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_req, body, done) =>
    done(null, body),
  );

  const readWav = (body: unknown) => {
    if (!Buffer.isBuffer(body)) throw new HttpError(415, 'Send the recording as audio/wav');
    try {
      const info = parseWav(body);
      if (info.durationSec > MAX_SECONDS) throw new HttpError(413, `Recording is longer than ${MAX_SECONDS} s`);
      if (info.durationSec < 0.1) throw new HttpError(400, 'Recording is empty');
      return info;
    } catch (err) {
      if (err instanceof InvalidWavError) throw new HttpError(400, `Invalid recording: ${err.message}`);
      throw err;
    }
  };

  app.post('/api/stt', async (req): Promise<SttResult> => {
    readWav(req.body);
    const prompt = queryLimit.optional().parse((req.query as { prompt?: string }).prompt);
    const started = performance.now();
    const raw = await whisper.transcribe(req.body as Buffer, { prompt });
    const ms = Math.round(performance.now() - started);
    const { text, words, segments } = buildTranscript(raw.segments);
    return {
      text,
      words,
      durationSec: raw.durationSec,
      ms,
      model,
      segments: segments.map(({ start, end, text: t, kept, reason }) => ({ start, end, text: t, kept, reason })),
    };
  });

  app.get('/api/stt/samples', () => samples.list());

  app.post('/api/stt/samples', async (req, reply) => {
    const info = readWav(req.body);
    const reference = queryLimit.min(1).safeParse((req.query as { reference?: string }).reference);
    if (!reference.success) throw new HttpError(400, 'The sentence you read (reference) is required');
    const q = req.query as { mic?: string; processing?: string };
    const id = await samples.save(req.body as Buffer, reference.data, info.durationSec, {
      mic: q.mic ? queryLimit.parse(q.mic).slice(0, 100) : undefined,
      processing: q.processing === undefined ? undefined : q.processing === 'true',
    });
    return reply.code(201).send({ id });
  });

  app.delete('/api/stt/samples', async () => ({ deleted: await samples.deleteAll() }));
}
