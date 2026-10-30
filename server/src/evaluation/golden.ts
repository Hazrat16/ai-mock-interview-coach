// The golden answer set for the scoring consistency harness (M9, `make calibrate`): per rubric, questions from
// the bank with a hand-written strong, medium and weak answer, each with an expected score band.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { INTERVIEW_TYPES } from '@shared/schemas/interview';

export const GOLDEN_DIR = fileURLToPath(new URL('../../test/fixtures/golden-answers', import.meta.url));

export const QUALITIES = ['strong', 'medium', 'weak'] as const;
export type Quality = (typeof QUALITIES)[number];

/** Expected overall score bands (docs/plan/08-testing-quality.md §2). */
export const BANDS: Record<Quality, [number, number]> = { strong: [75, 95], medium: [45, 70], weak: [10, 40] };

const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  interviewType: z.enum(INTERVIEW_TYPES),
  question: z.string().min(10),
  strong: z.string().min(1),
  medium: z.string().min(1),
  weak: z.string().min(1),
  /** The medium answer as speech recognition might mishear it (same content, misheard technical terms). */
  variants: z.object({ misheard: z.string().min(1) }).optional(),
});
const fileSchema = z.object({ rubric: z.string(), items: z.array(itemSchema).min(1) });

export type GoldenItem = z.infer<typeof itemSchema> & { rubric: string };

export function loadGolden(dir = GOLDEN_DIR): GoldenItem[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const file = fileSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      return file.items.map((i) => ({ ...i, rubric: file.rubric }));
    });
}

const FILLERS = ['um,', 'uh,', 'like,', 'you know,'];

/** The same words with filler words spread through them, as a hesitant speaker would say it. */
export function withFillers(text: string): string {
  const words = text.split(/\s+/);
  const out = ['So, um,'];
  words.forEach((w, i) => {
    out.push(w);
    if (i % 7 === 6 && i < words.length - 1) out.push(FILLERS[Math.floor(i / 7) % FILLERS.length]!);
  });
  return out.join(' ');
}
