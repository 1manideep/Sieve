// End-to-end tests with the unpacked dev build and a stub home base (50 sections 14.2 and 16, 8.9).
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import type { Decision, ExtensionToPage } from '@sieve/shared';
import { deriveExtensionId } from '../scripts/ext-id.mjs';
import { badgeText, expect, notificationIds, sharedExtensionId, test } from './fixtures';
import type { StubPage } from './fixtures';
import { DEPOSIT, DEPOSIT_ANSWER, DEPOSIT_EXCERPT, LEASE, LEASE_EXCERPT, STATEMENT, variant } from './previews';

const manifestKey = (JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { key: string }).key;

async function decisions(stub: StubPage): Promise<Decision[]> {
  const received = await stub.received();
  return received
    .filter((m): m is Extract<ExtensionToPage, { type: 'sieve/decision' }> => m.type === 'sieve/decision')
    .map((m) => m.decision);
}

async function connected(openStub: (origin?: string) => Promise<StubPage>, homeBase = true): Promise<StubPage> {
  const stub = await openStub();
  await stub.connect({ homeBase });
  await stub.waitForStatus('connected');
  return stub;
}

test('ID is stable: the key gives the same id everywhere', async ({ extensionId }) => {
  expect(extensionId).toBe(deriveExtensionId(manifestKey));
  const shared = sharedExtensionId();
  if (!shared.startsWith('REPLACE')) expect(extensionId).toBe(shared); // once CR-1 lands
});

test('connect and empty', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  const ack = (await stub.received())[0];
  expect(ack).toMatchObject({ type: 'sieve/hello-ack', version: 1, extensionVersion: '0.1.0' });
  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: 'No requests waiting' })).toBeVisible();
  await expect(panel.getByText('Home base online')).toBeVisible();
  expect(await badgeText(sw)).toBe('');
  const axe = await new AxeBuilder({ page: panel }).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('hello-ack carries the open-sieve binding from commands.getAll (8.9 a, d)', async ({ openStub, sw }) => {
  const commands = await sw.evaluate(() => chrome.commands.getAll());
  const open = commands.find((c) => c.name === 'open-sieve');
  expect(open?.description).toBe("Open or close Sieve's side panel");
  const stub = await connected(openStub);
  const ack = (await stub.received())[0] as Extract<ExtensionToPage, { type: 'sieve/hello-ack' }>;
  expect(ack.shortcut).toBe(open?.shortcut ?? '');
});

test('request and approve', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.pending([DEPOSIT]);
  await expect.poll(() => badgeText(sw)).toBe('1');
  await expect(panel.getByRole('heading', { name: 'A request is waiting' })).toBeVisible();
  await expect(panel.getByText(`Test assistant asked for: "${DEPOSIT.question}"`)).toBeVisible();
  await expect(panel.getByText('Oct 29 · Home · found on this device')).toBeVisible();
  const outgoing = panel.getByTestId('outgoing-text');
  expect(await outgoing.textContent()).toBe(DEPOSIT_ANSWER);
  await panel.getByRole('radio', { name: 'Excerpt' }).click();
  expect(await outgoing.textContent()).toBe(DEPOSIT_EXCERPT);
  const axe = await new AxeBuilder({ page: panel }).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await panel.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => decisions(stub)).toHaveLength(1);
  const [decision] = await decisions(stub);
  expect(decision).toEqual({
    requestId: DEPOSIT.requestId,
    approved: true,
    step: 'excerpt',
    itemIds: [],
    decidedBy: 'extension',
    decidedAt: expect.any(Number),
  });
  await stub.resolved(DEPOSIT.requestId, 'approved');
  await stub.pending([]);
  await expect(panel.getByRole('heading', { name: 'Shared' })).toBeVisible();
  await expect(panel.getByText('Sent: excerpt. Nothing else left this device.')).toBeVisible();
  await expect.poll(() => badgeText(sw)).toBe('');
  expect(await decisions(stub)).toHaveLength(1); // exactly one decision

  // Nothing stored: storage.local is empty; storage.session holds only request ids (50 section 16, item 8).
  const stored = await sw.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }));
  expect(stored.local).toEqual({});
  expect(Object.keys(stored.session).every((k) => k === 'announced')).toBe(true);
  for (const id of (stored.session.announced as string[] | undefined) ?? []) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
});

