import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { documentResultSchema, documentViewSchema } from '@shared/schemas/documents';
import { createSessionResponseSchema, sessionDetailSchema } from '@shared/schemas/interview';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { findCandidates, seedQuestions } from '../../src/db/repos/questions';
import { parseEnv } from '../../src/env';
import { JobRunner } from '../../src/evaluation/jobRunner';
import { OllamaClient } from '../../src/llm/ollamaClient';
import { chatReply, type FakeOllama, type FakeReply, startFakeOllama } from '../helpers/fakeOllama';
import { minimalPdf } from '../helpers/minimalPdf';

let fake: FakeOllama | undefined;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
afterEach(async () => {
  await app?.close();
  db?.close();
  await fake?.close();
  fake = undefined;
});

const RESUME_SUMMARY = {
  headline: 'Backend engineer, 2 years, payments',
  skills: ['Node.js', 'PostgreSQL', 'Kafka'],
  projects: [
    {
      name: 'Ledger Service',
      what: 'built the double-entry ledger for card payments',
      technologies: ['Node.js', 'PostgreSQL'],
      outcome: 'handled 2k requests per second',
    },
  ],
  experience: [{ role: 'Backend Engineer', place: 'Paylane', highlight: 'moved settlement to Kafka' }],
};
const JD_SUMMARY = {
  role: 'Senior Backend Engineer',
  company: 'Acme',
  required_skills: ['Go', 'gRPC', 'distributed tracing'],
  responsibilities: ['own the order service'],
  nice_to_have: [],
};
const QUESTIONS = {
  questions: [
    {
      based_on: 'Ledger Service',
      text: 'In your Ledger Service project, how did you keep the double-entry ledger consistent under load?',
      difficulty: 'medium',
      skills: ['databases', 'consistency'],
      expected_points: ['transactions', 'idempotency keys'],
    },
    {
      based_on: 'Paylane',
      text: 'At Paylane you moved settlement to Kafka. What problems did that solve, and what did it cost?',
      difficulty: 'medium',
      skills: ['messaging'],
      expected_points: ['decoupling', 'ordering and retries'],
    },
  ],
};

const system = (body: Record<string, unknown>) => String((body.messages as { content: string }[])[0]!.content);
const user = (body: Record<string, unknown>) => String((body.messages as { content: string }[])[1]?.content ?? '');

async function setup(opts: { ollamaDown?: boolean } = {}) {
  fake = await startFakeOllama({
    models: ['granite4:3b', 'qwen3.5:4b'],
    chat: (body): FakeReply => {
      const s = system(body);
      if (s.includes('Summarize this resume')) return chatReply(JSON.stringify(RESUME_SUMMARY));
      if (s.includes('Summarize this job description')) return chatReply(JSON.stringify(JD_SUMMARY));
      if (s.includes('writes clear, realistic interview questions')) return chatReply(JSON.stringify(QUESTIONS));
      if (s.includes('You coach candidates')) return chatReply(JSON.stringify({ example_answer: 'In the Ledger…' }));
      return chatReply(JSON.stringify({ summary: 'Ok.', quality_signal: 'ok', action: 'next', follow_up: null }));
    },
  });
  db = openMemoryDb();
  await migrate(db);
  seedQuestions(db);
  const env = parseEnv({
    NODE_ENV: 'test',
    DATA_DIR: '/tmp/coach',
    OLLAMA_URL: opts.ollamaDown ? 'http://127.0.0.1:9' : fake.url,
  });
  app = await buildApp(env, db, '0.0.0-test', { engine: { decisionTimeoutMs: 2000 } });
}

const upload = (body: Buffer, query: string, type = 'application/pdf') =>
  app.inject({ method: 'POST', url: `/api/documents/upload?${query}`, headers: { 'content-type': type }, payload: body });

const RESUME_PDF = minimalPdf([
  ['Jane Doe - Backend Engineer', 'Paylane, 2023-2025: moved settlement to Kafka.'],
  ['Projects', 'Ledger Service: double-entry ledger for card payments in Node.js and PostgreSQL, 2k requests/s.'],
]);

const CONFIG = {
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: 'technical',
  difficulty: 'medium',
  questionCount: 2,
  thinkingTimeSec: 10,
  followUpLimit: 1,
};

