import os from 'node:os';
import type { Health } from '@shared/schemas/health';
import type { Env } from '../env';

const LOW_MEMORY_GB = 6;
const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function checkOllama(env: Env): Promise<Health['ollama']> {
  const wanted = [env.INTERVIEWER_MODEL, env.FALLBACK_MODEL];
  let version: string;
  try {
    version = ((await getJson(`${env.OLLAMA_URL}/api/version`, 2000)) as { version: string }).version;
  } catch {
    return {
      status: 'down',
      detail: `Not reachable at ${env.OLLAMA_URL}`,
      hint: 'Start it with: make deps-up',
      models: wanted.map((name) => ({ name, installed: false })),
    };
  }
  const tags = (await getJson(`${env.OLLAMA_URL}/api/tags`, 5000)) as { models: { name: string }[] };
  const installed = new Set(tags.models.map((m) => m.name));
  const models = wanted.map((name) => ({ name, installed: installed.has(name) }));
  const missing = models.filter((m) => !m.installed).map((m) => m.name);
  return missing.length
    ? {
        status: 'degraded',
        version,
        models,
        detail: `Missing model: ${missing.join(', ')}`,
        hint: 'Download with: make models',
      }
    : { status: 'ok', version, models, detail: `Ollama ${version}` };
}

export async function getHealth(env: Env, version: string): Promise<Health> {
  // os.freemem() reports MemAvailable on Linux, which counts reclaimable cache.
  const availableGb = gb(os.freemem());
  return {
    app: { status: 'ok', version },
    ollama: await checkOllama(env),
    memory: { availableGb, totalGb: gb(os.totalmem()), low: availableGb < LOW_MEMORY_GB },
  };
}
