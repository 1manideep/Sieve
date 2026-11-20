// Page helpers for the Playground specs. Copy is written out exactly as 40 quotes it, so a copy change fails here.
import { expect, type Locator, type Page } from '@playwright/test';

export const LANDLORD = 'What did my landlord say about the deposit? Draft a reply.';
export const HEALTH = 'What do my test results say?';
export const BANK = "What's my latest bank balance?";
export const PARCEL = 'What does the parcel delivery email want?';
export const MY_TEST = 'What does my test email want?';
export const INSTRUCTION = 'Draft a short, polite reply.';
export const APPROVE = 'Draft a reply with the cloud model';

/** Open the Playground and wait for the pretend computer to be ready; a seeding failure fails fast with the console errors. */
export async function openPlayground(page: Page, errors: string[] = []): Promise<void> {
  await page.goto('/playground');
  await expect(page.getByRole('region', { name: 'Playground device' })).toBeVisible();
  // Seeded: the Mail folder counts its emails (30 in the sample data). A seeding failure shows its notice instead.
  const seeded = page.getByRole('button', { name: /^Mail [1-9]\d* emails?$/ });
  const failed = page.getByText("Couldn't set up the sample data.");
  await expect(seeded.or(failed).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Try asking').or(failed).first()).toBeVisible();
  if (await failed.isVisible()) throw new Error(`The Playground could not seed its sample data.\n${errors.join('\n')}`);
  await waitForEmbeddings(page);
}

/** Records in the Playground index that have no vector yet (seed-bundle.json without vectors embeds after load). */
async function unembedded(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('sieve-playground');
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['records', 'vectors'], 'readonly');
          const records = tx.objectStore('records').getAllKeys();
          const vectors = tx.objectStore('vectors').index('recordId').getAllKeys();
          tx.oncomplete = () => {
            const have = new Set<string>();
            // The recordId index's keys are the vector ids `${recordId}#${n}`; strip the chunk number.
            for (const id of vectors.result) have.add(String(id).replace(/#\d+$/, ''));
            db.close();
            resolve(records.result.filter((id) => !have.has(String(id))).length);
          };
          tx.onerror = () => {
            db.close();
            resolve(-1);
          };
        };
      }),
  );
}

/** The embedder's state as the ML client reports it to the seam (web/src/ml/client.ts, 60 section 3.9.1). */
async function embedderState(page: Page): Promise<string> {
  return page.evaluate(() => (window as Window & { __sieveE2E?: { ml?: Record<string, string> } }).__sieveE2E?.ml?.embed ?? 'idle');
}

/**
 * Wait until every record has its vectors and the embedder is loaded, so a question is answered by the same search a
 * person gets once the device is ready (vector and keyword), not the keyword-only fallback of the first seconds. The
 * seed bundle ships its vectors, so the first wait is a safety net for a stale bundle; the second is what matters.
 */
export async function waitForEmbeddings(page: Page): Promise<void> {
  await expect.poll(() => unembedded(page), { timeout: 45_000, intervals: [100, 250, 500] }).toBe(0);
  await expect.poll(() => embedderState(page), { timeout: 45_000, intervals: [100, 250, 500] }).toBe('ready');
}

export function chip(page: Page, text: string): Locator {
  return page.getByText('Try asking').locator('..').getByRole('button', { name: text, exact: true });
}

export function traceRow(page: Page, kind: string): Locator {
  return page.locator(`li[data-kind="${kind}"]`).first();
}

/** Ask a suggestion and wait for its result card. */
export async function askChip(page: Page, text: string): Promise<void> {
  await chip(page, text).click();
  await expect(page.locator('article[aria-label="Result"]')).toBeVisible({ timeout: 45_000 });
}

/** Press Tab until the locator has focus (at most `max` presses). */
export async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** A sentence of the landlord's email that the answer step must never send (data/playground pg-mail-02). */
export const LANDLORD_OTHER_SENTENCE = 'It will be returned within 30 days of move-out, minus any repair costs.';
/** Part of the Health email body (pg-mail-15), which no model may read. */
export const HEALTH_TEXT = 'Your cholesterol is a little high.';
