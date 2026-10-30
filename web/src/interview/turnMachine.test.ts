import { describe, expect, it } from 'vitest';
import type { SessionDetail, TurnView } from '@shared/schemas/interview';
import { type InterviewState, reduce } from './turnMachine';

const turn = (id: string, n: number, kind: TurnView['kind'] = 'main'): TurnView => ({
  id,
  seq: n,
  kind,
  text: `Question ${id}`,
  questionNumber: n,
  totalQuestions: 2,
});

const detail = (over: Partial<SessionDetail> = {}): SessionDetail => ({
  id: 's1',
  status: 'in_progress',
  config: {
    jobTitle: 'Engineer',
    jobFamily: 'software_engineering',
    level: 'junior',
    interviewType: 'behavioral',
    difficulty: 'medium',
    questionCount: 2,
    thinkingTimeSec: 10,
    followUpLimit: 1,
  },
  createdAt: '2026-10-29T00:00:00Z',
  startedAt: '2026-10-29T00:00:01Z',
  endedAt: null,
  intro: 'Hello.',
  turns: [{ ...turn('t1', 1), answer: null }],
  current: turn('t1', 1),
  ...over,
});

const answering = () => reduce({ phase: 'loading' }, { type: 'started', detail: detail() });

describe('interview turn machine', () => {
  it('shows a planned interview as ready, and an open one as answering with the intro', () => {
    expect(
      reduce({ phase: 'loading' }, { type: 'loaded', detail: detail({ status: 'planned', turns: [], current: null }) })
        .phase,
    ).toBe('ready');
    expect(answering()).toMatchObject({ phase: 'answering', speech: 'Hello.', current: { id: 't1' } });
  });

  it('welcomes back on resume and lists earlier answers', () => {
    const resumed = detail({
      turns: [
        { ...turn('t1', 1), answer: { transcript: 'first', createdAt: 'x' } },
        { ...turn('t2', 2), answer: null },
      ],
      current: turn('t2', 2),
    });
    expect(reduce({ phase: 'loading' }, { type: 'loaded', detail: resumed })).toMatchObject({
      phase: 'answering',
      speech: expect.stringContaining('Welcome back'),
      log: [{ turn: { id: 't1' }, answer: 'first' }],
    });
  });

  it('refuses to submit an empty answer', () => {
    const s = reduce(answering(), { type: 'submitted' });
    expect(s).toMatchObject({ phase: 'answering', error: expect.stringContaining('Type an answer') });
  });

  it('submits, then shows the follow-up with the acknowledgment', () => {
    let s: InterviewState = reduce(answering(), { type: 'draft', text: '  my answer ' });
    s = reduce(s, { type: 'submitted' });
    expect(s).toMatchObject({ phase: 'deciding', pending: 'my answer' });
    s = reduce(s, {
      type: 'result',
      result: { ack: 'Thank you.', lead: '', next: turn('t2', 1, 'follow_up'), closing: null },
    });
    expect(s).toMatchObject({
      phase: 'answering',
      current: { id: 't2', kind: 'follow_up' },
      speech: 'Thank you.',
      draft: '',
      log: [{ turn: { id: 't1' }, answer: 'my answer' }],
    });
  });

  it('submits a spoken transcript without touching the typed draft', () => {
    const s = reduce(answering(), { type: 'submitted', text: ' I would add an index. ' });
    expect(s).toMatchObject({ phase: 'deciding', pending: 'I would add an index.' });
  });

  it('keeps the typed answer when submitting fails', () => {
    let s = reduce(reduce(answering(), { type: 'draft', text: 'my answer' }), { type: 'submitted' });
    s = reduce(s, { type: 'failed', message: 'Server not responding' });
    expect(s).toMatchObject({ phase: 'answering', draft: 'my answer', error: 'Server not responding' });
  });

  it('records a skip as unanswered and completes after the last question', () => {
    let s = reduce(answering(), { type: 'skipped' });
    expect(s).toMatchObject({ phase: 'deciding', pending: null });
    s = reduce(s, { type: 'result', result: { ack: '', lead: '', next: null, closing: 'Bye.' } });
    expect(s).toMatchObject({ phase: 'completed', closing: 'Bye.', log: [{ answer: null }] });
  });

  it('ignores events that do not fit the current phase', () => {
    const ready = reduce(
      { phase: 'loading' },
      { type: 'loaded', detail: detail({ status: 'planned', turns: [], current: null }) },
    );
    expect(reduce(ready, { type: 'submitted' })).toBe(ready);
  });
});
