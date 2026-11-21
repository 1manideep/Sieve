// The Gmail token on this computer (20 section 15.1, Nov 20): kept on the real Gmail row for its lifetime and shared
// by every tab, read on start and before every sync, renewed inside the person's own clicks (Google Identity Services
// only), and cleared on a 401, on expiry and on disconnect; signing out of Sieve keeps it (Nov 21, 2026). With FakeGmail and the fake sign-in script.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGmail } from '../../../../tests/harness/fakeGmail';
import { installFakeGis } from '../../../../tests/harness/fakeGis';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { dropDb, freshDb, until } from '../../../../tests/harness/indexEnv';
import { GMAIL_SCOPE } from '../../index/config';
import { openDbNamed, type SieveDb, type SourceRow } from '../../index/db';
import { closeDb } from '../../index/lifecycle';
import { peekQueue } from '../../index/queue/ingestQueue';
import { setMlClient } from '../../ml/client';

vi.mock('@/ai', async () => (await import('../../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});
// Firebase as the app has it: already started (so sign-out is watched), with the fake Auth.
vi.mock('firebase/app', async () => ({ ...(await import('@/test/fakes/firebaseApp')), getApps: () => [{ name: '[DEFAULT]' }] }));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/app/firebase', async () => {
  const fake = await import('@/test/fakes/firebaseAuth');
  return { getAuthInstance: () => fake.getAuth() };
});

const fakeAuth = await import('@/test/fakes/firebaseAuth');
const { connectGmail, disconnectSource, reauthorize } = await import('../registry');
const { getGmailToken, gmailTokenRequestOpen, resetGmailAuth } = await import('./auth');
const { resetGmailBucket } = await import('./api');
const { UnitBucket } = await import('./rateLimit');
const { GMAIL_RENEW_EVERY_MS, resetGmailRenew } = await import('./renew');
const { runGmailSync } = await import('./sync');
const { clearStoredToken, storedTokenOf, writeStoredToken } = await import('./tokenStore');

let gmail: FakeGmail;
let gis: ReturnType<typeof installFakeGis>;
let db: SieveDb;

function fastBucket(set: (b: InstanceType<typeof UnitBucket>) => void = resetGmailBucket, Bucket: typeof UnitBucket = UnitBucket): void {
  set(new Bucket({ unitsPerMinute: 1e12, capacity: 1e9, maxConcurrency: 4 }));
}

/** Date.now moved forward, with time still passing (Dexie and the polling helpers keep working). */
function later(ms: number): void {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ms);
}

function keptToken(row: SourceRow | undefined) {
  return storedTokenOf(row)?.value ?? null;
}

beforeEach(() => {
  setMlClient(createHashEmbedClient());
  resetGmailAuth();
  resetGmailRenew();
  fastBucket();
  gmail = new FakeGmail();
  gmail.install();
  gis = installFakeGis({ token: gmail.token });
  fakeAuth.setFakeAuthUser(fakeAuth.googleUser);
  db = freshDb('real');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await dropDb(db);
  gmail.restoreFetch();
  gis.uninstall();
  resetGmailAuth();
  resetGmailRenew();
  resetGmailBucket();
  setMlClient(null);
  fakeAuth.setFakeAuthUser(null);
});

async function connect(): Promise<void> {
  gmail.add({ id: 'a', subject: 'Hello', text: 'hi' });
  await connectGmail(db);
  await runGmailSync(db);
  await peekQueue(db)?.whenIdle();
}

/** Fresh copies of the sources and index modules, as a reload or another tab has them: nothing in memory. */
async function freshTab() {
  vi.resetModules();
  const registry = await import('../registry');
  const auth = await import('./auth');
  const sync = await import('./sync');
  const dbModule = await import('../../index/db');
  const lifecycle = await import('../../index/lifecycle');
  const ml = await import('../../ml/client');
  const api = await import('./api');
  const rate = await import('./rateLimit');
  ml.setMlClient(createHashEmbedClient());
  fastBucket(api.resetGmailBucket, rate.UnitBucket);
  const tabDb = dbModule.openDbNamed(db.name, 'real');
  return { registry, auth, sync, db: tabDb, close: () => lifecycle.closeDb(tabDb, { flush: false }) };
}

