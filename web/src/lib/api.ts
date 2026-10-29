import type { z } from 'zod';

async function parse<T>(res: Response, path: string, schema: z.ZodType<T>): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request to ${path} failed (HTTP ${res.status})`);
  }
  return schema.parse(await res.json());
}

/** GET a JSON API path and validate the response against a shared schema. */
export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return parse(await fetch(path), path, schema);
}

/** Send JSON (POST/PUT) and validate the response. */
export async function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown, schema: z.ZodType<T>) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return parse(res, path, schema);
}

/** POST a recorded WAV (raw body) and validate the JSON response. */
export async function postWav<T>(path: string, wav: Blob, schema: z.ZodType<T>): Promise<T> {
  return parse(
    await fetch(path, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav }),
    path,
    schema,
  );
}

export async function deleteJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return parse(await fetch(path, { method: 'DELETE' }), path, schema);
}
