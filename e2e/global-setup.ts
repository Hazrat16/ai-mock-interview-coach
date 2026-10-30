// Makes the fake microphone input: Piper reads an interview answer, with a second of silence before it
// (the interviewer has just finished) so the answer starts during thinking time like a real one.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FAKE_MIC_WAV } from '../playwright.config';
import { PiperClient } from '../server/src/speech/ttsClient';

// Deliberately vague (no situation, no result), so the interviewer has a reason to ask a follow-up.
export const ANSWER =
  'I usually just work it out with the team. We talk about it and then we find something that works for everyone.';

export default async function globalSetup() {
  process.loadEnvFile('.env');
  const piper = new PiperClient(process.env.PIPER_URL ?? 'http://127.0.0.1:5150', [1000, 2000]);
  const wav = await piper.synthesize(ANSWER, { voice: 'en_US-joe-medium', lengthScale: 1.05 });
  const rate = wav.readUInt32LE(24);
  const silence = Buffer.alloc(rate * 2); // 1 s of 16-bit mono silence
  const data = Buffer.concat([silence, wav.subarray(44)]);
  const header = Buffer.from(wav.subarray(0, 44));
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(FAKE_MIC_WAV), { recursive: true });
  writeFileSync(FAKE_MIC_WAV, Buffer.concat([header, data]));
}
