import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path('.'), '');
  return {
    root: 'web',
    envDir: path('.'),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path('./web/src'), '@shared': path('./shared') } },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // /vad: speech-detection files, served by the app server (Vite refuses module imports from public/).
      proxy: { '/api': `http://127.0.0.1:${env.PORT ?? 4317}`, '/vad': `http://127.0.0.1:${env.PORT ?? 4317}` },
    },
    build: { outDir: path('./dist/web'), emptyOutDir: true },
  };
});
