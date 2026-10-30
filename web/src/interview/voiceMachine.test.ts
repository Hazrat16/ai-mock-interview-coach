import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_CONFIG,
  initialVoiceState,
  micOpen,
  silenceCountdown,
  type VoiceEvent,
  voiceReduce,
  type VoiceState,
} from './voiceMachine';

const config = { ...DEFAULT_VOICE_CONFIG, thinkingMs: 5000, silenceMs: 4000 };
const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState(config)) => events.reduce(voiceReduce, from);

// Interviewer finishes at t=1000; thinking until 6000.
const asked = () => run([{ type: 'spoken', now: 1000 }]);
// You start at 2000 (during thinking time) and say one sentence, transcribed.
const oneSentence = (text = 'I led the migration to Postgres last year.') =>
  run(
    [
      { type: 'speech_start', now: 2000 },
      { type: 'segment', id: 1, startMs: 2000, endMs: 5000 },
      { type: 'stt_done', id: 1, text },
    ],
    asked(),
  );

describe('voice answer: normal flow', () => {
  it('opens the mic only after the interviewer finished, for thinking time', () => {
    expect(micOpen(initialVoiceState(config))).toBe(false);
    const s = asked();
    expect(s).toMatchObject({ step: 'thinking', until: 6000, questionEndMs: 1000 });
    expect(micOpen(s)).toBe(true);
  });

  it('never ends the answer during thinking-time silence', () => {
    const s = run([{ type: 'tick', now: 5999 }], asked());
    expect(s.step).toBe('thinking');
    // After thinking time, still nothing said: it keeps listening (no answer to end yet).
    const later = run(
      [
        { type: 'tick', now: 6000 },
        { type: 'tick', now: 60_000 },
      ],
      asked(),
    );
    expect(later).toMatchObject({ step: 'listening', segments: [] });
  });

  it('starts the answer early when you speak during thinking time', () => {
    expect(run([{ type: 'speech_start', now: 2000 }], asked())).toMatchObject({ step: 'listening', speaking: true });
  });

  it('ends the answer after the configured silence and submits the joined segments', () => {
    let s = run(
      [
        { type: 'speech_start', now: 2000 },
        { type: 'segment', id: 1, startMs: 2000, endMs: 5000 },
        { type: 'speech_start', now: 5500 },
        { type: 'segment', id: 2, startMs: 5500, endMs: 9000 },
        { type: 'stt_done', id: 2, text: 'and moved forty tables.' },
        { type: 'stt_done', id: 1, text: 'I led the migration' },
        { type: 'tick', now: 12_999 },
      ],
      asked(),
    );
    expect(s.step).toBe('listening');
    expect(silenceCountdown(s, 12_999)).toBe(1);
    s = run([{ type: 'tick', now: 13_000 }], s);
    expect(s).toMatchObject({
      step: 'ready',
      transcript: 'I led the migration and moved forty tables.',
      endedAt: 13_000, // when the silence ran out, for the turn-latency measurement
      delivery: { segments: 2, responseLatencyMs: 1000, answerMs: 7000 },
    });
  });

  it('any speech cancels the end-of-answer countdown', () => {
    let s = run([{ type: 'tick', now: 8000 }], oneSentence());
    expect(silenceCountdown(s, 8000)).toBe(1);
    s = run(
      [
        { type: 'speech_start', now: 8500 },
        { type: 'tick', now: 9500 },
      ],
      s,
    );
    expect(s).toMatchObject({ step: 'listening', speaking: true });
    expect(silenceCountdown(s, 9500)).toBeUndefined();
  });

  it('shows the countdown only for the last 3 seconds', () => {
    expect(silenceCountdown(oneSentence(), 5500)).toBeUndefined(); // 3.5 s left
    expect(silenceCountdown(oneSentence(), 6500)).toBe(3);
  });

  it('waits for segments still being transcribed before submitting', () => {
    let s = run(
      [
        { type: 'speech_start', now: 2000 },
        { type: 'segment', id: 1, startMs: 2000, endMs: 5000 },
        { type: 'done', now: 5200 },
      ],
      asked(),
    );
    expect(s).toMatchObject({ step: 'transcribing' });
    expect(micOpen(s)).toBe(false);
    s = run([{ type: 'stt_done', id: 1, text: 'I would use a message queue here.' }], s);
    expect(s).toMatchObject({ step: 'ready', transcript: 'I would use a message queue here.' });
  });

  it('ends at the maximum answer length even while you keep talking', () => {
    const s = run(
      [
        { type: 'speech_start', now: 2000 },
        { type: 'tick', now: 2000 + config.maxAnswerMs },
      ],
      asked(),
    );
    expect(s.step).toBe('transcribing');
  });
});

