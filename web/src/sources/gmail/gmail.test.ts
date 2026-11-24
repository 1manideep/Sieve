// 20 section 20, Gmail: A-GM-1 to A-GM-5, A-EM-5, A-CON-1, A-CON-7 to A-CON-10 (Gmail), A-SR-11, with FakeGmail.
// A-GM-5 since Nov 20: the token is kept on the real Gmail row only (15.1), never in web storage or another table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { b64url, FakeGmail } from '../../../../tests/harness/fakeGmail';
import { installFakeGis } from '../../../../tests/harness/fakeGis';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { dropDb, freshDb, until } from '../../../../tests/harness/indexEnv';
import { BACKOFF } from '../../index/config';
import { verifyFresh } from '../../index/consistency';
import { openDbNamed, type SieveDb, type SourceRow } from '../../index/db';
import { closeDb, ready } from '../../index/lifecycle';
import { peekQueue } from '../../index/queue/ingestQueue';
import { getRuntime } from '../../index/runtime';
import { search, type SearchReport } from '../../index/search';
import { setMlClient } from '../../ml/client';
import { connectGmail, disconnectSource, startSources } from '../registry';
import { clearGmailToken, getGmailToken, requestGmailToken, resetGmailAuth, scrubToken } from './auth';
import { onIndexEvent } from '../../index/events';
import { GmailRateError, gmailFetch, getProfile, resetGmailBucket } from './api';
import { buildGmailQuery } from './liveSearch';
import { decodeMimeWords, decodeSnippet, extractBodies, header, isSkippable } from './mime';
import { UnitBucket } from './rateLimit';
import { GMAIL_MESSAGE_MAX_FAILURES, runGmailSync } from './sync';
import { storedTokenOf } from './tokenStore';
import { gmailWindowQuery, setGmailWindow } from './window';
import { GMAIL_WINDOW_KEY } from '../../state/gmailWindow';

