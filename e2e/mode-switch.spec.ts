// The browser remembers "typed answers" from an earlier interview: the question screen still offers voice.
import { expect, test } from '@playwright/test';

test('switch from typing to voice in the middle of an interview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  await page.goto('/interview/new');
  await page.getByLabel('Number of questions').fill('1');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  await page.reload(); // as after closing the tab: still typed, and still switchable
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('group', { name: 'Answer by' }).getByRole('button', { name: 'Voice' }).click();
  await expect(page.getByLabel('Your answer')).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Recording', { exact: true })).toBeVisible({ timeout: 90_000 });

  await page.getByRole('group', { name: 'Answer by' }).getByRole('button', { name: 'Typing' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible();
  await expect(page.getByText('Recording', { exact: true })).toBeHidden(); // switching away closes the mic
  await page.request.delete(`/api/sessions/${sessionId}`);
});
