// The assessment plan (M15, R24): questions chosen to cover the skills of your job family you practised least.
import type { InterviewConfig } from '@shared/schemas/interview';
import { familySkills } from '@shared/taxonomy';
import type { Question } from '../db/repos/questions';
import { type Plan, seededRandom, shuffle } from './planner';

/**
 * Picks one question at a time: the one whose least-practised skill (in the family's taxonomy) has the lowest count,
 * counting the questions already picked; ties go to the seeded order. Questions with no taxonomy skill come last.
 */
export function planAssessment(
  candidates: Question[],
  opts: { count: number; seed: number; family: InterviewConfig['jobFamily']; practiced: Map<string, number> },
): Plan {
  const skills = new Set(familySkills(opts.family));
  const counts = new Map(opts.practiced);
  // Sort by text first: ids are random per database, and the same seed must give the same plan everywhere.
  let pool = shuffle(
    [...candidates].sort((a, b) => a.text.localeCompare(b.text)),
    seededRandom(opts.seed),
  );
  const need = (q: Question) => {
    const own = q.skills.filter((s) => skills.has(s));
    return own.length ? Math.min(...own.map((s) => counts.get(s) ?? 0)) : Infinity;
  };
  const questionIds: string[] = [];
  while (questionIds.length < opts.count && pool.length) {
    let best = 0;
    for (let i = 1; i < pool.length; i++) if (need(pool[i]!) < need(pool[best]!)) best = i;
    const q = pool[best]!;
    questionIds.push(q.id);
    for (const s of q.skills) counts.set(s, (counts.get(s) ?? 0) + 1);
    pool = pool.filter((_, i) => i !== best);
  }
  return { questionIds, shortfall: opts.count - questionIds.length };
}
