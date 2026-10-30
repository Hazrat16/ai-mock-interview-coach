import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type Coverage, coverageSchema } from '@shared/schemas/coverage';
import { type InterviewConfig, JOB_FAMILIES } from '@shared/schemas/interview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson } from '@/lib/api';
import { JOB_FAMILY_LABELS } from '@/lib/labels';
import { fieldClass } from '@/lib/styles';

type Family = InterviewConfig['jobFamily'];

/** The job family of your last interview setup on this browser. */
function lastFamily(): Family {
  try {
    const f = (JSON.parse(localStorage.getItem('interview-coach:last-config') ?? '{}') as { jobFamily?: string })
      .jobFamily;
    return JOB_FAMILIES.includes(f as Family) ? (f as Family) : 'software_engineering';
  } catch {
    return 'software_engineering';
  }
}

/** Which skills of a job family you have practised, and how often (counted from the questions you answered). */
export function SkillCoverage() {
  const [family, setFamily] = useState<Family>(lastFamily);
  const [data, setData] = useState<Coverage>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    getJson(`/api/coverage?family=${family}`, coverageSchema)
      .then((c) => active && setData(c))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [family]);

  const skills = data?.groups.flatMap((g) => g.skills) ?? [];
  const covered = new Set(skills.filter((s) => s.practiced > 0).map((s) => s.key)).size;
  const total = new Set(skills.map((s) => s.key)).size;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skill coverage{data && `: ${covered} of ${total} skills practised`}</CardTitle>
        <CardDescription>
          Each skill of the job family, with how many of your answered questions practised it. It shows what you have
          covered, not how well you did (scores are off).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Job family"
            className={`${fieldClass} w-auto`}
            value={family}
            onChange={(e) => setFamily(e.target.value as Family)}
          >
            {JOB_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {JOB_FAMILY_LABELS[f]}
              </option>
            ))}
          </select>
          <Button asChild size="sm">
            <Link to="/interview/new?assessment=1">Practise the skills you covered least</Link>
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {data?.groups.map((g) => (
          <section key={g.name} className="space-y-2">
            <h3 className="font-medium">{g.name}</h3>
            <ul className="flex flex-wrap gap-2">
              {g.skills.map((s) => (
                <li
                  key={s.key}
                  className={`rounded-md border px-2.5 py-1 ${
                    s.practiced > 0
                      ? 'border-primary/40 bg-primary/5'
                      : s.bankQuestions === 0
                        ? 'border-dashed text-muted-foreground'
                        : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {s.label}{' '}
                  <span
                    className={`tabular-nums ${s.practiced === 0 && s.bankQuestions > 0 ? '' : 'text-muted-foreground'}`}
                  >
                    {s.practiced > 0 ? `×${s.practiced}` : s.bankQuestions === 0 ? '· no questions yet' : '· not yet'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          “No questions yet”: the question bank has none for this skill, so an assessment cannot cover it; an interview
          based on a job description can.
        </p>
      </CardContent>
    </Card>
  );
}
