// Keyboard-only run-through (M15): a whole typed interview and finding it again in History, with Tab, typing and
// Enter only. Every element reached must show where the focus is (an outline or a ring).
import { expect, type Page, test } from '@playwright/test';

/** Presses Tab until the focused element's accessible name or label matches; returns how it looks focused. */
async function tabTo(page: Page, name: RegExp, max = 80) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const label =
        el.getAttribute('aria-label') ??
        (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
        el.textContent ??
        '';
      const focusedStyle = getComputedStyle(el);
      const outline = focusedStyle.outlineStyle !== 'none' && parseFloat(focusedStyle.outlineWidth) > 0;
      // A date field highlights the focused month/day/year part itself (not visible to CSS); refocusing it
      // would also send focus back to its first part.
      const dateField = el instanceof HTMLInputElement && el.type === 'date';
      if (outline || dateField) return { label: label.trim(), indicator: true };
      // Many controls always have a subtle shadow: a ring counts only if focus changes it.
      const ring = focusedStyle.boxShadow;
      el.blur();
      const unfocusedShadow = getComputedStyle(el).boxShadow;
      el.focus({ focusVisible: true } as FocusOptions);
      return { label: label.trim(), indicator: ring !== unfocusedShadow };
    });
    if (focused && name.test(focused.label)) return focused;
    seen.push(focused?.label.slice(0, 40) ?? '(page)');
  }
  throw new Error(`could not reach ${name} with Tab; went through: ${[...new Set(seen)].join(' | ')}`);
}

test('a whole interview with the keyboard only', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await page.addInitScript(() => localStorage.setItem('interview-coach:answer-mode', 'text'));
  const noIndicator: string[] = [];
  const go = async (name: RegExp) => {
    const f = await tabTo(page, name);
    if (!f.indicator) noIndicator.push(f.label);
  };

  await page.goto('/');
  await go(/^New interview$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/interview\/new$/);

  await go(/^Number of questions$/);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1');
  await go(/^Follow-ups per question$/);
  await page.keyboard.press('Home'); // "None"
  await go(/^Prepare interview$/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/interview\/[0-9a-f-]+$/);
  const sessionId = page.url().split('/').pop()!;

  await go(/^Start with typed answers$/);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Your answer')).toBeVisible({ timeout: 30_000 });
  await go(/^Your answer$/);
  await page.keyboard.type('I keep a short decision log so the team can see why we chose each option.');
  await go(/^Submit answer$/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/report$/, { timeout: 90_000 });
  await expect(page.getByText('Key points to mention').first()).toBeVisible();

  await go(/^History$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/history/);
  await go(/^Search questions and answers$/);
  await page.keyboard.type('decision log');
  await expect(page.locator('mark').first()).toBeVisible();
  await go(/decision/i); // the search result
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/interview/${sessionId}/report$`));

  await page.request.delete(`/api/sessions/${sessionId}`);
  expect(noIndicator, `focused without a visible indicator: ${noIndicator.join(', ')}`).toEqual([]);
});
