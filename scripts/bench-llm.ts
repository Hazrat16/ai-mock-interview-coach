// LLM benchmark on realistic interview workloads. Usage:
//   make bench                         # defaults below (~20-30 min)
//   make bench ARGS="--quick"          # one eval run, no thread sweep (~8 min)
//   make bench ARGS="--models qwen3.5:4b --threads auto,4,6 --eval-runs 1"
// Appends a report to docs/benchmarks/<date>-llm-bench.md
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';
import type { z } from 'zod';
import { OllamaClient, type ChatMessage, type ChatMetrics } from '../server/src/llm/ollamaClient';
import { structuredChat } from '../server/src/llm/structured';
import { ANSWERS, evaluationMessages, evaluationSchema, followUpMessages, followUpSchema } from './bench/prompts';

if (existsSync('.env')) process.loadEnvFile('.env');
const { values: args } = parseArgs({
  options: {
    models: {
      type: 'string',
      default: [...new Set([process.env.EVALUATOR_MODEL, process.env.INTERVIEWER_MODEL])].join(','),
    },
    threads: { type: 'string', default: 'auto,4,6,8' },
    'eval-runs': { type: 'string', default: '2' },
    quick: { type: 'boolean', default: false },
  },
});
const models = args.models.split(',').filter(Boolean);
const threadSweep = args.quick ? ['auto'] : args.threads.split(',');
const evalRuns = args.quick ? 1 : Number(args['eval-runs']);
const url = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435';
const client = new OllamaClient(url);

type Row = {
  model: string;
  test: string;
  threads: string;
  wallS: number;
  metrics: ChatMetrics;
  attempts: number | 'failed';
  minAvailGb: number;
};
const rows: Row[] = [];

const gb = (b: number) => Math.round((b / 1024 ** 3) * 10) / 10;
const s1 = (ms: number) => Math.round(ms / 100) / 10;
const rate = (tokens: number, ms: number) => (ms ? Math.round((tokens / ms) * 10_000) / 10 : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN;
};

