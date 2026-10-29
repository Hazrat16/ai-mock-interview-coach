import { afterEach, describe, expect, it } from 'vitest';
import {
  type CreateSessionRequest,
  createSessionResponseSchema,
  sessionDetailSchema,
  turnResultSchema,
} from '@shared/schemas/interview';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { seedQuestions } from '../../src/db/repos/questions';
import { parseEnv } from '../../src/env';
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

async function setup(chat: FakeReply[] | ((body: Record<string, unknown>) => FakeReply) = [], ollamaUrl?: string) {
  fake = await startFakeOllama({ chat, models: ['granite4:3b', 'qwen3.5:4b'] });
  db = openMemoryDb();
  await migrate(db);
  seedQuestions(db);
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: '/tmp/coach', OLLAMA_URL: ollamaUrl ?? fake.url });
  app = await buildApp(env, db, '0.0.0-test', { decisionTimeoutMs: 2000 });
}

const decision = (d: { action: 'follow_up' | 'next'; follow_up?: string | null }) =>
  chatReply(JSON.stringify({ follow_up: null, summary: 'Covered a disagreement.', quality_signal: 'ok', ...d }));

const config = {
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: 'behavioral',
  difficulty: 'medium',
  questionCount: 2,
  thinkingTimeSec: 10,
  followUpLimit: 1,
} as const;

async function create(body: Partial<CreateSessionRequest> = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/sessions', payload: { config, seed: 7, ...body } });
  return { status: res.statusCode, body: createSessionResponseSchema.parse(res.json()) };
}

async function startNew(body: Partial<CreateSessionRequest> = {}) {
  const created = (await create(body)).body;
  if (created.status !== 'created') throw new Error('not created');
  const res = await app.inject({ method: 'POST', url: `/api/sessions/${created.sessionId}/start` });
  return sessionDetailSchema.parse(res.json());
}

