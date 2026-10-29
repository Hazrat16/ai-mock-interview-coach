import { describe, expect, it } from 'vitest';
import { normalizeWords, wordErrorRate } from './wer';

describe('normalizeWords', () => {
  it('ignores case, punctuation, and hyphens', () => {
    expect(normalizeWords('Well, I — honestly — re-ran the CI/CD job!')).toEqual([
      'well',
      'i',
      'honestly',
      're',
      'ran',
      'the',
      'ci',
      'cd',
      'job',
    ]);
  });

  it('spells out numbers so "40" and "forty" match', () => {
    expect(normalizeWords('from 40 to 3 seconds, 1,250 users, 99.9% uptime')).toEqual(
      'from forty to three seconds one thousand two hundred fifty users ninety nine point nine percent uptime'.split(
        ' ',
      ),
    );
  });
});

describe('wordErrorRate', () => {
  it('is 0 for the same words written differently', () => {
    expect(wordErrorRate('I reduced it from forty seconds to three.', 'I reduced it from 40 seconds to 3').wer).toBe(0);
  });

  it('counts substitutions, deletions, and insertions', () => {
    // ref 6 words: "the cache was very slow today"; hyp substitutes cash, drops very, adds really
    const r = wordErrorRate('the cache was very slow today', 'the cash was slow today really');
    expect(r).toEqual({ wer: 3 / 6, errors: 3, referenceWords: 6 });
  });

  it('does not count joined or split compounds and unit abbreviations as errors', () => {
    expect(wordErrorRate('A hash map gives constant time lookups', 'A HashMap gives constant-time look ups').wer).toBe(
      0,
    );
    expect(wordErrorRate('from eight hundred milliseconds', 'from 800 ms').wer).toBe(0);
    expect(wordErrorRate('from eight hundred milliseconds', 'from 800ms').wer).toBe(0);
  });

  it('handles empty texts', () => {
    expect(wordErrorRate('', '').wer).toBe(0);
    expect(wordErrorRate('', 'noise').wer).toBe(1);
    expect(wordErrorRate('hello there', '').wer).toBe(1);
  });
});
