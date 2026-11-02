// Technical focus: the Focus field appears only where it applies, and the interview it starts stays on that track.
import { expect, test } from '@playwright/test';

test('a technical interview can focus on one area', async ({ page }) => {
  await page.goto('/interview/new');
  await expect(page.getByLabel('Focus')).toBeHidden();

  await page.getByLabel('Interview type').selectOption('technical');
  await page.getByLabel('Focus').selectOption('devops');
  await expect(page.getByLabel('Focus')).toHaveValue('devops');

  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await expect(page).toHaveURL(/\/interview\/(?!new)[^/]+$/);
  await expect(page.getByRole('heading', { name: /DevOps Technical interview/ })).toBeVisible();
});
