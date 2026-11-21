// End-to-end tests with the unpacked dev build and a stub home base (50 sections 14.2 and 16, 8.9).
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import type { Worker } from '@playwright/test';
import type { Decision, ExtensionToPage } from '@sieve/shared';
import { deriveExtensionId } from '../scripts/ext-id.mjs';
import { badgeText, expect, focusedWindow, notificationIds, popupCount, setOpenOnArrival, sharedExtensionId, test } from './fixtures';
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
  expect(ack).toMatchObject({ type: 'sieve/hello-ack', version: 1, extensionVersion: '0.1.1' });
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
  expect(open?.description).toBe('Open or close Sieve');
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
  // Approved from this panel: the heading counts what it sent (board F8B) and offers the receipt.
  await expect(panel.getByRole('heading', { name: `Sent ${DEPOSIT_EXCERPT.length} characters to Test assistant` })).toBeVisible();
  await expect(panel.getByText('Sent: excerpt. Nothing else left this device.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Open the receipt' })).toBeVisible();
  await expect.poll(() => badgeText(sw)).toBe('');
  expect(await decisions(stub)).toHaveLength(1); // exactly one decision

  // Nothing stored: storage.local is empty until the person changes a setting; storage.session holds only request
  // ids (50 section 16, item 8).
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
  await stub.raw({ type: 'sieve/pending', version: 1, proposals: 'not a list' });
  await expect(panel.getByRole('heading', { name: 'No requests waiting' })).toBeVisible();
  expect(await stub.status()).toBe('connected');
  await stub.raw({ type: 'sieve/hello', version: 1 });
  await stub.raw('not an object');
  await stub.raw({ type: 'sieve/resolved', version: 1, requestId: 'bad id!', outcome: 'approved' });
  await stub.waitForStatus('disconnected');
  await expect(panel.getByRole('heading', { name: "Sieve isn't open" })).toBeVisible();
});

test('a newer page: unknown values are left out and never disconnect (0.1.1)', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  const newKind = variant(LEASE, { warnings: [{ kind: 'from-next-week' as never, message: 'Something new to know.' }] });
  const newOutcome = variant(STATEMENT, { outcome: 'needs-a-new-screen' as never });
  const badOption = variant(DEPOSIT, { requestId: 'req-bad-option', options: [{ ...DEPOSIT.options[0]!, step: 'everything' as never }, DEPOSIT.options[1]!, DEPOSIT.options[2]!] });
  // Far more than 5 messages, each with something this build does not know: none of them counts.
  for (let i = 0; i < 4; i++) {
    await stub.pending([DEPOSIT, newKind, newOutcome, badOption]);
    await stub.raw({ type: 'sieve/settings', version: 1, anything: true });
    await stub.raw({ type: 'sieve/resolved', version: 1, requestId: 'req-other', outcome: 'revoked' });
  }
  await expect.poll(() => badgeText(sw)).toBe('2');
  expect(await stub.status()).toBe('connected');
  await expect(panel.getByRole('heading', { name: 'A request is waiting' })).toBeVisible();
  await expect(panel.getByText(`Test assistant asked for: "${DEPOSIT.question}"`)).toBeVisible();
  await expect(panel.getByText('Also waiting (1)')).toBeVisible();
  await panel.getByRole('button', { name: /Planner/ }).click();
  await expect(panel.getByText(`Planner asked for: "${LEASE.question}"`)).toBeVisible();
  await expect(panel.getByText('Something new to know.')).toHaveCount(0);
  await expect(panel.getByText(STATEMENT.question)).toHaveCount(0);
});