vi.mock('@/ai', async () => (await import('../../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});

process.env.TZ = 'America/Chicago';
const DAY = 86_400_000;
let gmail: FakeGmail;
let gis: ReturnType<typeof installFakeGis>;
let db: SieveDb;

function fastBucket(): void {
  resetGmailBucket(new UnitBucket({ unitsPerMinute: 1e12, capacity: 1e9, maxConcurrency: 4 }));
}

beforeEach(async () => {
  setMlClient(createHashEmbedClient());
  resetGmailAuth();
  fastBucket();
  gmail = new FakeGmail();
  gmail.install();
  gis = installFakeGis({ token: gmail.token });
  db = freshDb('real');
});

afterEach(async () => {
  vi.useRealTimers();
  await dropDb(db);
  gmail.restoreFetch();
  gis.uninstall();
  resetGmailAuth();
  resetGmailBucket();
  setMlClient(null);
});

async function connect(): Promise<void> {
  await connectGmail(db);
  await runGmailSync(db);   // the backfill started by connect
  await peekQueue(db)?.whenIdle();
}

describe('MIME (A-GM-1, A-EM-5)', () => {
  it('alternative gives HTML only; mixed with a PDF counts the attachment; nested rfc822; base64url; iso-8859-1', () => {
    const alt = { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url('plain') } }, { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } }] };
    expect(extractBodies(alt)).toEqual({ html: '<p>html</p>', attachments: 0 });
    const mixed = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { data: b64url('body text') } }, { mimeType: 'application/pdf', filename: 'W-2.pdf', body: { attachmentId: 'a1', size: 900 } }] };
    expect(extractBodies(mixed)).toEqual({ text: 'body text', attachments: 1 });
    const nested = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'message/rfc822', parts: [{ mimeType: 'text/plain', body: { data: b64url('forwarded') } }] }] };
    expect(extractBodies(nested).text).toBe('forwarded');
    expect(extractBodies({ mimeType: 'text/plain', body: { data: b64url('ok?>>~') } }).text).toBe('ok?>>~');
    const latin = { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-8859-1"' }], body: { data: b64url(new Uint8Array([0x63, 0x61, 0x66, 0xe9])) } };
    expect(extractBodies(latin).text).toBe('café');
  });

  it('survives 40 levels of nesting and parts without a type', () => {
    let part: Record<string, unknown> = { mimeType: 'text/plain', body: { data: b64url('deep') } };
    for (let i = 0; i < 40; i++) part = { mimeType: 'multipart/mixed', parts: [part] };
    expect(() => extractBodies(part)).not.toThrow();
    expect(extractBodies({ parts: [{ body: { data: 'x' } }] } as never)).toEqual({ attachments: 0 });
  });

  it('decodes encoded words, joins adjacent ones, leaves plain text', () => {
    expect(decodeMimeWords('=?UTF-8?B?8J+OgiBQYXJ0eSBvbiBTYXR1cmRheQ==?=')).toBe('🎂 Party on Saturday');
    expect(decodeMimeWords('=?UTF-8?Q?Caf=C3=A9_plans?=')).toBe('Café plans');
    expect(decodeMimeWords('=?ISO-8859-1?Q?Jos=E9?=')).toBe('José');
    expect(decodeMimeWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?=')).toBe('ab');
    expect(decodeMimeWords('=?UTF-8?B?8J+O?= =?UTF-8?B?gg==?=')).toBe('🎂');   // an emoji split across two words
    expect(decodeMimeWords('Plain subject')).toBe('Plain subject');
    expect(header({ headers: [{ name: 'subject', value: '=?UTF-8?B?8J+OgiBQYXJ0eSBvbiBTYXR1cmRheQ==?=' }] }, 'Subject')).toBe('🎂 Party on Saturday');
  });

  it('snippets decode entities with no parser; drafts, chats, spam and trash are skippable', () => {
    expect(decodeSnippet('Tom &amp; Jerry&#39;s <img src="https://tracker.example/p.gif">')).toBe("Tom & Jerry's ");
    expect(isSkippable({ id: 'x', threadId: 'x', labelIds: ['DRAFT'] })).toBe(true);
    expect(isSkippable({ id: 'x', threadId: 'x', labelIds: ['INBOX'] })).toBe(false);
  });
});

describe('UnitBucket (A-GM-2)', () => {
  it('refills over time, serves interactive callers first, caps concurrency', async () => {
    vi.useFakeTimers();
    let now = 0;
    const b = new UnitBucket({ unitsPerMinute: 600, capacity: 20, maxConcurrency: 2, now: () => now });
    const order: string[] = [];
    const r1 = await b.acquire(20, 'background');
    const bg = b.acquire(10, 'background').then((rel) => (order.push('bg'), rel));
    const fg = b.acquire(10, 'interactive').then((rel) => (order.push('fg'), rel));
    now += 1_000;   // 10 units refilled: the interactive caller goes first
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(['fg']);
    now += 1_000;   // units for bg, but two requests are in flight (the cap is 2)
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(['fg']);
    r1();
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['fg', 'bg']);
    (await fg)();
    (await bg)();
    vi.useRealTimers();
  });
});

describe('UnitBucket on a long-lived signal', () => {
  it('removes its abort listener once the units are granted', async () => {
    const bucket = new UnitBucket({ unitsPerMinute: 1e12, capacity: 1e9, maxConcurrency: 4 });
    const ac = new AbortController();
    const add = vi.spyOn(ac.signal, 'addEventListener');
    const remove = vi.spyOn(ac.signal, 'removeEventListener');
    for (let i = 0; i < 5; i++) (await bucket.acquire(1, 'background', ac.signal))();
    expect(add).toHaveBeenCalledTimes(5);
    expect(remove).toHaveBeenCalledTimes(5);
  });
});

