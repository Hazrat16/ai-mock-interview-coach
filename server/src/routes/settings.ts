import type { FastifyInstance } from 'fastify';
import { settingsPatchSchema } from '@shared/schemas/settings';
import { createBackup, listBackups, backupDir } from '../db/backup';
import type { Db } from '../db/connection';
import { defaultSettings, getSettings, updateSettings } from '../db/repos/settings';
import type { Env } from '../env';

export function settingsRoutes(app: FastifyInstance, env: Env, db: Db) {
  const defaults = defaultSettings(env);

  app.get('/api/settings', () => getSettings(db, defaults));

  app.put('/api/settings', (req, reply) => {
    const patch = settingsPatchSchema.safeParse(req.body);
    if (!patch.success) {
      return reply.code(400).send({ error: 'Invalid settings', issues: patch.error.issues });
    }
    updateSettings(db, patch.data);
    return getSettings(db, defaults);
  });

  app.get('/api/backups', () => ({ dir: backupDir(env.DATA_DIR), backups: listBackups(env.DATA_DIR) }));

  app.post('/api/backups', async (_req, reply) => {
    const path = await createBackup(db, env.DATA_DIR);
    return reply.code(201).send({ path });
  });
}
