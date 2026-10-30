// Speech-to-text benchmark (make bench-stt). Needs the piper and whisper containers running.
// 1. Loopback: Piper speaks known interview answers in two voices; each Whisper model transcribes them;
//    word error rate (WER) and speed are measured. Includes a ~30 s clip (acceptance: <= 5 s).
// 2. Your own recordings from Settings ("Save for benchmark"), if any: the real accuracy test.
// Options: --models base.en,small.en-q5_1 (default: all downloaded)  --no-prompt-test
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { questionForSentence } from '../shared/speechCheck';
import { STT_MODELS } from '../shared/sttModels';
import { wordErrorRate } from '../shared/text/wer';
import { SampleStore } from '../server/src/speech/samples';
import { WhisperClient } from '../server/src/speech/sttClient';
import { buildTranscript } from '../server/src/speech/transcript';
import { PiperClient } from '../server/src/speech/ttsClient';
import { parseWav } from '../server/src/speech/wav';
import { audioStats } from './lib/audioStats';

process.loadEnvFile('.env');
const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const whisperUrl = process.env.WHISPER_URL ?? 'http://127.0.0.1:5160';
const whisper = new WhisperClient(whisperUrl, [1000, 2000, 3000, 4000]);
const piper = new PiperClient(process.env.PIPER_URL ?? 'http://127.0.0.1:5150', []);
const modelsDir = join(process.env.MODELS_DIR ?? '', 'whisper');
const defaultModel = process.env.WHISPER_MODEL ?? 'ggml-base.en.bin';

// Answers with the vocabulary interviews use: numbers, tools, acronyms. `q` is the question (the prompt).
const ANSWERS = [
  {
    q: 'Tell me about a time you improved performance.',
    a: 'In my last internship I owned the CSV export. Users reported timeouts, so I profiled it, found an N plus one query, batched it, and the export went from forty seconds to three.',
  },
  {
    q: 'How would you design a URL shortener?',
    a: 'I would generate a short code with a base sixty two counter, store the mapping in PostgreSQL, and put a Redis cache in front, because redirects are read heavy.',
  },
  {
    q: 'Describe a conflict with a teammate.',
    a: 'A senior engineer wanted to refactor the payment module first. I thought we needed tests before that, so I wrote a few tests for the risky parts and showed him a bug they caught. We agreed to add tests first.',
  },
  {
    q: 'What is the difference between a process and a thread?',
    a: 'A process has its own memory space, while threads inside one process share memory. That makes threads cheaper to create, but you need locks or other synchronization to avoid race conditions.',
  },
  {
    q: 'Why do you want this role?',
    a: 'I enjoy backend work, and your team builds data pipelines at a scale I have not worked with yet. I also liked that engineers here own features from design to deployment.',
  },
  {
    q: 'How do you deploy a service?',
    a: 'We build a Docker image in CI, run the unit and integration tests, push it to the registry, and Kubernetes rolls it out gradually while health checks watch the error rate.',
  },
];
const VOICES = ['en_US-ljspeech-medium', 'en_US-joe-medium'];

type Clip = { label: string; wav: Buffer; reference: string; prompt?: string; seconds: number; setup?: string };

