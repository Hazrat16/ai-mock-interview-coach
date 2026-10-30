import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { historyQuerySchema } from '@shared/schemas/history';
import type { Db } from '../db/connection';
import { dashboardStats, searchHistory } from '../db/repos/history';
import { HttpError } from '../errors';

export function historyRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/history', (req) => {
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, z.prettifyError(query.error));
    return searchHistory(db, query.data);
  });

  app.get('/api/dashboard', () => dashboardStats(db));
}