describe('REST errors (A-GM-3)', () => {
  it('a long Retry-After waits BACKOFF.maxMs at most', async () => {
    await requestGmailToken({ prompt: 'select_account' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    gmail.script([{ match: 'GET /profile', status: 429, headers: { 'Retry-After': '3600' } }]);
    const p = getProfile();
    await vi.advanceTimersByTimeAsync(BACKOFF.maxMs - 100);
    expect(gmail.calls.filter((c) => c.startsWith('GET /profile'))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toMatchObject({ emailAddress: gmail.email });
    expect(gmail.calls.filter((c) => c.startsWith('GET /profile'))).toHaveLength(2);
  });

  it('waits for Retry-After on 429 and gives GmailRateError after 6 attempts', async () => {
    await requestGmailToken({ prompt: 'select_account' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    gmail.script([{ match: 'GET /profile', status: 429, headers: { 'Retry-After': '3' } }]);
    const p = getProfile();
    await vi.advanceTimersByTimeAsync(2_900);
    expect(gmail.calls.filter((c) => c.startsWith('GET /profile'))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toMatchObject({ emailAddress: gmail.email });
    expect(gmail.calls.filter((c) => c.startsWith('GET /profile'))).toHaveLength(2);
    gmail.script([{ match: 'GET /profile', status: 503, times: 6 }]);
    const q = getProfile();
    const assertion = expect(q).rejects.toBeInstanceOf(GmailRateError);
    await vi.advanceTimersByTimeAsync(200_000);
    await assertion;
  });

  it('a 401 clears the token, stops the sync and sets needsAuth', async () => {
    gmail.add({ id: 'a', subject: 'One', text: 'one' });
    await connect();
    const lost: string[] = [];
    const off = onIndexEvent((e) => lost.push(e.type));
    gmail.script([{ match: 'GET /history', status: 401 }]);
    await runGmailSync(db);
    off();
    expect(lost).toContain('gmail-auth-lost');
    expect(getGmailToken()).toBeNull();
    expect((await db.sources.get('gmail'))?.needsAuth).toBe(true);
    // the refused token leaves the row too, so no tab takes it back (20 section 15.1)
    await until(async () => storedTokenOf(await db.sources.get('gmail')) === null);
    await expect(gmailFetch('/profile', { units: 1, priority: 'interactive' })).rejects.toMatchObject({ name: 'GmailAuthError' });
  });

  it('a message that keeps failing is skipped after a few syncs, so the rest of the mailbox still indexes', async () => {
    gmail.add({ id: 'a', subject: 'One', text: 'one' });
    gmail.add({ id: 'bad', subject: 'Broken', text: 'x' });
    gmail.add({ id: 'c', subject: 'Three', text: 'three' });
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/messages/bad')) return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid id value' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      return inner(input, init);
    }) as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await connect();   // the first failure stops this sync
    expect((await db.sources.get('gmail'))?.errorCode).toBe('unknown');
    for (let i = 1; i < GMAIL_MESSAGE_MAX_FAILURES; i++) await runGmailSync(db);
    const row = await db.sources.get('gmail');
    expect(row).toMatchObject({ phase: 'idle' });
    expect(row?.errorCode).toBeUndefined();
    expect(await db.records.get('gmail:a')).toBeDefined();
    expect(await db.records.get('gmail:c')).toBeDefined();
    expect(await db.records.get('gmail:bad')).toBeUndefined();
  });

  it('storage full during a sync leaves the row idle and paused for storage, so Resume shows', async () => {
    gmail.add({ id: 'a', subject: 'One', text: 'one' });
    await connect();
    gmail.add({ id: 'b', subject: 'Two', text: 'two' });
    const prev = (navigator as unknown as { storage?: unknown }).storage;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 99, quota: 100 }), persisted: async () => false, persist: async () => false } });
    try {
      await runGmailSync(db);
      expect(await db.sources.get('gmail')).toMatchObject({ phase: 'idle', paused: true, pausedBy: 'storage', errorCode: 'storage-full' });
    } finally {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: prev });
    }
  });

  it('403 insufficientPermissions sets gmail-forbidden with its reason', async () => {
    gmail.add({ id: 'a', subject: 'One', text: 'one' });
    await connect();
    gmail.script([{ match: 'GET /history', status: 403, body: { error: { code: 403, message: 'no', errors: [{ reason: 'insufficientPermissions' }] } } }]);
    await runGmailSync(db);
    expect(await db.sources.get('gmail')).toMatchObject({ errorCode: 'gmail-forbidden', error: 'Gmail refused access: insufficientPermissions.' });
  });
});

