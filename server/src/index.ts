import { readFileSync } from 'node:fs';
import { buildApp } from './app';
import { openDb } from './db/connection';
import { migrate } from './db/migrate';
import { loadEnv } from './env';

const env = loadEnv();
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const db = openDb(env.DATA_DIR);
const migration = await migrate(db, { dataDir: env.DATA_DIR });
if (migration.to !== migration.from) {
  console.log(`Database schema upgraded v${migration.from} → v${migration.to}`);
  if (migration.backup) console.log(`  backup taken first: ${migration.backup}`);
}

const app = await buildApp(env, db, version);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
console.log(`Database: ${env.DATA_DIR}/coach.db`);
console.log(
  env.NODE_ENV === 'production'
    ? `Interview Coach: http://${env.HOST}:${env.PORT}`
    : `API on http://${env.HOST}:${env.PORT}; open the UI at http://127.0.0.1:5173`,
);
