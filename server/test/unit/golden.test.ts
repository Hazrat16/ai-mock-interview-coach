import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGolden, QUALITIES, withFillers } from '../../src/evaluation/golden';
import { rubricFor } from '../../src/evaluation/rubrics';

describe('golden answer set (M9)', () => {
  const items = loadGolden();

  it('has at least 5 questions for each rubric, with unique ids', () => {
    const count = new Map<string, number>();
    for (const i of items) count.set(i.rubric, (count.get(i.rubric) ?? 0) + 1);
    expect([...count.keys()].sort()).toEqual(['behavioral', 'coding', 'system_design', 'technical']);
    for (const n of count.values()) expect(n).toBeGreaterThanOrEqual(5);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('uses bank questions, scored with the rubric their interview type gets', () => {
    for (const i of items) {
      expect(rubricFor(i.interviewType).key).toBe(i.rubric);
      const bank = JSON.parse(readFileSync(`seed/questions/${i.interviewType}.json`, 'utf8')) as { text: string }[];
      expect(
        bank.map((b) => b.text),
        i.id,
      ).toContain(i.question);
    }
  });

  it('has a longer answer for better quality, and no answer short enough to hit a length rule', () => {
    const words = (s: string) => s.split(/\s+/).length;
    for (const i of items) {
      const [strong, medium, weak] = QUALITIES.map((q) => words(i[q]));
      expect(strong, i.id).toBeGreaterThan(medium!);
      expect(weak, i.id).toBeGreaterThanOrEqual(20);
    }
  });

  it('adds fillers without changing the words', () => {
    const text = 'A process has its own memory space while threads share the memory of their process and are cheaper';
    const filled = withFillers(text);
    expect(filled).toMatch(/^So, um, A process/);
    expect(filled).toContain('uh,');
    expect(filled.replace(/So, um, |\b(um|uh|like|you know), /g, '')).toBe(text);
  });
});
