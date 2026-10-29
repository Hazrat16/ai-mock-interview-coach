import { readFileSync } from 'node:fs';
import { buildApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const app = await buildApp(env, version);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
console.log(
  env.NODE_ENV === 'production'
    ? `Interview Coach: http://${env.HOST}:${env.PORT}`
    : `API on http://${env.HOST}:${env.PORT}; open the UI at http://127.0.0.1:5173`,
);