describe('voice answer: Done mid-word', () => {
  it('waits for the last piece of speech, then submits it', () => {
    let s = run(
      [
        { type: 'speech_start', now: 2000 },
        { type: 'done', now: 4000 },
      ],
      asked(),
    );
    expect(s).toMatchObject({ step: 'transcribing', awaitingTail: true });
    s = run(
      [
        { type: 'segment', id: 1, startMs: 2000, endMs: 4000 },
        { type: 'stt_done', id: 1, text: 'That is my final answer.' },
      ],
      s,
    );
    expect(s).toMatchObject({ step: 'ready', transcript: 'That is my final answer.' });
  });

  it('gives up on the last piece after the timeout', () => {
    let s = run(
      [
        { type: 'speech_start', now: 2000 },
        { type: 'segment', id: 1, startMs: 2000, endMs: 5000 },
        { type: 'stt_done', id: 1, text: 'I would cache the results.' },
        { type: 'speech_start', now: 5500 },
        { type: 'done', now: 5600 },
      ],
      asked(),
    );
    expect(s.step).toBe('transcribing');
    s = run([{ type: 'tail_timeout' }], s);
    expect(s).toMatchObject({ step: 'ready', transcript: 'I would cache the results.' });
  });
});

describe("voice answer: didn't catch that", () => {
  it('asks again when fewer than 3 words were understood, at most twice, then offers typing', () => {
    let s = run([{ type: 'tick', now: 9000 }], oneSentence('Um.'));
    expect(s).toMatchObject({ step: 'speaking', say: 'reprompt', reprompts: 1, segments: [] });
    expect(micOpen(s)).toBe(false);

    s = run(
      [
        { type: 'spoken', now: 10_000 },
        { type: 'segment', id: 2, startMs: 11_000, endMs: 11_500 },
        { type: 'stt_done', id: 2, text: '' },
        { type: 'done', now: 12_000 },
      ],
      s,
    );
    expect(s).toMatchObject({ step: 'speaking', say: 'reprompt', reprompts: 2 });

    s = run(
      [
        { type: 'spoken', now: 13_000 },
        { type: 'segment', id: 3, startMs: 14_000, endMs: 14_500 },
        { type: 'stt_done', id: 3, text: 'Hello there' },
        { type: 'done', now: 15_000 },
      ],
      s,
    );
    expect(s).toMatchObject({ step: 'fallback', heard: 'Hello there' });
  });

  it('pressing Done without saying anything counts as not caught', () => {
    expect(run([{ type: 'done', now: 3000 }], asked())).toMatchObject({ step: 'speaking', say: 'reprompt' });
  });
});

describe('voice answer: speech-to-text failures', () => {
  const failed = () =>
    run(
      [
        { type: 'speech_start', now: 2000 },
        { type: 'segment', id: 1, startMs: 2000, endMs: 5000 },
        { type: 'segment', id: 2, startMs: 5500, endMs: 8000 },
        { type: 'stt_done', id: 1, text: 'First part of my answer.' },
        { type: 'stt_failed', id: 2 },
        { type: 'done', now: 8500 },
      ],
      asked(),
    );

  it('stops at an error instead of silently losing part of the answer', () => {
    expect(failed()).toMatchObject({ step: 'stt_error' });
  });

  it('retries the failed parts', () => {
    let s = run([{ type: 'retry_stt' }], failed());
    expect(s).toMatchObject({ step: 'transcribing', segments: [{ status: 'done' }, { status: 'pending' }] });
    s = run([{ type: 'stt_done', id: 2, text: 'And the second part.' }], s);
    expect(s).toMatchObject({ step: 'ready', transcript: 'First part of my answer. And the second part.' });
  });

  it('can continue without the failed parts', () => {
    expect(run([{ type: 'drop_failed' }], failed())).toMatchObject({
      step: 'ready',
      transcript: 'First part of my answer.',
    });
  });
});