test('deny', async ({ openStub, openPanel }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.pending([DEPOSIT]);
  await panel.getByRole('button', { name: 'Deny' }).click();
  await expect.poll(() => decisions(stub)).toHaveLength(1);
  const [decision] = await decisions(stub);
  expect(decision).toMatchObject({ requestId: DEPOSIT.requestId, approved: false, itemIds: [], decidedBy: 'extension' });
  expect(decision && 'step' in decision).toBe(false);
  await stub.resolved(DEPOSIT.requestId, 'declined');
  await stub.pending([]);
  await expect(panel.getByRole('heading', { name: 'Declined' })).toBeVisible();
});

test('unavailable step cannot be selected by click or keyboard', async ({ openStub, openPanel }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.pending([LEASE]);
  const full = panel.getByRole('radio', { name: 'Full item' });
  await expect(full).toBeDisabled();
  await full.click({ force: true });
  await expect(full).toHaveAttribute('aria-checked', 'false');
  const excerpt = panel.getByRole('radio', { name: 'Excerpt' });
  await excerpt.focus();
  await panel.keyboard.press('ArrowRight');
  await expect(full).toHaveAttribute('aria-checked', 'false');
  await expect(panel.getByRole('radio', { name: 'Answer only' })).toHaveAttribute('aria-checked', 'true');
  await panel.keyboard.press('ArrowLeft');
  await expect(excerpt).toHaveAttribute('aria-checked', 'true');
  expect(await panel.getByTestId('outgoing-text').textContent()).toBe(LEASE_EXCERPT);
  // The worker refuses a step above maxStep even if a panel asked for it (50 section 16, item 6).
  const reply = await panel.evaluate(
    (id) =>
      new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: 'sieve-panel' });
        port.onMessage.addListener((m: { type: string }) => {
          if (m.type === 'panel/decide-rejected') resolve(m);
        });
        port.postMessage({ type: 'panel/decide', requestId: id, approved: true, step: 'full' });
      }),
    LEASE.requestId,
  );
  expect(reply).toEqual({ type: 'panel/decide-rejected', requestId: LEASE.requestId, reason: 'step-unavailable' });
  expect(await decisions(stub)).toEqual([]);
});

test('non-ready outcomes', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.pending([variant(DEPOSIT, { requestId: 'blocked-1', outcome: 'blocked-never', rule: 'never', item: { ...DEPOSIT.item!, category: 'Health' } })]);
  await expect(panel.getByRole('heading', { name: 'Blocked by your rules' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  expect(await badgeText(sw)).toBe('');
  await stub.pending([variant(DEPOSIT, { requestId: 'consent-1', outcome: 'needs-cloud-consent' })]);
  await expect(panel.getByRole('heading', { name: 'Needs your OK for the cloud' })).toBeVisible();
  await expect.poll(() => badgeText(sw)).toBe('1');
  const card = panel.getByRole('article');
  await expect(card.getByRole('button', { name: 'Open Sieve' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Deny' })).toHaveCount(0);
});

test('invalid messages are ignored, and 5 of them disconnect the page', async ({ openStub, openPanel }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.raw({ type: 'sieve/pending', version: 2, proposals: [DEPOSIT] });
  await stub.raw({ type: 'sieve/pending', version: 1, proposals: [variant(DEPOSIT, { options: [{ ...DEPOSIT.options[0]!, step: 'everything' as never }, DEPOSIT.options[1]!, DEPOSIT.options[2]!] })] });
  await expect(panel.getByRole('heading', { name: 'No requests waiting' })).toBeVisible();
  expect(await stub.status()).toBe('connected');
  await stub.raw({ type: 'sieve/unknown', version: 1 });
  await stub.raw('not an object');
  await stub.raw({ type: 'sieve/resolved', version: 1, requestId: 'bad id!', outcome: 'approved' });
  await stub.waitForStatus('disconnected');
  await expect(panel.getByRole('heading', { name: "Sieve isn't open" })).toBeVisible();
});

test('disconnect: closing the Sieve tab shows "Sieve isn\'t open" within 3 s', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.pending([DEPOSIT]);
  await expect.poll(() => badgeText(sw)).toBe('1');
  await stub.page.close();
  await expect(panel.getByRole('heading', { name: "Sieve isn't open" })).toBeVisible({ timeout: 3_000 });
  await expect(panel.getByText('Home base offline')).toBeVisible();
  await expect.poll(() => badgeText(sw)).toBe('');
});

test('two tabs: both requests listed, each decision goes to its own page', async ({ openStub, openPanel }) => {
  const a = await connected(openStub);
  const b = await connected(openStub, false);
  await a.pending([DEPOSIT]);
  await b.pending([LEASE]);
  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: 'Also waiting (1)' })).toBeVisible();
  await panel.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => decisions(a)).toHaveLength(1);
  await a.resolved(DEPOSIT.requestId, 'approved');
  await a.pending([]);
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByTestId('outgoing-text')).toHaveText(LEASE_EXCERPT);
  await panel.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => decisions(b)).toHaveLength(1);
  expect((await decisions(a)).map((d) => d.requestId)).toEqual([DEPOSIT.requestId]);
  expect((await decisions(b)).map((d) => d.requestId)).toEqual([LEASE.requestId]);
  expect((await decisions(b))[0]).toMatchObject({ approved: true, step: 'excerpt' });
});

