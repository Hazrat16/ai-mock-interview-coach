import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { type BackupList, backupListSchema } from '@shared/schemas/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson, sendJson } from '@/lib/api';

const SHOWN = 5;
const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function DataCard() {
  const [list, setList] = useState<BackupList>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  useEffect(() => {
    let active = true;
    getJson('/api/backups', backupListSchema)
      .then((l) => active && setList(l))
      .catch((e: Error) => active && setMessage({ kind: 'error', text: e.message }));
    return () => {
      active = false;
    };
  }, []);

  const backUp = useCallback(async () => {
    setBusy(true);
    try {
      const { path } = await sendJson('POST', '/api/backups', {}, z.object({ path: z.string() }));
      setList(await getJson('/api/backups', backupListSchema));
      setMessage({ kind: 'ok', text: `Saved ${path.split('/').at(-1)}` });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>
          Everything is stored on this computer. Backups contain all your data, including transcripts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {list && (
          <p className="text-muted-foreground">
            Backups folder: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{list.dir}</code>
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void backUp()} disabled={busy}>
            {busy ? 'Backing up…' : 'Back up now'}
          </Button>
          {message && (
            <span role="status" className={message.kind === 'ok' ? 'text-muted-foreground' : 'text-destructive'}>
              {message.text}
            </span>
          )}
        </div>
        {list && list.backups.length > 0 && (
          <ul className="divide-y rounded-md border">
            {list.backups.slice(0, SHOWN).map((b) => (
              <li key={b.name} className="flex justify-between gap-4 px-3 py-2">
                <span className="truncate font-mono">{b.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(b.createdAt).toLocaleString()} · {sizeLabel(b.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {list && list.backups.length > SHOWN && (
          <p className="text-xs text-muted-foreground">
            Showing the newest {SHOWN} of {list.backups.length}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
