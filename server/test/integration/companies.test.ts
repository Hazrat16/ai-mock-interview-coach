import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { addQuestionsResultSchema, companySchema } from '@shared/schemas/companies';
import { sessionReportSchema } from '@shared/schemas/evaluation';
import { createSessionResponseSchema, sessionDetailSchema } from '@shared/schemas/interview';
import { GENERATED_LABEL, provenanceLabel } from '@shared/schemas/provenance';
import { buildApp } from '../../src/app';
import { type Db, openDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { findCandidates, seedQuestions } from '../../src/db/repos/questions';
import { parseEnv } from '../../src/env';
import { chatReply, type FakeOllama, type FakeReply, startFakeOllama } from '../helpers/fakeOllama';

let fake: FakeOllama | undefined;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;
afterEach(async () => {
  await app?.close();
  db?.close();
  await fake?.close();
  rmSync(dir, { recursive: true, force: true });
  fake = undefined;
});

const NOTES_SUMMARY = {
  what_they_do: 'Acme builds logistics software',
  values: ['customer obsession', 'ownership'],
  interview_process: ['recruiter call', 'two behavioral rounds'],
  what_they_look_for: ['stories with measurable results'],
  tips: [],
};
const PREDICTED = {
  questions: [
    {
      based_on: 'customer obsession',
      text: 'Tell me about a time you went beyond what a customer asked for. What happened?',
      difficulty: 'medium',
      skills: ['customer_focus'],
      expected_points: ['the customer need', 'what you did', 'the result'],
    },
    {
      based_on: 'ownership',
      text: 'Describe a problem nobody owned that you took on yourself. How did it end?',
      difficulty: 'medium',
      skills: ['ownership'],
      expected_points: ['why it mattered', 'your actions', 'the outcome'],
    },
  ],
};

const system = (b: Record<string, unknown>) => String((b.messages as { content: string }[])[0]!.content);
const user = (b: Record<string, unknown>) => String((b.messages as { content: string }[])[1]?.content ?? '');

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'coach-company-'));
  fake = await startFakeOllama({
    models: ['granite4:3b', 'qwen3.5:4b'],
    chat: (body): FakeReply => {
      const s = system(body);
      if (s.includes('notes about a company')) return chatReply(JSON.stringify(NOTES_SUMMARY));
      if (s.includes('writes clear, realistic interview questions')) return chatReply(JSON.stringify(PREDICTED));
      return chatReply(JSON.stringify({ summary: 'Ok.', quality_signal: 'ok', action: 'next', follow_up: null }));
    },
  });
  db = openDb(dir);
  await migrate(db);
  seedQuestions(db);
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: dir, OLLAMA_URL: fake.url });
  app = await buildApp(env, db, '0.0.0-test', { engine: { decisionTimeoutMs: 2000 } });
}

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
const companies = async () => z.array(companySchema).parse((await app.inject({ url: '/api/companies' })).json());
const YOURS = { source: 'Glassdoor review', sourceDate: '2026-10-01' };
const addNotes = () =>
  post('/api/companies/notes', {
    company: 'Acme',
    title: 'Recruiter call',
    text: 'Acme builds logistics software. Recruiter said: two behavioral rounds, they care about customer obsession and ownership, and want stories with numbers.',
    source: 'recruiter call',
    sourceDate: '2026-10-20',
  });
const CONFIG = {
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: 'behavioral',
  difficulty: 'medium',
  questionCount: 3,
  thinkingTimeSec: 10,
  followUpLimit: 1,
};

