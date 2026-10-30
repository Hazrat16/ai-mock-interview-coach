// "Sorry, I don't understand the question" gets the question again in other words, not the next question.
import { expect, test } from '@playwright/test';

test('asking what the question means rewords it instead of moving on', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  await page.goto('/interview/new');
  await page.getByLabel('Number of questions').fill('2');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Question 1 of 2')).toBeVisible();
  const question = page.locator('p[aria-live="polite"]');
  const original = await question.innerText();

  await page.getByLabel('Your answer').fill("Sorry, I don't understand the question.");
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/^Sure, (let me put it another way|here it is again)\.$/)).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('Question 1 of 2')).toBeVisible(); // still the same question
  await expect(page.getByLabel('Your answer')).toHaveValue('');
  const reworded = await question.innerText();
  test.info().annotations.push({ type: 'reworded', description: `${original} -> ${reworded}` });
  await page.request.delete(`/api/sessions/${sessionId}`);
});
