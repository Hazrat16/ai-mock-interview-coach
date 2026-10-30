// End-to-end tests in your installed Google Chrome against the real local AI services (make e2e).
// A separate app instance (production build, port 4417) uses a throw-away database, so your interviews
// are never touched. Chrome's fake microphone plays e2e/.cache/answer.wav (made by Piper in global setup).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4417;
export const FAKE_MIC_WAV = join(import.meta.dirname, 'e2e/.cache/answer.wav');

export default defineConfig({
  testDir: 'e2e',
  timeout: 12 * 60_000, // a spoken interview plus its evaluation with real models on a laptop CPU
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // %noloop: the answer plays once each time the mic opens, then silence (which ends the answer)
        `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}%noloop`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'npm run build && npx tsx server/src/index.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATA_DIR: mkdtempSync(join(tmpdir(), 'coach-e2e-')),
    },
  },
});