test('notification: one per new request while no panel is open, gone after resolved', async ({ openStub, sw }) => {
  const stub = await connected(openStub);
  await stub.pending([STATEMENT]);
  await expect.poll(() => notificationIds(sw)).toEqual([`sieve-req-${STATEMENT.requestId}`]);
  await stub.pending([STATEMENT]);
  await stub.pending([STATEMENT]);
  expect(await notificationIds(sw)).toEqual([`sieve-req-${STATEMENT.requestId}`]);
  const announced = await sw.evaluate(() => chrome.storage.session.get('announced'));
  expect(announced).toEqual({ announced: [STATEMENT.requestId] });
  await stub.resolved(STATEMENT.requestId, 'declined');
  await expect.poll(() => notificationIds(sw)).toEqual([]);
});

test('origin enforcement: 127.0.0.1 gets no channel to the extension', async ({ openStub, openPanel }) => {
  const stub = await openStub('http://127.0.0.1:5173/');
  const hasRuntime = await stub.page.evaluate(() => (window as unknown as { __stub: { hasRuntime(): boolean } }).__stub.hasRuntime());
  const status = await stub.connect();
  expect(hasRuntime === false || status !== 'connected').toBe(true);
  await stub.pending([DEPOSIT]);
  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: "Sieve isn't open" })).toBeVisible();
  expect(await stub.status()).not.toBe('connected');
});

test('wrong port name is refused', async ({ openStub, openPanel }) => {
  const stub = await openStub();
  await stub.connect({ name: 'not-sieve' });
  await stub.waitForStatus('disconnected');
  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: "Sieve isn't open" })).toBeVisible();
});

test('shortcut toggles the panel (8.9 b, e)', async ({ openPanel, sw }) => {
  const panel = await openPanel();
  await expect(panel.getByRole('heading', { name: 'Sieve', level: 1 })).toBeVisible();
  const windowId = await panel.evaluate(() => chrome.windows.getCurrent().then((w) => w.id ?? -1));
  type Hook = { __sieveDev: { command(name: string, windowId: number): string; panelWindows(): number[] } };
  const press = (w: number) => sw.evaluate(([id]) => (self as unknown as Hook).__sieveDev.command('open-sieve', id), [w] as const);
  // The panel reports its window in panel/hello once chrome.windows.getCurrent() resolves.
  await expect.poll(() => sw.evaluate(() => (self as unknown as Hook).__sieveDev.panelWindows())).toContain(windowId);
  // A panel is open in another window only: the command opens one in this window.
  expect(await press(windowId + 1000)).toBe('open');
  // With the panel open in this window, the command sends panel/close and the panel closes itself.
  const closed = panel.waitForEvent('close');
  expect(await press(windowId)).toBe('close');
  await closed;
  // A second press opens it again (sidePanel.open needs a real key press; headless cannot show the side panel).
  await expect.poll(() => press(windowId)).toBe('open');
});

test('long unbroken strings never push Approve off screen (70 R-UI-04)', async ({ openStub, openPanel }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  const base64 = 'QUJD'.repeat(1250); // a 5,000-character line
  const url = `https://tracking.example/${'a1b2'.repeat(144)}`; // about 600 characters
  const title = 'S'.repeat(300);
  await stub.pending([
    variant(DEPOSIT, {
      requestId: 'long-1',
      question: url.slice(0, 500),
      item: { ...DEPOSIT.item!, title },
      options: [{ ...DEPOSIT.options[0]!, text: base64, chars: base64.length }, DEPOSIT.options[1]!, DEPOSIT.options[2]!],
    }),
  ]);
  for (const width of [320, 400]) {
    await panel.setViewportSize({ width, height: 800 });
    await expect(panel.getByRole('heading', { name: 'A request is waiting' })).toBeVisible();
    const overflow = await panel.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const approve = panel.getByRole('button', { name: 'Approve' });
    await approve.scrollIntoViewIfNeeded();
    await expect(approve).toBeInViewport();
  }
});
