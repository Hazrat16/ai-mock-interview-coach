import { afterEach, describe, expect, it } from 'vitest';
import { sessionReportSchema } from '@shared/schemas/evaluation';
import { createSessionResponseSchema, sessionDetailSchema } from '@shared/schemas/interview';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { claimNextJob } from '../../src/db/repos/evaluations';
import { migrate } from '../../src/db/migrate';
import { seedQuestions } from '../../src/db/repos/questions';
import { parseEnv } from '../../src/env';
import { JobRunner } from '../../src/evaluation/jobRunner';
import { OllamaClient } from '../../src/llm/ollamaClient';
import { chatReply, type FakeOllama, type FakeReply, startFakeOllama } from '../helpers/fakeOllama';

let fake: FakeOllama | undefined;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
afterEach(async () => {
  await app?.close();
  db?.close();
  await fake?.close();
  fake = undefined;
});

const ANSWER = 'I disagreed about caching. I ran a benchmark and showed the numbers, so we kept one database.';
const KEYS = ['relevance', 'star_structure', 'personal_contribution', 'results_impact', 'reflection'];

/** A behavioral evaluation as qwen would write it; one quote is invented. */
const evaluationJson = (score = 3) =>
  JSON.stringify({
    criteria: KEYS.map((key, i) => ({
      key,
      evidence: i === 0 ? ['I ran a benchmark and showed the numbers', 'I led a team of five'] : ['kept one database'],
      rationale: `Rationale for ${key}.`,
      score,
    })),
    strengths: ['Used data to settle the disagreement.'],
    mistakes: ['No reflection.'],
    missing_concepts: ['What was learned.'],
    suggestions: ['Say what you would do differently.'],
    example_answer: 'In my internship I disagreed with a teammate about caching...',
    follow_up_exercise: 'Retell the story ending with one lesson.',
  });

const isEvaluation = (body: Record<string, unknown>) =>
  String((body.messages as { content: string }[])[0]!.content).includes('You evaluate mock interview answers');
const decisionNext = chatReply(
  JSON.stringify({ summary: 'Covered it.', quality_signal: 'ok', action: 'next', follow_up: null }),
);

async function setup(evaluator: (body: Record<string, unknown>) => FakeReply) {
  fake = await startFakeOllama({
    models: ['granite4:3b', 'qwen3.5:4b'],
    chat: (body) => (isEvaluation(body) ? evaluator(body) : decisionNext),
  });
  db = openMemoryDb();
  await migrate(db);
  seedQuestions(db);
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: '/tmp/coach', OLLAMA_URL: fake.url });
  app = await buildApp(env, db, '0.0.0-test', { engine: { decisionTimeoutMs: 2000 } });
}

const CONFIG = {
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: 'behavioral',
  difficulty: 'medium',
  questionCount: 2,
  thinkingTimeSec: 10,
  followUpLimit: 0,
};

const runner = (over: Partial<ConstructorParameters<typeof JobRunner>[0]> = {}) =>
  new JobRunner({
    db,
    llm: new OllamaClient(fake!.url),
    fallbackModel: 'granite4:3b',
    log: () => undefined,
    isPaused: () => false,
    ...over,
  });

