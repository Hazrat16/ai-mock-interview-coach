import { Link } from 'react-router';
import { type HistoryItem, MATCH_END, MATCH_START } from '@shared/schemas/history';
import { Badge } from '@/components/ui/badge';
import { INTERVIEW_TYPE_LABELS, LEVEL_LABELS } from '@/lib/labels';

const STATUS = {
  completed: null,
  in_progress: { label: 'Unfinished', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  paused: { label: 'Unfinished', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  abandoned: { label: 'Ended early', className: '' },
  planned: { label: 'Not started', className: '' },
} as const;

/** Where an interview opens: the report once it is over, the interview itself while it is unfinished. */
export const interviewLink = (i: Pick<HistoryItem, 'id' | 'status'>) =>
  i.status === 'in_progress' || i.status === 'paused' ? `/interview/${i.id}` : `/interview/${i.id}/report`;

/** A search snippet with the matched words highlighted. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${MATCH_START}[^${MATCH_END}]*${MATCH_END})`));
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith(MATCH_START) ? (
          <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function InterviewList({ items }: { items: HistoryItem[] }) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((i) => {
        const status = STATUS[i.status];
        return (
          <li key={i.id}>
            <Link to={interviewLink(i)} className="block space-y-2 p-4 hover:bg-muted/50">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">
                  {INTERVIEW_TYPE_LABELS[i.interviewType]} · {i.jobTitle}
                </span>
                {status && (
                  <Badge variant="secondary" className={status.className}>
                    {status.label}
                  </Badge>
                )}
                <time dateTime={i.createdAt} className="ml-auto text-sm text-muted-foreground tabular-nums">
                  {new Date(i.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </div>
              {i.firstQuestion && !i.matches.length && (
                <p className="truncate text-sm" title={i.firstQuestion}>
                  {i.firstQuestion}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {LEVEL_LABELS[i.level]} · {i.answered} of {i.totalQuestions} question
                {i.totalQuestions === 1 ? '' : 's'} answered
              </p>
              {i.matches.map((m, n) => (
                <div key={n} className="border-l-2 pl-3 text-sm">
                  <p className="font-medium">
                    <Snippet text={m.questionText} />
                  </p>
                  <p className="text-muted-foreground">
                    <Snippet text={m.snippet} />
                  </p>
                </div>
              ))}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
