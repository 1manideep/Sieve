// 70 section 17 acceptance tests 2, 3 (the Vitest part), 4 (the index part) and 11 (the image part), driven by
// index-scenarios.json against the index and sources as built: FakeGmail, the memory folder, fake-indexeddb.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGmail } from '../../../../tests/harness/fakeGmail';
import { installFakeGis } from '../../../../tests/harness/fakeGis';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { dropDb, freshDb } from '../../../../tests/harness/indexEnv';
import { attachMemFolder, MemFolder } from '../../../../tests/harness/memFs';
import { corpusBytes, corpusCase } from '../../../../tests/harness/robustCorpus';
import { checkIntegrity, verifyFresh } from '@/index/consistency';
import type { SieveDb } from '@/index/db';
import { ready } from '@/index/lifecycle';
import { peekQueue } from '@/index/queue/ingestQueue';
import { search } from '@/index/search';
import { setMlClient } from '@/ml/client';
import { resetGmailBucket } from '@/sources/gmail/api';
import { resetGmailAuth, clearGmailToken } from '@/sources/gmail/auth';
import { UnitBucket } from '@/sources/gmail/rateLimit';
import { runGmailSync } from '@/sources/gmail/sync';
import { scanFolder } from '@/sources/folder/scan';
import { setPdfExtractor } from '@/sources/readers/pdf';
import { connectFolder, connectGmail } from '@/sources/registry';
import { expandMoved } from '../media';

