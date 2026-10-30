import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/db/repos/questions';
import { planAssessment } from '../../src/interview/assessment';

const q = (id: string, skills: string[]): Question => ({
  id,
  text: `Question ${id}`,
  interviewType: 'technical',
  jobFamily: null,
  levelMin: 'intern',
  levelMax: 'lead',
  difficulty: 'medium',
  skills,
  expectedPoints: [],
  source: 'seed',
});

const BANK = [
  q('db1', ['databases']),
  q('db2', ['databases', 'performance']),
  q('sec', ['security']),
  q('net', ['networking']),
  q('js', ['javascript']), // not in the taxonomy
];
const plan = (practiced: Record<string, number>, count: number, seed = 1) =>
  planAssessment(BANK, { count, seed, family: 'software_engineering', practiced: new Map(Object.entries(practiced)) })
    .questionIds;

describe('planAssessment', () => {
  it('covers the least-practised skills first, one skill after another', () => {
    const ids = plan({ databases: 5, performance: 5, security: 2, networking: 0 }, 3);
    expect(ids[0]).toBe('net'); // never practised
    expect(ids[1]).toBe('sec'); // 2, while networking is now 1
    expect(ids.slice(0, 2)).not.toContain('db1');
  });

  it('spreads over skills instead of repeating one', () => {
    const ids = plan({}, 3);
    const skillsCovered = new Set(ids.flatMap((id) => BANK.find((b) => b.id === id)!.skills));
    expect(skillsCovered.size).toBeGreaterThanOrEqual(3);
    expect(ids).not.toContain('js');
  });

  it('is repeatable with the same seed, and asks taxonomy-less questions last', () => {
    expect(plan({}, 5, 7)).toEqual(plan({}, 5, 7));
    expect(plan({}, 5).at(-1)).toBe('js');
  });

  it('reports a shortfall when the bank is too small', () => {
    expect(
      planAssessment(BANK, { count: 9, seed: 1, family: 'software_engineering', practiced: new Map() }).shortfall,
    ).toBe(4);
  });
});
