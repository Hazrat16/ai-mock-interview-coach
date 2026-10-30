import { Keyboard, Mic } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { type SessionReport, sessionReportSchema } from '@shared/schemas/evaluation';
import type { InterviewConfig } from '@shared/schemas/interview';
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
          From your {d.answers} spoken answer{d.answers === 1 ? '' : 's'}. Coaching hints only; not part of the scores.
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Report · {INTERVIEW_TYPE_LABELS[c.interviewType as InterviewConfig['interviewType']] ?? c.interviewType}{' '}
            interview
          </h1>
          <p className="text-sm text-muted-foreground">
            {c.jobTitle} · {LEVEL_LABELS[c.level as InterviewConfig['level']] ?? c.level}
            {report.endedAt && ` · ${new Date(report.endedAt).toLocaleString()}`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/interview/new">New interview</Link>
        </Button>
      </div>

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
          <div className="text-sm" role="status" aria-live="polite">
            {pending > 0
              ? `Preparing interview-ready answers: ${done} of ${total} done. The local model takes ${SHOW_SCORES ? '2–4 minutes' : 'under a minute'} per question; you can leave this page.`
              : `${done} of ${total} question${total === 1 ? '' : 's'} ready${failed ? `, ${failed} failed` : ''}.`}
          </div>
          {notEvaluated && report.status === 'completed' && (
            <Button onClick={() => void act(`/api/sessions/${id}/evaluate`)}>Prepare interview-ready answers</Button>
          )}
        </CardContent>
      </Card>
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

      {report.items.map((item) => (
        <Card key={item.questionNumber}>
          <CardHeader>
            <CardTitle className="text-base">Question {item.questionNumber}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="space-y-3">
              {item.thread.map((t) => (
                <li key={t.id} className="space-y-1 text-sm">
                  <p className="font-medium">
                    {t.kind === 'follow_up' && <span className="text-muted-foreground">Follow-up: </span>}
                    {t.text}
                  </p>
                  {t.answer ? (
                    <p className="flex gap-2 whitespace-pre-wrap text-muted-foreground">
                      {t.answer.inputMethod === 'voice' ? (
                        <Mic className="mt-0.5 size-3.5 shrink-0" aria-label="Spoken" />
                      ) : (
                        <Keyboard className="mt-0.5 size-3.5 shrink-0" aria-label="Typed" />
                      )}
                      <span>{t.answer.transcript}</span>
                    </p>
                  ) : (
                    <p className="italic text-muted-foreground">Skipped</p>
                  )}
                </li>
              ))}
            </ol>
            {item.evaluation ? (
              <div className="border-t pt-4">
                <EvaluationView
                  evaluation={item.evaluation}
                  onRetry={() => void act(`/api/evaluations/${item.evaluation!.id}/retry`)}
                />
              </div>
            ) : (
              !item.thread[0]?.answer && <p className="text-sm text-muted-foreground">Not answered.</p>
            )}
            {item.keyPoints.length > 0 && (
              <div className="space-y-1 border-t pt-4">
                <h4 className="text-sm font-medium">Key points to mention</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {item.keyPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