/** A finished 2-question behavioral interview with typed answers; returns the session id. */
async function finishedInterview(): Promise<string> {
  const created = createSessionResponseSchema.parse(
    (await app.inject({ method: 'POST', url: '/api/sessions', payload: { config: CONFIG, seed: 3 } })).json(),
  );
  if (created.status !== 'created') throw new Error('not created');
  const id = created.sessionId;
  let s = sessionDetailSchema.parse((await app.inject({ method: 'POST', url: `/api/sessions/${id}/start` })).json());
  while (s.current) {
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/turns/${s.current.id}/answer`,
      payload: {
        transcript: ANSWER,
        inputMethod: 'voice',
        voice: {
          sttModel: 'ggml-base.en.bin',
          delivery: {
            answerMs: 9000,
            speakingMs: 8000,
            wordsPerMinute: 130,
            longPauses: 1,
            fillerWords: 2,
            responseLatencyMs: 3000,
            segments: 2,
          },
        },
      },
    });
    s = sessionDetailSchema.parse((await app.inject({ url: `/api/sessions/${id}` })).json());
  }
  await new Promise((r) => setImmediate(r)); // evaluations are queued right after completion
  return id;
}

const report = async (id: string) =>
  sessionReportSchema.parse((await app.inject({ url: `/api/sessions/${id}/report` })).json());

describe('evaluation pipeline', () => {
  it('queues one evaluation per question when the interview ends, then scores it in code', async () => {
    await setup(() => chatReply(evaluationJson(3)));
    const id = await finishedInterview();
    let r = await report(id);
    expect(r.progress).toEqual({ done: 0, pending: 2, failed: 0, total: 2 });
    expect(r.items[0]!.evaluation).toMatchObject({
      status: 'pending',
      rubricKey: 'behavioral',
      rubricVersion: 1,
      model: 'qwen3.5:4b',
    });

    const run = runner();
    expect(await run.runOnce()).toBe('done');
    expect(await run.runOnce()).toBe('done');
    expect(await run.runOnce()).toBe('idle');

    r = await report(id);
    expect(r.progress).toMatchObject({ done: 2, pending: 0 });
    const ev = r.items[0]!.evaluation!;
    expect(ev).toMatchObject({ status: 'done', overallScore: 75, model: 'qwen3.5:4b', unsupportedEvidence: 1 });
    expect(ev.result!.criteria[0]!.evidence).toEqual([
      { quote: 'I ran a benchmark and showed the numbers', supported: true },
      { quote: 'I led a team of five', supported: false },
    ]);
    expect(ev.result!.criteria[0]).toMatchObject({
      name: 'Relevance',
      anchor: 'Clearly answers the question, with minor detours.',
    });
    expect(r.average).toBe(75);
    expect(r.delivery).toEqual({
      answers: 2,
      wordsPerMinute: 130,
      longPauses: 2,
      fillerWords: 4,
      responseLatencyMs: 3000,
    });
    expect(r.items[0]!.thread[0]!.answer).toMatchObject({ transcript: ANSWER, inputMethod: 'voice' });

    // Evaluator settings: low temperature, fixed seed, the configured model.
    const evalRequests = fake!.requests.filter(isEvaluation);
    expect(evalRequests[0]).toMatchObject({ model: 'qwen3.5:4b', options: { temperature: 0.1, seed: 42 } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM evaluation_scores').get()).toEqual({ n: 10 });
  });

  it('uses the fallback model when the evaluator gives invalid output twice', async () => {
    // Score 5 is out of range: rejected by the schema, repair retried, rejected again.
    await setup((body) => chatReply(body.model === 'qwen3.5:4b' ? evaluationJson(5) : evaluationJson(2)));
    const id = await finishedInterview();
    await runner().runOnce();
    const ev = (await report(id)).items[0]!.evaluation!;
    expect(ev).toMatchObject({ status: 'done', model: 'granite4:3b', overallScore: 50 });
  });

  it('marks a failed evaluation, and Retry queues it again', async () => {
    let broken = true;
    await setup(() => (broken ? chatReply('not json') : chatReply(evaluationJson(4))));
    const id = await finishedInterview();
    await runner().runOnce();
    const failed = (await report(id)).items[0]!.evaluation!;
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('granite4:3b') });

    broken = false;
    const res = await app.inject({ method: 'POST', url: `/api/evaluations/${failed.id}/retry` });
    expect(res.statusCode).toBe(202);
    expect((await report(id)).items[0]!.evaluation!.status).toBe('pending');
    // The second question's job comes first (older); run both.
    await runner().runOnce();
    await runner().runOnce();
    expect((await report(id)).items[0]!.evaluation).toMatchObject({ status: 'done', overallScore: 100 });
  });

  it('re-queues work that was running when the app stopped (crash)', async () => {
    await setup(() => chatReply(evaluationJson(3)));
    const id = await finishedInterview();
    claimNextJob(db); // simulates a crash in the middle of an evaluation
    expect((await report(id)).items[0]!.evaluation!.status).toBe('running');

    const run = runner({ idleMs: 60_000 });
    run.start(); // resets running → pending, then works in the background
    run.stop();
    expect((await report(id)).items[0]!.evaluation!.status).toBe('pending');
    expect(await runner().runOnce()).toBe('done');
  });

  it('waits instead of failing when Ollama is not running', async () => {
    await setup(() => chatReply(evaluationJson(3)));
    const id = await finishedInterview();
    const down = runner({ llm: new OllamaClient('http://127.0.0.1:9') });
    expect(await down.runOnce()).toBe('unavailable');
    const ev = (await report(id)).items[0]!.evaluation!;
    expect(ev.status).toBe('pending');
    expect(await runner().runOnce()).toBe('done');
  });

  it('pauses while an interview is going on', async () => {
    await setup(() => chatReply(evaluationJson(3)));
    await finishedInterview();
    // A second interview in progress, just started: the runner must not take the LLM away from it.
    const created = createSessionResponseSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/sessions', payload: { config: CONFIG, seed: 9 } })).json(),
    );
    if (created.status !== 'created') throw new Error('not created');
    await app.inject({ method: 'POST', url: `/api/sessions/${created.sessionId}/start` });
    expect(await runner({ isPaused: undefined }).runOnce()).toBe('idle');
  });

  it('evaluates an older finished interview on request, once', async () => {
    await setup(() => chatReply(evaluationJson(3)));
    const id = await finishedInterview();
    db.exec('DELETE FROM jobs; DELETE FROM evaluations;'); // as if it finished before M8
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${id}/evaluate` });
    expect(sessionReportSchema.parse(res.json()).progress.pending).toBe(2);
    await app.inject({ method: 'POST', url: `/api/sessions/${id}/evaluate` });
    expect(db.prepare('SELECT COUNT(*) AS n FROM evaluations').get()).toEqual({ n: 2 });
  });
});
