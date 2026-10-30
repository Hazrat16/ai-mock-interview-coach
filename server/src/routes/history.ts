import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { coverageQuerySchema } from '@shared/schemas/coverage';
import { historyQuerySchema } from '@shared/schemas/history';
import type { Db } from '../db/connection';
import { coverage } from '../db/repos/coverage';
import { dashboardStats, searchHistory } from '../db/repos/history';
import { HttpError } from '../errors';

export function historyRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/history', (req) => {
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, z.prettifyError(query.error));
    return searchHistory(db, query.data);
  });

  app.get('/api/dashboard', () => dashboardStats(db));

  app.get('/api/coverage', (req) => {
    const query = coverageQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, z.prettifyError(query.error));
    return coverage(db, query.data.family);
  });
}
