// The golden path in the Playground (40 sections 12 and 19.2; acceptance AT-1 to AT-4).
import { expect, test } from '@playwright/test';
import { DEPOSIT_ANSWER, fakeDraft } from './fixtures/fakeModel';
import { APPROVE, DRAFT_HEADING, INSTRUCTION, LANDLORD, LANDLORD_OTHER_SENTENCE, askChip, chip, openPlayground, openTrace, tabTo, traceRow } from './fixtures/helpers';
import { cloudCalls, prepareStubs, seamCalls } from './fixtures/stubs';

test.describe('Playground golden path', () => {
  test('on-device model ready: answer on the device, draft in the cloud, one receipt', async ({ page }) => {
    const { forbidden, errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await expect(page.getByRole('button', { name: 'Use your own data' })).toBeVisible();

    await chip(page, LANDLORD).click();
    // A running trace row appears before the result.
    await expect(page.getByTestId('preparing-card').locator('[data-status="running"]').first()).toBeVisible();
    await expect(page.locator('article[aria-label="Result"]')).toBeVisible({ timeout: 45_000 });

    await expect(page.getByRole('radio', { name: '1 · Answer only' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('outgoing-text')).toHaveText(DEPOSIT_ANSWER);
    expect(await cloudCalls(page)).toHaveLength(0);

    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByRole('heading', { name: DRAFT_HEADING })).toBeVisible();
    await expect(page.getByTestId('draft-text')).toHaveText(fakeDraft(DEPOSIT_ANSWER));
    await openTrace(page);
    await expect(traceRow(page, 'select').getByText('This device · Gemini Nano')).toBeVisible();
    await expect(traceRow(page, 'draft').getByText('Cloud · Gemini', { exact: true })).toBeVisible();
    await expect(page.getByTestId('trace-total').first()).toHaveText(`${41 + INSTRUCTION.length} characters left this device`);

    // Exactly one cloud call: the approved text and the instruction, nothing else from the email.
    const cloud = await cloudCalls(page);
    expect(cloud.map((c) => c.purpose)).toEqual(['draft']);
    expect(cloud[0].prompt).toContain(DEPOSIT_ANSWER);
    expect(cloud[0].prompt).toContain(INSTRUCTION);
    expect(cloud[0].prompt).not.toContain(LANDLORD_OTHER_SENTENCE);

    // Every model call of the visit (11 section 10.7): loading and indexing the sample data make none; the question
    // makes one select-answer, one verify-answer on the chosen item (10 section 12.3 step 12b), then one
    // injection-check and one pii-check on the text that would leave, all on the device.
    const calls = await seamCalls(page);
    expect(calls.map((c) => c.purpose)).toEqual(['select-answer', 'verify-answer', 'injection-check', 'pii-check', 'draft']);
    expect(calls[1]).toMatchObject({ recordIds: ['playground:pg-mail-02'], data: 'sample', sdkReported: 'on_device' });
    for (const c of calls.slice(2, 4)) {
      expect(c).toMatchObject({ recordIds: ['playground:pg-mail-02'], data: 'sample', sdkReported: 'on_device' });
      expect(c.prompt).toContain('$1,200');
    }
    await expect(page.locator('li[data-kind="injection"][data-where="device"]').getByText('No hidden instructions in the text to share')).toBeVisible();
    await expect(page.locator('li[data-kind="pii"][data-where="device"]').getByText('No more personal details in the text to share')).toBeVisible();

    await page.getByRole('tab', { name: 'What has AI seen? (1)' }).click();
    await expect(page.getByTestId('receipt-what')).toHaveText('Answer only from "Re: Deposit for the apartment"');
    expect(forbidden).toEqual([]);
  });

  test('simulated no model: the reading step runs in the cloud on sample data, labelled', async ({ page }) => {
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await page.getByRole('radio', { name: 'Not available (simulate)' }).click();
    await expect(page.getByText('Simulated: no on-device model')).toBeVisible();
    await askChip(page, LANDLORD);
    await openTrace(page);
    await expect(traceRow(page, 'select').getByText('Cloud · Gemini (sample data)')).toBeVisible();
    // The banner title; its message repeats the phrase ("...so the sample data ran in the cloud.").
    await expect(page.getByText('Sample data ran in the cloud', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByTestId('draft-text')).toHaveText(fakeDraft(DEPOSIT_ANSWER));
    // Without the on-device model the share-time injection check of sample data runs in the cloud (as the ingest check
    // did before); the personal details check never leaves the device, so it is skipped.
    const cloud = (await cloudCalls(page)).map((c) => c.purpose);
    expect(cloud).toEqual(expect.arrayContaining(['select-answer', 'injection-check', 'draft']));
    expect(cloud).not.toContain('pii-check');
    expect((await seamCalls(page)).some((c) => c.purpose === 'pii-check')).toBe(false);
  });

  test('a second ask of the same text reuses the share-time check: no new injection or pii call', async ({ page }) => {
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await askChip(page, LANDLORD);
    const count = async (purpose: string) => (await seamCalls(page)).filter((c) => c.purpose === purpose).length;
    expect([await count('select-answer'), await count('verify-answer'), await count('injection-check'), await count('pii-check')]).toEqual([1, 1, 1, 1]);
    const field = page.getByLabel('Ask the Playground');
    await field.fill(LANDLORD);
    await field.press('Enter');
    await expect.poll(() => count('select-answer'), { timeout: 45_000 }).toBe(2);
    await expect(page.getByRole('button', { name: APPROVE }).last()).toBeVisible({ timeout: 45_000 });
    expect([await count('verify-answer'), await count('injection-check'), await count('pii-check')]).toEqual([2, 1, 1]);
    await openTrace(page);
    await expect(page.getByText('This exact text was checked before: no hidden instructions').first()).toBeVisible();
  });

  test('no model in this Chrome: the toggle says so and the golden path completes through the cloud', async ({ page }) => {
    const { errors } = await prepareStubs(page, { availability: 'unavailable' });
    await openPlayground(page, errors);
    const option = page.getByRole('radio', { name: 'Not in this Chrome' });
    await expect(option).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(/No on-device model in this Chrome\. Sample files run in the cloud and are labelled\./)).toBeVisible();
    await askChip(page, LANDLORD);
    await expect(page.getByTestId('outgoing-text')).toHaveText(DEPOSIT_ANSWER);
    await page.getByRole('button', { name: APPROVE }).click();
    await expect(page.getByTestId('draft-text')).toHaveText(fakeDraft(DEPOSIT_ANSWER));
  });

  test('keyboard only: chip, ladder, approve', async ({ page }) => {
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await openPlayground(page, errors);
    await tabTo(page, chip(page, LANDLORD));
    await page.keyboard.press('Enter');
    await expect(page.locator('article[aria-label="Result"]')).toBeVisible({ timeout: 45_000 });
    const answer = page.getByRole('radio', { name: '1 · Answer only' });
    await tabTo(page, answer);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '2 · Excerpt' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('outgoing-text')).not.toHaveText(DEPOSIT_ANSWER);
    const excerpt = (await page.getByTestId('outgoing-text').textContent()) ?? '';
    await tabTo(page, page.getByRole('button', { name: APPROVE }));
    await page.keyboard.press('Enter');
    // The excerpt was approved, so the seam's draft is "Draft: " plus the excerpt (60 section 3.9.1).
    await expect(page.getByTestId('draft-text')).toHaveText(fakeDraft(excerpt));
  });
});
