import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/db/repos/questions';
import { planQuestions } from '../../src/interview/planner';

const q = (id: string, difficulty: Question['difficulty']): Question => ({
  id,
  text: `Question ${id}`,
  interviewType: 'behavioral',
  jobFamily: null,
  levelMin: 'intern',
  levelMax: 'lead',
  difficulty,
  skills: ['x'],
  expectedPoints: ['y'],
  source: 'seed',
});

const bank = [
  ...['m1', 'm2', 'm3', 'm4'].map((id) => q(id, 'medium')),
  ...['e1', 'e2'].map((id) => q(id, 'easy')),
  q('h1', 'hard'),
];
const opts = { count: 3, difficulty: 'medium' as const, seed: 42, recentIds: new Set<string>() };

describe('planQuestions', () => {
  it('returns distinct questions of the target difficulty first', () => {
    const { questionIds, shortfall } = planQuestions(bank, opts);
    expect(shortfall).toBe(0);
    expect(new Set(questionIds).size).toBe(3);
    expect(questionIds.every((id) => id.startsWith('m'))).toBe(true);
  });

  it('is reproducible: same seed, same plan, regardless of input order', () => {
    const a = planQuestions(bank, opts);
    const b = planQuestions([...bank].reverse(), opts);
    expect(b).toEqual(a);
  });

  it('gives different plans for different seeds', () => {
    const plans = new Set([1, 2, 3, 4, 5].map((seed) => planQuestions(bank, { ...opts, seed }).questionIds.join()));
    expect(plans.size).toBeGreaterThan(1);
  });

  it('fills with nearby difficulties when the target runs out', () => {
    const { questionIds } = planQuestions(bank, { ...opts, count: 6 });
    expect(questionIds.slice(0, 4).every((id) => id.startsWith('m'))).toBe(true);
    expect(questionIds.slice(4).every((id) => ['e1', 'e2', 'h1'].includes(id))).toBe(true); // one step away
    expect(questionIds).toHaveLength(6);
  });

  it('uses recently asked questions only after fresh ones', () => {
    const recentIds = new Set(['m1', 'm2', 'm3']);
    const { questionIds } = planQuestions(bank, { ...opts, count: 2, recentIds });
    expect(questionIds[0]).toBe('m4'); // the only fresh medium question
    expect(recentIds.has(questionIds[1]!)).toBe(false); // a fresh easy/hard one beats a recent medium one
  });

  it('reports a shortfall when the bank is too small', () => {
    expect(planQuestions(bank, { ...opts, count: 10 })).toMatchObject({ shortfall: 3 });
  });

  it("treats 'adaptive' as medium", () => {
    const { questionIds } = planQuestions(bank, { ...opts, difficulty: 'adaptive' });
    expect(questionIds.every((id) => id.startsWith('m'))).toBe(true);
  });
});
