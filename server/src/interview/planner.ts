import { DIFFICULTIES } from '@shared/schemas/interview';
import type { Question } from '../db/repos/questions';

/** Small seeded PRNG (mulberry32): the same seed always gives the same plan. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export type Plan = { questionIds: string[]; shortfall: number };

/**
 * Picks `count` distinct questions. Preference order:
 * not asked recently before asked recently; then the target difficulty before nearby difficulties.
 * Within each group the order is a seeded shuffle. 'adaptive' targets medium (real adapting: M12).
 */
export function planQuestions(
  candidates: Question[],
  opts: { count: number; difficulty: Question['difficulty'] | 'adaptive'; seed: number; recentIds: Set<string> },
): Plan {
  const target = DIFFICULTIES.indexOf(opts.difficulty === 'adaptive' ? 'medium' : opts.difficulty);
  const random = seededRandom(opts.seed);
  const distance = (q: Question) => Math.abs(DIFFICULTIES.indexOf(q.difficulty) - target);
  // Sort by text, not id: ids are random per database, and the same seed must give the same plan everywhere.
  const sorted = [...candidates].sort((a, b) => a.text.localeCompare(b.text));

  const groups = new Map<string, Question[]>();
  for (const q of sorted) {
    const key = `${opts.recentIds.has(q.id) ? 1 : 0}-${distance(q)}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const ordered = [...groups.keys()].sort().flatMap((key) => shuffle(groups.get(key)!, random));
  const questionIds = ordered.slice(0, opts.count).map((q) => q.id);
  return { questionIds, shortfall: opts.count - questionIds.length };
}
