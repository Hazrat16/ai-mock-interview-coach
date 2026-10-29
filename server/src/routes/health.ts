import type { FastifyInstance } from 'fastify';
import type { Env } from '../env';
import { getHealth } from '../runtime/health';

export function healthRoutes(app: FastifyInstance, env: Env, version: string) {
  app.get('/api/health', () => getHealth(env, version));
}
