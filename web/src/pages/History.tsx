import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { type HistoryItem, historyItemSchema } from '@shared/schemas/history';
import { INTERVIEW_TYPES, LEVELS } from '@shared/schemas/interview';
import { InterviewList } from '@/components/history/InterviewList';
import { Button } from '@/components/ui/button';
import { getJson } from '@/lib/api';
import { INTERVIEW_TYPE_LABELS, LEVEL_LABELS } from '@/lib/labels';
import { fieldClass } from '@/lib/styles';

const FILTERS = ['q', 'type', 'level', 'from', 'to'] as const;
const SEARCH_DELAY_MS = 300;

export function History() {
  // Filters live in the address, so Back from a report returns to the same results.
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [items, setItems] = useState<HistoryItem[]>();
  const [error, setError] = useState<string>();
  const query = params.toString();

  const set = (key: (typeof FILTERS)[number], value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  // Search as you type, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => set('q', text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set only changes the address
  }, [text]);

  useEffect(() => {
    let active = true;
    getJson(`/api/history${query ? `?${query}` : ''}`, z.array(historyItemSchema))
      .then((list) => {
        if (!active) return;
        setItems(list);
        setError(undefined);
      })
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [query]);

  const filtered = FILTERS.some((f) => params.get(f));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">History</h1>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="Search questions and answers"
            placeholder="Search questions and your answers, e.g. index or race condition"
            className={`${fieldClass} pl-9`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <select
            aria-label="Interview type"
            className={fieldClass}
            value={params.get('type') ?? ''}
            onChange={(e) => set('type', e.target.value)}
          >
            <option value="">All types</option>
            {INTERVIEW_TYPES.map((t) => (
              <option key={t} value={t}>
                {INTERVIEW_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            aria-label="Level"
            className={fieldClass}
            value={params.get('level') ?? ''}
            onChange={(e) => set('level', e.target.value)}
          >
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="From date"
            className={fieldClass}
            value={params.get('from') ?? ''}
            onChange={(e) => set('from', e.target.value)}
          />
          <input
            type="date"
            aria-label="To date"
            className={fieldClass}
            value={params.get('to') ?? ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {items && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {items.length === 0
            ? ''
            : `${items.length} interview${items.length === 1 ? '' : 's'}${filtered ? ' found' : ''}`}
        </p>
      )}
      {items?.length === 0 &&
        (filtered ? (
          <div className="space-y-3 rounded-lg border p-6 text-sm">
            <p>No interviews match. Search finds whole words and word starts in questions and in your answers.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setText('');
                setParams({}, { replace: true });
              }}
            >
              Clear search and filters
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border p-6 text-sm">
            <p>No interviews yet. Finished and unfinished interviews will be listed here.</p>
            <Button asChild size="sm">
              <Link to="/interview/new">Start your first interview</Link>
            </Button>
          </div>
        ))}
      {items && items.length > 0 && <InterviewList items={items} />}
    </div>
  );
}
