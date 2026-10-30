// Company preparation (M14, R23) with the real models: notes with source and date, your question first, then a
// prediction from your notes; every question carries its label in the interview and the report. ~3 minutes.
import { expect, test } from '@playwright/test';

const COMPANY = 'Zentrix E2E';

test('company interview: your question, then a prediction from your notes, each labelled', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  await page.goto('/companies');
  await page.getByLabel('Company', { exact: true }).fill(COMPANY);
  await page.getByLabel('Notes title').fill('Recruiter call');
  await page
    .getByLabel('Your notes')
    .fill(
      'Zentrix builds route-planning software for delivery fleets. The recruiter said there are two behavioral rounds. ' +
        'They value ownership and clear written communication, and want stories with measurable results.',
    );
  await page.getByLabel('Source').fill('recruiter call');
  await page.getByLabel('Date of the information').fill('2026-10-20');
  await page.getByRole('button', { name: 'Add notes' }).click();
  await expect(page.getByText(`Added your notes about ${COMPANY}.`)).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByText('Verified by you (recruiter call, 2026-10-20)')).toBeVisible();

  await page
    .getByLabel(`Questions for ${COMPANY}, one per line`)
    .fill('Why do you want to build software for delivery fleets?');
  const add = page
    .locator('div', { has: page.getByRole('heading', { name: 'Add questions you know they ask' }) })
    .last();
  await add.getByLabel('Source').fill('Glassdoor review');
  await add.getByLabel('Date of the information').fill('2026-10-01');
  await page.getByRole('button', { name: 'Add 1 question' }).click();
  await expect(page.getByText('Added 1 question.')).toBeVisible();

  await page.getByRole('link', { name: `Interview for ${COMPANY}` }).click();
  await expect(page.getByLabel('Questions', { exact: true })).toHaveValue(`company:${COMPANY}`);
  await page.getByLabel('Interview type').selectOption('behavioral');
  await page.getByLabel('Number of questions').fill('2');
  await page.getByLabel('Follow-ups per question').selectOption('0');
  await page.getByRole('button', { name: 'Prepare interview' }).click();
  await expect(page.getByText(`You have 1 behavioral question for ${COMPANY}`)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Predict 1 from your notes/ }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/, { timeout: 4 * 60_000 });
  const sessionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Start with typed answers' }).click();
  await expect(page.getByText('Why do you want to build software for delivery fleets?')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Verified by you (Glassdoor review, 2026-10-01)')).toBeVisible();
  await page.getByLabel('Your answer').fill('I like hard routing problems and I want my work to save drivers time.');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Question 2 of 2')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Generated prediction, not verified')).toBeVisible();
  const detail = (await (await page.request.get(`/api/sessions/${sessionId}`)).json()) as { current: { text: string } };
  test.info().annotations.push({ type: 'predicted', description: detail.current.text });

  await page.getByLabel('Your answer').fill('I owned the release checklist and cut failed deploys by half.');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.waitForURL(/\/report$/, { timeout: 90_000 });
  await expect(page.getByText('Verified by you (Glassdoor review, 2026-10-01)')).toBeVisible();
  await expect(page.getByText('Generated prediction, not verified')).toBeVisible();

  // Clean up the interview, the questions and the notes.
  await page.request.delete(`/api/sessions/${sessionId}`);
  const companies = (await (await page.request.get('/api/companies')).json()) as {
    name: string;
    notes: { id: string }[];
    questions: { id: string }[];
  }[];
  for (const c of companies.filter((x) => x.name === COMPANY)) {
    for (const q of c.questions) await page.request.delete(`/api/companies/questions/${q.id}`);
    for (const n of c.notes) await page.request.delete(`/api/documents/${n.id}`);
  }
});