describe('voice answer: controls', () => {
  it('pause closes the mic and keeps what you said; resume carries on listening', () => {
    let s = run([{ type: 'pause' }], oneSentence());
    expect(s).toMatchObject({ step: 'paused', reason: 'user', segments: [{ id: 1 }] });
    expect(micOpen(s)).toBe(false);
    s = run(
      [
        { type: 'resume', now: 30_000 },
        { type: 'tick', now: 33_999 },
      ],
      s,
    );
    expect(s).toMatchObject({ step: 'listening', segments: [{ id: 1 }] }); // silence timer restarted at resume
  });

  it('pause before you said anything: resume repeats the question', () => {
    const s = run([{ type: 'pause' }, { type: 'resume', now: 9000 }], asked());
    expect(s).toMatchObject({ step: 'speaking', say: 'question' });
  });

  it('pause while the interviewer speaks', () => {
    expect(run([{ type: 'pause' }])).toMatchObject({ step: 'paused', segments: [] });
  });

  it('a lost microphone pauses with its own reason', () => {
    expect(run([{ type: 'mic_lost' }], oneSentence())).toMatchObject({ step: 'paused', reason: 'mic_lost' });
  });

  it('repeat mid-answer keeps what you said and goes back to listening afterwards', () => {
    let s = run([{ type: 'repeat' }], oneSentence());
    expect(s).toMatchObject({ step: 'speaking', say: 'question', segments: [{ id: 1 }] });
    s = run([{ type: 'spoken', now: 20_000 }], s);
    expect(s).toMatchObject({ step: 'listening', segments: [{ id: 1 }], lastSpeechEndMs: 20_000 });
  });

  it('repeat during thinking time restarts thinking time after the question', () => {
    const s = run([{ type: 'repeat' }, { type: 'spoken', now: 7000 }], asked());
    expect(s).toMatchObject({ step: 'thinking', until: 12_000 });
  });

  it('zero thinking time goes straight to listening', () => {
    expect(run([{ type: 'spoken', now: 1000 }], initialVoiceState({ ...config, thinkingMs: 0 }))).toMatchObject({
      step: 'listening',
    });
  });

  it('counts each utterance once: question, repeat, reprompt; not transcription updates', () => {
    let s = initialVoiceState(config);
    expect(s.speeches).toBe(1);
    s = run([{ type: 'repeat' }], s);
    expect(s.speeches).toBe(2);
    s = run(
      [{ type: 'spoken', now: 1000 }, { type: 'segment', id: 1, startMs: 1500, endMs: 3000 }, { type: 'repeat' }],
      s,
    );
    expect(s).toMatchObject({ step: 'speaking', speeches: 3 });
    s = run([{ type: 'stt_done', id: 1, text: 'Hi' }], s); // arrives while the question is replayed
    expect(s).toMatchObject({ step: 'speaking', speeches: 3 });
    s = run(
      [
        { type: 'spoken', now: 5000 },
        { type: 'done', now: 5100 },
      ],
      s,
    );
    expect(s).toMatchObject({ step: 'speaking', say: 'reprompt', speeches: 4 });
  });

  it('ignores controls that do not apply', () => {
    const ready = run([{ type: 'tick', now: 9000 }], oneSentence());
    expect(ready.step).toBe('ready');
    for (const e of [
      { type: 'pause' },
      { type: 'repeat' },
      { type: 'done', now: 1 },
      { type: 'retry_stt' },
      { type: 'resume', now: 1 },
    ] as VoiceEvent[]) {
      expect(voiceReduce(ready, e)).toBe(ready);
    }
    const speaking = initialVoiceState(config);
    expect(voiceReduce(speaking, { type: 'done', now: 1 })).toBe(speaking);
    expect(voiceReduce(speaking, { type: 'tick', now: 99_999 })).toBe(speaking);
  });
});
