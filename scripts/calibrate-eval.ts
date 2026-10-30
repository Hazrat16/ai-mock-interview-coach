// Scoring consistency harness (M9, `make calibrate`). Scores the golden answer set with the real evaluator and
// checks the targets in docs/plan/08-testing-quality.md §2: repeatability, ordering, band hits, evidence
// grounding, and that fillers or misheard terms do not change the score.
// Every result is cached (DATA_DIR/calibration), so an interrupted run resumes, and changing the prompt or a
// rubric re-scores only what changed (the cache key is the exact prompt).
// Options: --model <tag>  --reps <1-3> (seeds 42, 7, 1234)  --limit <questions per rubric>  --only <rubric>
//          --no-delivery  --write (save the report to docs/benchmarks/)
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InterviewConfig } from '../shared/schemas/interview';
import {
  EVALUATION_PROMPT_VERSION,
  buildMessages,
  evaluate,
  type EvaluationInput,
} from '../server/src/evaluation/evaluator';
import {
  BANDS,
  type GoldenItem,
  loadGolden,
  type Quality,
  QUALITIES,
  withFillers,
} from '../server/src/evaluation/golden';
import { rubricFor } from '../server/src/evaluation/rubrics';
import { OllamaClient } from '../server/src/llm/ollamaClient';

