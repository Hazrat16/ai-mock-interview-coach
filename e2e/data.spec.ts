// Settings → Data & privacy: export, back up, delete everything (typed confirmation), restore.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('export, back up, delete everything, restore from Settings', async ({ page }) => {
  // One short typed interview to have something to export, delete and restore.
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  await page.goto('/interview/new');
  await page.getByLabel('Number of questions').fill('1');
  await page.getByLabel('Follow-ups per question').selectOption('0');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await page.getByLabel('Your answer').fill('I kept a decision log, and the platypus deadline still slipped by a day.');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.waitForURL(/\/report$/, { timeout: 90_000 });

  await page.goto('/settings');
  await expect(page.getByText(/Stored now: \d+ interviews?/)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download export' }).click();
  const file = await (await download).path();
  expect(readFileSync(file, 'utf8')).toContain('platypus deadline');

  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/^Saved coach-.*\.db$/)).toBeVisible();

  // The delete button stays disabled until the word is typed exactly.
  await page.getByRole('button', { name: 'Delete everything' }).click();
  const confirm = page.getByRole('button', { name: 'Delete everything' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page.getByText('All interviews and recordings were deleted.')).toBeVisible();
  await expect(page.getByText(/Stored now: 0 interviews/)).toBeVisible();
  expect(await (await page.request.get('/api/history?q=platypus')).json()).toEqual([]);

  // Restore the backup just made (the newest coach-… one).
  const row = page
    .getByRole('listitem')
    .filter({ hasText: /coach-\d/ })
    .first();
  await row.getByRole('button', { name: 'Restore' }).click();
  await row.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/^Restored coach-.*The data from before is in pre-restore-/)).toBeVisible();
  const found = (await (await page.request.get('/api/history?q=platypus')).json()) as { id: string }[];
  expect(found).toHaveLength(1);
  await page.request.delete(`/api/sessions/${found[0]!.id}`);
});
