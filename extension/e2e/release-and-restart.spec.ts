// The release build trusts the hosted app only, and a restarted service worker rebuilds its state from the page
// without repeating a notification (50 sections 4.2, 7.7 and 14.3 items 5 and 9, checked headless).
import { chromium, test as base } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { badgeText, expect, notificationIds, STUB_URL, test } from './fixtures';
import { DEPOSIT, STATEMENT } from './previews';

base('release build: http://localhost:5173 gets no channel', async () => {
  const ext = fileURLToPath(new URL('../dist', import.meta.url));
  const userDataDir = mkdtempSync(join(tmpdir(), 'sieve-ext-release-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2] ?? '';
    const page = await context.newPage();
    await page.goto(`${STUB_URL}?ext=${id}`);
    const status = await page.evaluate(() => (window as unknown as { __stub: { connect(): string } }).__stub.connect());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => (window as unknown as { __stub: { status: string } }).__stub.status);
    expect(status === 'unsupported' || after !== 'connected').toBe(true);
    const matches = await sw.evaluate(() => chrome.runtime.getManifest().externally_connectable?.matches);
    // The hosted app only: the custom domain and Hosting's default domain (scripts/modes.mjs), never localhost.
    expect(matches).toEqual(['https://sieve.manideep.info/*', 'https://sieve-manideep.web.app/*']);
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('worker restart: the page reconnects, the badge returns, no second notification', async ({ context, openStub, sw, extensionId }) => {
  const stub = await openStub();
  await stub.connect();
  await stub.waitForStatus('connected');
  await stub.pending([STATEMENT, DEPOSIT]);
  await expect.poll(() => notificationIds(sw)).toHaveLength(2);
  await expect.poll(() => badgeText(sw)).toBe('2');
  // Dismiss both, so a repeated create (same id) after the restart would show up again.
  await sw.evaluate(async (ids) => {
    for (const id of ids) await chrome.notifications.clear(id);
  }, [`sieve-req-${STATEMENT.requestId}`, `sieve-req-${DEPOSIT.requestId}`]);
  await expect.poll(() => notificationIds(sw)).toEqual([]);

  // Stop the extension's service worker the way chrome://serviceworker-internals does.
  const cdp = await context.newCDPSession(stub.page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await stub.waitForStatus('disconnected');

  // The page reconnects at once and repeats hello + pending (50 section 6.2 rule 9); the worker wakes for it.
  await stub.connect();
  await stub.waitForStatus('connected');
  await stub.pending([STATEMENT, DEPOSIT]);
  const worker = context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${extensionId}/`)) ?? sw;
  await expect.poll(() => badgeText(worker)).toBe('2');
  const announced = await worker.evaluate(() => chrome.storage.session.get('announced'));
  expect(announced).toEqual({ announced: [STATEMENT.requestId, DEPOSIT.requestId] });
  // The restarted worker read the announced ids back from storage.session: nothing was announced twice.
  await stub.page.waitForTimeout(500); // asserting an absence: give a wrong create time to happen
  expect(await notificationIds(worker)).toEqual([]);
});
