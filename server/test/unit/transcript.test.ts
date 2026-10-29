import { describe, expect, it } from 'vitest';
import type { RawSegment } from '../../src/speech/sttClient';
import { buildTranscript, classifySegment } from '../../src/speech/transcript';

const seg = (text: string, over: Partial<RawSegment> = {}): RawSegment => ({
  start: 0,
  end: 1,
  text,
  noSpeechProb: 0.02,
  avgLogprob: -0.2,
  ...over,
});

describe('transcript filtering', () => {
  it('joins confident segments into the answer', () => {
    const t = buildTranscript([seg('In my last role,'), seg('I led the migration.')]);
    expect(t).toMatchObject({ text: 'In my last role, I led the migration.', words: 8 });
  });

  it('drops silence, low-confidence guesses, and known hallucinations', () => {
    expect(classifySegment(seg('Something.', { noSpeechProb: 0.8 })).reason).toBe('no_speech');
    expect(classifySegment(seg('Bananas forever.', { avgLogprob: -1.4 })).reason).toBe('low_confidence');
    expect(classifySegment(seg('Thanks for watching!')).reason).toBe('hallucination');
    expect(classifySegment(seg('[BLANK_AUDIO]')).reason).toBe('empty');
    expect(classifySegment(seg(' ... ')).reason).toBe('empty');
  });

  it('keeps a real short "Thank you." but drops it on near-silence', () => {
    expect(classifySegment(seg('Thank you.')).kept).toBe(true);
    expect(classifySegment(seg('Thank you.', { noSpeechProb: 0.45 })).reason).toBe('hallucination');
  });

  it('removes noise tags inside a segment but keeps the words', () => {
    expect(buildTranscript([seg('[MUSIC] I would use a queue.')]).text).toBe('I would use a queue.');
  });

  it('gives an empty answer when nothing was said', () => {
    expect(buildTranscript([seg('[BLANK_AUDIO]'), seg('you', { noSpeechProb: 0.5 })])).toMatchObject({
      text: '',
      words: 0,
    });
  });
});
