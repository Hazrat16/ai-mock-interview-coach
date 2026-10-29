// Text-to-speech benchmark against the running Piper container (make bench-tts).
// For each downloaded voice: first-sentence latency (when playback can start), whole-text time, and
// real-time factor (synthesis time / audio length; below 1 means faster than speech).
// Then the default voice again while Ollama is generating, the worst case during an interview.
// Options: --runs N (default 3), --no-load (skip the LLM-load pass).
import { splitSentences } from '../shared/text/sentences';
import { VOICES } from '../shared/voices';
import { PiperClient } from '../server/src/speech/ttsClient';
import { parseWav } from '../server/src/speech/wav';

process.loadEnvFile('.env');
const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 3;
const piper = new PiperClient(process.env.PIPER_URL ?? 'http://127.0.0.1:5150', []);
const ollamaUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435';

const TEXTS = {
  intro:
    "Hello, and thanks for joining. This is a behavioral interview for a junior Backend Engineer role. I have 5 questions for you, and I may ask a short follow-up now and then. Take your time with each answer. Let's begin.",
  question:
    'Got it, thank you. Next question. Walk me through how you would design a URL shortener that handles one hundred million new links per month, including how you would generate the short codes and keep redirects fast.',
  short: 'Thank you. And the last question. What would you do differently next time?',
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function time(text: string, voice: string) {
  const t = performance.now();
  const wav = await piper.synthesize(text, { voice, lengthScale: 1 });
  return { ms: performance.now() - t, audioSec: parseWav(wav).durationSec };
}

async function measure(voice: string) {
  await time('Warm up.', voice); // loads the voice into Piper (1-2 s the first time)
  const rows: string[] = [];
  for (const [name, text] of Object.entries(TEXTS)) {
    const first = splitSentences(text)[0]!;
    const firstMs: number[] = [];
    const wholeMs: number[] = [];
    let audioSec = 0;
    for (let i = 0; i < runs; i++) {
      firstMs.push((await time(first, voice)).ms);
      const whole = await time(text, voice);
      wholeMs.push(whole.ms);
      audioSec = whole.audioSec;
    }
    const rtf = median(wholeMs) / 1000 / audioSec;
    rows.push(
      `| ${voice} | ${name} | ${Math.round(median(firstMs))} | ${Math.round(median(wholeMs))} | ${audioSec.toFixed(1)} | ${rtf.toFixed(3)} |`,
    );
  }
  return rows;
}

const installed = await piper.installedVoices().catch(() => {
  console.error('Piper is not reachable. Start it with: make deps-up');
  process.exit(1);
});
console.log(`Runs per text: ${runs} (median shown). Times in ms.\n`);
console.log('| Voice | Text | First sentence ms | Whole text ms | Audio s | RTF |');
console.log('|---|---|---|---|---|---|');
for (const v of VOICES.filter((voice) => installed.includes(voice.id))) {
  for (const row of await measure(v.id)) console.log(row);
}

if (!args.includes('--no-load')) {
  const model = process.env.INTERVIEWER_MODEL ?? 'granite4:3b';
  const voice = process.env.PIPER_DEFAULT_VOICE ?? 'en_US-ljspeech-medium';
  const load = fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [{ role: 'user', content: 'Write 300 words about software testing.' }],
      options: { num_predict: 400, num_thread: Number(process.env.LLM_NUM_THREAD) || undefined },
    }),
  }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 4000)); // let the model load and start generating
  console.log(`\nWhile ${model} is generating:\n`);
  console.log('| Voice | Text | First sentence ms | Whole text ms | Audio s | RTF |');
  console.log('|---|---|---|---|---|---|');
  for (const row of await measure(voice)) console.log(row);
  await load;
}
