import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coverageSchema } from '@shared/schemas/coverage';
import { dashboardSchema, historyItemSchema, MATCH_END, MATCH_START } from '@shared/schemas/history';
import { createSessionResponseSchema, sessionDetailSchema } from '@shared/schemas/interview';
import { buildApp } from '../../src/app';
import { type Db, openMemoryDb } from '../../src/db/connection';
import { loadMigrations, migrate } from '../../src/db/migrate';
import { ftsQuery } from '../../src/db/repos/history';
import { seedQuestions } from '../../src/db/repos/questions';
import { parseEnv } from '../../src/env';
import { chatReply, type FakeOllama, startFakeOllama } from '../helpers/fakeOllama';

let fake: FakeOllama | undefined;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
afterEach(async () => {
  await app?.close();
  db?.close();
  await fake?.close();
  fake = undefined;
});

async function setup() {
  fake = await startFakeOllama({
    models: ['granite4:3b', 'qwen3.5:4b'],
    chat: [chatReply(JSON.stringify({ summary: 'Ok.', quality_signal: 'ok', action: 'next', follow_up: null }))],
  });
  db = openMemoryDb();
  await migrate(db);
  seedQuestions(db);
  const env = parseEnv({ NODE_ENV: 'test', DATA_DIR: '/tmp/coach', OLLAMA_URL: fake.url });
  app = await buildApp(env, db, '0.0.0-test', { engine: { decisionTimeoutMs: 2000 } });
}

const delivery = (wpm: number, fillers: number, pauses: number) => ({
  answerMs: 9000,
  speakingMs: 8000,
  wordsPerMinute: wpm,
  longPauses: pauses,
  fillerWords: fillers,
  responseLatencyMs: 3000,
  segments: 2,
});

type Spec = {
  type: 'behavioral' | 'technical';
  level: 'junior' | 'senior';
  answers: string[];
  /** Per answer; null = typed. */
  delivery?: (ReturnType<typeof delivery> | null)[];
  /** Answer only this many, then leave the interview in progress. */
  stopAfter?: number;
  start?: boolean;
};

