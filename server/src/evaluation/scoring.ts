import type { Rubric } from './rubrics';

/** Overall 0-100 from the criterion scores (0-4), computed in code, never by the model. */
export function overallScore(rubric: Rubric, scores: Record<string, number>): number {
  let sum = 0;
  for (const c of rubric.criteria) {
    const score = scores[c.key];
    if (score === undefined) throw new Error(`missing score for ${c.key}`);
    sum += c.weight * (score / 4);
  }
  return Math.round(sum * 100);
}

export function average(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}