describe('company preparation', () => {
  it('keeps your notes and questions with their source and date', async () => {
    await setup();
    expect((await addNotes()).statusCode).toBe(200);
    const added = addQuestionsResultSchema.parse(
      (
        await post('/api/companies/questions', {
          company: 'acme', // names match without case
          interviewType: 'behavioral',
          questions: ['Tell me about the hardest bug you fixed.', 'Tell me about the hardest bug you fixed.'],
          ...YOURS,
        })
      ).json(),
    );
    expect(added).toEqual({ added: 1, duplicates: 1 });

    const [acme] = await companies();
    expect(acme!.notes).toEqual([
      expect.objectContaining({ title: 'Recruiter call', source: 'recruiter call', sourceDate: '2026-10-20' }),
    ]);
    expect(acme!.notes[0]!.summary).toContain('Values: customer obsession; ownership.');
    expect(acme!.questions).toEqual([
      expect.objectContaining({
        text: 'Tell me about the hardest bug you fixed.',
        provenance: { kind: 'verified', source: 'Glassdoor review', date: '2026-10-01' },
      }),
    ]);
    expect(provenanceLabel(acme!.questions[0]!.provenance)).toBe('Verified by you (Glassdoor review, 2026-10-01)');

    // Source and date are required.
    const missing = await post('/api/companies/questions', {
      company: 'Acme',
      interviewType: 'behavioral',
      questions: ['Why do you want to work here?'],
      source: 'x',
      sourceDate: 'last week',
    });
    expect(missing.statusCode).toBe(400);
  });

  it('predicts questions only from your notes, labelled as predictions', async () => {
    await setup();
    const predict = {
      company: 'Acme',
      interviewType: 'behavioral',
      jobTitle: 'Backend Engineer',
      level: 'junior',
      count: 2,
    };
    const noNotes = await post('/api/companies/predict', predict);
    expect(noNotes.statusCode).toBe(409);
    expect(noNotes.json()).toEqual({ error: expect.stringContaining('only from your notes') });

    await addNotes();
    expect((await post('/api/companies/predict', predict)).json()).toEqual({ added: 2, duplicates: 0 });
    const req = fake!.requests.find((b) => system(b).includes('writes clear, realistic interview questions'))!;
    expect(user(req)).toContain("The candidate's notes about the company (summary):");
    expect(user(req)).toContain('Values: customer obsession; ownership.');
    expect(user(req)).toContain('Do not invent facts about the company.');
    const [acme] = await companies();
    expect(acme!.questions.map((q) => q.provenance)).toEqual([{ kind: 'generated' }, { kind: 'generated' }]);
    expect(provenanceLabel(acme!.questions[0]!.provenance)).toBe(GENERATED_LABEL);
  });

  it('a company interview asks your questions first, labels every question, and offers to predict more', async () => {
    await setup();
    await addNotes();
    await post('/api/companies/questions', {
      company: 'Acme',
      interviewType: 'behavioral',
      questions: ['Why Acme, and why now?'],
      ...YOURS,
    });

    const ask = await post('/api/sessions', { config: CONFIG, company: 'Acme', seed: 1 });
    expect(ask.json()).toEqual({ status: 'needs_decision', available: 1, requested: 3 });

    const created = createSessionResponseSchema.parse(
      (await post('/api/sessions', { config: CONFIG, company: 'Acme', seed: 1, onShortfall: 'generate' })).json(),
    );
    expect(created).toMatchObject({ status: 'created', questionCount: 3, generated: 2 });
    if (created.status !== 'created') return;
    expect(db.prepare('SELECT mode FROM sessions WHERE id = ?').get(created.sessionId)).toEqual({ mode: 'company' });

    let d = sessionDetailSchema.parse((await post(`/api/sessions/${created.sessionId}/start`, {})).json());
    expect(d.current).toMatchObject({
      text: 'Why Acme, and why now?', // yours first
      provenance: { kind: 'verified', source: 'Glassdoor review', date: '2026-10-01' },
    });
    await post(`/api/sessions/${created.sessionId}/turns/${d.current!.id}/answer`, {
      transcript: 'I like logistics and Acme ships fast.',
      inputMethod: 'typed_fallback',
    });
    const decision = fake!.requests.filter((b) => user(b).includes('Main question:')).at(-1)!;
    expect(user(decision)).toContain("The candidate's notes about the company (summary):");
    d = sessionDetailSchema.parse((await app.inject({ url: `/api/sessions/${created.sessionId}` })).json());
    expect(d.current!.provenance).toEqual({ kind: 'generated' }); // then the predictions

    const report = sessionReportSchema.parse(
      (await app.inject({ url: `/api/sessions/${created.sessionId}/report` })).json(),
    );
    expect(report.items.map((i) => i.thread[0]!.provenance?.kind)).toEqual(['verified', 'generated']); // the two asked so far

    // Company questions never turn up in ordinary interviews.
    const bank = findCandidates(db, {
      interviewType: 'behavioral',
      jobFamily: 'software_engineering',
      level: 'junior',
    });
    expect(bank.some((q) => q.text.includes('Acme') || q.text.includes('nobody owned'))).toBe(false);
  });

  it('ordinary questions have no label; delete everything removes company data', async () => {
    await setup();
    await addNotes();
    await post('/api/companies/questions', {
      company: 'Acme',
      interviewType: 'behavioral',
      questions: ['Why Acme?!!'],
      ...YOURS,
    });
    const bankInterview = createSessionResponseSchema.parse(
      (await post('/api/sessions', { config: { ...CONFIG, questionCount: 1 }, seed: 1 })).json(),
    );
    if (bankInterview.status !== 'created') return;
    const d = sessionDetailSchema.parse((await post(`/api/sessions/${bankInterview.sessionId}/start`, {})).json());
    expect(d.current!.provenance).toBeUndefined();
    await post(`/api/sessions/${bankInterview.sessionId}/end`, {});

    expect((await post('/api/data/delete-all', { confirm: 'DELETE' })).statusCode).toBe(200);
    expect(await companies()).toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM questions WHERE source IN ('user', 'company')`).get()).toEqual({
      n: 0,
    });
  });
});
