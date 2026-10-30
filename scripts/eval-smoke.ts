// One real evaluation per interview type with the configured evaluator model (make eval-smoke, ~10 min).
// Checks that the output validates, the score is computed, and quotes are found in the answer; records timing.
import { readFileSync } from 'node:fs';
import type { InterviewConfig } from '../shared/schemas/interview';
import { evaluate, type Exchange } from '../server/src/evaluation/evaluator';
import { rubricFor } from '../server/src/evaluation/rubrics';
import { OllamaClient } from '../server/src/llm/ollamaClient';

process.loadEnvFile('.env');
// Options: [model] [--only <type>]
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const model =
  (process.argv[2]?.startsWith('--') ? undefined : process.argv[2]) ?? process.env.EVALUATOR_MODEL ?? 'qwen3.5:4b';
const llm = new OllamaClient(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435');

type Seed = { text: string; expected: string[] };
const bank = (file: string) => JSON.parse(readFileSync(`seed/questions/${file}.json`, 'utf8')) as Seed[];

// Middling spoken answers (some substance, clear gaps), as Whisper would transcribe them.
const CASES: { type: InterviewConfig['interviewType']; question: Seed; exchange: (q: string) => Exchange[] }[] = [
  {
    type: 'behavioral',
    question: bank('behavioral')[0]!,
    exchange: (q) => [
      {
        kind: 'main',
        question: q,
        answer:
          'So, um, in my internship a teammate wanted to put sessions in Postgres and I thought Redis was better. We talked about it in standup and I made a small benchmark. It turned out Postgres was fast enough so we just kept it.',
      },
      {
        kind: 'follow_up',
        question: 'What did you personally learn from that?',
        answer: 'I guess that I should measure first before I argue about it.',
      },
    ],
  },
  {
    type: 'technical',
    question: bank('technical').find((q) => /index/i.test(q.text))!,
    exchange: (q) => [
      {
        kind: 'main',
        question: q,
        answer:
          'An index is like a lookup structure, usually a B-tree, so the database does not scan every row. It makes reads faster, but writes get slower because the index has to be updated too. You should index columns you filter on a lot.',
      },
    ],
  },
  {
    type: 'coding',
    question: bank('coding')[0]!,
    exchange: (q) => [
      {
        kind: 'main',
        question: q,
        answer:
          'I would go through the array and keep a hash map from value to index. For each number I check if the target minus the number is already in the map, and if yes I return both indexes. That is O of n time and O of n space.',
      },
    ],
  },
  {
    type: 'system_design',
    question: bank('system_design')[0]!,
    exchange: (q) => [
      {
        kind: 'main',
        question: q,
        answer:
          'I would have an API service behind a load balancer and store the data in a SQL database. For scale I would add a cache like Redis in front of the database and maybe read replicas. We could also use a queue for slow work.',
      },
    ],
  },
];

const config = (type: InterviewConfig['interviewType']): InterviewConfig => ({
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: type,
  difficulty: 'medium',
  questionCount: 3,
  thinkingTimeSec: 10,
  followUpLimit: 1,
});

console.log(`Evaluator: ${model}\n`);
for (const c of CASES.filter((x) => !only || x.type === only)) {
  const rubric = rubricFor(c.type);
  try {
    const r = await evaluate(
      llm,
      { rubric, config: config(c.type), exchange: c.exchange(c.question.text), expectedPoints: c.question.expected },
      {
        model,
        numThread: Number(process.env.LLM_NUM_THREAD) || undefined,
      },
    );
    const quotes = r.result.criteria.flatMap((x) => x.evidence);
    console.log(`## ${c.type}: ${c.question.text}`);
    console.log(
      `score ${r.overall}/100 · ${Math.round(r.ms / 1000)} s · attempts ${r.attempts} · quotes ${quotes.length - r.unsupported}/${quotes.length} found`,
    );
    console.log(r.result.criteria.map((x) => `  ${x.key} ${x.score}: ${x.rationale}`).join('\n'));
    for (const q of quotes.filter((x) => !x.supported)) console.log(`  NOT FOUND: "${q.quote}"`);
    console.log(`  mistakes: ${r.result.mistakes.join(' | ')}`);
    console.log(`  exercise: ${r.result.followUpExercise}\n`);
  } catch (err) {
    console.log(`## ${c.type}: FAILED ${(err as Error).message}\n`);
  }
}