describe('documents', () => {
  it('reads a PDF resume locally and stores it with a short summary', async () => {
    await setup();
    const res = await upload(RESUME_PDF, 'kind=resume&title=My%20resume');
    expect(res.statusCode).toBe(200);
    const { document, summaryError } = documentResultSchema.parse(res.json());
    expect(summaryError).toBeNull();
    expect(document).toMatchObject({ kind: 'resume', title: 'My resume', interviews: 0 });
    expect(document.text).toContain('Ledger Service: double-entry ledger');
    expect(document.text).toContain('moved settlement to Kafka'); // both pages
    expect(document.summary).toContain('Project "Ledger Service": built the double-entry ledger');
    expect(document.summary!.split(/\s+/).length).toBeLessThan(220); // ≤ ~300 tokens
    // The model got the extracted text, not the PDF.
    const req = fake!.requests.find((b) => system(b).includes('Summarize this resume'))!;
    expect(user(req)).toContain('Ledger Service');
    expect(user(req)).not.toContain('%PDF');

    const list = z.array(documentViewSchema).parse((await app.inject({ url: '/api/documents' })).json());
    expect(list.map((d) => d.title)).toEqual(['My resume']);
  });

  it('stores a pasted job description; plain text files work too', async () => {
    await setup();
    const text = 'Acme is hiring a Senior Backend Engineer. You will own the order service. Required: Go, gRPC, tracing.';
    const pasted = documentResultSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/documents',
          payload: { kind: 'job_description', title: 'Acme', company: 'Acme', text },
        })
      ).json(),
    );
    expect(pasted.document.summary).toBe(
      'Role: Senior Backend Engineer at Acme.\nRequired skills: Go; gRPC; distributed tracing.\nResponsibilities: own the order service.',
    );
    const txt = await upload(Buffer.from(text), 'kind=job_description&title=Acme%20txt', 'text/plain');
    expect(documentResultSchema.parse(txt.json()).document.text).toBe(text);
  });

  it('refuses files with no usable text', async () => {
    await setup();
    const scanned = minimalPdf([[]]); // a page with no text layer
    expect((await upload(scanned, 'kind=resume&title=x')).json()).toEqual({
      error: expect.stringContaining('scanned PDF'),
    });
    expect((await upload(Buffer.from([0, 1, 2, 3, 0, 255]), 'kind=resume&title=x')).statusCode).toBe(400);
    expect((await upload(Buffer.from('%PDF-1.4 broken'), 'kind=resume&title=x')).statusCode).toBe(400);
    expect((await upload(Buffer.alloc(6 * 1024 * 1024, 65), 'kind=resume&title=x')).statusCode).toBe(413);
    expect((await upload(RESUME_PDF, 'kind=letter&title=x')).statusCode).toBe(400);
  });

  it('keeps the document when the model is not running, and summarizes it later', async () => {
    await setup({ ollamaDown: true });
    const res = documentResultSchema.parse((await upload(RESUME_PDF, 'kind=resume&title=CV')).json());
    expect(res.summaryError).toContain('not reachable');
    expect(res.document.summary).toBeNull();
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { config: CONFIG, documentId: res.document.id },
    });
    expect(created.statusCode).toBe(409);
  });
});

describe('interviews from a document', () => {
  it('asks questions written from the resume; the summary reaches the interviewer and the answer writer', async () => {
    await setup();
    const doc = documentResultSchema.parse((await upload(RESUME_PDF, 'kind=resume&title=CV')).json()).document;
    const created = createSessionResponseSchema.parse(
      (
        await app.inject({ method: 'POST', url: '/api/sessions', payload: { config: CONFIG, documentId: doc.id } })
      ).json(),
    );
    expect(created).toMatchObject({ status: 'created', questionCount: 2, generated: 2 });
    if (created.status !== 'created') return;
    const genReq = fake!.requests.find((b) => system(b).includes('writes clear, realistic interview questions'))!;
    expect(user(genReq)).toContain("The candidate's resume (summary):");
    expect(user(genReq)).toContain('Project "Ledger Service"');
    expect(user(genReq)).not.toContain('Jane Doe'); // the summary, not the full document

    let d = sessionDetailSchema.parse(
      (await app.inject({ method: 'POST', url: `/api/sessions/${created.sessionId}/start` })).json(),
    );
    expect(d.current!.text).toContain('Ledger Service');
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${created.sessionId}/turns/${d.current!.id}/answer`,
      payload: { transcript: 'I used a transaction per transfer and idempotency keys.', inputMethod: 'typed_fallback' },
    });
    const decision = fake!.requests.filter((b) => user(b).includes('Main question:')).at(-1)!;
    expect(user(decision)).toContain("The candidate's resume (summary):");
    d = sessionDetailSchema.parse((await app.inject({ url: `/api/sessions/${created.sessionId}` })).json());
    expect(d.current!.text).toContain('Paylane');

    // The session is linked; mode is resume.
    expect(db.prepare('SELECT mode FROM sessions WHERE id = ?').get(created.sessionId)).toEqual({ mode: 'resume' });
    expect(z.array(documentViewSchema).parse((await app.inject({ url: '/api/documents' })).json())[0]!.interviews).toBe(1);

    // The interview-ready answer gets the resume summary too.
    await app.inject({ method: 'POST', url: `/api/sessions/${created.sessionId}/end` });
    await new Promise((r) => setImmediate(r));
    const runner = new JobRunner({
      db,
      llm: new OllamaClient(fake!.url),
      fallbackModel: 'granite4:3b',
      log: () => undefined,
      isPaused: () => false,
      scoring: false,
    });
    expect(await runner.runOnce()).toBe('done');
    const ready = fake!.requests.find((b) => system(b).includes('You coach candidates'))!;
    expect(user(ready)).toContain('use its real projects and facts');
    expect(user(ready)).toContain('Project "Ledger Service"');

    // Resume questions never turn up in ordinary interviews.
    const bank = findCandidates(db, { interviewType: 'technical', jobFamily: 'software_engineering', level: 'junior' });
    expect(bank.some((q) => q.text.includes('Ledger Service'))).toBe(false);

    // Deleting the document keeps the interview and its questions.
    await app.inject({ method: 'DELETE', url: `/api/documents/${doc.id}` });
    expect((await app.inject({ url: `/api/sessions/${created.sessionId}/report` })).statusCode).toBe(200);
  });
});