describe('connect and backfill (A-GM-4, A-GM-5)', () => {
  it('backfills 1,200 messages, resumes without refetching, and fills bodies in place', async () => {
    for (let i = 0; i < 1_200; i++) gmail.add({ id: `m${i}`, subject: `Message ${i}`, text: `Body of message ${i} about item ${i}.`, internalDate: gmail.now - (i + 1) * 3_600_000 }, { silent: true });
    gmail.add({ id: 'old', subject: 'Too old', text: 'old', internalDate: gmail.now - 400 * DAY }, { silent: true });
    await connect();
    const row = await db.sources.get('gmail');
    expect(row).toMatchObject({ connected: true, account: gmail.email, phase: 'idle' });
    expect(await db.records.count()).toBe(1_200);
    expect((await db.records.get('gmail:m5'))?.text).toBe('Body of message 5 about item 5.');
    expect(await db.records.get('gmail:old')).toBeUndefined();
    // a reload: a new handle on the same database, then the backfill again
    const name = db.name;
    await closeDb(db);
    db = openDbNamed(name, 'real');
    await ready(db);
    gmail.calls = [];
    gmail.add({ id: 'new1', subject: 'Arrived later', text: 'fresh body', internalDate: gmail.now - 60_000 }, { silent: true });
    await startSources(db);
    await runGmailSync(db, 'backfill');
    const gets = gmail.calls.filter((c) => c.startsWith('GET /messages/*'));
    expect(gets).toHaveLength(2);   // metadata and body of the one new message only
    expect((await db.records.get('gmail:new1'))?.text).toBe('fresh body');
  }, 60_000);

  it('a later sync goes back for an email that never got its body', async () => {
    gmail.add({ id: 'a', subject: 'First', text: 'the body of a' });
    gmail.add({ id: 'b', subject: 'Second', text: 'the body of b' });
    await connect();
    // as after a backfill that stopped before its bodies step: the record is there, its body is not
    const { ingestInternal } = await import('../../index/ingest');
    const before = await db.records.get('gmail:a');
    await ingestInternal(db, { source: 'gmail', sourceRef: 'a', kind: 'email', title: 'First', from: before?.from, threadId: before?.threadId, date: before?.date ?? 0, text: 'First' }, 'own', { bodyPending: true });
    expect((await db.records.get('gmail:a'))?.text).toBeUndefined();
    gmail.calls = [];
    await runGmailSync(db);   // history only: nothing new arrived
    expect((await db.records.get('gmail:a'))?.text).toBe('the body of a');
    expect((await db.records.get('gmail:b'))?.text).toBe('the body of b');
    expect(gmail.calls.filter((c) => c.startsWith('GET /messages/*'))).toHaveLength(1);
    expect((await db.sources.get('gmail'))?.phase).toBe('idle');
    gmail.calls = [];
    await runGmailSync(db);   // nothing left to fetch
    expect(gmail.calls.filter((c) => c.startsWith('GET /messages/*'))).toHaveLength(0);
  });

  it('keeps the token only on the real Gmail row, never in web storage; logs replace it', async () => {
    gmail.add({ id: 'a', subject: 'Hello', text: 'hi' });
    await connect();
    const token = gmail.token;
    const row = await db.sources.get('gmail');
    expect(storedTokenOf(row)).toMatchObject({ value: token, scope: expect.stringContaining('gmail.readonly') });
    const { accessToken: _kept, ...rest } = row as SourceRow & { accessToken?: unknown };
    expect(JSON.stringify(rest)).not.toContain(token);
    for (const t of db.tables) {
      if (t.name === 'sources') continue;
      const rows = await t.toArray();
      expect(JSON.stringify(rows)).not.toContain(token);
    }
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i) ?? '')).not.toContain(token);
    for (let i = 0; i < sessionStorage.length; i++) expect(sessionStorage.getItem(sessionStorage.key(i) ?? '')).not.toContain(token);
    expect(scrubToken(`Bearer ${token} failed`)).toBe('Bearer [token] failed');
  });

  it('a denied scope connects nothing; a blocked popup says so', async () => {
    gis.set({ grantAll: false });
    await connectGmail(db);
    expect(await db.sources.get('gmail')).toMatchObject({ connected: false, errorCode: 'scope-denied' });
    gis.set({ grantAll: true, respondWith: 'popup_failed_to_open' });
    await connectGmail(db);
    expect(await db.sources.get('gmail')).toMatchObject({ errorCode: 'popup-blocked', error: 'Chrome blocked the Google sign-in window. Allow pop-ups for this site and try again.' });
  });
});