process.loadEnvFile('.env');
const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const model = arg('--model') ?? process.env.EVALUATOR_MODEL ?? 'qwen3.5:4b';
const SEEDS = [42, 7, 1234].slice(0, Number(arg('--reps') ?? 3));
const limit = Number(arg('--limit') ?? Infinity);
const only = arg('--only');
const delivery = !args.includes('--no-delivery');
const numThread = process.env.LLM_NUM_THREAD ? Number(process.env.LLM_NUM_THREAD) : undefined;
const llm = new OllamaClient(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435');

// --- the cases
type Bank = { text: string; expected: string[] }[];
const banks = new Map<string, Bank>();
const expectedPoints = (item: GoldenItem) => {
  const file = `seed/questions/${item.interviewType}.json`;
  if (!banks.has(file)) banks.set(file, JSON.parse(readFileSync(file, 'utf8')) as Bank);
  const q = banks.get(file)!.find((b) => b.text === item.question);
  if (!q) throw new Error(`${item.id}: question not in ${file}`);
  return q.expected;
};

type Variant = 'clean' | 'fillers' | 'misheard';
type Case = { item: GoldenItem; quality: Quality; variant: Variant; seed: number; text: string };

const perRubric = new Map<string, number>();
const items = loadGolden().filter((i) => {
  if (only && i.rubric !== only) return false;
  const n = perRubric.get(i.rubric) ?? 0;
  perRubric.set(i.rubric, n + 1);
  return n < limit;
});
const cases: Case[] = [];
for (const [s, seed] of SEEDS.entries()) {
  for (const item of items)
    for (const quality of QUALITIES) cases.push({ item, quality, variant: 'clean', seed, text: item[quality] });
  // Right after the first pass, so a short run already answers "does delivery change the score?"
  if (s === 0 && delivery) {
    for (const item of items) {
      cases.push({ item, quality: 'medium', variant: 'fillers', seed, text: withFillers(item.medium) });
      if (item.variants)
        cases.push({ item, quality: 'medium', variant: 'misheard', seed, text: item.variants.misheard });
    }
  }
}

const config = (item: GoldenItem): InterviewConfig => ({
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: item.interviewType,
  difficulty: 'medium',
  questionCount: 5,
  thinkingTimeSec: 10,
  followUpLimit: 1,
});
const inputFor = (c: Case): EvaluationInput => ({
  rubric: rubricFor(c.item.interviewType),
  config: config(c.item),
  exchange: [{ kind: 'main', question: c.item.question, answer: c.text }],
  expectedPoints: expectedPoints(c.item),
});

// --- run, with the cache
type Scored = { overall: number; scores: Record<string, number>; quotes: number; supported: number; ms: number };
const cacheDir = join(process.env.DATA_DIR ?? '.', 'calibration');
const cacheFile = join(cacheDir, 'cache.jsonl');
mkdirSync(cacheDir, { recursive: true });
const cache = new Map<string, Scored>();
if (existsSync(cacheFile)) {
  for (const line of readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) {
    const { key, ...r } = JSON.parse(line) as Scored & { key: string };
    cache.set(key, r);
  }
}
const keyOf = (c: Case) =>
  createHash('sha256')
    .update(JSON.stringify({ model, seed: c.seed, messages: buildMessages(inputFor(c)) }))
    .digest('hex');

const todo = cases.filter((c) => !cache.has(keyOf(c))).length;
console.log(
  `${items.length} questions, ${cases.length} evaluations with ${model} (prompt v${EVALUATION_PROMPT_VERSION}), ` +
    `${cases.length - todo} cached, ${todo} to run (~${Math.round((todo * 170) / 60)} min).\n`,
);

const results: (Case & Scored)[] = [];
let failures = 0;
let ran = 0;
let ranMs = 0;
for (const [i, c] of cases.entries()) {
  const key = keyOf(c);
  let r = cache.get(key);
  if (!r) {
    try {
      const e = await evaluate(llm, inputFor(c), { model, numThread, seed: c.seed });
      const quotes = e.result.criteria.flatMap((x) => x.evidence);
      r = {
        overall: e.overall,
        scores: Object.fromEntries(e.result.criteria.map((x) => [x.key, x.score])),
        quotes: quotes.length,
        supported: quotes.filter((q) => q.supported).length,
        ms: e.ms,
      };
      cache.set(key, r);
      appendFileSync(cacheFile, `${JSON.stringify({ key, ...r })}\n`);
      ran++;
      ranMs += e.ms;
    } catch (err) {
      failures++;
      console.log(
        `[${i + 1}/${cases.length}] ${c.item.id} ${c.quality} ${c.variant} seed ${c.seed}: FAILED ${(err as Error).message}`,
      );
      continue;
    }
    const left = cases.length - i - 1;
    console.log(
      `[${i + 1}/${cases.length}] ${c.item.id} ${c.quality}${c.variant === 'clean' ? '' : ` (${c.variant})`} seed ${c.seed}: ` +
        `${r.overall} (${Math.round(r.ms / 1000)} s; ~${Math.round((left * ranMs) / ran / 60_000)} min left at most)`,
    );
  }
  results.push({ ...c, ...r });
}

// --- metrics
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const clean = results.filter((r) => r.variant === 'clean');
const runs = (id: string, q: Quality) => clean.filter((r) => r.item.id === id && r.quality === q);
const meanScore = (id: string, q: Quality) => mean(runs(id, q).map((r) => r.overall));
const lines: string[] = [];
const out = (s = '') => lines.push(s);
const mark = (ok: boolean) => (ok ? '✅' : '❌');

out(`# Scoring calibration: ${model}, prompt v${EVALUATION_PROMPT_VERSION} (${new Date().toISOString().slice(0, 10)})`);
out();
out(
  `${items.length} questions × strong/medium/weak, ${SEEDS.length} seed(s) (${SEEDS.join(', ')}), junior Backend Engineer.`,
);
out(
  `Golden set: \`server/test/fixtures/golden-answers/\`. Run: \`make calibrate\`.${failures ? ` **${failures} evaluation(s) failed.**` : ''}`,
);
out();

const targets: string[] = [];
if (SEEDS.length > 1) {
  const groups = items.flatMap((it) => QUALITIES.map((q) => runs(it.id, q))).filter((g) => g.length > 1);
  const sds = groups.map((g) => sd(g.map((r) => r.overall)));
  let close = 0;
  let pairs = 0;
  for (const g of groups) {
    for (const k of Object.keys(g[0]!.scores)) {
      const v = g.map((r) => r.scores[k]!);
      pairs++;
      if (Math.max(...v) - Math.min(...v) <= 1) close++;
    }
  }
  const sdOk = sds.filter((x) => x <= 7).length;
  targets.push(
    `| Repeatability: overall SD ≤ 7 | ${pct(sdOk, sds.length)} of answers (mean SD ${mean(sds).toFixed(1)}, max ${Math.max(...sds).toFixed(1)}) | all | ${mark(sdOk === sds.length)} |`,
    `| Repeatability: criterion spread ≤ 1 | ${pct(close, pairs)} | ≥ 90% | ${mark(close / pairs >= 0.9)} |`,
  );
}
const ordered = items.filter(
  (it) =>
    meanScore(it.id, 'strong') > meanScore(it.id, 'medium') && meanScore(it.id, 'medium') > meanScore(it.id, 'weak'),
);
targets.push(
  `| Ordering strong > medium > weak | ${ordered.length}/${items.length} (${pct(ordered.length, items.length)}) | ≥ 90% | ${mark(ordered.length / items.length >= 0.9)} |`,
);
const inBand = clean.filter((r) => r.overall >= BANDS[r.quality][0] && r.overall <= BANDS[r.quality][1]);
targets.push(
  `| Inside expected band | ${inBand.length}/${clean.length} (${pct(inBand.length, clean.length)}) | ≥ 75% | ${mark(inBand.length / clean.length >= 0.75)} |`,
);
const quotes = results.reduce((n, r) => n + r.quotes, 0);
const supported = results.reduce((n, r) => n + r.supported, 0);
targets.push(
  `| Evidence quotes found in the answer | ${supported}/${quotes} (${pct(supported, quotes)}) | ≥ 95% | ${mark(supported / quotes >= 0.95)} |`,
);
const deliveryRows: string[] = [];
let deliveryOk = 0;
let deliveryN = 0;
for (const r of results.filter((x) => x.variant !== 'clean')) {
  const base = clean.find((c) => c.item.id === r.item.id && c.quality === 'medium' && c.seed === r.seed);
  if (!base) continue;
  const diff = r.overall - base.overall;
  deliveryN++;
  if (Math.abs(diff) <= 5) deliveryOk++;
  deliveryRows.push(`| ${r.item.id} | ${r.variant} | ${base.overall} | ${r.overall} | ${diff > 0 ? '+' : ''}${diff} |`);
}
if (deliveryN)
  targets.push(
    `| Fillers / misheard terms within 5 points | ${deliveryOk}/${deliveryN} | all | ${mark(deliveryOk === deliveryN)} |`,
  );

out('## Targets');
out();
out('| Check | Result | Target | |');
out('|---|---|---|---|');
for (const t of targets) out(t);
out();

out('## Scores per question (mean over seeds; expected: strong 75–95, medium 45–70, weak 10–40)');
out();
out('| Rubric | Question | Strong | Medium | Weak |');
out('|---|---|---|---|---|');
const cell = (id: string, q: Quality) => {
  const v = runs(id, q).map((r) => r.overall);
  if (!v.length) return '–';
  const m = Math.round(mean(v));
  const ok = m >= BANDS[q][0] && m <= BANDS[q][1];
  return `${ok ? '' : '**'}${m}${ok ? '' : '**'}${v.length > 1 ? ` (${v.join(', ')})` : ''}`;
};
for (const it of items)
  out(`| ${it.rubric} | ${it.id} | ${cell(it.id, 'strong')} | ${cell(it.id, 'medium')} | ${cell(it.id, 'weak')} |`);
out();
out('Bold: mean outside the expected band.');
out();

out('## Criterion scores (0–4, mean) per answer quality');
out();
for (const rubric of [...new Set(items.map((i) => i.rubric))]) {
  const rs = clean.filter((r) => r.item.rubric === rubric);
  const keys = Object.keys(rs[0]?.scores ?? {});
  out(`| ${rubric} | ${keys.join(' | ')} |`);
  out(`|---|${keys.map(() => '---').join('|')}|`);
  for (const q of QUALITIES) {
    const qr = rs.filter((r) => r.quality === q);
    out(`| ${q} | ${keys.map((k) => mean(qr.map((r) => r.scores[k]!)).toFixed(1)).join(' | ')} |`);
  }
  out();
}

if (deliveryRows.length) {
  out('## Delivery independence (medium answer; same seed)');
  out();
  out('| Question | Variant | Clean | Variant | Difference |');
  out('|---|---|---|---|---|');
  for (const r of deliveryRows) out(r);
  out();
}
const times = results.map((r) => r.ms / 1000);
out(
  `Time per evaluation: mean ${mean(times).toFixed(0)} s, max ${Math.max(...times).toFixed(0)} s (${results.length} results).`,
);

const report = lines.join('\n');
console.log(`\n${report}`);
if (args.includes('--write')) {
  const file = `docs/benchmarks/calibration-${new Date().toISOString().slice(0, 10)}-${model.replace(/[^a-z0-9.]+/gi, '-')}.md`;
  writeFileSync(file, `${report}\n`);
  console.log(`\nSaved to ${file}`);
}
