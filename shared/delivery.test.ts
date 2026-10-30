import { describe, expect, it } from 'vitest';
import { measureDelivery } from './delivery';

describe('measureDelivery', () => {
  it('measures pace, pauses, fillers, and response time', () => {
    const d = measureDelivery(
      [
        { startMs: 3000, endMs: 9000, text: 'Um, in my last role I led a migration to Postgres.' }, // 11 words, 6 s
        { startMs: 9800, endMs: 15000, text: 'We moved forty tables, uh, over two weekends.' }, // 8 words
        { startMs: 19000, endMs: 22000, text: 'You know, it went fine.' }, // 5 words, after a 4 s pause
      ],
      1000,
    );
    expect(d).toEqual({
      answerMs: 19000,
      speakingMs: 14200,
      wordsPerMinute: Math.round((24 / 14200) * 60000),
      longPauses: 1,
      fillerWords: 3,
      responseLatencyMs: 2000,
      segments: 3,
    });
  });

  it('ignores empty segments and returns nothing when nothing was said', () => {
    expect(measureDelivery([{ startMs: 0, endMs: 500, text: '  ' }], 0)).toBeUndefined();
    expect(measureDelivery([], 0)).toBeUndefined();
  });

  it('does not count "umbrella" or "human" as fillers', () => {
    expect(measureDelivery([{ startMs: 0, endMs: 1000, text: 'The umbrella team is human.' }], 0)?.fillerWords).toBe(0);
  });
});
