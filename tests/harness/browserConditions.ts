// Browser conditions for Playwright (70 sections 15.3 and 15.5): frozen and resumed tabs, a hidden tab, a storage
// quota, offline, clock jumps, and an OPFS folder filled with corpus files (special names included). Used by
// e2e/robust.spec.ts; every helper works on Playwright's Chromium only (CDP).
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/** Page.setWebLifecycleState frozen, then active after `run` (R-PLAT-03). */
export async function whileFrozen(page: Page, run: () => Promise<void>): Promise<void> {
  const s = await cdp(page);
  await s.send('Page.setWebLifecycleState', { state: 'frozen' });
  try {
    await run();
  } finally {
    await s.send('Page.setWebLifecycleState', { state: 'active' });
    await s.detach();
  }
}

/** Opens and focuses a second page in the same context, so `page` becomes a hidden tab (R-PLAT-01). Returns a restore. */
export async function hide(page: Page): Promise<() => Promise<void>> {
  const other = await page.context().newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  return async () => {
    await page.bringToFront();
    await other.close();
  };
}

/** Storage.overrideQuotaForOrigin (V19, R-PLAT-07). Pass undefined to remove the override. */
export async function setQuota(page: Page, quotaSize: number | undefined): Promise<void> {
  const s = await cdp(page);
  const origin = new URL(page.url()).origin;
  await s.send('Storage.overrideQuotaForOrigin', quotaSize === undefined ? { origin } : { origin, quotaSize });
  await s.detach();
}

/** context.setOffline for the duration of `run` (R-PLAT-12, R-RLY-13). */
export async function whileOffline(context: BrowserContext, run: () => Promise<void>): Promise<void> {
  await context.setOffline(true);
  try {
    await run();
  } finally {
    await context.setOffline(false);
  }
}

/** A laptop sleep: install the clock, then jump it forward (R-PLAT-04). `ms` defaults to 3 hours. */
export async function sleepFor(page: Page, ms = 3 * 3_600_000): Promise<void> {
  await page.clock.install();
  await page.clock.fastForward(ms);
}

/** Stubs document.wasDiscarded before the app loads (R-PLAT-02; the real flag is manual check V13). */
export async function markDiscarded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'wasDiscarded', { configurable: true, value: true });
  });
}

export interface OpfsFile { path: string; bytes: number[]; lastModified?: number }

/**
 * Writes files into a folder under OPFS (navigator.storage.getDirectory()) and returns its name; the app is pointed
 * at it with a showDirectoryPicker stub (20 V-20.14). Paths may hold special names (R-FILE-10): bidi controls, NFD,
 * '#', '%', emoji. OPFS has no settable lastModified, so R-IDX-03's older-time case stays in Vitest (memFs).
 */
export async function fillOpfsFolder(page: Page, folder: string, files: OpfsFile[]): Promise<string> {
  await page.evaluate(async ({ folder: name, files: list }) => {
    const root = await navigator.storage.getDirectory();
    const top = await root.getDirectoryHandle(name, { create: true });
    for (const f of list) {
      const parts = f.path.split('/');
      let dir = top;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1] as string, { create: true });
      const w = await handle.createWritable();
      await w.write(new Uint8Array(f.bytes));
      await w.close();
    }
  }, { folder, files });
  await page.addInitScript((name) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(name);
  }, folder);
  return folder;
}

/** Records every request that leaves the page (the network guard of 60 section 3.9.2), except the app's own origin. */
export function recordOutgoing(page: Page): string[] {
  const seen: string[] = [];
  const own = () => {
    try {
      return new URL(page.url()).origin;
    } catch {
      return '';
    }
  };
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(own()) && !u.startsWith('data:') && !u.startsWith('blob:')) seen.push(u);
  });
  return seen;
}
