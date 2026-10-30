import { CircleAlert, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { SCORING } from '@shared/features';
import type { EvaluationView as Evaluation } from '@shared/schemas/evaluation';
import { Button } from '@/components/ui/button';

/** Scores are shown only while scoring is on (shared/features.ts). */
export const SHOW_SCORES = SCORING;

/** Colour by band: below 50 needs work, 75+ strong. Practice scores, not a hiring verdict. */
export function scoreClass(score: number) {
  if (score >= 75) return 'text-emerald-700 dark:text-emerald-400';
  if (score >= 50) return 'text-foreground';
  return 'text-amber-700 dark:text-amber-400';
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function ScoreDots({ score }: { score: number }) {
  return (
    <span className="flex gap-1" role="img" aria-label={`${score} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`size-2.5 rounded-full ${n <= score ? 'bg-primary' : 'bg-muted'}`} />
      ))}
    </span>
  );
}

export function EvaluationView({ evaluation, onRetry }: { evaluation: Evaluation; onRetry: () => void }) {
  const e = evaluation;
  if (e.status === 'pending' || e.status === 'running') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {e.status === 'running'
          ? `Writing the interview-ready answer with the local model… (usually ${SHOW_SCORES ? '2–4 minutes' : 'under a minute'})`
          : 'Waiting for the local model.'}
        {e.status === 'pending' && e.error && <span> Last attempt: {e.error}</span>}
      </p>
    );
  }
  if (e.status === 'failed' || !e.result) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">
          {SHOW_SCORES ? 'The evaluation failed' : 'Could not write the interview-ready answer'}:{' '}
          {e.error ?? 'unknown error'}
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden /> {SHOW_SCORES ? 'Retry evaluation' : 'Try again'}
        </Button>
      </div>
    );
  }
  const r = e.result;
  // Answer-only results (written while scoring was off) have no score.
  if (e.overallScore === null || !SHOW_SCORES) {
    return (
      <section className="space-y-2 rounded-lg border border-primary/15 bg-primary/[0.03] p-4">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-brand-strong" aria-hidden />
          Interview-ready answer
        </h4>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.exampleAnswer}</p>
      </section>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3">
        <span className={`text-3xl font-semibold tabular-nums ${scoreClass(e.overallScore)}`}>{e.overallScore}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        {e.unsupportedEvidence > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <CircleAlert className="size-3.5" aria-hidden />
            {e.unsupportedEvidence} quote{e.unsupportedEvidence === 1 ? '' : 's'} not found in your answer
          </span>
        )}
      </div>

      <ul className="divide-y rounded-lg border">
        {r.criteria.map((c) => (
          <li key={c.key} className="space-y-1.5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {c.name} <span className="font-normal text-muted-foreground">· {Math.round(c.weight * 100)}%</span>
              </span>
              <span className="flex items-center gap-2 text-sm">
                <ScoreDots score={c.score} /> <span className="tabular-nums">{c.score}/4</span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{c.anchor}</p>
            <p className="text-sm">{c.rationale}</p>
            {c.evidence.length > 0 && (
              <ul className="space-y-1">
                {c.evidence.map((q, i) => (
                  <li key={i} className="text-sm">
                    <q className={q.supported ? 'text-muted-foreground' : 'text-muted-foreground line-through'}>
                      {q.quote}
                    </q>
                    {!q.supported && (
                      <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">not found in your answer</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <List title="Strengths" items={r.strengths} />
        <List title="Mistakes" items={r.mistakes} />
        <List title="Missing points" items={r.missingConcepts} />
        <List title="How to improve" items={r.suggestions} />
      </div>

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">A stronger example answer</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.exampleAnswer}</p>
      </details>
      <p className="text-sm">
        <span className="font-medium">Practice exercise:</span> {r.followUpExercise}
      </p>
      <p className="text-xs text-muted-foreground">
        Rubric: {e.rubricTitle} v{e.rubricVersion} · model {e.model}
        {e.durationMs !== null && ` · ${Math.round(e.durationMs / 1000)} s`}
      </p>
    </div>
  );
}