describe('the token is kept on this computer and shared by every tab', () => {
  it('survives a reload: a fresh page uses the stored token and syncs with no Continue', async () => {
    await connect();
    const token = gmail.token;
    expect(keptToken(await db.sources.get('gmail'))).toBe(token);
    const name = db.name;
    await closeDb(db, { flush: false });   // the page goes away, and its memory with it
    resetGmailAuth();
    const tab = await freshTab();
    try {
      expect(tab.auth.getGmailToken()).toBeNull();
      gmail.add({ id: 'b', subject: 'After the reload', text: 'new mail' });
      await tab.registry.startSources(tab.db);
      expect(tab.auth.getGmailToken()).toBe(token);
      await until(async () => (await tab.db.records.get('gmail:b')) !== undefined);
      expect(await tab.db.sources.get('gmail')).toMatchObject({ connected: true, needsAuth: false });
    } finally {
      await tab.close();
      db = openDbNamed(name, 'real');
    }
  }, 30_000);

  it('a second tab with nothing in memory does not ask to sign in while the stored token is good', async () => {
    await connect();
    const tab = await freshTab();
    try {
      await tab.registry.startSources(tab.db);
      await tab.sync.runGmailSync(tab.db);
      expect(tab.auth.getGmailToken()).toBe(gmail.token);
      expect((await tab.db.sources.get('gmail'))?.needsAuth).toBe(false);
    } finally {
      await tab.close();
    }
    expect((await db.sources.get('gmail'))?.needsAuth).toBe(false);
  }, 30_000);

  it('a token another tab kept reaches the indexer tab, which syncs at once instead of waiting for its timer', async () => {
    await connect();
    gmail.token = 'ya29.from-another-tab';   // Google now takes only the new token
    gmail.add({ id: 'c', subject: 'Arrived', text: 'new' });
    const accessToken = { value: gmail.token, expiresAt: Date.now() + 3_600_000, scope: GMAIL_SCOPE };
    await db.sources.update('gmail', { accessToken } as Partial<SourceRow>);
    await until(async () => (await db.records.get('gmail:c')) !== undefined);
    expect(getGmailToken()).toBe('ya29.from-another-tab');
    expect((await db.sources.get('gmail'))?.needsAuth).toBe(false);
  });

  it('a token that ran out is cleared from the row, and the next sync asks for Continue', async () => {
    await connect();
    later(61 * 60_000);
    gmail.calls = [];
    await runGmailSync(db);
    const row = await db.sources.get('gmail');
    expect(keptToken(row)).toBeNull();
    expect(row?.needsAuth).toBe(true);
    expect(getGmailToken()).toBeNull();
    expect(gmail.calls.filter((c) => c.startsWith('GET /history'))).toHaveLength(0);
  });

  it('a 401 clears the stored token; a refused token that another tab already replaced is left alone', async () => {
    await connect();
    await clearStoredToken(db, 'ya29.some-other-token');
    expect(keptToken(await db.sources.get('gmail'))).toBe(gmail.token);
    gmail.script([{ match: 'GET /history', status: 401 }]);
    await runGmailSync(db);
    await until(async () => keptToken(await db.sources.get('gmail')) === null);
    expect((await db.sources.get('gmail'))?.needsAuth).toBe(true);
  });

  it('is never written to the Playground database', async () => {
    const playground = freshDb('playground');
    try {
      await playground.sources.put({ kind: 'gmail', connected: true, progress: { done: 0, total: 0 }, paused: false });
      await writeStoredToken(playground, { value: 'ya29.never-here', expiresAt: Date.now() + 3_600_000, scope: GMAIL_SCOPE });
      expect(keptToken(await playground.sources.get('gmail'))).toBeNull();
    } finally {
      await dropDb(playground);
    }
  });

  it('signing out of Sieve keeps the Gmail access on this computer (Nov 21, 2026)', async () => {
    await connect();
    const token = gmail.token;
    fakeAuth.setFakeAuthUser(null);
    for (const call of fakeAuth.onAuthStateChanged.mock.calls) (call[1] as ((user: null) => void) | undefined)?.(null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(keptToken(await db.sources.get('gmail'))).toBe(token);
    expect(getGmailToken()).toBe(token);
    expect(gis.revoked).not.toContain(token);
  });

  it('connecting again the account that is already indexed keeps its place: no new listing, no count from zero', async () => {
    await connect();
    const before = await db.sources.get('gmail');
    expect(before?.progress.total).toBe(1);
    const listings = () => gmail.calls.filter((c) => /messages\?/.test(c) && !/history/.test(c)).length;
    const listed = listings();
    await connectGmail(db);
    await runGmailSync(db);
    await peekQueue(db)?.whenIdle();
    const after = await db.sources.get('gmail');
    expect(after?.progress).toEqual(before?.progress);
    expect(after?.reconciledAt).toBe(before?.reconciledAt);
    expect(after?.connected).toBe(true);
    expect(listings()).toBe(listed);                 // only the history since the cursor was read
    expect(await db.records.where('source').equals('gmail').count()).toBe(1);
  });

  it('disconnect revokes and clears the stored token', async () => {
    await connect();
    const token = gmail.token;
    await disconnectSource(db, 'gmail');
    expect(keptToken(await db.sources.get('gmail'))).toBeNull();
    expect(gis.revoked).toContain(token);
  });
});

describe('Continue and renewal inside clicks', () => {
  it('Continue keeps the new token on the row and clears the ask', async () => {
    await connect();
    await db.sources.update('gmail', { needsAuth: true });
    gis.set({ token: 'ya29.continued' });
    gmail.token = 'ya29.continued';
    await reauthorize(db, 'gmail');
    const row = await db.sources.get('gmail');
    expect(keptToken(row)).toBe('ya29.continued');
    expect(row?.needsAuth).toBe(false);
    expect(row?.errorCode).toBeUndefined();
  });

  it('a click anywhere renews through Google Identity Services when under 10 minutes are left, once per 5 minutes', async () => {
    gis.set({ expiresIn: 8 * 60 });   // the token from connect has 8 minutes left
    await connect();
    gis.set({ token: 'ya29.renewed', expiresIn: 8 * 60 });
    gmail.token = 'ya29.renewed';
    const before = gis.requests.length;
    document.body.click();
    // Asked inside the click, so the popup keeps the user activation.
    expect(gis.requests.slice(before)).toEqual([{ prompt: '', login_hint: gmail.email }]);
    await until(async () => keptToken(await db.sources.get('gmail')) === 'ya29.renewed');
    expect(getGmailToken()).toBe('ya29.renewed');
    expect((await db.sources.get('gmail'))?.needsAuth).toBe(false);

    document.body.click();   // still under 10 minutes, but within the 5 minutes since the last try
    expect(gis.requests).toHaveLength(before + 1);
    later(GMAIL_RENEW_EVERY_MS);
    document.body.click();
    expect(gis.requests).toHaveLength(before + 2);
    expect(fakeAuth.reauthenticateWithPopup).not.toHaveBeenCalled();
  });

  it('a click asks nothing while more than 10 minutes are left', async () => {
    await connect();
    const before = gis.requests.length;
    document.body.click();
    expect(gis.requests).toHaveLength(before);
  });

  it('without the Google sign-in script a click asks nothing: the Firebase popup is only for Continue', async () => {
    gis.set({ expiresIn: 8 * 60 });
    await connect();
    gis.uninstall();
    document.body.click();
    expect(gmailTokenRequestOpen()).toBe(false);
    expect(fakeAuth.reauthenticateWithPopup).not.toHaveBeenCalled();
  });
});