/** Creates an interview through the API and answers it; returns its id. */
async function interview(s: Spec): Promise<string> {
  const config = {
    jobTitle: s.type === 'technical' ? 'Backend Engineer' : 'Product Designer',
    jobFamily: 'software_engineering',
    level: s.level,
    interviewType: s.type,
    difficulty: 'medium',
    questionCount: s.answers.length,
    thinkingTimeSec: 10,
    followUpLimit: 0,
  };
  const created = createSessionResponseSchema.parse(
    (await app.inject({ method: 'POST', url: '/api/sessions', payload: { config, seed: 5 } })).json(),
  );
  if (created.status !== 'created') throw new Error('not created');
  const id = created.sessionId;
  if (s.start === false) return id;
  let d = sessionDetailSchema.parse((await app.inject({ method: 'POST', url: `/api/sessions/${id}/start` })).json());
  for (const [i, transcript] of s.answers.entries()) {
    if (i === s.stopAfter || !d.current) break;
    const voice = s.delivery?.[i];
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/turns/${d.current.id}/answer`,
      payload: voice
        ? { transcript, inputMethod: 'voice', voice: { sttModel: 'ggml-base.en.bin', delivery: voice } }
        : { transcript, inputMethod: 'typed_fallback' },
    });
    d = sessionDetailSchema.parse((await app.inject({ url: `/api/sessions/${id}` })).json());
  }
  return id;
}

const history = async (query = '') =>
  z.array(historyItemSchema).parse((await app.inject({ url: `/api/history${query}` })).json());

describe('ftsQuery', () => {
  it('turns any input into a safe prefix query', () => {
    expect(ftsQuery('race condition')).toBe('"race"* "condition"*');
    expect(ftsQuery('"AND OR NOT*( -')).toBe('"AND"* "OR"* "NOT"*');
    expect(ftsQuery('  ?! ')).toBeUndefined();
  });
});

describe('history', () => {
  it('finds words inside answers and questions, with highlighted snippets; filters combine', async () => {
    await setup();
    const tech = await interview({
      type: 'technical',
      level: 'junior',
      answers: ['I would add indexes on the foreign keys and check the query plan.', 'A mutex prevents the race.'],
    });
    const beh = await interview({
      type: 'behavioral',
      level: 'senior',
      answers: ['I disagreed with my manager about the release date.', 'I learned to ask early.'],
    });

    expect((await history()).map((h) => h.id)).toEqual([beh, tech]); // newest first

    // Stemming and prefixes: "index" finds "indexes"; "mute" finds "mutex".
    const found = await history('?q=index');
    expect(found.map((h) => h.id)).toEqual([tech]);
    expect(found[0]!.matches[0]!.snippet).toContain(`${MATCH_START}indexes${MATCH_END}`);
    expect((await history('?q=mute')).map((h) => h.id)).toEqual([tech]);

    // Every word must appear (in the same answer).
    expect(await history('?q=manager%20mutex')).toEqual([]);
    expect((await history('?q=manager%20release')).map((h) => h.id)).toEqual([beh]);

    // Filters combine with each other and with the search.
    expect((await history('?type=technical')).map((h) => h.id)).toEqual([tech]);
    expect((await history('?type=technical&level=senior')).map((h) => h.id)).toEqual([]);
    expect((await history('?level=senior&q=learned')).map((h) => h.id)).toEqual([beh]);
    expect(await history('?q=learned&type=technical')).toEqual([]);

    // Dates (inclusive days).
    db.prepare(`UPDATE sessions SET created_at = '2026-10-01T10:00:00.000Z' WHERE id = ?`).run(tech);
    expect((await history('?from=2026-10-01&to=2026-10-01')).map((h) => h.id)).toEqual([tech]);
    expect((await history('?to=2026-10-02')).map((h) => h.id)).toEqual([tech]);
    expect((await history('?from=2026-10-02')).map((h) => h.id)).toEqual([beh]);

    // Input that is not a valid search is not an error.
    expect((await app.inject({ url: '/api/history?q=%22AND%20(*' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/history?from=yesterday' })).statusCode).toBe(400);

    const item = found[0]!;
    expect(item).toMatchObject({ status: 'completed', jobTitle: 'Backend Engineer', level: 'junior', answered: 2 });
    expect(item.totalQuestions).toBe(2);
  });

  it('keeps the search index in sync: reworded questions and deleted interviews', async () => {
    await setup();
    const id = await interview({ type: 'technical', level: 'junior', answers: ['Sharding by user id.'] });
    db.prepare(`UPDATE turns SET question_text = 'How would you partition the data?' WHERE session_id = ?`).run(id);
    const byQuestion = await history('?q=partition');
    expect(byQuestion.map((h) => h.id)).toEqual([id]);
    // Words found in the question are marked there; the snippet is always from the answer.
    expect(byQuestion[0]!.matches[0]).toEqual({
      questionText: `How would you ${MATCH_START}partition${MATCH_END} the data?`,
      snippet: 'Sharding by user id.',
    });
    await app.inject({ method: 'DELETE', url: `/api/sessions/${id}` });
    expect(await history('?q=sharding')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM answers_fts').get()).toEqual({ n: 0 });
  });

  it('leaves out interviews that were never started', async () => {
    await setup();
    await interview({ type: 'technical', level: 'junior', answers: ['x'], start: false });
    expect(await history()).toEqual([]);
  });

  it('indexes answers given before the search existed (migration 0002)', async () => {
    db = openMemoryDb();
    const all = loadMigrations();
    await migrate(db, { migrations: all.slice(0, 1) });
    seedQuestions(db);
    db.exec(`
      INSERT INTO interview_configs (id, job_title, job_family, level, interview_type, difficulty, question_count, created_at)
        VALUES ('c', 'Dev', 'software_engineering', 'junior', 'technical', 'medium', 1, '2026-10-01');
      INSERT INTO sessions (id, config_id, config_snapshot_json, mode, status, plan_json, interviewer_model, created_at)
        VALUES ('s', 'c', '{"jobTitle":"Dev","level":"junior","interviewType":"technical"}', 'random', 'completed',
                '{"seed":1,"questionIds":["q"]}', 'granite4:3b', '2026-10-01');
      INSERT INTO turns (id, session_id, seq, kind, question_text) VALUES ('t', 's', 1, 'main', 'Explain caching.');
      INSERT INTO answers (id, turn_id, transcript, input_method, created_at)
        VALUES ('a', 't', 'Redis keeps hot keys in memory.', 'typed_fallback', '2026-10-01');`);
    await migrate(db, { migrations: all });
    expect(db.prepare(`SELECT answer_id FROM answers_fts WHERE answers_fts MATCH 'redis'`).all()).toEqual([
      { answer_id: 'a' },
    ]);
  });
});

describe('dashboard', () => {
  it('has the right numbers with no interviews', async () => {
    await setup();
    const d = dashboardSchema.parse((await app.inject({ url: '/api/dashboard' })).json());
    expect(d).toEqual({
      interviews: { completed: 0, inProgress: 0, total: 0 },
      questionsAnswered: 0,
      practiceMinutes: 0,
      lastPracticedAt: null,
      byType: [],
      topics: [],
      delivery: [],
      recent: [],
    });
  });

  it('matches the numbers computed independently from the data', async () => {
    await setup();
    const a = await interview({
      type: 'technical',
      level: 'junior',
      answers: ['one', 'two', 'three'],
      delivery: [delivery(120, 2, 1), delivery(150, 0, 0), null],
    });
    const b = await interview({
      type: 'technical',
      level: 'junior',
      answers: ['four', 'five'],
      delivery: [delivery(100, 5, 2), delivery(110, 3, 3)],
    });
    const c = await interview({ type: 'behavioral', level: 'senior', answers: ['six'] });
    const open = await interview({ type: 'behavioral', level: 'junior', answers: ['seven', 'eight'], stopAfter: 1 });
    await interview({ type: 'technical', level: 'junior', answers: ['never'], start: false });

    // Fixed times, so durations and order are known.
    const times: [string, string, string][] = [
      [a, '2026-10-01T10:00:00.000Z', '2026-10-01T10:20:00.000Z'],
      [b, '2026-10-02T10:00:00.000Z', '2026-10-02T10:10:30.000Z'],
      [c, '2026-10-03T10:00:00.000Z', '2026-10-03T10:05:00.000Z'],
    ];
    for (const [id, start, end] of times)
      db.prepare('UPDATE sessions SET created_at = ?, started_at = ?, ended_at = ? WHERE id = ?').run(
        start,
        start,
        end,
        id,
      );
    db.prepare(
      `UPDATE sessions SET created_at = '2026-10-04T09:00:00.000Z', started_at = '2026-10-04T09:00:00.000Z'
                WHERE id = ?`,
    ).run(open);

    const d = dashboardSchema.parse((await app.inject({ url: '/api/dashboard' })).json());
    expect(d.interviews).toEqual({ completed: 3, inProgress: 1, total: 4 });
    expect(d.questionsAnswered).toBe(3 + 2 + 1 + 1);
    expect(d.practiceMinutes).toBe(Math.round(20 + 10.5 + 5));
    expect(d.lastPracticedAt).toBe('2026-10-04T09:00:00.000Z');
    expect(d.byType).toEqual([
      { interviewType: 'technical', count: 2 },
      { interviewType: 'behavioral', count: 1 },
    ]);
    // Spoken answers only, oldest first; averaged like the report.
    expect(d.delivery).toEqual([
      {
        sessionId: a,
        date: times[0]![1],
        answers: 2,
        wordsPerMinute: 135,
        fillerWordsPerAnswer: 1,
        longPausesPerAnswer: 0.5,
      },
      {
        sessionId: b,
        date: times[1]![1],
        answers: 2,
        wordsPerMinute: 105,
        fillerWordsPerAnswer: 4,
        longPausesPerAnswer: 2.5,
      },
    ]);
    expect(d.recent.map((r) => r.id)).toEqual([open, c, b, a]);

    // Topics: the skill tags of the answered bank questions, counted here from the raw rows.
    const tags = (
      db
        .prepare(
          `SELECT q.skill_tags_json FROM turns t JOIN answers a ON a.turn_id = t.id JOIN questions q ON q.id = t.question_id
           JOIN sessions s ON s.id = t.session_id WHERE t.kind = 'main' AND s.status != 'planned'`,
        )
        .all() as { skill_tags_json: string }[]
    ).flatMap((r) => JSON.parse(r.skill_tags_json) as string[]);
    const counts = new Map<string, number>();
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    const expected = [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((x, y) => y.count - x.count || (x.tag < y.tag ? -1 : 1))
      .slice(0, 12);
    expect(tags.length).toBeGreaterThan(0);
    expect(d.topics).toEqual(expected);
  });
});

describe('skill coverage and assessment interviews', () => {
  it('counts practised skills from answered questions, and an assessment targets the gaps', async () => {
    await setup();
    const empty = coverageSchema.parse((await app.inject({ url: '/api/coverage?family=software_engineering' })).json());
    const all = empty.groups.flatMap((g) => g.skills);
    expect(all.every((s) => s.practiced === 0)).toBe(true);
    expect(all.find((s) => s.key === 'databases')!.bankQuestions).toBeGreaterThan(0);
    expect(
      coverageSchema.parse((await app.inject({ url: '/api/coverage?family=product' })).json()).groups[0]!.skills,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'product_sense', bankQuestions: 0 })]));
    expect((await app.inject({ url: '/api/coverage?family=astronaut' })).statusCode).toBe(400);

    await interview({ type: 'technical', level: 'junior', answers: ['One.', 'Two.', 'Three.'] });
    const after = coverageSchema.parse((await app.inject({ url: '/api/coverage?family=software_engineering' })).json());
    const practiced = after.groups.flatMap((g) => g.skills).filter((s) => s.practiced > 0);
    expect(practiced.length).toBeGreaterThan(0);

    // An assessment interview avoids the skills just practised while untouched ones remain.
    const created = createSessionResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sessions',
          payload: {
            config: { ...CONFIG_TECH, questionCount: 3 },
            assessment: true,
            seed: 4,
          },
        })
      ).json(),
    );
    if (created.status !== 'created') throw new Error('not created');
    expect(db.prepare('SELECT mode FROM sessions WHERE id = ?').get(created.sessionId)).toEqual({ mode: 'assessment' });
    const plan = JSON.parse(
      (db.prepare('SELECT plan_json FROM sessions WHERE id = ?').get(created.sessionId) as { plan_json: string })
        .plan_json,
    ) as { questionIds: string[] };
    const done = new Set(practiced.map((s) => s.key));
    for (const id of plan.questionIds) {
      const skills = JSON.parse(
        (db.prepare('SELECT skill_tags_json FROM questions WHERE id = ?').get(id) as { skill_tags_json: string })
          .skill_tags_json,
      ) as string[];
      expect(
        skills.some((s) => !done.has(s)),
        skills.join(','),
      ).toBe(true);
    }
  });
});

const CONFIG_TECH = {
  jobTitle: 'Backend Engineer',
  jobFamily: 'software_engineering',
  level: 'junior',
  interviewType: 'technical',
  difficulty: 'medium',
  questionCount: 3,
  thinkingTimeSec: 10,
  followUpLimit: 0,
};
