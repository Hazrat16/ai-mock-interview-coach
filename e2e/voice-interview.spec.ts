// A full spoken interview in Chrome with a fake microphone, against the real Ollama, Piper and Whisper.
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { wordErrorRate } from '../shared/text/wer';
import { ANSWER } from './global-setup';

type TurnTiming = { totalMs: number; transcribeMs: number; decideMs: number; speakMs: number };

test('spoken interview: questions are read aloud, answers are heard, transcribed and submitted', async ({ page }) => {
  // Every request the page makes must stay on this computer.
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await page.goto('/interview/new');
  await page.getByLabel('Interview type').selectOption('behavioral');
  await page.getByLabel('Number of questions').fill('2');
  await page.getByLabel('Follow-ups per question').selectOption('1');
  await page.getByLabel('Thinking time (seconds)').fill('3');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Enable microphone and start' }).click();
  await expect(page.getByText('Interviewer speaking')).toBeVisible({ timeout: 30_000 });
  // The microphone is closed while the interviewer speaks (laptop speakers, D3).
  await expect(page.getByText('Recording', { exact: true })).toBeHidden();
  // The mic is open only after the interviewer finished: recording indicator during thinking/listening.
  await expect(page.getByText('Recording', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Heard so far:/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Finishing your answer in/)).toBeVisible({ timeout: 60_000 });

  await expect(page.getByText(/end of the interview/i)).toBeVisible({ timeout: 5 * 60_000 });

  const detail = (await (await page.request.get(`/api/sessions/${sessionId}`)).json()) as {
    status: string;
    turns: { kind: string; answer: { transcript: string } | null }[];
  };
  expect(detail.status).toBe('completed');
  const answers = detail.turns.map((t) => t.answer?.transcript ?? '');
  expect(answers.length).toBeGreaterThanOrEqual(2);
  for (const a of answers) expect(wordErrorRate(ANSWER, a).wer).toBeLessThan(0.15);

  const turns = (await page.evaluate(() => (window as unknown as { __coachTurns: TurnTiming[] }).__coachTurns)) ?? [];
  writeFileSync(
    'test-results/voice-interview.json',
    JSON.stringify(
      {
        turns,
        answers: answers.map((a) => ({ wer: wordErrorRate(ANSWER, a).wer, transcript: a })),
        kinds: detail.turns.map((t) => t.kind),
        hosts: [...hosts],
        console: logs.filter((l) => /\[(turn|tts|vad)\]/.test(l)),
      },
      null,
      2,
    ),
  );
  // The report opens by itself after the closing. Key points come from the bank right away; the
  // interview-ready answers are written in the background (qwen, under a minute per question; scoring is off).
  await page.waitForURL(/\/report$/, { timeout: 60_000 });
  await expect(page.getByText('How you spoke')).toBeVisible();
  await expect(page.getByText('Key points to mention').first()).toBeVisible();
  await expect(page.getByText('average score')).toBeHidden(); // scores are hidden for now (SHOW_SCORES)
  const evalStart = Date.now();
  await expect(page.getByText(/2 of 2 questions ready/)).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.getByText('Interview-ready answer')).toHaveCount(2);
  const evalSeconds = Math.round((Date.now() - evalStart) / 1000);
  const report = (await (await page.request.get(`/api/sessions/${sessionId}/report`)).json()) as {
    average: number | null;
    items: { evaluation: { status: string; overallScore: number | null; model: string; durationMs: number } }[];
  };
  writeFileSync(
    'test-results/voice-interview-report.json',
    JSON.stringify(
      { evalSeconds, average: report.average, evaluations: report.items.map((i) => i.evaluation) },
      null,
      2,
    ),
  );
  for (const i of report.items) expect(i.evaluation).toMatchObject({ status: 'done', overallScore: null });
  expect(report.average).toBeNull();

  expect(turns.length).toBeGreaterThanOrEqual(2); // each answer → the next question or the closing
  // A vague answer gets a follow-up from the interviewer (granite asks one for answers like this).
  expect(detail.turns.map((t) => t.kind)).toContain('follow_up');
  expect([...hosts]).toEqual(['127.0.0.1']);

  // R15: the audio of the answers is never written to disk. Only the interviewer's synthesized phrases are
  // cached (tts-cache); speech-check recordings exist only after recording one in Settings.
  const { dir } = (await (await page.request.get('/api/backups')).json()) as { dir: string };
  const dataDir = dirname(dir);
  const audio = (readdirSync(dataDir, { recursive: true }) as string[]).filter(
    (f) => /\.(wav|webm|ogg|mp3|flac|opus|m4a)$/i.test(f) && !f.startsWith('tts-cache'),
  );
  expect(audio, `audio files in ${dataDir}`).toEqual([]);
  expect(readdirSync(join(dataDir, 'tts-cache')).length).toBeGreaterThan(0); // the check looks in the right place
  await page.request.delete(`/api/sessions/${sessionId}`);
});
