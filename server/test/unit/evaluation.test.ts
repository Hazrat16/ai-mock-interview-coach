import { describe, expect, it } from 'vitest';
import { quoteSupported } from '../../src/evaluation/evidence';
import { RUBRICS, rubricFor } from '../../src/evaluation/rubrics';
import { average, overallScore } from '../../src/evaluation/scoring';

describe('rubrics', () => {
  it.each(RUBRICS.map((r) => [r.key, r] as const))('%s: weights sum to 1, anchors for every score 0-4', (_k, r) => {
    expect(r.criteria.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 10);
    expect(new Set(r.criteria.map((c) => c.key)).size).toBe(r.criteria.length);
    for (const c of r.criteria) {
      expect(c.anchors).toHaveLength(5);
      for (const a of c.anchors) expect(a.trim().length).toBeGreaterThan(2);
      expect(c.weight).toBeGreaterThan(0);
    }
  });

  it('has a rubric for every interview type (HR uses behavioral)', () => {
    expect(rubricFor('hr').key).toBe('behavioral');
    expect(rubricFor('behavioral').key).toBe('behavioral');
    expect(rubricFor('technical').key).toBe('technical');
    expect(rubricFor('coding').key).toBe('coding');
    expect(rubricFor('system_design').key).toBe('system_design');
  });
});

describe('overallScore', () => {
  const r = rubricFor('behavioral');
  const all = (n: number) => Object.fromEntries(r.criteria.map((c) => [c.key, n]));

  it('maps all-0 to 0, all-4 to 100, all-2 to 50', () => {
    expect(overallScore(r, all(0))).toBe(0);
    expect(overallScore(r, all(4))).toBe(100);
    expect(overallScore(r, all(2))).toBe(50);
  });

  it('weights the criteria', () => {
    // Only personal_contribution (weight 0.25) at 4: 25 points.
    expect(overallScore(r, { ...all(0), personal_contribution: 4 })).toBe(25);
    // Only reflection (0.15) at 2: 7.5 → 8.
    expect(overallScore(r, { ...all(0), reflection: 2 })).toBe(8);
  });

  it('refuses incomplete scores instead of guessing', () => {
    expect(() => overallScore(r, { relevance: 4 })).toThrow(/missing score/);
  });

  it('averages to one decimal, null for none', () => {
    expect(average([70, 81, 64])).toBe(71.7);
    expect(average([])).toBeNull();
  });
});

describe('quoteSupported', () => {
  const transcript =
    'Um, so in my internship the export kept timing out. I profiled it and found an N plus one query, I batched it, ' +
    'and the export went from 40 seconds to three. Honestly I learned to measure first.';

  it('accepts exact quotes and ones with small differences', () => {
    expect(quoteSupported('I profiled it and found an N plus one query', transcript)).toBe(true);
    expect(quoteSupported('the export went from forty seconds to three', transcript)).toBe(true); // 40 = forty
    expect(quoteSupported('I profiled it, found an N+1 query', transcript)).toBe(true); // one word dropped/changed
    expect(quoteSupported('"I learned to measure first."', transcript)).toBe(true);
    expect(quoteSupported('export kept timing out ... I profiled it', transcript)).toBe(true);
  });

  it('rejects invented quotes', () => {
    expect(quoteSupported('I led a team of five engineers', transcript)).toBe(false);
    expect(quoteSupported('the export went from forty seconds to under one second', transcript)).toBe(false);
    expect(quoteSupported('', transcript)).toBe(false);
  });

  it('requires an exact match for very short quotes', () => {
    expect(quoteSupported('batched it', transcript)).toBe(true);
    expect(quoteSupported('cached it', transcript)).toBe(false);
  });
});
