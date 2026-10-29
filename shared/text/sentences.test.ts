import { describe, expect, it } from 'vitest';
import { splitSentences } from './sentences';

describe('splitSentences', () => {
  it('splits on sentence punctuation', () => {
    expect(splitSentences('Thank you. Next question. Why do you want this role? Take your time!')).toEqual([
      'Thank you.',
      'Next question.',
      'Why do you want this role?',
      'Take your time!',
    ]);
  });

  it('keeps abbreviations and initials inside the sentence', () => {
    expect(splitSentences('Pick a store, e.g. Redis or Postgres. Dr. Smith and J. Doe agree, i.e. it works.')).toEqual([
      'Pick a store, e.g. Redis or Postgres.',
      'Dr. Smith and J. Doe agree, i.e. it works.',
    ]);
  });

  it('does not split code terms, versions, and numbers', () => {
    expect(
      splitSentences('Can you do better than O(n log n)? Explain how Node.js handles v1.2.3 at 3.5 ms. Go on.'),
    ).toEqual(['Can you do better than O(n log n)?', 'Explain how Node.js handles v1.2.3 at 3.5 ms.', 'Go on.']);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(splitSentences('He said "ship it." Then what? (Be specific.) Okay.')).toEqual([
      'He said "ship it."',
      'Then what?',
      '(Be specific.)',
      'Okay.',
    ]);
  });

  it('does not split before a lowercase word, and handles ellipses', () => {
    expect(splitSentences('Caching, queues, etc. are fine... Now design it.')).toEqual([
      'Caching, queues, etc. are fine...',
      'Now design it.',
    ]);
  });

  it('treats paragraphs and list items as boundaries and drops empty pieces', () => {
    expect(splitSentences('Consider:\n- latency\n- cost\n\n  ...  \n\nWhich matters most')).toEqual([
      'Consider:',
      '- latency',
      '- cost',
      'Which matters most',
    ]);
  });

  it('splits a very long sentence at a comma so the first audio starts quickly', () => {
    const long = `${'word '.repeat(30)}first part, ${'more '.repeat(30)}second part.`;
    const parts = splitSentences(long);
    expect(parts.length).toBe(2);
    expect(parts[0]!.endsWith('first part,')).toBe(true);
    expect(parts.join(' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });
});
