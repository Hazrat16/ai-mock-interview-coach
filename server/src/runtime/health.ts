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

/** `wanted`: the models the app is configured to use (from settings, plus the fallback). */
export async function checkOllama(env: Env, wanted: string[]): Promise<Health['ollama']> {
  let version: string;
  try {
    version = ((await getJson(`${env.OLLAMA_URL}/api/version`, 2000)) as { version: string }).version;
  } catch {
    return {
      status: 'down',
      detail: `Not reachable at ${env.OLLAMA_URL}`,
      hint: 'Start it with: make deps-up',
      models: wanted.map((name) => ({ name, installed: false })),
      available: [],
    };
  }
  const tags = (await getJson(`${env.OLLAMA_URL}/api/tags`, 5000)) as { models: { name: string }[] };
  const available = tags.models.map((m) => m.name).sort();
  const models = wanted.map((name) => ({ name, installed: available.includes(name) }));
  const missing = models.filter((m) => !m.installed).map((m) => m.name);
  return missing.length
    ? {
        status: 'degraded',
        version,
        models,
        available,
        detail: `Missing model: ${missing.join(', ')}`,
        hint: 'Download with: make models',
      }
    : { status: 'ok', version, models, available, detail: `Ollama ${version}` };
}

export async function getHealth(env: Env, version: string, wantedModels: string[]): Promise<Health> {
  // os.freemem() reports MemAvailable on Linux, which counts reclaimable cache.
  const availableGb = gb(os.freemem());
  return {
    app: { status: 'ok', version },
    ollama: await checkOllama(env, wantedModels),
    memory: { availableGb, totalGb: gb(os.totalmem()), low: availableGb < LOW_MEMORY_GB },
  };
}
