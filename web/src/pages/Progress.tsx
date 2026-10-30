import { Link } from 'react-router';
import type { DeliveryPoint } from '@shared/schemas/history';
import { LineChart } from '@/components/charts/LineChart';
import { SkillCoverage } from '@/components/charts/SkillCoverage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { chartLabels, useDashboard } from '@/lib/dashboard';

const CHARTS: {
  key: keyof Pick<DeliveryPoint, 'wordsPerMinute' | 'fillerWordsPerAnswer' | 'longPausesPerAnswer'>;
  title: string;
  description: string;
  unit: string;
  band?: [number, number];
}[] = [
  {
    key: 'wordsPerMinute',
    title: 'Speaking pace',
    description: 'Words per minute while speaking. The shaded range (120–160) is a comfortable interview pace.',
    unit: 'wpm',
    band: [120, 160],
  },
  {
    key: 'fillerWordsPerAnswer',
    title: 'Filler words',
    description: '"Um", "uh", "you know"… per answer. Approximate: the transcriber leaves many out. Lower is better.',
    unit: 'per answer',
  },
  {
    key: 'longPausesPerAnswer',
    title: 'Long pauses',
    description: 'Silences of 3 seconds or more per answer. Lower is better, but a short pause to think is fine.',
    unit: 'per answer',
  },
];

export function Progress() {
  const { data: d, error } = useDashboard();

  if (error)
    return (
      <p role="alert" className="mx-auto max-w-3xl text-sm text-destructive">
        {error}
      </p>
    );
  if (!d) return <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading…</p>;

  const points = d.delivery;
  const labels = chartLabels(points.map((p) => p.date));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Progress</h1>
        <p className="text-sm text-muted-foreground">
          How you speak, interview by interview (spoken answers of completed interviews), and which skills you have
          practised. Content scores are switched off for now.
        </p>
      </div>

      {points.length === 0 ? (
        <div className="space-y-3 rounded-lg border p-6 text-sm">
          <p>
            No spoken interviews yet. Finish an interview answering by voice, and your pace, filler words and pauses
            appear here.
          </p>
          <Button asChild size="sm">
            <Link to="/interview/new">New interview</Link>
          </Button>
        </div>
      ) : (
        <>
          {points.length === 1 && (
            <p className="text-sm text-muted-foreground">One interview so far; the lines appear from the second one.</p>
          )}
          {CHARTS.map((c) => {
            const latest = points.at(-1)![c.key];
            return (
              <Card key={c.key}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {c.title}: <span className="tabular-nums">{latest}</span>{' '}
                    <span className="text-sm font-normal text-muted-foreground">{c.unit} last time</span>
                  </CardTitle>
                  <CardDescription>{c.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <LineChart
                    title={`${c.title} per interview`}
                    unit={c.unit}
                    band={c.band}
                    points={points.map((p, i) => ({ label: labels[i]!, value: p[c.key] }))}
                  />
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
      <SkillCoverage />
    </div>
  );
}