describe('deletions and history (A-CON-1, A-CON-7, A-CON-8, A-CON-9)', () => {
  it('A-CON-1: a deleted email leaves no record, vectors or keyword entry, also after a reload with a stale snapshot', async () => {
    gmail.add({ id: 'dep', subject: 'Re: Deposit', text: 'Your booking K7Q2LM deposit of $1,200 was received.' });
    gmail.add({ id: 'other', subject: 'Lunch', text: 'Lunch on Friday.' });
    await connect();
    expect(await db.vectors.where('recordId').equals('gmail:dep').count()).toBeGreaterThan(0);
    const rt = getRuntime(db);
    await rt.keyword.flush();
    const staleSnapshot = await db.search.get('minisearch');
    gmail.delete('dep');
    await runGmailSync(db);
    expect(await db.records.get('gmail:dep')).toBeUndefined();
    expect(await db.vectors.where('recordId').equals('gmail:dep').count()).toBe(0);
    expect(await db.tombstones.get('gmail:dep')).toMatchObject({ reason: 'source-deleted' });
    expect(rt.keyword.has('gmail:dep')).toBe(false);
    for (const q of ['K7Q2LM', 'what did they say about my deposit']) expect((await search(db, q, { live: false })).map((c) => c.recordId)).not.toContain('gmail:dep');
    // reload with the snapshot saved before the delete
    if (staleSnapshot) await db.search.put(staleSnapshot);
    const name = db.name;
    await closeDb(db, { flush: false });
    db = openDbNamed(name, 'real');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await ready(db);
    info.mockRestore();
    expect(getRuntime(db).keyword.has('gmail:dep')).toBe(false);
    expect((await search(db, 'K7Q2LM', { live: false })).map((c) => c.recordId)).not.toContain('gmail:dep');
  });

  it('A-CON-7: an expired history id runs a reconciliation and sets the cursor from the profile', async () => {
    gmail.add({ id: 'a', subject: 'Keep', text: 'keep me' });
    gmail.add({ id: 'b', subject: 'Gone', text: 'delete me' });
    await connect();
    gmail.deleteSilently('b');
    gmail.add({ id: 'c', subject: 'New during the gap', text: 'new' });
    gmail.expireHistory();
    await runGmailSync(db);
    expect(await db.records.get('gmail:b')).toBeUndefined();
    expect(await db.records.get('gmail:c')).toBeDefined();
    expect((await db.sources.get('gmail'))?.cursor).toBe(String(gmail.historyId));
  });

  it('A-CON-8: trash removes with reason trashed; restore re-ingests with a new version', async () => {
    gmail.add({ id: 't', subject: 'Parcel', text: 'parcel text' });
    await connect();
    const v1 = (await db.records.get('gmail:t'))?.version ?? 0;
    gmail.trash('t');
    await runGmailSync(db);
    expect(await db.records.get('gmail:t')).toBeUndefined();
    expect(await db.tombstones.get('gmail:t')).toMatchObject({ reason: 'trashed' });
    gmail.restore('t');
    await runGmailSync(db);
    const back = await db.records.get('gmail:t');
    expect(back?.version).toBeGreaterThan(v1);
    expect(await db.tombstones.get('gmail:t')).toBeUndefined();
  });

  it('A-CON-9: a message trashed after the backfill listed it is skipped', async () => {
    for (let i = 0; i < 6; i++) gmail.add({ id: `r${i}`, subject: `Race ${i}`, text: `race ${i}`, internalDate: gmail.now - (i + 1) * 60_000 }, { silent: true });
    // trash r3 locally between listing and its turn: the first metadata fetch removes it from the index
    let done = false;
    const prev = gmail.handle;
    gmail.handle = async (url, headers) => {
      if (!done && url.pathname.endsWith('/messages/r0')) {
        done = true;
        const { removeRecord } = await import('../../index/consistency');
        await removeRecord(db, 'gmail:r3', 'trashed');
      }
      return prev(url, headers);
    };
    await connect();
    expect(await db.records.get('gmail:r3')).toBeUndefined();
    expect(await db.records.get('gmail:r2')).toBeDefined();
  });

  it('disconnect removes every Gmail record and revokes the token', async () => {
    gmail.add({ id: 'a', subject: 'One', text: 'one' });
    await connect();
    await disconnectSource(db, 'gmail');
    expect(await db.records.where('source').equals('gmail').count()).toBe(0);
    expect(await db.sources.get('gmail')).toMatchObject({ connected: false });
    expect(storedTokenOf(await db.sources.get('gmail'))).toBeNull();
    expect(gis.revoked).toContain(gmail.token);
    expect(getGmailToken()).toBeNull();
  });
});

