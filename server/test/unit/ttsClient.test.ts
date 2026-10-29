import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PiperClient, parseWav, TtsError, TtsUnavailableError } from '../../src/speech/ttsClient';
import { type FakePiper, makeWav, startFakePiper } from '../helpers/fakePiper';

let fake: FakePiper | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

/** A port that nothing listens on right now. */
async function freePort() {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

const opts = { voice: 'en_US-ljspeech-medium', lengthScale: 1 };

describe('parseWav', () => {
  it('reads sample rate, channels, and duration', () => {
    expect(parseWav(makeWav(1.5))).toEqual({ sampleRate: 22050, channels: 1, bitsPerSample: 16, durationSec: 1.5 });
  });

  it('rejects an HTML error page and a non-PCM file', () => {
    expect(() => parseWav(Buffer.from('<h1>Internal Server Error</h1>'.padEnd(60)))).toThrow(TtsError);
    const float = makeWav();
    float.writeUInt16LE(3, 20); // IEEE float
    expect(() => parseWav(float)).toThrow(/non-PCM/);
  });
});

describe('PiperClient', () => {
  it('sends text, voice, and length scale, and returns the WAV', async () => {
    fake = await startFakePiper();
    const wav = await new PiperClient(fake.url).synthesize('Hello there.', {
      voice: 'en_US-joe-medium',
      lengthScale: 0.9,
    });
    expect(parseWav(wav).sampleRate).toBe(22050);
    expect(fake.requests).toEqual([{ text: 'Hello there.', voice: 'en_US-joe-medium', length_scale: 0.9 }]);
  });

  it('lists installed voices', async () => {
    fake = await startFakePiper({ voices: ['b', 'a'] });
    expect(await new PiperClient(fake.url).installedVoices()).toEqual(['a', 'b']);
  });

  it('turns an HTTP error into a TtsError instead of passing on a broken file', async () => {
    fake = await startFakePiper();
    await expect(new PiperClient(fake.url, []).synthesize(' ', opts)).rejects.toThrow(/HTTP 500/);
  });

  it('gives up with a start hint when Piper stays down', async () => {
    const client = new PiperClient(`http://127.0.0.1:${await freePort()}`, [10, 10]);
    const err = await client.synthesize('Hi.', opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsUnavailableError);
    expect((err as TtsUnavailableError).hint).toContain('make deps-up');
  });

  it('waits for Piper to come back after a crash (Docker restarts it)', async () => {
    const port = await freePort();
    const client = new PiperClient(`http://127.0.0.1:${port}`, [100, 100, 100]);
    const pending = client.synthesize('Still there?', opts);
    setTimeout(() => void startFakePiper({ port }).then((f) => (fake = f)), 150);
    expect(parseWav(await pending).durationSec).toBeGreaterThan(0);
  });
});
