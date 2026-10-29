import { useCallback, useEffect, useReducer, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type SessionDetail, sessionDetailSchema, turnResultSchema } from '@shared/schemas/interview';
import { settingsSchema } from '@shared/schemas/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type LogEntry, reduce } from '@/interview/turnMachine';
import { getJson, sendJson } from '@/lib/api';
import { INTERVIEW_TYPE_LABELS, LEVEL_LABELS } from '@/lib/labels';
import { fieldClass } from '@/lib/styles';

function useElapsedSeconds(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => {
      clearInterval(id);
      setSeconds(0);
    };
  }, [running]);
  return seconds;
}

function Transcript({ log }: { log: LogEntry[] }) {
  if (log.length === 0) return <p className="text-sm text-muted-foreground">Nothing answered yet.</p>;
  return (
    <ol className="space-y-4">
      {log.map(({ turn, answer }) => (
        <li key={turn.id} className="space-y-1 text-sm">
          <p className="font-medium">
            {turn.kind === 'follow_up'
              ? `Follow-up to question ${turn.questionNumber}`
              : `Question ${turn.questionNumber}`}
            : {turn.text}
          </p>
          <p className={answer ? 'whitespace-pre-wrap text-muted-foreground' : 'italic text-muted-foreground'}>
            {answer ?? 'Skipped'}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Header({ detail }: { detail: SessionDetail }) {
  const c = detail.config;
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        {INTERVIEW_TYPE_LABELS[c.interviewType]} interview · {c.jobTitle}
      </h1>
      <p className="text-sm text-muted-foreground">
        {LEVEL_LABELS[c.level]} level ·{' '}
        {detail.turns.length === 0 ? c.questionCount : (detail.current?.totalQuestions ?? c.questionCount)} questions ·
        text mode
      </p>
    </div>
  );
}

export function Interview() {
  const { id = '' } = useParams();
  const [state, dispatch] = useReducer(reduce, { phase: 'loading' });
  const [showTranscript, setShowTranscript] = useState(true);
  const elapsed = useElapsedSeconds(state.phase === 'deciding');

  useEffect(() => {
    let active = true;
    getJson(`/api/sessions/${id}`, sessionDetailSchema)
      .then((detail) => active && dispatch({ type: 'loaded', detail }))
      .catch((e: Error) => active && dispatch({ type: 'failed', message: e.message }));
    getJson('/api/settings', settingsSchema)
      .then((s) => active && setShowTranscript(s.showTranscript))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id]);

  const start = useCallback(async () => {
    try {
      dispatch({
        type: 'started',
        detail: await sendJson('POST', `/api/sessions/${id}/start`, {}, sessionDetailSchema),
      });
    } catch (e) {
      dispatch({ type: 'failed', message: (e as Error).message });
    }
  }, [id]);

  const respond = useCallback(
    async (action: 'answer' | 'skip', turnId: string, transcript?: string) => {
      dispatch({ type: action === 'answer' ? 'submitted' : 'skipped' });
      if (action === 'answer' && !transcript?.trim()) return;
      try {
        const body = action === 'answer' ? { transcript, inputMethod: 'typed_fallback' } : {};
        const result = await sendJson('POST', `/api/sessions/${id}/turns/${turnId}/${action}`, body, turnResultSchema);
        dispatch({ type: 'result', result });
      } catch (e) {
        dispatch({ type: 'failed', message: (e as Error).message });
      }
    },
    [id],
  );

  const end = useCallback(async () => {
    if (!window.confirm('End the interview now? Your answers so far are kept.')) return;
    try {
      dispatch({ type: 'ended', detail: await sendJson('POST', `/api/sessions/${id}/end`, {}, sessionDetailSchema) });
    } catch (e) {
      dispatch({ type: 'failed', message: (e as Error).message });
    }
  }, [id]);

  if (state.phase === 'loading') return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (state.phase === 'error') {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
        <Link to="/interview/new" className="text-sm underline">
          Back to setup
        </Link>
      </div>
    );
  }

  if (state.phase === 'ready') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header detail={state.detail} />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm">
              When you are ready, start the interview. You can pause by leaving the page; it resumes where you stopped.
            </p>
            <Button onClick={() => void start()}>Start interview</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.phase === 'completed') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header detail={state.detail} />
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-lg">{state.closing ?? 'This interview has ended.'}</p>
            <p className="text-sm text-muted-foreground">Answer evaluation and scores arrive in milestone M8.</p>
          </CardContent>
        </Card>
        <section aria-labelledby="answers-heading" className="space-y-3">
          <h2 id="answers-heading" className="font-semibold">
            Your answers
          </h2>
          <Transcript log={state.log} />
        </section>
        <Button asChild variant="outline">
          <Link to="/interview/new">Start another interview</Link>
        </Button>
      </div>
    );
  }

  // answering or deciding
  const { current, speech, log } = state;
  const deciding = state.phase === 'deciding';
  const draft = state.phase === 'answering' ? state.draft : (state.pending ?? '');
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <Header detail={state.detail} />
        <Button variant="outline" size="sm" onClick={() => void end()} disabled={deciding}>
          End interview
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Question {current.questionNumber} of {current.totalQuestions}
            {current.kind === 'follow_up' && ' · follow-up'}
          </p>
          {speech && <p className="text-sm text-muted-foreground">{speech}</p>}
          <p className="text-lg leading-relaxed" aria-live="polite">
            {current.text}
          </p>
        </CardContent>
      </Card>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void respond('answer', current.id, draft);
        }}
      >
        <label htmlFor="answer" className="text-sm font-medium">
          Your answer
        </label>
        <textarea
          id="answer"
          rows={8}
          autoFocus
          className={fieldClass}
          value={draft}
          disabled={deciding}
          onChange={(e) => dispatch({ type: 'draft', text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void respond('answer', current.id, draft);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={deciding}>
            Submit answer
          </Button>
          <Button type="button" variant="ghost" disabled={deciding} onClick={() => void respond('skip', current.id)}>
            Skip question
          </Button>
          <span className="text-xs text-muted-foreground">{words} words · Ctrl+Enter to submit</span>
        </div>
        <div role="status" aria-live="polite" className="text-sm">
          {deciding && <p className="text-muted-foreground">The interviewer is thinking… {elapsed} s</p>}
          {state.phase === 'answering' && state.error && <p className="text-destructive">{state.error}</p>}
        </div>
      </form>

      <section aria-labelledby="transcript-heading" className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <h2 id="transcript-heading" className="font-semibold">
            Transcript
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setShowTranscript((v) => !v)} aria-expanded={showTranscript}>
            {showTranscript ? 'Hide' : 'Show'}
          </Button>
        </div>
        {showTranscript && <Transcript log={log} />}
      </section>
    </div>
  );
}
