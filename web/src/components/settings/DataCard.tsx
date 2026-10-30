import { Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  DELETE_WORD,
  type DataSummary,
  dataSummarySchema,
  deleteResultSchema,
  RESTORE_WORD,
  restoreResultSchema,
} from '@shared/schemas/data';
import { type BackupList, backupListSchema } from '@shared/schemas/settings';
import { ConfirmAction } from '@/components/settings/ConfirmAction';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';

const SHOWN = 5;
const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DataCard() {
  const [list, setList] = useState<BackupList>();
  const [summary, setSummary] = useState<DataSummary>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const load = () =>
    Promise.all([getJson('/api/backups', backupListSchema), getJson('/api/data/summary', dataSummarySchema)]);
  const refresh = useCallback(async () => {
    const [l, s] = await load();
    setList(l);
    setSummary(s);
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .then(([l, s]) => {
        if (!active) return;
        setList(l);
        setSummary(s);
      })
      .catch((e: Error) => active && setMessage({ kind: 'error', text: e.message }));
    return () => {
      active = false;
    };
  }, []);

  /** Runs an action, then shows its message and fresh numbers; errors are shown instead. */
  const run = useCallback(
    async (action: () => Promise<string>) => {
      setMessage(undefined);
      try {
        const text = await action();
        await refresh();
        setMessage({ kind: 'ok', text });
      } catch (e) {
        setMessage({ kind: 'error', text: (e as Error).message });
      }
    },
    [refresh],
  );

  const backUp = async () => {
    setBusy(true);
    await run(async () => {
      const { path } = await sendJson('POST', '/api/backups', {}, z.object({ path: z.string() }));
      return `Saved ${path.split('/').at(-1)}`;
    });
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data &amp; privacy</CardTitle>
        <CardDescription>
          Everything is stored on this computer and nothing is sent anywhere. Your answers are kept as text; the audio
          of your answers is never saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {summary && (
          <p>
            Stored now: {plural(summary.interviews, 'interview')}, {plural(summary.answers, 'answer')} (as text),{' '}
            {plural(summary.evaluations, 'interview-ready answer')}
            {summary.voiceSamples > 0 && `, ${plural(summary.voiceSamples, 'speech-check recording')}`}.
          </p>
        )}
        {message && (
          <p role="status" className={message.kind === 'ok' ? 'text-muted-foreground' : 'text-destructive'}>
            {message.text}
          </p>
        )}

        <section className="space-y-2">
          <h3 className="font-medium">Export</h3>
          <p className="text-muted-foreground">
            All interviews, your answers, interview-ready answers and key points in one JSON file you can keep or read.
          </p>
          <Button asChild variant="outline">
            <a href="/api/data/export" download>
              <Download aria-hidden /> Download export
            </a>
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Backups</h3>
          <p className="text-muted-foreground">
            A backup is a copy of all data in one file. Restoring one replaces everything with that copy; your current
            data is saved as a backup first, so a restore can be undone.
          </p>
          {list && (
            <p className="text-muted-foreground">
              Backups folder:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{list.dir}</code>
            </p>
          )}
          <Button variant="outline" onClick={() => void backUp()} disabled={busy}>
            {busy ? 'Backing up…' : 'Back up now'}
          </Button>
          {list && list.backups.length > 0 && (
            <ul className="divide-y rounded-md border">
              {list.backups.slice(0, SHOWN).map((b) => (
                <li key={b.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
                  <span className="truncate font-mono">{b.name}</span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    {new Date(b.createdAt).toLocaleString()} · {sizeLabel(b.sizeBytes)}
                    <ConfirmAction
                      label="Restore"
                      busyLabel="Restoring…"
                      size="sm"
                      word={RESTORE_WORD}
                      warning={
                        <>
                          All current data will be replaced by <span className="font-mono">{b.name}</span>. Your current
                          data is saved as a backup first.
                        </>
                      }
                      onConfirm={() =>
                        run(async () => {
                          const r = await sendJson(
                            'POST',
                            '/api/data/restore',
                            { name: b.name, confirm: RESTORE_WORD },
                            restoreResultSchema,
                          );
                          return `Restored ${b.name} (${plural(r.interviews, 'interview')}). The data from before is in ${r.safetyBackup}.`;
                        })
                      }
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {list && list.backups.length > SHOWN && (
            <p className="text-xs text-muted-foreground">
              Showing the newest {SHOWN} of {list.backups.length}. Older ones are in the backups folder.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="font-medium">Delete</h3>
          <p className="text-muted-foreground">
            Deleting cannot be undone from here. Backups made earlier still contain the deleted data: delete those files
            in the backups folder to remove it completely. Settings and the question bank are kept.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <ConfirmAction
              label="Delete transcripts"
              busyLabel="Deleting…"
              word={DELETE_WORD}
              warning="Removes the text of every answer you gave, and the interview-ready answers written from them. The interviews and their questions stay."
              onConfirm={() =>
                run(async () => {
                  await sendJson('POST', '/api/data/delete-transcripts', { confirm: DELETE_WORD }, deleteResultSchema);
                  return 'All transcripts were deleted.';
                })
              }
            />
            <ConfirmAction
              label="Delete everything"
              busyLabel="Deleting…"
              variant="destructive"
              word={DELETE_WORD}
              warning="Removes every interview, your answers, interview-ready answers, your resumes and job descriptions, and your speech-check recordings."
              onConfirm={() =>
                run(async () => {
                  await sendJson('POST', '/api/data/delete-all', { confirm: DELETE_WORD }, deleteResultSchema);
                  return 'All interviews and recordings were deleted.';
                })
              }
            />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
