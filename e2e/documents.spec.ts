// A resume-based interview (M13) with the real models: upload a PDF, read the summary, start an interview from
// it, and get a question about one of its projects. About 2-3 minutes (summary ~40 s, questions ~60 s).
import { expect, test } from '@playwright/test';
import { minimalPdf } from '../server/test/helpers/minimalPdf';

const RESUME = minimalPdf([
  [
    'Sam Rivera - Junior Backend Engineer',
    'Backend Engineer Intern, Brightcart, 2025: cut checkout API p95 latency from 900 ms to 250 ms with Redis caching.',
    'Parkly - parking spot booking app (Node.js, PostgreSQL): row-level locking to prevent double bookings.',
    'LogLens - log search tool (Go, SQLite FTS5): indexed 2 GB of logs, search under 100 ms.',
    'Skills: Node.js, TypeScript, Go, PostgreSQL, Redis, Docker',
  ],
]);
const PROJECTS = /Parkly|LogLens|Brightcart/;

test('resume interview: upload a PDF, start an interview from it, get questions about its projects', async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  await page.goto('/documents');
  await page.getByLabel('Title').fill('E2E resume');
  await page
    .getByLabel('Resume file')
    .setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: RESUME });
  await page.getByRole('button', { name: 'Add resume' }).click();
  await expect(page.getByText('Added "E2E resume".')).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByText('What the interviewer sees')).toBeVisible();
  await expect(page.getByText(/Project "?(Parkly|LogLens)/).first()).toBeVisible();

  await page.getByRole('link', { name: 'Interview based on this' }).click();
  await expect(page.getByLabel('Questions', { exact: true })).toHaveValue(/.+/);
  await page.getByLabel('Interview type').selectOption('technical');
  await page.getByLabel('Number of questions').fill('2');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await expect(page.getByText(/Writing 2 questions from your resume/)).toBeVisible();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/, { timeout: 4 * 60_000 });
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Question 1 of 2')).toBeVisible();
  const detail = (await (await page.request.get(`/api/sessions/${sessionId}`)).json()) as {
    current: { text: string };
  };
  test.info().annotations.push({ type: 'question', description: detail.current.text });
  expect(detail.current.text).toMatch(PROJECTS);

  // Clean up: the interview, then the document.
  await page.request.delete(`/api/sessions/${sessionId}`);
  const docs = (await (await page.request.get('/api/documents')).json()) as { id: string; title: string }[];
  for (const d of docs.filter((x) => x.title === 'E2E resume')) await page.request.delete(`/api/documents/${d.id}`);
});
