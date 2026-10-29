import os from 'node:os';
import type { Health } from '@shared/schemas/health';
import type { Env } from '../env';
import type { WhisperClient } from '../speech/sttClient';
import type { PiperClient } from '../speech/ttsClient';

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

/** Piper is up and has the selected voice on disk. */
export async function checkTts(piper: PiperClient, voice: string): Promise<Health['tts']> {
  let installed: string[];
  try {
    installed = await piper.installedVoices();
  } catch {
    return { status: 'down', voice, detail: 'Piper is not running', hint: 'Start it with: make deps-up' };
  }
  return installed.includes(voice)
    ? { status: 'ok', voice, detail: `Piper, voice ${voice}` }
    : { status: 'degraded', voice, detail: `Voice ${voice} is not downloaded`, hint: 'Download with: make voices' };
}

export async function checkStt(whisper: WhisperClient, model: string): Promise<Health['stt']> {
  return (await whisper.healthy())
    ? { status: 'ok', model, detail: `whisper.cpp, model ${model}` }
    : {
        status: 'down',
        model,
        detail: 'Whisper is not running',
        hint: 'Start it with: make deps-up (if it keeps stopping, download the model: make stt-models)',
      };
}

export async function getHealth(
  env: Env,
  version: string,
  wantedModels: string[],
  tts: () => Promise<Health['tts']>,
  stt: () => Promise<Health['stt']>,
): Promise<Health> {
  // os.freemem() reports MemAvailable on Linux, which counts reclaimable cache.
  const availableGb = gb(os.freemem());
  return {
    app: { status: 'ok', version },
    ollama: await checkOllama(env, wantedModels),
    tts: await tts(),
    stt: await stt(),
    memory: { availableGb, totalGb: gb(os.totalmem()), low: availableGb < LOW_MEMORY_GB },
  };
}
