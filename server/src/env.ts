import { existsSync } from 'node:fs';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Loopback only: the app must never be reachable from the network.
  HOST: z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
  OLLAMA_URL: z.url().default('http://127.0.0.1:11435'),
  DATA_DIR: z.string().min(1),
  INTERVIEWER_MODEL: z.string().min(1).default('granite4:3b'),
  EVALUATOR_MODEL: z.string().min(1).default('qwen3.5:4b'),
  FALLBACK_MODEL: z.string().min(1).default('granite4:3b'),
  /** CPU threads for the LLM. Unset = Ollama's default. Tune with `make bench`. */
  LLM_NUM_THREAD: z.coerce.number().int().min(1).max(64).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Validates environment variables; throws one readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (check .env):\n${problems}`);
  }
  return result.data;
}

export function loadEnv(): Env {
  if (existsSync('.env')) process.loadEnvFile('.env');
  return parseEnv(process.env);
}