async function unload(model: string) {
  await fetch(`${url}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) });
}

async function measure<T>(
  model: string,
  test: string,
  threads: string,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  numPredict: number,
) {
  let minAvail = os.freemem();
  const sampler = setInterval(() => (minAvail = Math.min(minAvail, os.freemem())), 500);
  const started = performance.now();
  let row: Row;
  try {
    const r = await structuredChat(client, {
      model,
      schema,
      messages,
      options: {
        temperature: test === 'evaluation' ? 0.1 : 0.7,
        num_ctx: 8192,
        num_predict: numPredict,
        ...(threads === 'auto' ? {} : { num_thread: Number(threads) }),
      },
      keepAlive: '10m',
      timeoutMs: 600_000,
    });
    const m = r.metrics.reduce((a, b) => ({
      totalMs: a.totalMs + b.totalMs,
      loadMs: a.loadMs + b.loadMs,
      promptTokens: a.promptTokens + b.promptTokens,
      promptMs: a.promptMs + b.promptMs,
      outputTokens: a.outputTokens + b.outputTokens,
      outputMs: a.outputMs + b.outputMs,
    }));
    row = {
      model,
      test,
      threads,
      wallS: s1(performance.now() - started),
      metrics: m,
      attempts: r.attempts,
      minAvailGb: 0,
    };
  } catch (err) {
    console.log(`    ! ${(err as Error).message}`);
    const zero = { totalMs: 0, loadMs: 0, promptTokens: 0, promptMs: 0, outputTokens: 0, outputMs: 0 };
    row = {
      model,
      test,
      threads,
      wallS: s1(performance.now() - started),
      metrics: zero,
      attempts: 'failed',
      minAvailGb: 0,
    };
  } finally {
    clearInterval(sampler);
  }
  row.minAvailGb = gb(minAvail);
  rows.push(row);
  const m = row.metrics;
  console.log(
    `  ${test.padEnd(13)} threads=${threads.padEnd(4)} ${String(row.wallS).padStart(6)} s  ` +
      `load ${s1(m.loadMs)} s, prompt ${m.promptTokens} tok @ ${rate(m.promptTokens, m.promptMs)}/s, ` +
      `output ${m.outputTokens} tok @ ${rate(m.outputTokens, m.outputMs)}/s, attempts ${row.attempts}, ` +
      `min free RAM ${row.minAvailGb} GB`,
  );
}

const startedAt = new Date();
console.log(`LLM benchmark: models ${models.join(', ')}; threads ${threadSweep.join(', ')}; eval runs ${evalRuns}`);
console.log(`CPU ${os.cpus()[0]?.model}, ${os.cpus().length} threads; RAM available ${gb(os.freemem())} GB\n`);

for (const [i, model] of models.entries()) {
  console.log(`== ${model}`);
  // Thread sweep only for the first model; the others use Ollama's default.
  for (const threads of i === 0 ? threadSweep : ['auto']) {
    await unload(model);
    // Three turns in a row: the first includes loading; later ones reuse the cached system prompt.
    for (const [n, answer] of ANSWERS.entries()) {
      await measure(
        model,
        n === 0 ? 'follow-up 1st' : `follow-up ${n + 1}`,
        threads,
        followUpMessages(answer),
        followUpSchema,
        200,
      );
    }
  }
  for (let n = 0; n < evalRuns; n++) {
    await measure(
      model,
      'evaluation',
      'auto',
      evaluationMessages(ANSWERS[n % 2 === 0 ? 0 : 2]!),
      evaluationSchema,
      1200,
    );
  }
  await unload(model);
}

// ---- report ----
const power = (() => {
  // The adapter's name varies (AC, ADP1, ACAD...); find the one of type "Mains".
  for (const dev of readdirSync('/sys/class/power_supply')) {
    const read = (f: string) => readFileSync(`/sys/class/power_supply/${dev}/${f}`, 'utf8').trim();
    if (read('type') === 'Mains') return read('online') === '1' ? 'on AC' : 'on battery';
  }
  return 'unknown';
})();
const lines = [
  `# LLM benchmark, ${startedAt.toLocaleString('sv-SE')}`,
  '',
  `- Ollama image ${process.env.OLLAMA_IMAGE_TAG}, CPU ${os.cpus()[0]?.model}, power ${power}`,
  `- Follow-up: ~600-token prompt, up to 200 output tokens, JSON schema. Evaluation: ~1,800-token rubric prompt, up to 1,200 output tokens.`,
  `- "follow-up 2nd/3rd" reuse the cached system prompt, like consecutive interview turns.`,
  '',
  '| model | test | threads | wall s | load s | prompt tok @ tok/s | output tok @ tok/s | JSON attempts | min free RAM GB |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.model} | ${r.test} | ${r.threads} | ${r.wallS} | ${s1(r.metrics.loadMs)} | ` +
      `${r.metrics.promptTokens} @ ${rate(r.metrics.promptTokens, r.metrics.promptMs)} | ` +
      `${r.metrics.outputTokens} @ ${rate(r.metrics.outputTokens, r.metrics.outputMs)} | ${r.attempts} | ${r.minAvailGb} |`,
  ),
  '',
  '## Summary',
  '',
  '| model | threads | follow-up, warm turns (median s) | evaluation (median s) | JSON valid first try |',
  '|---|---|---|---|---|',
];
for (const model of models) {
  const mine = rows.filter((r) => r.model === model);
  const evalMedian = median(mine.filter((r) => r.test === 'evaluation' && r.attempts !== 'failed').map((r) => r.wallS));
  const firstTry = `${mine.filter((r) => r.attempts === 1).length}/${mine.length}`;
  for (const threads of [...new Set(mine.filter((r) => r.test.startsWith('follow-up')).map((r) => r.threads))]) {
    const warm = mine.filter((r) => r.threads === threads && /follow-up [23]/.test(r.test) && r.attempts !== 'failed');
    lines.push(`| ${model} | ${threads} | ${median(warm.map((r) => r.wallS))} | ${evalMedian} | ${firstTry} |`);
  }
}
lines.push('', '');
mkdirSync('docs/benchmarks', { recursive: true });
const report = `docs/benchmarks/${startedAt.toISOString().slice(0, 10)}-llm-bench.md`;
appendFileSync(report, lines.join('\n'));
console.log(`\n${lines.slice(lines.indexOf('## Summary')).join('\n')}\nReport appended to ${report}`);