test('text hash: an approval names the text on screen; a text that changed is checked again (0.1.1)', async ({ openStub, openPanel }) => {
  const stub = await connected(openStub);
  const panel = await openPanel();
  await stub.pending([{ ...DEPOSIT, textHash: 'e2e0000000000001' }]);
  const approve = panel.getByRole('button', { name: 'Approve' });
  await approve.click();
  type Sent = Extract<ExtensionToPage, { type: 'sieve/decision' }> & { textHash?: string };
  const sent = async () => (await stub.received()).filter((m): m is Sent => m.type === 'sieve/decision');
  await expect.poll(async () => (await sent()).map((m) => m.textHash)).toEqual(['e2e0000000000001']);
  // The page refused it: its text changed, and it sends the new list.
  const changedText = 'Your deposit of $1,200 was paid on March 3 by check.';
  await stub.pending([{ ...DEPOSIT, options: [{ ...DEPOSIT.options[0]!, text: changedText, chars: changedText.length }, DEPOSIT.options[1]!, DEPOSIT.options[2]!], textHash: 'e2e0000000000002' }]);
  await expect(panel.getByRole('alert')).toHaveText('The text to send changed. Check it again before you approve.');
  await expect(panel.getByTestId('outgoing-text')).toHaveText(changedText);
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(async () => (await sent()).map((m) => m.textHash)).toEqual(['e2e0000000000001', 'e2e0000000000002']);
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
  await setOpenOnArrival(sw, false); // the notification path; with the setting on, a request opens the popup (below)
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

test('a new request opens the real popup once; closed, it stays closed for that request (7.7)', async ({ openStub, sw }) => {
  const stub = await connected(openStub);
  const win = await focusedWindow(sw);
  await stub.pending([DEPOSIT, LEASE]); // two at once: one popup
  await expect.poll(() => panelViews(sw)).toContainEqual({ surface: 'popup', visible: true, windowId: win });
  expect(await popupCount(sw)).toBe(1);
  expect(await notificationIds(sw)).toEqual([]);
  expect(await badgeText(sw)).toBe('2');
  // The person closes it without deciding.
  expect(await press(sw, win)).toBe('close');
  await expect.poll(() => popupCount(sw)).toBe(0);
  // The page repeats its list, and reloads (the same requests are added again): no popup, no notification.
  await stub.pending([DEPOSIT, LEASE]);
  await stub.disconnect();
  await stub.connect();
  await stub.waitForStatus('connected');
  await stub.pending([DEPOSIT, LEASE]);
  await stub.page.waitForTimeout(500); // asserting an absence: give a wrong open time to happen
  expect(await popupCount(sw)).toBe(0);
  expect(await notificationIds(sw)).toEqual([]);
  // A new request opens it again, showing the new one with the others waiting.
  await stub.pending([DEPOSIT, LEASE, STATEMENT]);
  await expect.poll(() => popupCount(sw)).toBe(1);
  expect(await notificationIds(sw)).toEqual([]);
  expect(await sw.evaluate(() => chrome.storage.session.get('announced'))).toEqual({
    announced: [DEPOSIT.requestId, LEASE.requestId, STATEMENT.requestId],
  });
  // It never opened the side panel (no gesture): the only page is the popup.
  expect((await panelViews(sw)).map((v) => v.surface)).toEqual(['popup']);
});

test('settings: the popup switch turns opening on arrival off, and then a request only notifies', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  const page = await openPanel('?surface=popup');
  await page.getByRole('button', { name: 'Settings' }).click();
  const toggle = page.getByRole('switch', { name: 'Open when a request arrives' });
  await expect(toggle).toBeChecked();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => sw.evaluate(() => chrome.storage.local.get(null))).toEqual({ settings: { openOnArrival: false } });
  await page.close();
  await expect.poll(() => panelViews(sw)).toEqual([]);
  const win = await focusedWindow(sw);
  await stub.pending([DEPOSIT]);
  await expect.poll(() => notificationIds(sw)).toEqual([`sieve-req-${DEPOSIT.requestId}`]);
  expect(await popupCount(sw)).toBe(0);
  expect(await badgeText(sw)).toBe('1');
  // Back on: the next request opens the popup in the focused window.
  await setOpenOnArrival(sw, true);
  await stub.pending([DEPOSIT, LEASE]);
  await expect.poll(() => panelViews(sw)).toContainEqual({ surface: 'popup', visible: true, windowId: win });
  expect(await notificationIds(sw)).toEqual([`sieve-req-${DEPOSIT.requestId}`]);
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

type PanelView = { surface: 'popup' | 'panel'; visible: boolean; windowId?: number };
type Hook = { __sieveDev: { command(name: string, windowId: number): string; panelWindows(): number[]; panelViews(): PanelView[] } };
const press = (sw: Worker, w: number) => sw.evaluate(([id]) => (self as unknown as Hook).__sieveDev.command('open-sieve', id), [w] as const);
const panelViews = (sw: Worker) => sw.evaluate(() => (self as unknown as Hook).__sieveDev.panelViews());

test('shortcut: closes the panel page showing in the window, else opens the popup (8.9 b, e)', async ({ openPanel, sw }) => {
  const panel = await openPanel(); // a tab, so it counts as the side panel
  await expect(panel.getByRole('heading', { name: 'Sieve', level: 1 })).toBeVisible();
  const windowId = await panel.evaluate(() => chrome.windows.getCurrent().then((w) => w.id ?? -1));
  // The page reports its window and surface in panel/hello once chrome.windows.getCurrent() resolves.
  await expect.poll(() => sw.evaluate(() => (self as unknown as Hook).__sieveDev.panelWindows())).toContain(windowId);
  expect(await panelViews(sw)).toEqual([{ surface: 'panel', visible: true, windowId }]);
  // Nothing of Sieve shows in another window: the command opens the popup there (a Chrome window has focus; this
  // id has no window, so Chrome refuses, and nothing else is tried after the gesture).
  expect(await press(sw, windowId + 1000)).toBe('popup');
  // With the panel page showing in this window, the command sends panel/close and the page closes itself.
  const closed = panel.waitForEvent('close');
  expect(await press(sw, windowId)).toBe('close');
  await closed;
  await expect.poll(() => panelViews(sw)).toEqual([]);
});

test('manifest: the toolbar icon opens the popup, the side panel stays, Chrome 127+', async ({ sw }) => {
  const info = await sw.evaluate(async () => ({
    manifest: chrome.runtime.getManifest() as chrome.runtime.ManifestV3,
    popup: await chrome.action.getPopup({}),
    behavior: await chrome.sidePanel.getPanelBehavior(),
    hasOpenPopup: typeof chrome.action.openPopup === 'function',
  }));
  expect(info.manifest.action?.default_popup).toBe('sidepanel/index.html');
  expect(info.popup).toMatch(/^chrome-extension:\/\/[a-p]{32}\/sidepanel\/index\.html$/);
  expect((info.manifest as { side_panel?: { default_path?: string } }).side_panel?.default_path).toBe('sidepanel/index.html');
  expect(info.manifest.minimum_chrome_version).toBe('127');
  // A click on the icon must open the popup, not the side panel.
  expect(info.behavior.openPanelOnActionClick).toBe(false);
  expect(info.hasOpenPopup).toBe(true);
});

test('popup: the shortcut opens the real popup, 400 px wide and as tall as its content; open and close leak nothing', async ({ openStub, openPanel, sw }) => {
  const stub = await connected(openStub);
  // An extension tab to look into the popup with chrome.extension.getViews. It is a panel page in window 1, so
  // the popup goes to a second window.
  const viewer = await openPanel();
  await expect.poll(() => panelViews(sw)).toHaveLength(1);
  const popupWindow = await sw.evaluate(async () => (await chrome.windows.create({ url: 'about:blank', focused: true, width: 1280, height: 1000 }))?.id ?? -1);
  type Measure = { surface?: string; width: number; height: number; scrollWidth: number; root: number; main: number; mainScroll: number; footer: string[] } | null;
  const measure = () =>
    viewer.evaluate((): Measure => {
      const [w] = chrome.extension.getViews({ type: 'popup' });
      if (!w) return null;
      const doc = w.document;
      const root = doc.getElementById('root')?.firstElementChild;
      const main = doc.querySelector('main');
      if (!root || !main) return null;
      return {
        surface: doc.documentElement.dataset.surface,
        width: w.innerWidth,
        height: w.innerHeight,
        scrollWidth: doc.documentElement.scrollWidth,
        root: root.getBoundingClientRect().height,
        main: main.clientHeight,
        mainScroll: main.scrollHeight,
        footer: Array.from(doc.querySelectorAll('footer button'), (b) => b.textContent ?? ''),
      };
    });

  for (let round = 0; round < 3; round++) {
    expect(await press(sw, popupWindow)).toBe('popup');
    // The popup said hello as a popup, from its own window.
    await expect.poll(() => panelViews(sw)).toContainEqual({ surface: 'popup', visible: true, windowId: popupWindow });
    await expect.poll(async () => (await measure())?.footer).toEqual(['Keep open on the side', 'Open Sieve']);
    const empty = await measure();
    expect(empty).toMatchObject({ surface: 'popup', width: 400 });
    expect(empty!.scrollWidth).toBeLessThanOrEqual(400);
    expect(empty!.root).toBeLessThan(600);
    expect(Math.abs(empty!.height - empty!.root)).toBeLessThanOrEqual(1); // the popup is as tall as the page
    if (round === 0) {
      // A request makes it taller, up to 600 px; past that the main area scrolls, never the page sideways.
      await stub.pending([DEPOSIT, LEASE, STATEMENT]);
      await expect.poll(async () => (await measure())?.root ?? 0).toBeGreaterThan(empty!.root);
      const full = await measure();
      expect(full!.width).toBe(400);
      expect(full!.scrollWidth).toBeLessThanOrEqual(400);
      expect(full!.root).toBeLessThanOrEqual(600);
      expect(Math.abs(full!.height - full!.root)).toBeLessThanOrEqual(1);
      if (full!.root === 600) expect(full!.mainScroll).toBeGreaterThan(full!.main);
      await stub.pending([]);
      await expect.poll(async () => (await measure())?.root).toBe(empty!.root);
    }
    // A second press closes it (the popup gets panel/close and calls window.close()).
    expect(await press(sw, popupWindow)).toBe('close');
    await expect.poll(() => viewer.evaluate(() => chrome.extension.getViews({ type: 'popup' }).length)).toBe(0);
    // Its port went with it: only the viewer tab is left.
    await expect.poll(() => panelViews(sw)).toEqual([expect.objectContaining({ surface: 'panel' })]);
  }
  const contexts = await sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['POPUP' as chrome.runtime.ContextType] })).length);
  expect(contexts).toBe(0);
});

