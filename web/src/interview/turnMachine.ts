// Interview screen state as a pure reducer, so every transition can be unit-tested.
// Session-level flow, shared by typed and spoken answers. The spoken answer's own steps (speaking, listening,
// transcribing, ...) live in voiceMachine.ts; it hands the final transcript to 'submitted'.
import type { SessionDetail, TurnResult, TurnView } from '@shared/schemas/interview';

export type LogEntry = { turn: TurnView; answer: string | null };

export type InterviewState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; detail: SessionDetail }
  | {
      phase: 'answering';
      detail: SessionDetail;
      current: TurnView;
      /** What the interviewer says before the question: intro, acknowledgment, transition. */
      speech: string;
      log: LogEntry[];
      draft: string;
      error?: string;
    }
  | {
      phase: 'deciding';
      detail: SessionDetail;
      current: TurnView;
      speech: string;
      log: LogEntry[];
      pending: string | null;
    }
  | { phase: 'completed'; detail: SessionDetail; closing: string | null; log: LogEntry[] };

export type InterviewEvent =
  | { type: 'loaded'; detail: SessionDetail }
  | { type: 'started'; detail: SessionDetail }
  | { type: 'draft'; text: string }
  /** `text`: a spoken answer's transcript; without it the typed draft is submitted. */
  | { type: 'submitted'; text?: string }
  | { type: 'skipped' }
  | { type: 'result'; result: TurnResult }
  | { type: 'failed'; message: string }
  | { type: 'ended'; detail: SessionDetail };

const logOf = (detail: SessionDetail): LogEntry[] =>
  detail.turns
    .filter((t) => t.id !== detail.current?.id)
    .map(({ answer, ...turn }) => ({ turn, answer: answer?.transcript ?? null }));

function fromDetail(detail: SessionDetail, speech: string): InterviewState {
  if (detail.status === 'planned') return { phase: 'ready', detail };
  if (detail.current) {
    return { phase: 'answering', detail, current: detail.current, speech, log: logOf(detail), draft: '' };
  }
  return { phase: 'completed', detail, closing: null, log: logOf(detail) };
}

export function reduce(state: InterviewState, event: InterviewEvent): InterviewState {
  switch (event.type) {
    case 'loaded':
      return fromDetail(
        event.detail,
        event.detail.turns.length > 1 ? 'Welcome back. Here is where we left off.' : event.detail.intro,
      );
    case 'started':
      return fromDetail(event.detail, event.detail.intro);
    case 'draft':
      return state.phase === 'answering' ? { ...state, draft: event.text, error: undefined } : state;
    case 'submitted':
    case 'skipped': {
      if (state.phase !== 'answering') return state;
      const answer = event.type === 'submitted' ? (event.text ?? state.draft).trim() : '';
      if (event.type === 'submitted' && !answer) return { ...state, error: 'Type an answer first, or skip.' };
      const { detail, current, speech, log } = state;
      return {
        phase: 'deciding',
        detail,
        current,
        speech,
        log,
        pending: event.type === 'submitted' ? answer : null,
      };
    }
    case 'result': {
      if (state.phase !== 'deciding') return state;
      const log = [...state.log, { turn: state.current, answer: state.pending }];
      const { next, closing, ack, lead } = event.result;
      if (!next) return { phase: 'completed', detail: state.detail, closing, log };
      return {
        phase: 'answering',
        detail: state.detail,
        current: next,
        speech: [ack, lead].filter(Boolean).join(' '),
        log,
        draft: '',
      };
    }
    case 'failed':
      if (state.phase === 'deciding') {
        // Keep the typed answer so nothing is lost; the user can retry.
        const { pending, ...rest } = state;
        return { ...rest, phase: 'answering', draft: pending ?? '', error: event.message };
      }
      return { phase: 'error', message: event.message };
    case 'ended':
      return {
        phase: 'completed',
        detail: event.detail,
        closing: null,
        log: logOf({ ...event.detail, current: null }),
      };
  }
}