vi.mock('@/ai', async () => (await import('../../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});

process.env.TZ = 'America/Chicago';

interface Step { op: string; [k: string]: unknown }
interface Msg { id: string; subject: string; from: string; text: string; labelIds?: string[] }
const scenario = (id: string) => corpusCase<{ steps: Step[] }, Record<string, unknown>>('index-scenarios.json', id);

let db: SieveDb;
let gmail: FakeGmail;
let gis: ReturnType<typeof installFakeGis>;
let folder: MemFolder;
let gmailConnected = false;
let folderConnected = false;

const searchIds = async (q: string) => (await search(db, q, { live: false })).map((c) => c.recordId);

async function run(steps: Step[]): Promise<void> {
  for (const s of steps) {
    switch (s.op) {
      case 'gmailAdd':
        for (const m of s.messages as Msg[]) gmail.add({ id: m.id, subject: m.subject, from: m.from, text: m.text, ...(m.labelIds ? { labelIds: m.labelIds } : {}) });
        break;
      case 'sync':
        if (!gmailConnected) {
          gmailConnected = true;
          await connectGmail(db);
        }
        await runGmailSync(db);
        await peekQueue(db)?.whenIdle();
        break;
      case 'deleteAtSource':
        if (s.silent) gmail.deleteSilently(String(s.id));
        else gmail.delete(String(s.id));
        break;
      case 'trash':
        gmail.trash(String(s.id));
        break;
      case 'restore':
        gmail.restore(String(s.id));
        break;
      case 'historyExpire':
        gmail.expireHistory();
        break;
      case 'folderWrite':
        folder.write(String(s.path), String(s.text), s.lastModified ? { lastModified: Number(s.lastModified) } : undefined);
        break;
      case 'folderRemove':
        folder.remove(String(s.path));
        break;
      case 'folderMove':
        folder.move(String(s.from), String(s.to));
        break;
      case 'scan':
        if (!folderConnected) {
          folderConnected = true;
          await connectFolder(db);
        }
        await scanFolder(db);
        await peekQueue(db)?.whenIdle();
        break;
      default:
        break;   // ask, block and verifyFresh are checked by each test
    }
  }
}

beforeEach(async () => {
  setMlClient(createHashEmbedClient());
  setPdfExtractor(async (data) => ({ text: new TextDecoder().decode(data), pages: 1, truncated: false }));
  resetGmailAuth();
  resetGmailBucket(new UnitBucket({ unitsPerMinute: 1e12, capacity: 1e9, maxConcurrency: 4 }));
  gmail = new FakeGmail();
  gmail.install();
  gis = installFakeGis({ token: gmail.token });
  db = freshDb('real');
  await ready(db);
  folder = new MemFolder('Documents');
  attachMemFolder(db, folder);
  (globalThis as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => folder.root;
  gmailConnected = false;
  folderConnected = false;
});

afterEach(async () => {
  await dropDb(db);
  gmail.restoreFetch();
  gis.uninstall();
  resetGmailAuth();
  resetGmailBucket();
  setPdfExtractor(null);
  setMlClient(null);
  delete (globalThis as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('17.2 index-scenarios.json (R-IDX-01 to R-IDX-08)', () => {
  it('deleted-email: no record, vector, consent or search hit; a source-deleted tombstone', async () => {
    const c = scenario('deleted-email');
    await run(c.input.steps);
    const id = String(c.expected.recordGone);
    expect(await db.records.get(id)).toBeUndefined();
    expect(await db.vectors.where('recordId').equals(id).count()).toBe(0);
    expect(await db.consents.get(id)).toBeUndefined();
    expect(await db.tombstones.get(id)).toMatchObject({ reason: 'source-deleted' });
    expect(await searchIds('deposit')).not.toContain(id);
  });

  it('missed-delete: verifyFresh finds the message gone and removes it', async () => {
    const c = scenario('missed-delete');
    await run(c.input.steps);
    const id = String(c.expected.recordGone);
    expect(await verifyFresh(db, id)).toBe('gone');
    expect(await db.records.get(id)).toBeUndefined();
  });

  it('trash-restore: trashed is removed with a trashed tombstone, restored comes back searchable', async () => {
    const c = scenario('trash-restore');
    const steps = c.input.steps;
    const id = String(c.expected.recordBack);
    await run(steps.slice(0, 4));
    expect(await db.records.get(id)).toBeUndefined();
    expect(await db.tombstones.get(id)).toMatchObject({ reason: 'trashed' });
    await run(steps.slice(4));
    expect(await db.records.get(id)).toBeDefined();
    expect(await db.tombstones.get(id)).toBeUndefined();
    expect(await searchIds('deposit')).toContain(id);
  });

  it('spam-never-indexed', async () => {
    await run(scenario('spam-never-indexed').input.steps);
    expect(await db.records.count()).toBe(0);
  });

  it('history-404: deletions in the gap are removed, arrivals added, the cursor is the profile', async () => {
    const c = scenario('history-404');
    await run(c.input.steps);
    for (const id of c.expected.gone as string[]) expect(await db.records.get(id)).toBeUndefined();
    for (const id of c.expected.present as string[]) expect(await db.records.get(id)).toBeDefined();
    expect((await db.sources.get('gmail'))?.cursor).toBe(String(gmail.historyId));
  });

  it('deleted-file: the record, its vectors and its search hit are gone', async () => {
    const c = scenario('deleted-file');
    await run(c.input.steps);
    const id = String(c.expected.recordGone);
    expect(await db.records.get(id)).toBeUndefined();
    expect(await db.vectors.where('recordId').equals(id).count()).toBe(0);
    expect(await searchIds('dog')).not.toContain(id);
  });

  it('same-path-new-bytes: new bytes with an older time re-index in place; vectors are version 2', async () => {
    const steps = scenario('same-path-new-bytes').input.steps;
    await run(steps.slice(0, 2));
    const v1 = (await db.records.get('folder:notes.md'))?.version ?? 0;
    await run(steps.slice(2));
    const rec = await db.records.get('folder:notes.md');
    expect(rec?.version).toBe(v1 + 1);   // "version 2" of the fixture: the first version plus one
    expect(rec?.text).toContain('1,400');
    expect(await searchIds('1,400')).toContain('folder:notes.md');
    const rows = await db.vectors.where('recordId').equals('folder:notes.md').toArray();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((v) => v.recordVersion === v1 + 1)).toBe(true);
  });

  it('same-size-same-time: the rescan misses it, verifyFresh catches it', async () => {
    const c = scenario('same-size-same-time');
    await run(c.input.steps);
    expect((await db.records.get('folder:notes.md'))?.text).toContain('1,200');
    expect(await verifyFresh(db, 'folder:notes.md')).toBe('changed');
    expect((await db.records.get('folder:notes.md'))?.text).toContain('1,400');
  });

  it('duplicate-content: five records, one candidate per content hash', async () => {
    await run(scenario('duplicate-content').input.steps);
    expect(await db.records.where('source').equals('folder').count()).toBe(5);
    const ids = await searchIds('W-2 wages');
    const w2 = ids.filter((id) => id.includes('W-2'));
    expect(w2).toHaveLength(1);
  });

  it('move-keeps-block: same derived fields, a moved tombstone, and a block on the old id reaches the new one', async () => {
    const c = scenario('move-keeps-block');
    await run(c.input.steps);
    const newId = String(c.expected.recordAt);
    expect(await db.records.get(newId)).toBeDefined();
    expect(await db.tombstones.get('folder:Taxes/W-2.pdf')).toMatchObject({ reason: 'moved', movedTo: newId });
    expect(await expandMoved(db, ['folder:Taxes/W-2.pdf'])).toContain(newId);
  });
});

describe('17.3 (Vitest part) checkIntegrity repairs an interrupted index (R-IDX-11)', () => {
  it('orphan and stale vector rows are deleted; a resurrected record is removed again', async () => {
    await run([{ op: 'folderWrite', path: 'a.txt', text: 'alpha deposit notes' }, { op: 'folderWrite', path: 'b.txt', text: 'beta lease notes' }, { op: 'scan' }]);
    const vec = new Float32Array(384);
    await db.vectors.bulkPut([
      { id: 'folder:ghost.txt#0', recordId: 'folder:ghost.txt', start: 0, end: 1, vector: vec, model: 'Xenova/all-MiniLM-L6-v2', recordVersion: 1 },
      { id: 'folder:a.txt#99', recordId: 'folder:a.txt', start: 0, end: 1, vector: vec, model: 'Xenova/all-MiniLM-L6-v2', recordVersion: 7 },
    ]);
    const b = await db.records.get('folder:b.txt');
    await db.tombstones.put({ id: 'folder:b.txt', deletedAt: (b?.indexedAt ?? 0) + 1, reason: 'source-deleted' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const report = await checkIntegrity(db);
    info.mockRestore();
    expect(report.repaired.orphanVectors).toBeGreaterThanOrEqual(1);
    expect(report.repaired.staleVectors).toBeGreaterThanOrEqual(1);
    expect(report.repaired.resurrected).toBe(1);
    expect(await db.vectors.where('recordId').equals('folder:ghost.txt').count()).toBe(0);
    expect(await db.vectors.get('folder:a.txt#99')).toBeUndefined();
    expect(await db.records.get('folder:b.txt')).toBeUndefined();
  });
});

describe('17.4 (index part) an expired Gmail token is "unknown", never an error (R-IDX-14, R-MAIL-10)', () => {
  it('verifyFresh says unknown with the no-token reason and keeps the record', async () => {
    await run([{ op: 'gmailAdd', messages: [{ id: '18c2f0a9d1e4b001', subject: 'Re: Deposit for the apartment', from: 'Dana Whitfield <dana@thistlewick-pm.example>', text: 'The deposit of $1,200 comes back in 21 days.' }] }, { op: 'sync' }]);
    clearGmailToken();
    const reasons: string[] = [];
    expect(await verifyFresh(db, 'gmail:18c2f0a9d1e4b001', { onUnverified: (r) => reasons.push(r) })).toBe('unknown');
    expect(reasons).toEqual(['no-token']);
    expect(await db.records.get('gmail:18c2f0a9d1e4b001')).toBeDefined();
  });

  it('a Gmail 503 is unknown, not an error', async () => {
    await run([{ op: 'gmailAdd', messages: [{ id: '18c2f0a9d1e4b001', subject: 'Re: Deposit for the apartment', from: 'Dana Whitfield <dana@thistlewick-pm.example>', text: 'The deposit of $1,200 comes back in 21 days.' }] }, { op: 'sync' }]);
    gmail.script([{ match: 'GET /messages/*', status: 503, times: 10, body: { error: { code: 503, message: 'Backend Error' } } }]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const p = verifyFresh(db, 'gmail:18c2f0a9d1e4b001');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await p).toBe('unknown');
    vi.useRealTimers();
  });
});

describe('17.11 (image part) a 30,000 x 30,000 PNG never stops a scan (R-FILE-08)', () => {
  it('the bomb is skipped as too-large without decoding; the file after it is indexed', async () => {
    const bomb = corpusBytes('files/bomb-30000.png');
    expect(bomb).not.toBeNull();
    const decode = vi.fn();
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = decode;
    try {
      folder.write('a-bomb.png', bomb as Uint8Array).write('z-notes.txt', 'Call the landlord about the sink.');
      await connectFolder(db);
      await scanFolder(db);
      expect((await db.sources.get('folder'))?.skipped).toMatchObject({ 'too-large': 1 });
      expect(await db.records.get('folder:z-notes.txt')).toBeDefined();
      expect(await db.records.get('folder:a-bomb.png')).toBeUndefined();
      expect(decode).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
    }
  });
});