test('popup layout in a tab: 400 px, content height up to 600 px, the main area scrolls', async ({ openStub, openPanel }) => {
  const stub = await connected(openStub);
  const page = await openPanel('?surface=popup');
  await page.setViewportSize({ width: 400, height: 800 });
  await expect(page.getByRole('heading', { name: 'No requests waiting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep open on the side' })).toBeVisible();
  const size = () =>
    page.evaluate(() => {
      const root = document.getElementById('root')!.firstElementChild!;
      const main = document.querySelector('main')!;
      return {
        width: document.body.getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        root: root.getBoundingClientRect().height,
        page: document.documentElement.getBoundingClientRect().height,
        main: main.clientHeight,
        mainScroll: main.scrollHeight,
      };
    });
  const empty = await size();
  expect(empty.width).toBe(400);
  expect(empty.root).toBeLessThan(600);
  expect(empty.page).toBe(empty.root); // nothing stretches it to the viewport
  const long = 'QUJD'.repeat(1250);
  await stub.pending([variant(DEPOSIT, { requestId: 'tall-1', options: [{ ...DEPOSIT.options[0]!, text: long, chars: long.length }, DEPOSIT.options[1]!, DEPOSIT.options[2]!] }), LEASE]);
  await expect(page.getByRole('heading', { name: 'A request is waiting' })).toBeVisible();
  const tall = await size();
  expect(tall.root).toBe(600);
  expect(tall.page).toBeLessThanOrEqual(600);
  expect(tall.mainScroll).toBeGreaterThan(tall.main);
  expect(tall.scrollWidth).toBeLessThanOrEqual(400);
  // Approve is reached by scrolling the main area; header and footer stay on screen.
  const approve = page.getByRole('button', { name: 'Approve' });
  await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Sieve', level: 1 })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Keep open on the side' })).toBeInViewport();
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
