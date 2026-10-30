// Accessibility (M15): axe-core on every page, WCAG 2.1 A and AA rules. No critical or serious violations
// allowed. A short typed interview gives the interview, report and history pages real content. (The app has
// light colours only: dark ones are defined but nothing switches them on.)
import { expect, test } from '@playwright/test';
import { a11yProblems as scan } from './helpers/a11y';

test('no critical or serious accessibility problems on any page', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  const problems: string[] = [];
  // A company with one of your questions, so the Companies page shows its list and labels.
  await page.request.post('/api/companies/questions', {
    data: {
      company: 'A11y Co',
      interviewType: 'behavioral',
      questions: ['Why do you want to join A11y Co?'],
      source: 'careers page',
      sourceDate: '2026-10-01',
    },
  });

  for (const [name, path] of [
    ['dashboard', '/'],
    ['new interview', '/interview/new'],
    ['history', '/history'],
    ['progress', '/progress'],
    ['documents', '/documents'],
    ['companies', '/companies'],
    ['settings', '/settings'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    problems.push(...(await scan(page, name)));
  }

  // An interview in progress, then its report.
  await page.goto('/interview/new');
  await page.getByLabel('Number of questions').fill('1');
  await page.getByLabel('Follow-ups per question').selectOption('0');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;
  problems.push(...(await scan(page, 'interview (before start)')));
  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  problems.push(...(await scan(page, 'interview (question)')));
  await page.getByLabel('Your answer').fill('I would start by measuring, then fix the slowest part first.');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.waitForURL(/\/report$/, { timeout: 90_000 });
  await expect(page.getByText('Key points to mention').first()).toBeVisible();
  problems.push(...(await scan(page, 'report')));
  await page.goto('/history?q=measuring');
  await expect(page.locator('mark').first()).toBeVisible();
  problems.push(...(await scan(page, 'history (search)')));

  await page.request.delete(`/api/sessions/${sessionId}`);
  const companies = (await (await page.request.get('/api/companies')).json()) as {
    name: string;
    questions: { id: string }[];
  }[];
  for (const q of companies.find((c) => c.name === 'A11y Co')?.questions ?? [])
    await page.request.delete(`/api/companies/questions/${q.id}`);
  expect(problems, problems.join('\n')).toEqual([]);
});
