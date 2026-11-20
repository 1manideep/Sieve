// Playground states (40 section 19.2; acceptance AT-5 to AT-9, AT-18, AT-33).
import { expect, test } from '@playwright/test';
import { fakeDraft } from './fixtures/fakeModel';
import { APPROVE, BANK, HEALTH, HEALTH_TEXT, KEEP_HERE, LANDLORD, MY_TEST, PARCEL, askChip, openPlayground, openTrace } from './fixtures/helpers';
import { cloudCalls, prepareStubs, seamCalls } from './fixtures/stubs';

const desktopOnly = (name: string) => test.skip(name !== 'desktop', 'desktop project only');

test.describe('Playground states', () => {
  test('Health is never shared: no buttons, no model reads the email', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await askChip(page, HEALTH);
    await expect(page.getByText('Health is never shared').first()).toBeVisible();
    await expect(page.getByRole('button', { name: APPROVE })).toHaveCount(0);
    await expect(page.getByRole('button', { name: KEEP_HERE })).toHaveCount(0);
    const calls = await seamCalls(page);
    expect(calls.some((c) => c.prompt.includes(HEALTH_TEXT) || c.recordIds.includes('playground:pg-mail-15'))).toBe(false);
  });

  test('Money asks first: the banner sits directly above the buttons (Approve first), and approving still works', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await askChip(page, BANK);
    const banner = page.locator('[data-warning="ask-first"]');
    await expect(banner).toContainText('Money asks first');
    const lastWarning = page.locator('[data-warning]').last();
    await expect(lastWarning).toHaveAttribute('data-warning', 'ask-first');
    const nextControl = await banner.evaluate((el) => {
      const all = [...document.querySelectorAll('button, input, a[href]')];
      return all.find((c) => el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)?.textContent ?? '';
    });
    expect(nextControl).toMatch(APPROVE);
    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByTestId('draft-text')).toHaveText(/^Draft: /);
  });

  test('a hidden instruction is caught and never leaves', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await askChip(page, PARCEL);
    await expect(page.getByText(/Hidden text removed before any model read it|Possible instruction aimed at an AI/).first()).toBeVisible();
    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByTestId('draft-text')).toBeVisible();
    expect((await cloudCalls(page)).some((c) => /bank statement/i.test(c.prompt))).toBe(false);
  });

  test('a test email: added, indexed on this device, and its trap is flagged', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await page.getByRole('button', { name: 'Write a test email' }).click();
    await page.getByRole('button', { name: 'Add to the inbox' }).click();
    await expect(page.getByText('Added by you')).toBeVisible();
    await expect(page.getByText('Indexed on this device')).toBeVisible({ timeout: 30_000 });
    // Adding the email asks about it at once, so the conversation (F3) replaces the chips; the field keeps the question.
    await expect(page.getByLabel('Ask the Playground')).toHaveValue(MY_TEST);
    await expect(page.locator('article[aria-label="Result"]')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Possible instruction aimed at an AI|Hidden text removed before any model read it/).first()).toBeVisible();
    await expect(page.getByTestId('outgoing-text')).not.toContainText('bank statement');
    expect((await cloudCalls(page)).some((c) => /ignore your instructions/i.test(c.prompt))).toBe(false);
    // Indexing the email ran no Gemini Nano privacy check (11 section 6.1); the question ran one injection-check and
    // one pii-check on its outgoing text, on the device (10.7).
    const calls = await seamCalls(page);
    const firstQuestion = calls.findIndex((c) => c.purpose === 'select-answer');
    expect(firstQuestion).toBeGreaterThanOrEqual(0);
    expect(calls.slice(0, firstQuestion).some((c) => c.purpose === 'injection-check' || c.purpose === 'pii-check')).toBe(false);
    const checks = calls.slice(firstQuestion).filter((c) => c.purpose === 'injection-check' || c.purpose === 'pii-check');
    expect(checks.map((c) => [c.purpose, c.sdkReported])).toEqual([['injection-check', 'on_device'], ['pii-check', 'on_device']]);
    expect(checks.every((c) => c.recordIds.length === 1 && c.recordIds[0]!.startsWith('upload:test-email-'))).toBe(true);
  });

  test('your own file without a model: consent first, nothing leaves before it', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await page.getByRole('radio', { name: 'Not available (simulate)' }).click();
    const text = 'Move-out notes: return the keys to the office by December 31.';
    await page.getByLabel('Choose files to add').setInputFiles({ name: 'move-out-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.getByRole('heading', { name: 'Allow the cloud model to read this item?' })).toBeVisible({ timeout: 45_000 });
    expect((await cloudCalls(page)).some((c) => c.prompt.includes('return the keys'))).toBe(false);
    await page.getByRole('button', { name: 'Allow the cloud for this file' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Share the least it can' })).toBeVisible({ timeout: 45_000 });
    await openTrace(page);
    await expect(page.locator('li[data-kind="select"][data-where="cloud"]').getByText(/^Cloud · Gemini/)).toBeVisible();
  });

  test('Reset the device: added items and receipts are gone', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await askChip(page, LANDLORD);
    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByRole('tab', { name: 'What has AI seen? (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Write a test email' }).click();
    await page.getByRole('button', { name: 'Add to the inbox' }).click();
    await expect(page.getByText('Indexed on this device')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Reset the device' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset the Playground?' });
    await dialog.getByRole('button', { name: 'Reset' }).click();
    // The toast; the screen reader announcer repeats it, visually hidden.
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('The Playground was reset.')).toBeVisible();
    await expect(page.getByText('Nothing yet. Add a file, or write a test email that tries to trick the AI.')).toBeVisible();
    await page.getByRole('tab', { name: 'What has AI seen?', exact: true }).click();
    await expect(page.getByText('Nothing shared yet. Approve an answer and its receipt shows up here.')).toBeVisible();
  });

  test('narrow: the golden path completes with no horizontal scroll', async ({ page }, info) => {
    test.skip(info.project.name !== 'narrow', 'narrow project only');
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await askChip(page, LANDLORD);
    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByTestId('draft-text')).toHaveText(fakeDraft('Your deposit was $1,200, paid on March 3.'));
    const fits = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth);
    expect(fits).toBe(true);
  });

  test('model setup from /prepare: real progress, then ready', async ({ page }, info) => {
    desktopOnly(info.project.name);
    await prepareStubs(page, { availability: 'downloadable' });
    await page.goto('/prepare?back=/playground');
    const start = page.getByRole('button', { name: 'Start setup' });
    await expect(start).toBeVisible();
    // Record every value the progress bar shows, since the stub's download takes a fraction of a second.
    await page.evaluate(() => {
      const seen: number[] = [];
      (window as unknown as { __progress: number[] }).__progress = seen;
      const read = () => {
        for (const bar of document.querySelectorAll('[role="progressbar"][aria-valuenow]')) seen.push(Number(bar.getAttribute('aria-valuenow')));
      };
      new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    await start.click();
    await expect(page.getByRole('heading', { name: 'The on-device model is ready' })).toBeVisible({ timeout: 20_000 });
    const seen = await page.evaluate(() => (window as unknown as { __progress: number[] }).__progress);
    expect(seen.some((v) => v >= 25)).toBe(true);
    expect(seen.some((v) => v >= 50)).toBe(true);
  });
});
