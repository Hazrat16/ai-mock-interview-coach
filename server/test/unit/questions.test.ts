import { describe, expect, it } from 'vitest';
import { LEVELS, TRACKS } from '@shared/schemas/interview';
import { openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { findCandidates, seedQuestions, textHash } from '../../src/db/repos/questions';

async function seededDb() {
  const db = openMemoryDb();
  await migrate(db);
  return { db, added: seedQuestions(db) };
}

describe('question bank', () => {
  it('loads every seed file and does not duplicate on the next start', async () => {
    const { db, added } = await seededDb();
    expect(added).toBeGreaterThanOrEqual(70);
    expect(seedQuestions(db)).toBe(0);
    const types = db.prepare('SELECT DISTINCT interview_type AS t FROM questions ORDER BY t').all();
    expect(types.map((r) => (r as { t: string }).t)).toEqual([
      'behavioral',
      'coding',
      'hr',
      'system_design',
      'technical',
    ]);
  });

  it('treats questions differing only in case and punctuation as the same', () => {
    expect(textHash('What is a race condition?')).toBe(textHash('what is a RACE condition'));
  });

  it('filters by job family and level', async () => {
    const { db } = await seededDb();
    const dataTech = findCandidates(db, { interviewType: 'technical', jobFamily: 'data', level: 'junior' });
    expect(dataTech.length).toBeGreaterThan(0);
    expect(dataTech.every((q) => q.jobFamily === 'data' || q.jobFamily === null)).toBe(true);

    const leadBehavioral = findCandidates(db, { interviewType: 'behavioral', jobFamily: 'product', level: 'lead' });
    expect(leadBehavioral.some((q) => q.text.includes('influence a decision'))).toBe(true);
    const internBehavioral = findCandidates(db, { interviewType: 'behavioral', jobFamily: 'product', level: 'intern' });
    expect(internBehavioral.some((q) => q.text.includes('influence a decision'))).toBe(false); // mid..lead only
  });

  it('a track replaces the job family, and only finds questions of that track', async () => {
    const { db } = await seededDb();
    const base = { interviewType: 'technical', jobFamily: 'software_engineering', level: 'junior' } as const;
    const data = findCandidates(db, { ...base, track: 'data' });
    expect(data.some((q) => q.text.includes('p-value') || q.text.includes('overfitting'))).toBe(true);
    const frontend = findCandidates(db, { ...base, track: 'frontend' }).map((q) => q.text);
    expect(frontend.some((t) => t.includes('virtual DOM'))).toBe(true);
    expect(frontend.some((t) => t.includes('Dockerfile'))).toBe(false);
    expect(findCandidates(db, base).some((q) => q.jobFamily === 'data')).toBe(false);
  });

  it('a question can belong to several tracks', async () => {
    const { db } = await seededDb();
    const base = { interviewType: 'technical', jobFamily: 'other', level: 'mid' } as const;
    for (const track of ['backend', 'devops'] as const) {
      expect(findCandidates(db, { ...base, track }).some((q) => q.text.includes('logs, metrics and traces'))).toBe(
        true,
      );
    }
  });

  it('has a full interview of questions for every track at every level', async () => {
    const { db } = await seededDb();
    for (const track of TRACKS) {
      for (const level of LEVELS) {
        const found = findCandidates(db, { interviewType: 'technical', jobFamily: 'other', level, track });
        expect(found.length, `${track} ${level}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('stores an answer for every question that does not depend on your own experience', async () => {
    const { db } = await seededDb();
    const rows = db.prepare('SELECT interview_type AS type, ready_answer AS answer FROM questions').all() as {
      type: string;
      answer: string | null;
    }[];
    for (const r of rows) {
      if (r.type === 'hr' || r.type === 'behavioral') expect(r.answer).toBeNull();
      else expect(r.answer?.split(/\s+/).length).toBeLessThanOrEqual(180); // as the model's answers (readyAnswer.ts)
    }
  });

  it('gives seed questions from an earlier version their tracks and answers, keeping their ids', async () => {
    const { db } = await seededDb();
    const text = 'Explain how the JavaScript event loop works.';
    db.prepare(`UPDATE questions SET tracks_json = '[]', ready_answer = NULL WHERE text = ?`).run(text);
    const before = db.prepare('SELECT id FROM questions WHERE text = ?').get(text);
    expect(seedQuestions(db)).toBe(0);
    expect(db.prepare('SELECT id, tracks_json FROM questions WHERE text = ?').get(text)).toEqual({
      ...before,
      tracks_json: '["backend","frontend"]',
    });
    expect(db.prepare('SELECT ready_answer FROM questions WHERE text = ?').get(text)).toEqual({
      ready_answer: expect.stringContaining('call stack'),
    });
  });
});
