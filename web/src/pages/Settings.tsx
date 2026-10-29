import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { type Health, healthSchema } from '@shared/schemas/health';
import { DataCard } from '@/components/settings/DataCard';
import { ModelTestButton } from '@/components/settings/ModelTestButton';
import { PreferencesCard } from '@/components/settings/PreferencesCard';
import { VoiceCard } from '@/components/settings/VoiceCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJson } from '@/lib/api';

const POLL_MS = 10_000;

function Hint({ text }: { text?: string }) {
  if (!text) return null;
  const [label, command] = text.split(': ');
  return (
    <p className="text-sm text-muted-foreground">
      {label}: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{command}</code>
    </p>
  );
}

type HealthState = { health?: Health; error?: string };

async function fetchHealth(): Promise<HealthState> {
  try {
    return { health: await getJson('/api/health', healthSchema) };
  } catch {
    return { error: 'The app server is not responding. Is make dev still running?' };
  }
}

export function Settings() {
  const [{ health, error }, setState] = useState<HealthState>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = () => fetchHealth().then((s) => active && setState(s));
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setState(await fetchHealth());
    setLoading(false);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Status of the local components. Everything runs on this computer.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden />
          Refresh
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {health && (
        <div className="grid gap-4" aria-live="polite">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Language model (Ollama) <StatusBadge status={health.ollama.status} />
              </CardTitle>
              <CardDescription>{health.ollama.detail}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-3 text-sm">
                {health.ollama.models.map((m) => (
                  <li key={m.name} className="space-y-1">
                    <div className="flex justify-between">
                      <span className="font-mono">{m.name}</span>
                      <span className={m.installed ? 'text-muted-foreground' : 'text-destructive'}>
                        {m.installed ? 'installed' : 'missing'}
                      </span>
                    </div>
                    {m.installed && <ModelTestButton model={m.name} />}
                  </li>
                ))}
              </ul>
              <Hint text={health.ollama.hint} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Text-to-speech (Piper) <StatusBadge status={health.tts.status} />
              </CardTitle>
              <CardDescription>{health.tts.detail}</CardDescription>
            </CardHeader>
            {health.tts.hint && (
              <CardContent>
                <Hint text={health.tts.hint} />
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Memory <StatusBadge status={health.memory.low ? 'degraded' : 'ok'} />
              </CardTitle>
              <CardDescription>
                {health.memory.availableGb} GB available of {health.memory.totalGb} GB
              </CardDescription>
            </CardHeader>
            {health.memory.low && (
              <CardContent className="text-sm text-muted-foreground">
                Below 6 GB. Close browser tabs or stop other Docker projects before an interview.
              </CardContent>
            )}
          </Card>

          <p className="text-xs text-muted-foreground">App version {health.app.version}</p>
        </div>
      )}

      <PreferencesCard availableModels={health?.ollama.available ?? []} />
      <VoiceCard />
      <DataCard />
    </div>
  );
}