describe('verifyFresh for Gmail (A-CON-10)', () => {
  it('404 is gone and removes; trash is gone; no token is unknown with no-token', async () => {
    gmail.add({ id: 'v1', subject: 'Check', text: 'check' });
    gmail.add({ id: 'v2', subject: 'Trash me', text: 'x' });
    gmail.add({ id: 'v3', subject: 'Keep', text: 'y' });
    await connect();
    expect(await verifyFresh(db, 'gmail:v3')).toBe('ok');
    gmail.deleteSilently('v1');
    expect(await verifyFresh(db, 'gmail:v1')).toBe('gone');
    expect(await db.records.get('gmail:v1')).toBeUndefined();
    gmail.messages.get('v2')!.labelIds = ['TRASH'];
    expect(await verifyFresh(db, 'gmail:v2')).toBe('gone');
    clearGmailToken();
    const why: string[] = [];
    expect(await verifyFresh(db, 'gmail:v3', { onUnverified: (r) => why.push(r) })).toBe('unknown');
    expect(why).toEqual(['no-token']);
  });
});

describe('live Gmail search (A-SR-11)', () => {
  it('builds the query strings of 20 section 10.5', () => {
    const df = (t: string) => ({ deposit: 3, landlord: 9, seattle: 1, flight: 4, order: 6 })[t] ?? 0;
    const now = new Date('2026-11-17T09:00:00-06:00');
    const q = async (text: string) => {
      const { parseQuestion } = await import('../../index/parseQuestion');
      const p = parseQuestion(text, now, 'en-US');
      return buildGmailQuery({ corrected: p.corrected, hints: p.hints }, df).q;
    };
    return Promise.all([
      q('What did my landlord say about the deposit?').then((x) => expect(x).toBe('deposit landlord -in:chats -in:drafts')),
      q('When does my flight to Seattle leave?').then((x) => expect(x).toBe('seattle flight -in:chats -in:drafts')),
      q('Emails from Dana in October').then((x) => expect(x).toBe('from:dana after:2026/09/30 before:2026/11/01 -in:chats -in:drafts')),
      q('Where is order #88231?').then((x) => expect(x).toBe('order "88231" -in:chats -in:drafts')),
      q('my "deposit" OR in:spam -from:me').then((x) => {
        expect(x).not.toContain('in:spam');
        expect((x.match(/"/g) ?? []).length % 2).toBe(0);
      }),
    ]);
  });

  it('with a sender: "the latest" asks for the sender alone, and a query that finds nothing falls back to the sender (Nov 22)', () => {
    const df = () => 1;
    const build = (corrected: string, from: string) => buildGmailQuery({ corrected, hints: { from } }, df);
    expect(build('What did Benji ask me in his latest email?', 'Benji')).toEqual({ q: 'from:benji -in:chats -in:drafts', fallback: 'from:benji -in:chats -in:drafts' });
    expect(build('What did Benji say about the budget?', 'Benji')).toEqual({ q: 'budget from:benji -in:chats -in:drafts', fallback: 'from:benji -in:chats -in:drafts' });
    expect(build('What did Northside Gym say about lockers?', 'Northside Gym').fallback).toBe('from:"Northside Gym" -in:chats -in:drafts');
    // a role is not a sender's name: the word stays in the query, and the fallback is a word, as before
    expect(build('What did my landlord say about the deposit?', 'landlord')).toEqual({ q: 'landlord deposit -in:chats -in:drafts', fallback: 'landlord -in:chats -in:drafts' });
  });

  it('finds the latest email from a sender whose mail is all older than the index (Nov 22)', async () => {
    await connect();
    gmail.add({ id: 'old0', subject: 'Lunch', from: 'Benji Okoro <benji@inbox.example>', text: 'Lunch was great. Same place next month?', internalDate: gmail.now - 320 * DAY }, { silent: true });
    gmail.add({ id: 'old1', subject: 'Quick favour', from: 'Benji Okoro <benji@inbox.example>', text: 'Could you send me the slides from the offsite?', internalDate: gmail.now - 300 * DAY }, { silent: true });
    expect(await db.records.get('gmail:old1')).toBeUndefined();
    let report: SearchReport | undefined;
    const res = await search(db, 'What did Benji ask me in his latest email?', { hints: { from: 'Benji' }, onReport: (r) => (report = r) });
    expect(report?.live?.q).toBe('from:benji -in:chats -in:drafts');
    expect(res.map((c) => c.recordId)).toContain('gmail:old1');
    expect(report?.latest?.[0]).toBe('gmail:old1');
  });

  it("adds Gmail's own hits and reports the characters sent", async () => {
    gmail.add({ id: 'l1', subject: 'Deposit question', from: 'Dana <dana@thistlewick-pm.example>', text: 'About the landlord deposit.' });
    await connect();
    gmail.add({ id: 'l2', subject: 'Old deposit receipt', from: 'Dana <dana@thistlewick-pm.example>', text: 'Landlord deposit receipt from long ago.', internalDate: gmail.now - 300 * DAY }, { silent: true });
    let report: SearchReport | undefined;
    const res = await search(db, 'What did my landlord say about the deposit?', { onReport: (r) => (report = r) });
    expect(report?.live?.charsSent).toBe(report?.live?.q.length);
    expect(report?.live?.q).toContain('deposit');
    expect(res.map((c) => c.recordId)).toContain('gmail:l1');
    expect(await db.records.get('gmail:l2')).toBeDefined();   // fetched because the index did not have it
  });
});

describe('a chosen window: index only the last N days (Nov 24)', () => {
  afterEach(() => window.localStorage.removeItem(GMAIL_WINDOW_KEY));

  function mailbox(): void {
    gmail.now = Date.now();   // the window is counted from the real clock
    for (const [id, days] of [['d1', 1], ['d5', 5], ['d20', 20], ['d60', 60], ['d200', 200]] as const) {
      gmail.add({ id, subject: `Mail from ${days} days ago`, text: `Body ${id}.`, internalDate: gmail.now - days * DAY }, { silent: true });
    }
  }
  const ids = async () => ((await db.records.where('source').equals('gmail').primaryKeys()) as string[]).sort();

  it('picked before connecting: the first backfill lists only that window', async () => {
    mailbox();
    window.localStorage.setItem(GMAIL_WINDOW_KEY, '7');
    await connect();
    expect(await ids()).toEqual(['gmail:d1', 'gmail:d5']);
    expect(gmailWindowQuery(7)).toBe('newer_than:7d -in:chats -in:drafts');
  });

  it('the default is unchanged: six months, so 200 days ago stays out', async () => {
    mailbox();
    await connect();
    expect(await ids()).toEqual(['gmail:d1', 'gmail:d20', 'gmail:d5', 'gmail:d60']);
    expect(gmailWindowQuery(undefined)).toBe('newer_than:6m -in:chats -in:drafts');
  });

  it('shrinking removes older email at once; growing reads the days it adds', async () => {
    mailbox();
    await connect();
    const resync = vi.fn(async (d: SieveDb) => {
      await runGmailSync(d, 'backfill');
    });
    const shrunk = await setGmailWindow(db, 7, resync);
    expect(shrunk.removed).toBe(2);
    expect(await ids()).toEqual(['gmail:d1', 'gmail:d5']);
    expect(resync).not.toHaveBeenCalled();   // shorter than the default six months: nothing new to list
    expect((await db.tombstones.get('gmail:d60'))?.reason).toBe('user-removed');

    await setGmailWindow(db, 30, resync);
    expect(resync).toHaveBeenCalledTimes(1);
    await until(async () => (await ids()).includes('gmail:d20'));
    expect(await ids()).toEqual(['gmail:d1', 'gmail:d20', 'gmail:d5']);
    await expect(setGmailWindow(db, 0, resync)).rejects.toThrow(RangeError);
  });

  it('email that ages out of the window leaves on the next reconciliation', async () => {
    mailbox();
    window.localStorage.setItem(GMAIL_WINDOW_KEY, '30');
    await connect();
    expect(await ids()).toContain('gmail:d20');
    window.localStorage.setItem(GMAIL_WINDOW_KEY, '14');   // as if 16 days had passed for d20's window position
    await runGmailSync(db, 'reconcile');
    expect(await ids()).toEqual(['gmail:d1', 'gmail:d5']);
  });

  it('a question never reaches past the window: an after: floor, and an older sender is not fetched', async () => {
    mailbox();
    window.localStorage.setItem(GMAIL_WINDOW_KEY, '30');
    await connect();
    gmail.add({ id: 'benji', subject: 'Quick favour', from: 'Benji Okoro <benji@inbox.example>', text: 'Could you send me the slides?', internalDate: gmail.now - 90 * DAY }, { silent: true });
    let report: SearchReport | undefined;
    const res = await search(db, 'What did Benji ask me in his latest email?', { hints: { from: 'Benji' }, onReport: (r) => (report = r) });
    expect(report?.live?.q).toMatch(/^from:benji after:\d{4}\/\d{2}\/\d{2} -in:chats -in:drafts$/);
    expect(res.map((c) => c.recordId)).not.toContain('gmail:benji');
    expect(await db.records.get('gmail:benji')).toBeUndefined();
    // the floor only moves a question's own date later, never earlier
    const df = () => 0;
    expect(buildGmailQuery({ corrected: 'rent', hints: { after: '2026-11-20' } }, df, '2026-10-25').q).toContain('after:2026/11/19');
    expect(buildGmailQuery({ corrected: 'rent', hints: { after: '2026-01-01' } }, df, '2026-10-25').q).toContain('after:2026/10/24');
    expect(buildGmailQuery({ corrected: 'rent', hints: {} }, df, null).q).not.toContain('after:');
  });
});
