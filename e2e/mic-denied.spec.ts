// Microphone permission denied: the app explains how to allow it, and typed answers still work.
import { expect, test } from '@playwright/test';

// A browser without the fake-microphone flags and without microphone permission.
test.use({ permissions: [], launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('denied microphone: clear message, interview can still start with typed answers', async ({ page }) => {
  await page.goto('/interview/new');
  await page.getByLabel('Number of questions').fill('1');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Enable microphone and start' }).click();
  await expect(page.getByRole('alert')).toContainText(/Microphone access was denied|No microphone found/, {
    timeout: 30_000,
  });
  await expect(page.getByText('Recording', { exact: true })).toBeHidden();

  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  await page.request.delete(`/api/sessions/${sessionId}`);
});
