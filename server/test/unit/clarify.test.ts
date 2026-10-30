import { describe, expect, it } from 'vitest';
import { isClarificationRequest } from '../../src/interview/clarify';

describe('isClarificationRequest', () => {
  it.each([
    "Sorry, I don't understand the question.",
    'I didn’t get that.',
    "What does it mean? Sorry, I couldn't understand that. And does it mean any of my work or any specific work you want to work?",
    'Could you please repeat the question?',
    'Can you rephrase that?',
    'What do you mean by eventual consistency?',
    "I'm not sure what you're asking.",
    'Sorry?',
  ])('asks for the question again: %s', (reply) => {
    expect(isClarificationRequest(reply)).toBe(true);
  });

  it.each([
    "I don't know.",
    'Sorry, I want the stupid.', // garbled by speech recognition: not recognizable, treated as an answer
    'A process has its own memory, and threads share memory inside one process.',
    // A real answer that happens to contain the words.
    "I didn't understand the bug at first, so I added logging around the payment call, reproduced it locally with the same data, found a race between two workers, and fixed it with a lock on the order row.",
    '',
  ])('is an answer: %s', (reply) => {
    expect(isClarificationRequest(reply)).toBe(false);
  });
});
