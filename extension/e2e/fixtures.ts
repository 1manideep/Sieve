// Playwright fixtures for the unpacked extension (50 section 14.2; Playwright's extension guide). Neither the side
// panel nor the popup can be opened from the toolbar in automation, so the panel page is opened in a normal tab
// (it counts as the side panel; `?surface=popup` gives it the popup layout). The real popup is opened with
// chrome.action.openPopup() and read through chrome.extension.getViews from an extension tab.
import { test as base, chromium, expect as baseExpect } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionToPage, ProposalPreview } from '@sieve/shared';

const EXT = fileURLToPath(new URL('../dist-dev', import.meta.url)); // ESM: no __dirname
export const STUB_URL = 'http://localhost:5173/';

/** The EXTENSION_ID constant from shared/src/constants.ts, read as text (the e2e run imports types only). */
export function sharedExtensionId(): string {
  const text = readFileSync(new URL('../../shared/src/constants.ts', import.meta.url), 'utf8');
  return /export const EXTENSION_ID = '([^']+)'/.exec(text)?.[1] ?? '';
}

export interface StubPage {
  page: Page;
  connect(opts?: { homeBase?: boolean; name?: string; hello?: boolean }): Promise<string>;
  pending(list: (ProposalPreview & { textHash?: string })[]): Promise<void>;
  resolved(requestId: string, outcome: 'approved' | 'declined' | 'expired' | 'error'): Promise<void>;
  raw(message: unknown): Promise<void>;
  disconnect(): Promise<void>;
  received(): Promise<ExtensionToPage[]>;
  status(): Promise<string>;
  waitForStatus(status: string): Promise<void>;
}

interface Fixtures {
  context: BrowserContext;
  sw: Worker;
  extensionId: string;
  openPanel: (search?: string) => Promise<Page>;
  openStub: (origin?: string) => Promise<StubPage>;
  panelProblems: string[];
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their dependencies
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sieve-ext-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      // A screen taller than the default 800 x 600, so a popup can reach Chrome's 600 px cap below the toolbar.
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--screen-info={0,0 1600x1200}'],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(sw.url().split('/')[2] ?? '');
  },
  panelProblems: async ({}, use) => { // eslint-disable-line no-empty-pattern
    const problems: string[] = [];
    await use(problems);
  },
  openPanel: async ({ context, extensionId, panelProblems }, use) => {
    const pages: Page[] = [];
    await use(async (search = '') => {
      const page = await context.newPage();
      pages.push(page);
      page.on('console', (m) => {
        if (m.type() === 'error') panelProblems.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => panelProblems.push(`pageerror: ${e.message}`));
      await page.addInitScript(() => {
        const w = window as unknown as { __csp: string[] };
        w.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
        });
      });
      await page.goto(`chrome-extension://${extensionId}/sidepanel/index.html${search}`);
      return page;
    });
    // No CSP violations and no console errors on any panel page (50 section 14.2).
    for (const page of pages) {
      if (page.isClosed()) continue;
      const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? ['init script did not run']);
      panelProblems.push(...csp.map((c) => `csp: ${c}`));
    }
    baseExpect(panelProblems).toEqual([]);
  },
  openStub: async ({ context, extensionId }, use) => {
    await use(async (origin = STUB_URL) => {
      const page = await context.newPage();
      await page.goto(`${origin}?ext=${extensionId}`);
      type W = { __stub: { connect(o?: object): string; pending(l: unknown): void; resolved(id: string, o: string): void; raw(m: unknown): void; disconnect(): void; received: ExtensionToPage[]; status: string } };
      const stub: StubPage = {
        page,
        connect: (opts = {}) => page.evaluate((o) => (window as unknown as W).__stub.connect(o), opts),
        pending: (list) => page.evaluate((l) => (window as unknown as W).__stub.pending(l), list),
        resolved: (id, outcome) => page.evaluate(([i, o]) => (window as unknown as W).__stub.resolved(i, o), [id, outcome] as const),
        raw: (m) => page.evaluate((x) => (window as unknown as W).__stub.raw(x), m),
        disconnect: () => page.evaluate(() => (window as unknown as W).__stub.disconnect()),
        received: () => page.evaluate(() => (window as unknown as W).__stub.received),
        status: () => page.evaluate(() => (window as unknown as W).__stub.status),
        waitForStatus: async (status) => {
          await baseExpect.poll(() => page.evaluate(() => (window as unknown as W).__stub.status)).toBe(status);
        },
      };
      return stub;
    });
  },
});

export const expect = test.expect;

export function badgeText(sw: Worker): Promise<string> {
  return sw.evaluate(() => chrome.action.getBadgeText({}));
}

export function notificationIds(sw: Worker): Promise<string[]> {
  return sw.evaluate(() => chrome.notifications.getAll().then((all) => Object.keys(all)));
}

/** Writes the setting the popup's switch writes (chrome.storage.local `settings`, 50 section 7.10). */
export function setOpenOnArrival(sw: Worker, openOnArrival: boolean): Promise<void> {
  return sw.evaluate((v) => chrome.storage.local.set({ settings: { openOnArrival: v } }), openOnArrival);
}

/** How many Sieve popups are open right now. */
export function popupCount(sw: Worker): Promise<number> {
  return sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['POPUP' as chrome.runtime.ContextType] })).length);
}

/** Opens a focused normal window (the person is looking at Chrome) and waits until Chrome reports it as focused. */
export async function focusedWindow(sw: Worker): Promise<number> {
  const id = await sw.evaluate(async () => (await chrome.windows.create({ url: 'about:blank', focused: true, width: 1280, height: 1000 }))?.id ?? -1);
  await baseExpect
    .poll(() => sw.evaluate(async () => {
      const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      return w.focused ? w.id : -1;
    }))
    .toBe(id);
  return id;
}