/** Joins 16-bit PCM WAVs of the same format, with a short silence between them. */
function concatWavs(wavs: Buffer[], gapSec = 0.6): Buffer {
  const info = parseWav(wavs[0]!);
  const gap = Buffer.alloc(Math.round(gapSec * info.sampleRate) * 2);
  const parts = wavs.flatMap((w, i) => (i ? [gap, w.subarray(44)] : [w.subarray(44)]));
  const data = Buffer.concat(parts);
  const header = Buffer.from(wavs[0]!.subarray(0, 44));
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function loadModel(file: string) {
  const form = new FormData();
  form.set('model', `/models/${file}`);
  const res = await fetch(`${whisperUrl}/load`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`could not load ${file}: HTTP ${res.status} ${await res.text()}`);
}

async function run(clips: Clip[], usePrompt: boolean, minLogprob?: number) {
  let errors = 0;
  let words = 0;
  const bySetup = new Map<string, { errors: number; words: number }>();
  let ms = 0;
  let audio = 0;
  const worst: string[] = [];
  for (const c of clips) {
    const t = performance.now();
    const raw = await whisper.transcribe(c.wav, { prompt: usePrompt ? c.prompt : undefined, timeoutMs: 120_000 });
    ms += performance.now() - t;
    audio += c.seconds;
    const text = buildTranscript(raw.segments, minLogprob).text;
    const r = wordErrorRate(c.reference, text);
    errors += r.errors;
    words += r.referenceWords;
    if (c.setup) {
      const g = bySetup.get(c.setup) ?? { errors: 0, words: 0 };
      bySetup.set(c.setup, { errors: g.errors + r.errors, words: g.words + r.referenceWords });
    }
    if (r.wer > 0.1) worst.push(`    ${(r.wer * 100).toFixed(0)}% ${c.label}: "${text}"`);
  }
  return { wer: words ? errors / words : 0, ms, audio, worst, bySetup };
}

// --- prepare audio
console.log('Synthesizing test answers with Piper…');
const loopback: Clip[] = [];
for (const voice of VOICES) {
  for (const [i, x] of ANSWERS.entries()) {
    const wav = await piper.synthesize(x.a, { voice, lengthScale: 1 });
    loopback.push({
      label: `${voice} #${i + 1}`,
      wav,
      reference: x.a,
      prompt: x.q,
      seconds: parseWav(wav).durationSec,
    });
  }
}
const long = (() => {
  const picked = loopback.filter((c) => c.label.startsWith(VOICES[0]!)).slice(0, 3);
  const wav = concatWavs(picked.map((c) => c.wav));
  return {
    label: '30 s clip',
    wav,
    reference: picked.map((c) => c.reference).join(' '),
    seconds: parseWav(wav).durationSec,
  };
})();
const store = new SampleStore(join(process.env.DATA_DIR ?? '', 'stt-samples'));
const own: Clip[] = store.list().samples.map((s) => {
  const wav = readFileSync(store.wavPath(s.id));
  const setup = `${s.mic ?? 'unknown mic'}, processing ${s.processing === false ? 'off' : 'on'}`;
  const prompt = questionForSentence(s.reference);
  return { label: `own ${s.id}`, wav, reference: s.reference, prompt, seconds: s.durationSec, setup };
});
const totalSec = loopback.reduce((a, c) => a + c.seconds, 0);
console.log(
  `Loopback: ${loopback.length} clips, ${totalSec.toFixed(0)} s. Long clip: ${long.seconds.toFixed(1)} s. ` +
    `Your recordings: ${own.length}${own.length ? '' : ' (record some in Settings → Speech recognition)'}.\n`,
);

// --- models
const only = arg('--models')?.split(',');
const models = STT_MODELS.filter((m) => existsSync(join(modelsDir, m.file)) && (!only || only.includes(m.id)));
const rows: string[] = [];
const setupRows: string[] = [];
const promptRows: string[] = [];
const ownRows: string[] = [];
const notes: string[] = [];
for (const m of models) {
  process.stdout.write(`${m.id}… `);
  await loadModel(m.file);
  await whisper.transcribe(loopback[0]!.wav); // warm-up
  const lb = await run(loopback, false);
  const t = performance.now();
  const longRaw = await whisper.transcribe(long.wav, { timeoutMs: 120_000 });
  const longMs = performance.now() - t;
  const longWer = wordErrorRate(long.reference, buildTranscript(longRaw.segments).text).wer;
  const mine = own.length ? await run(own, false) : undefined;
  rows.push(
    `| ${m.id} | ${Math.round(m.bytes / 1e6)} | ${(lb.wer * 100).toFixed(1)}% | ${(lb.ms / 1000 / lb.audio).toFixed(3)} | ` +
      `${(longMs / 1000).toFixed(1)} s (WER ${(longWer * 100).toFixed(1)}%) | ${mine ? `${(mine.wer * 100).toFixed(1)}% (RTF ${(mine.ms / 1000 / mine.audio).toFixed(3)})` : '–'} |`,
  );
  if (lb.worst.length) notes.push(`  ${m.id}, loopback clips over 10% WER:`, ...lb.worst);
  for (const [setup, g] of mine?.bySetup ?? []) {
    setupRows.push(`| ${m.id} | ${setup} | ${((100 * g.errors) / g.words).toFixed(1)}% |`);
  }
  if (mine?.worst.length) notes.push(`  ${m.id}, your recordings over 10% WER:`, ...mine.worst);
  if (mine) {
    // What would help your voice: the question as a vocabulary hint, keeping low-confidence segments, both.
    const hinted = await run(own, true);
    const keepAll = await run(own, false, -Infinity);
    const both = await run(own, true, -Infinity);
    const pct = (r: { wer: number }) => `${(r.wer * 100).toFixed(1)}%`;
    ownRows.push(`| ${m.id} | ${pct(mine)} | ${pct(hinted)} | ${pct(keepAll)} | ${pct(both)} |`);
    if (hinted.worst.length)
      notes.push(`  ${m.id} with the question as hint, your recordings over 10% WER:`, ...hinted.worst);
  }
  if (!args.includes('--no-prompt-test')) {
    const withPrompt = await run(loopback, true);
    promptRows.push(`| ${m.id} | ${(lb.wer * 100).toFixed(1)}% | ${(withPrompt.wer * 100).toFixed(1)}% |`);
  }
  console.log('done');
}
await loadModel(defaultModel);

console.log(`\nWhisper speed and accuracy (RTF = transcription time / audio length; lower is faster)\n`);
console.log('| Model | MB | Loopback WER | Loopback RTF | 30 s clip | Your recordings WER |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
if (promptRows.length) {
  console.log(`\nEffect of passing the question as Whisper's prompt (loopback WER)\n`);
  console.log('| Model | No prompt | Question as prompt |');
  console.log('|---|---|---|');
  for (const r of promptRows) console.log(r);
}
if (own.length) {
  console.log(
    `\nYour recordings: sound quality (to compare setups; Piper's voice has ~12% below 300 Hz and ~9.5% above 2 kHz)\n`,
  );
  console.log('| Recording | Setup | Level dB | SNR dB | Below 300 Hz | Above 2 kHz |');
  console.log('|---|---|---|---|---|---|');
  for (const c of own) {
    const a = audioStats(c.wav);
    console.log(
      `| ${c.label.replace('own ', '')} | ${c.setup} | ${a.speechDb.toFixed(1)} | ${a.snrDb.toFixed(1)} | ${a.lowPct.toFixed(1)}% | ${a.treblePct.toFixed(1)}% |`,
    );
  }
  console.log(`\nYour recordings: WER per microphone setup\n`);
  console.log('| Model | Setup | WER |');
  console.log('|---|---|---|');
  for (const r of setupRows) console.log(r);
  console.log(`\nYour recordings: what helps (WER; lower is better)\n`);
  console.log('| Model | As in interviews | Question as hint | Keep low-confidence parts | Both |');
  console.log('|---|---|---|---|---|');
  for (const r of ownRows) console.log(r);
}
if (notes.length) console.log(`\nClips with errors:\n${notes.join('\n')}`);
console.log(`\nDefault model ${defaultModel} reloaded.`);
