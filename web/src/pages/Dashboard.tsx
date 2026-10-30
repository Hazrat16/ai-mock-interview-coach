import { Link } from 'react-router';
import { interviewLink, InterviewList } from '@/components/history/InterviewList';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { topicLabel, useDashboard } from '@/lib/dashboard';
import { INTERVIEW_TYPE_LABELS } from '@/lib/labels';

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function practiceTime(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Horizontal bars: label, bar, count. */
function Bars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[10rem_1fr_2rem] items-center gap-3">
          <span className="truncate">{r.label}</span>
          <span className="h-2 rounded-full bg-muted">
            <span className="block h-2 rounded-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const { data: d, error } = useDashboard();

  if (error)
    return (
      <p role="alert" className="mx-auto max-w-3xl text-sm text-destructive">
        {error}
      </p>
    );
  if (!d) return <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading…</p>;

  const unfinished = d.recent.find((r) => r.status === 'in_progress' || r.status === 'paused');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Button asChild>
          <Link to="/interview/new">New interview</Link>
        </Button>
      </div>

      {d.interviews.total === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>
              Practise a spoken interview with a local AI interviewer. Afterwards you get an interview-ready answer and
              the key points to mention for every question. Everything stays on this computer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/interview/new">Start your first interview</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {unfinished && (
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/50 p-4 text-sm">
              <span>
                You have an unfinished {INTERVIEW_TYPE_LABELS[unfinished.interviewType].toLowerCase()} interview (
                {unfinished.answered} of {unfinished.totalQuestions} answered).
              </span>
              <Button asChild variant="outline" size="sm">
                <Link to={interviewLink(unfinished)}>Resume</Link>
              </Button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              value={d.interviews.completed}
              label={`interview${d.interviews.completed === 1 ? '' : 's'} completed`}
            />
            <Stat value={d.questionsAnswered} label={`question${d.questionsAnswered === 1 ? '' : 's'} answered`} />
            <Stat value={practiceTime(d.practiceMinutes)} label="practice time" />
          </div>
          {d.lastPracticedAt && (
            <p className="text-sm text-muted-foreground">
              Last practice:{' '}
              {new Date(d.lastPracticedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}.{' '}
              <Link to="/progress" className="underline underline-offset-4">
                See how your speaking changes
              </Link>
              .
            </p>
          )}

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Recent interviews</h2>
              <Link to="/history" className="text-sm underline underline-offset-4">
                All interviews
              </Link>
            </div>
            <InterviewList items={d.recent} />
          </section>

          <div className="grid items-start gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Interview types</CardTitle>
                <CardDescription>Completed interviews per type.</CardDescription>
              </CardHeader>
              <CardContent>
                {d.byType.length ? (
                  <Bars
                    rows={d.byType.map((t) => ({ label: INTERVIEW_TYPE_LABELS[t.interviewType], count: t.count }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">None completed yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Topics practised</CardTitle>
                <CardDescription>Questions answered per topic.</CardDescription>
              </CardHeader>
              <CardContent>
                {d.topics.length ? (
                  <Bars rows={d.topics.map((t) => ({ label: topicLabel(t.tag), count: t.count }))} />
                ) : (
                  <p className="text-sm text-muted-foreground">No bank questions answered yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
