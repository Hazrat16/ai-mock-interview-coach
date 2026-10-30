import { CircleCheck, Keyboard, Loader2, Mic, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { type SessionReport, sessionReportSchema } from '@shared/schemas/evaluation';
import type { InterviewConfig } from '@shared/schemas/interview';
import { ProvenanceBadge } from '@/components/ProvenanceBadge';
import { EvaluationView, scoreClass, SHOW_SCORES } from '@/components/report/EvaluationView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';
import { INTERVIEW_TYPE_LABELS, LEVEL_LABELS } from '@/lib/labels';

const POLL_MS = 3000;

function DeliveryPanel({ d }: { d: NonNullable<SessionReport['delivery']> }) {
  const pace =
    d.wordsPerMinute < 110 ? 'on the slow side' : d.wordsPerMinute > 170 ? 'on the fast side' : 'a comfortable pace';
  return (
    <Card>
      <CardHeader>
        <CardTitle>How you spoke</CardTitle>
        <CardDescription>
          From your {d.answers} spoken answer{d.answers === 1 ? '' : 's'}. Coaching hints only
          {SHOW_SCORES ? '; not part of the scores' : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{d.wordsPerMinute}</div>
          <div className="text-muted-foreground">words per minute, {pace} (interviews: about 120–160)</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{d.longPauses}</div>
          <div className="text-muted-foreground">pauses of 3 s or more</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{d.fillerWords}</div>
          <div className="text-muted-foreground">filler words (approximate: the transcriber drops many)</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{(d.responseLatencyMs / 1000).toFixed(1)} s</div>
          <div className="text-muted-foreground">average time before you started (includes thinking time)</div>
        </div>
      </CardContent>
    </Card>
  );
}

type ThreadAnswer = SessionReport['items'][number]['thread'][number]['answer'];

/** One answer as it was given: spoken or typed, or a note when skipped or deleted. */
function AnswerText({ answer }: { answer: ThreadAnswer }) {
  if (!answer) return <p className="text-sm italic text-muted-foreground">Skipped</p>;
  return (
    <p className="flex gap-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
      {answer.inputMethod === 'voice' ? (
        <Mic className="mt-1 size-3.5 shrink-0" aria-label="Spoken" />
      ) : (
        <Keyboard className="mt-1 size-3.5 shrink-0" aria-label="Typed" />
      )}
      {answer.transcript ? <span>{answer.transcript}</span> : <span className="italic">Transcript deleted.</span>}
    </p>
  );
}

export function Report() {
  const { id = '' } = useParams();
  const [report, setReport] = useState<SessionReport>();
  const [error, setError] = useState<string>();

  const load = useCallback(
    () =>
      getJson(`/api/sessions/${id}/report`, sessionReportSchema)
        .then((r) => {
          setReport(r);
          setError(undefined);
        })
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  // Poll while evaluations are queued or running.
  const busy = !report || report.progress.pending > 0;
  useEffect(() => {
    let active = true;
    const tick = () => active && void load();
    tick();
    if (!busy) return;
    const t = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [load, busy]);

  const navigate = useNavigate();
  const remove = async () => {
    if (!window.confirm('Delete this interview, your answers and its interview-ready answers? This cannot be undone.'))
      return;
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (res.ok) void navigate('/history', { replace: true });
    else setError(`Could not delete the interview (HTTP ${res.status}).`);
  };

  const act = async (path: string) => {
    try {
      await sendJson('POST', path, {}, z.unknown());
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!report) {
    return error ? (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }

  const c = report.config;
  const { done, pending, failed, total } = report.progress;
  const notEvaluated = report.items.some((i) => i.thread[0]?.answer && !i.evaluation);
  // Once everything is ready, the status is one line in the header instead of its own card.
  const allReady = pending === 0 && failed === 0 && !(notEvaluated && report.status === 'completed') && !SHOW_SCORES;
  const readyLine = `${done} of ${total} question${total === 1 ? '' : 's'} ready${failed ? `, ${failed} failed` : ''}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {INTERVIEW_TYPE_LABELS[c.interviewType as InterviewConfig['interviewType']] ?? c.interviewType} interview
          </h1>
          <p className="text-sm text-muted-foreground">
            {c.jobTitle} · {LEVEL_LABELS[c.level as InterviewConfig['level']] ?? c.level}
            {report.endedAt &&
              ` · ${new Date(report.endedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
            {allReady && (
              <span
                role="status"
                className="ml-1 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"
              >
                · <CircleCheck className="size-3.5" aria-hidden /> {readyLine}.
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void remove()}>
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button asChild size="sm">
            <Link to="/interview/new">New interview</Link>
          </Button>
        </div>
      </div>

      {!allReady && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 pt-6">
            {SHOW_SCORES && (
              <div>
                <div
                  className={`text-4xl font-semibold tabular-nums ${report.average === null ? 'text-muted-foreground' : scoreClass(report.average)}`}
                >
                  {report.average ?? '–'}
                </div>
                <div className="text-sm text-muted-foreground">average score</div>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
              {pending > 0 && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
              {pending > 0
                ? `Preparing interview-ready answers: ${done} of ${total} done. The local model takes ${SHOW_SCORES ? '2–4 minutes' : 'under a minute'} per question; you can leave this page.`
                : `${readyLine}.`}
            </div>
            {notEvaluated && report.status === 'completed' && (
              <Button onClick={() => void act(`/api/sessions/${id}/evaluate`)}>Prepare interview-ready answers</Button>
            )}
          </CardContent>
        </Card>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {SHOW_SCORES && (
        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          These are practice scores from a small AI model running on this computer. They can be wrong, and they are not
          a prediction of how a real interviewer would judge you. Use them to find what to practice next.
        </p>
      )}

      {report.delivery && <DeliveryPanel d={report.delivery} />}

      {report.items.map((item) => {
        const [main, ...followUps] = item.thread;
        return (
          <Card key={item.questionNumber}>
            <CardHeader className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Question {item.questionNumber} of {main?.totalQuestions ?? report.items.length}
              </p>
              <CardTitle className="text-base leading-snug">{main?.text}</CardTitle>
              {main?.provenance && <ProvenanceBadge provenance={main.provenance} />}
            </CardHeader>
            <CardContent className="space-y-5">
              <section className="space-y-3 rounded-lg bg-muted/40 p-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your answer</h3>
                {main && <AnswerText answer={main.answer} />}
                {followUps.map((t) => (
                  <div key={t.id} className="space-y-1.5 border-l-2 pl-3">
                    <p className="text-sm font-medium">
                      <span className="text-muted-foreground">Follow-up: </span>
                      {t.text}
                    </p>
                    <AnswerText answer={t.answer} />
                  </div>
                ))}
              </section>

              {item.evaluation ? (
                <EvaluationView
                  evaluation={item.evaluation}
                  onRetry={() => void act(`/api/evaluations/${item.evaluation!.id}/retry`)}
                />
              ) : (
                !main?.answer && <p className="text-sm text-muted-foreground">Not answered.</p>
              )}

              {item.keyPoints.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Key points to mention</h4>
                  <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    {item.keyPoints.map((p, i) => (
                      <li key={i} className="flex gap-2">
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
