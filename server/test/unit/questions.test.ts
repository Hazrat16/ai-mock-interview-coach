import { describe, expect, it } from 'vitest';
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
});
