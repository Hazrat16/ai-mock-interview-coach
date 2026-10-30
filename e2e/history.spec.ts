// After an interview: History finds it by a word from the answer, opens its report; Dashboard and Progress
// show it. Typed answers, so no microphone is needed.
import { expect, test } from '@playwright/test';

test('history search finds an answer and opens its report; dashboard counts it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  await page.goto('/interview/new');
  await page.getByLabel('Interview type').selectOption('technical');
  await page.getByLabel('Number of questions').fill('1');
  await page.getByLabel('Follow-ups per question').selectOption('0');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  await page
    .getByLabel('Your answer')
    .fill('I once profiled a zebrafish imaging service and added indexes to the slow queries.');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.waitForURL(/\/report$/, { timeout: 90_000 });

  // Search by a word start ("zebra") and a stem ("index" finds "indexes").
  await page.goto('/history');
  await page.getByLabel('Search questions and answers').fill('zebra index');
  await expect(page.locator('mark', { hasText: 'zebrafish' })).toBeVisible();
  await expect(page.locator('mark', { hasText: 'indexes' })).toBeVisible();
  await expect(page).toHaveURL(/q=zebra\+index/);
  // A filter that excludes it, then back.
  await page.getByLabel('Interview type').selectOption('behavioral');
  await expect(page.getByText('No interviews match')).toBeVisible();
  await page.getByLabel('Interview type').selectOption('technical');
  await page.locator('mark', { hasText: 'zebrafish' }).click();
  await expect(page).toHaveURL(new RegExp(`/interview/${sessionId}/report$`));
  await expect(page.getByText('Key points to mention').first()).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(/interviews? completed/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Technical · Software Engineer/ }).first()).toBeVisible();

  // Typed answers have no delivery measurements.
  await page.goto('/progress');
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();

  await page.request.delete(`/api/sessions/${sessionId}`);
  const after = (await (await page.request.get('/api/history?q=zebrafish')).json()) as unknown[];
  expect(after).toEqual([]);
});
