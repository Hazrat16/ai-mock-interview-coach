import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Critical and serious axe-core violations (WCAG 2.1 A and AA) on the page as it is now, one line each. */
export async function a11yProblems(page: Page, name: string): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map(
      (v) =>
        `${name}: [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 4)
          .join('\n    ')}`,
    );
}
