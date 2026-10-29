import type { z } from 'zod';

/** GET a JSON API path and validate the response against a shared schema. */
export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request to ${path} failed (HTTP ${res.status})`);
  return schema.parse(await res.json());
}
