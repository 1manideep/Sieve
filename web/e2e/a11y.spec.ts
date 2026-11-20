// Accessibility (40 sections 14 and 19.2; AT-31): axe on /welcome, /playground (idle and with a ready result) and
// /prepare (downloadable). No violation with impact serious or critical.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LANDLORD, askChip, openPlayground } from './fixtures/helpers';
import { prepareStubs } from './fixtures/stubs';

async function seriousViolations(page: Page): Promise<string[]> {
  // Measure the settled page: a card fading in has blended colours for a moment (the colour-contrast rule would read
  // them). Endless animations, such as a progress pulse, are left running.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity),
  );
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

test.describe('accessibility', () => {
  test('/ (the landing)', async ({ page }) => {
    await prepareStubs(page, { availability: 'available' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Only what you approve leaves your computer.' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('/playground, idle and with a ready result', async ({ page }) => {
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    expect(await seriousViolations(page)).toEqual([]);
    await askChip(page, LANDLORD);
    await expect(page.getByTestId('outgoing-text')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('/prepare with the model to set up', async ({ page }) => {
    await prepareStubs(page, { availability: 'downloadable' });
    await page.goto('/prepare');
    await expect(page.getByRole('button', { name: 'Start setup' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
