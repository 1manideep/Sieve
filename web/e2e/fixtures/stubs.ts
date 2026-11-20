// End-to-end set-up (40 section 19.1, through the AI layer's seam of 60 section 3.9.1). Before any app script runs,
// window.__sieveE2E gets the simulated Nano availability, the canned answers and an empty call log. Network guards
// record anything the Playground must never reach: Firestore and RTDB (AT-1), and the real cloud model or App Check
// (with the seam on, no model request may leave the page).
import type { Page } from '@playwright/test';
import { ANSWERS, CANARIES } from './fakeModel';

export type StubAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

export interface StubOptions {
  availability: StubAvailability;
}

/** One model call as the seam records it. */
export interface SeamCall {
  purpose: string;
  mode: string;
  data: string;
  recordIds: string[];
  prompt: string;
  sdkReported?: 'on_device' | 'in_cloud';
}

export async function installSeam(page: Page, options: StubOptions): Promise<void> {
  await page.addInitScript(
    ({ nano, answers, canaries }) => {
      (window as unknown as { __sieveE2E: unknown }).__sieveE2E = { nano, calls: [], faults: {}, answers, canaries };
    },
    { nano: options.availability, answers: ANSWERS, canaries: CANARIES },
  );
}

/** Requests the Playground must never make. Each one is aborted and recorded. */
export async function guardNetwork(page: Page): Promise<string[]> {
  const forbidden: string[] = [];
  const record = (url: string) => forbidden.push(url);
  await page.route(/https:\/\/firestore\.googleapis\.com\/.*|https:\/\/[^/]*firebaseio\.com\/.*|https:\/\/[^/]*firebasedatabase\.app\/.*/, (route) => {
    record(route.request().url());
    return route.abort();
  });
  await page.route(/https:\/\/firebasevertexai\.googleapis\.com\/.*/, (route) => {
    record(route.request().url());
    return route.abort();
  });
  // App Check is not a content leak, but nothing in these specs needs it: answer it locally.
  await page.route(/https:\/\/content-firebaseappcheck\.googleapis\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'e2e', ttl: '3600s' }) }),
  );
  return forbidden;
}

/** Collects console errors and page errors, to print when a spec fails. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Error objects print as "Error"; read each argument's stack in the page instead.
    void Promise.all(m.args().map((a) => a.evaluate((v) => {
          if (v && typeof v === 'object') {
            const e = v as { name?: string; message?: string; stack?: string; inner?: { message?: string } };
            return [e.name, e.message, e.inner?.message, e.stack?.split('\n').slice(0, 4).join(' | ')].filter(Boolean).join(': ');
          }
          return String(v);
        }).catch(() => '')))
      .then((parts) => errors.push(parts.filter(Boolean).join(' ') || m.text()))
      .catch(() => errors.push(m.text()));
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? ''})`));
  return errors;
}

export interface Prepared {
  forbidden: string[];
  errors: string[];
}

export async function prepareStubs(page: Page, options: StubOptions): Promise<Prepared> {
  await installSeam(page, options);
  const forbidden = await guardNetwork(page);
  const errors = collectErrors(page);
  return { forbidden, errors };
}

export async function seamCalls(page: Page): Promise<SeamCall[]> {
  return page.evaluate(() => (window as unknown as { __sieveE2E?: { calls?: SeamCall[] } }).__sieveE2E?.calls ?? []);
}

/** The calls the seam reported as running in the cloud: what left the device. */
export async function cloudCalls(page: Page): Promise<SeamCall[]> {
  return (await seamCalls(page)).filter((c) => c.sdkReported === 'in_cloud');
}

/** Switches the simulated Nano availability while the page runs (the seam re-reads it on every check). */
export async function setNano(page: Page, nano: StubAvailability): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __sieveE2E?: { nano?: string } };
    w.__sieveE2E = { ...(w.__sieveE2E ?? {}), nano: n };
  }, nano);
}