const answer = (sessionId: string, turnId: string, transcript = 'I explained my view and we prototyped both.') =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/turns/${turnId}/answer`, payload: { transcript } });

const result = async (res: Awaited<ReturnType<typeof answer>>) => {
  expect(res.statusCode).toBe(200);
  return turnResultSchema.parse(res.json());
};

describe('interview session', () => {
  it('runs a full interview: question, follow-up, next question, closing', async () => {
    const followUp = 'How did you make sure your teammate felt heard while you compared prototypes?';
    await setup([decision({ action: 'follow_up', follow_up: followUp }), decision({ action: 'next' })]);
    const s = await startNew();
    expect(s.status).toBe('in_progress');
    expect(s.intro).toContain('behavioral interview for a junior Backend Engineer role');
    expect(s.current).toMatchObject({ kind: 'main', questionNumber: 1, totalQuestions: 2 });

    const r1 = await result(await answer(s.id, s.current!.id));
    expect(r1.next).toMatchObject({ kind: 'follow_up', text: followUp, questionNumber: 1 });
    expect(r1.ack).not.toMatch(/great|excellent|good answer/i);

    // Follow-up limit (1) reached: moves on without asking the model.
    const r2 = await result(await answer(s.id, r1.next!.id));
    expect(r2.next).toMatchObject({ kind: 'main', questionNumber: 2 });
    expect(r2.lead).toBe('And the last question.');
    expect(fake!.requests).toHaveLength(1);

    const r3 = await result(await answer(s.id, r2.next!.id));
    expect(r3).toMatchObject({ next: null, closing: expect.stringContaining('end of the interview') });

    const done = sessionDetailSchema.parse((await app.inject({ url: `/api/sessions/${s.id}` })).json());
    expect(done.status).toBe('completed');
    expect(done.turns.map((t) => [t.kind, t.answer !== null])).toEqual([
      ['main', true],
      ['follow_up', true],
      ['main', true],
    ]);
    // The model's summary is kept for context on later questions.
    expect(db.prepare("SELECT summary FROM turns WHERE kind = 'main' ORDER BY seq").get()).toEqual({
      summary: 'Covered a disagreement.',
    });
  });

  it('moves on when the model repeats the main question as a "follow-up"', async () => {
    // The fake model "follows up" with the main question itself, wrapped in other words.
    await setup((body) => {
      const prompt = (body.messages as { content: string }[]).at(-1)!.content;
      const main = /Main question: (.*)/.exec(prompt)![1]!;
      return decision({ action: 'follow_up', follow_up: `Can you give a specific example: ${main}` });
    });
    const s = await startNew();
    const r = await result(await answer(s.id, s.current!.id));
    expect(fake!.requests).toHaveLength(1);
    expect(r.next).toMatchObject({ kind: 'main', questionNumber: 2 });
  });

  it('keeps going when the model is down: the interview never stalls', async () => {
    await setup([], 'http://127.0.0.1:9');
    const s = await startNew();
    const r = await result(await answer(s.id, s.current!.id));
    expect(r.next).toMatchObject({ kind: 'main', questionNumber: 2 });
  });

  it('rejects a second answer to the same question', async () => {
    await setup([decision({ action: 'next' })]);
    const s = await startNew();
    await result(await answer(s.id, s.current!.id));
    expect((await answer(s.id, s.current!.id)).statusCode).toBe(409);
  });

  it('resumes after a reload at the open question', async () => {
    await setup([decision({ action: 'next' })]);
    const s = await startNew();
    const r = await result(await answer(s.id, s.current!.id));
    const again = sessionDetailSchema.parse(
      (await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/start` })).json(),
    );
    expect(again.current?.id).toBe(r.next!.id);
    expect(again.turns).toHaveLength(2);
  });

  it('skips a question, and completes when the last one is skipped', async () => {
    await setup();
    const s = await startNew();
    const skip = (turnId: string) =>
      app
        .inject({ method: 'POST', url: `/api/sessions/${s.id}/turns/${turnId}/skip` })
        .then((r) => turnResultSchema.parse(r.json()));
    const r1 = await skip(s.current!.id);
    expect(r1.next).toMatchObject({ questionNumber: 2 });
    const r2 = await skip(r1.next!.id);
    expect(r2.next).toBeNull();
    expect(fake!.requests).toHaveLength(0);
  });

  it('ending early: abandoned without answers, completed with some', async () => {
    await setup([decision({ action: 'next' })]);
    const a = await startNew();
    const endA = sessionDetailSchema.parse(
      (await app.inject({ method: 'POST', url: `/api/sessions/${a.id}/end` })).json(),
    );
    expect(endA.status).toBe('abandoned');

    const b = await startNew({ seed: 8 });
    await answer(b.id, b.current!.id);
    const endB = sessionDetailSchema.parse(
      (await app.inject({ method: 'POST', url: `/api/sessions/${b.id}/end` })).json(),
    );
    expect(endB.status).toBe('completed');
  });

  it('deletes a session with all its questions and answers', async () => {
    await setup([decision({ action: 'next' })]);
    const s = await startNew();
    await answer(s.id, s.current!.id);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${s.id}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/sessions/${s.id}` })).statusCode).toBe(404);
    expect(db.prepare('SELECT (SELECT COUNT(*) FROM turns) AS t, (SELECT COUNT(*) FROM answers) AS a').get()).toEqual({
      t: 0,
      a: 0,
    });
  });

  it('plans the same questions for the same seed, in a fresh database too', async () => {
    const planFor = async (seed: number) => {
      const r = await create({ seed }); // created but not started, so it does not count as "recent"
      const id = r.body.status === 'created' ? r.body.sessionId : '';
      return JSON.parse(
        (db.prepare('SELECT plan_json FROM sessions WHERE id = ?').get(id) as { plan_json: string }).plan_json,
      );
    };
    await setup();
    const a = await planFor(123);
    expect(await planFor(123)).toEqual(a);
    const textsA = a.questionIds.map(
      (id: string) => (db.prepare('SELECT text FROM questions WHERE id = ?').get(id) as { text: string }).text,
    );

    await app.close();
    db.close();
    await fake!.close();
    await setup(); // new database: new random ids
    const b = await planFor(123);
    const textsB = b.questionIds.map(
      (id: string) => (db.prepare('SELECT text FROM questions WHERE id = ?').get(id) as { text: string }).text,
    );
    expect(textsB).toEqual(textsA);
  });

  it('does not reuse questions from recent interviews while fresh ones exist', async () => {
    await setup();
    const first = await startNew({ seed: 1 });
    const second = await startNew({ seed: 1 }); // same seed, but the first question is now "recent"
    expect(second.current!.text).not.toBe(first.current!.text);
  });
});

describe('creating a session when the bank is short', () => {
  const big = { ...config, interviewType: 'system_design', level: 'intern', questionCount: 5 } as const;

  it('asks first, then can reduce the interview to the available questions', async () => {
    await setup();
    const asked = await create({ config: big });
    expect(asked.body).toMatchObject({ status: 'needs_decision', requested: 5 });
    const available = asked.body.status === 'needs_decision' ? asked.body.available : -1;
    expect(available).toBeGreaterThan(0);

    const reduced = await create({ config: big, onShortfall: 'reduce' });
    expect(reduced.body).toMatchObject({ status: 'created', questionCount: available, generated: 0 });
  });

  it('can generate the missing questions with the model', async () => {
    const generated = Array.from({ length: 5 }, (_, i) => ({
      text: `How would you design a simple service number ${i + 1} for a small team?`,
      difficulty: 'easy',
      skills: ['system_design'],
      expected_points: ['requirements', 'data model'],
    }));
    await setup([chatReply(JSON.stringify({ questions: generated }))]);
    const res = await create({ config: big, onShortfall: 'generate' });
    expect(res.body).toMatchObject({ status: 'created', questionCount: 5 });
    expect(res.body.status === 'created' && res.body.generated).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE source = 'generated'").get()).toEqual({
      n: expect.any(Number),
    });
  });
});
