// 20 section 20, folder: A-FD-1, A-CON-2, A-CON-3, A-CON-4, A-CON-10 (folder), moves (70 R-IDX-06), permission and
// partial walks (70 R-FILE-11 to R-FILE-13), with the in-memory folder of tests/harness/memFs.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { dropDb, freshDb } from '../../../../tests/harness/indexEnv';
import { attachMemFolder, MemFolder } from '../../../../tests/harness/memFs';
import { verifyFresh } from '../../index/consistency';
import type { SieveDb } from '../../index/db';
import { ready } from '../../index/lifecycle';
import { peekQueue } from '../../index/queue/ingestQueue';
import { duplicatesOf, search } from '../../index/search';
import { setMlClient } from '../../ml/client';
import { setPdfExtractor } from '../readers/pdf';
import { connectFolder, reauthorize } from '../registry';
import { scanFolder } from './scan';
import { fileTypeOf, isIgnored } from './walk';

vi.mock('@/ai', async () => (await import('../../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));

let db: SieveDb;
let folder: MemFolder;

beforeEach(async () => {
  setMlClient(createHashEmbedClient());
  setPdfExtractor(async (data) => ({ text: new TextDecoder().decode(data).replace(/^%PDF-1\.7\n/, ''), pages: 1, truncated: false }));
  db = freshDb('real');
  await ready(db);
  attachMemFolder(db, (folder = new MemFolder('Documents')));
  (globalThis as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => folder.root;
});

afterEach(async () => {
  await dropDb(db);
  setPdfExtractor(null);
  setMlClient(null);
  delete (globalThis as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

const ids = async () => ((await db.records.where('source').equals('folder').primaryKeys()) as string[]).sort();

describe('walk rules (A-FD-1)', () => {
  it('ignores system files and folders, and knows the supported types', () => {
    for (const n of ['.DS_Store', '~$draft.docx', 'Thumbs.db', 'x.crdownload', 'y.tmp']) expect(isIgnored(n, false)).toBe(true);
    for (const n of ['node_modules', '.git', 'Photos Library.photoslibrary', '__MACOSX']) expect(isIgnored(n, true)).toBe(true);
    expect(isIgnored('notes.md', false)).toBe(false);
    expect(['a.txt', 'b.MD', 'c.pdf', 'd.json', 'e.JPG', 'f.png', 'g.webp', 'h.heic', 'i.docx'].map(fileTypeOf)).toEqual(['text', 'markdown', 'pdf', 'json', 'jpeg', 'png', 'webp', 'heic', null]);
  });

  it('counts HEIC as skipped and a 31 MB PDF as too large', async () => {
    folder.write('IMG_1.heic', 'heic bytes').write('big.pdf', new Uint8Array(31 * 1024 * 1024)).write('ok.txt', 'fine');
    await connectFolder(db);
    await scanFolder(db);
    expect((await db.sources.get('folder'))?.skipped).toMatchObject({ heic: 1, 'too-large': 1 });
    expect(await ids()).toEqual(['folder:ok.txt']);
  });
});

describe('scans', () => {
  it('first scan indexes txt, md, pdf and json; a second scan reads nothing (fast path)', async () => {
    folder.write('notes.md', '# Notes\nCall the landlord.').write('a/lease.pdf', '%PDF-1.7\n12. Pets. One dog under 40 pounds.')
      .write('chat.json', JSON.stringify({ name: 'Jordan', messages: [{ type: 'message', date: '2026-11-12T18:02:00', from: 'Jordan Ellis', text: 'Hi' }] })).write('todo.txt', 'buy milk');
    await connectFolder(db);
    await scanFolder(db);
    expect(await ids()).toEqual(['folder:a/lease.pdf', 'folder:chat.json', 'folder:notes.md', 'folder:todo.txt']);
    expect((await db.records.get('folder:a/lease.pdf'))?.text).toContain('12. Pets.');
    expect((await db.records.get('folder:chat.json'))?.text).toContain('[2026-11-12 18:02] Jordan Ellis: Hi');
    const reads = folder.readCount;
    const versions = (await db.records.toArray()).map((r) => [r.id, r.version, r.indexedAt]);
    await scanFolder(db);
    expect(folder.readCount - reads).toBe(4);   // the walk's size and date lookups only; no file is read again
    expect((await db.records.toArray()).map((r) => [r.id, r.version, r.indexedAt])).toEqual(versions);
    expect((await db.sources.get('folder'))?.phase).toBe('idle');
  });

  it('A-CON-2: a deleted file is gone after the rescan, with its vectors', async () => {
    folder.write('keep.txt', 'keep this').write('gone.txt', 'zebracorn notes');
    await connectFolder(db);
    await scanFolder(db);
    await peekQueue(db)?.whenIdle();
    expect(await db.vectors.where('recordId').equals('folder:gone.txt').count()).toBeGreaterThan(0);
    folder.remove('gone.txt');
    await scanFolder(db);
    expect(await ids()).toEqual(['folder:keep.txt']);
    expect(await db.vectors.where('recordId').equals('folder:gone.txt').count()).toBe(0);
    expect(await db.tombstones.get('folder:gone.txt')).toMatchObject({ reason: 'source-deleted' });
    expect((await search(db, 'zebracorn', { live: false })).map((c) => c.recordId)).not.toContain('folder:gone.txt');
  });

  it('A-CON-3: new bytes at the same path with an older time re-index in place', async () => {
    folder.write('w2.txt', 'deposit $1,200 walrus', { lastModified: 2_000 });
    await connectFolder(db);
    await scanFolder(db);
    const v1 = await db.records.get('folder:w2.txt');
    folder.write('w2.txt', 'deposit $1,400 narwhal', { lastModified: 1_000 });
    await scanFolder(db);
    const v2 = await db.records.get('folder:w2.txt');
    expect(v2?.version).toBe((v1?.version ?? 0) + 1);
    expect(v2?.text).toContain('1,400');
    await peekQueue(db)?.whenIdle();
    expect((await db.vectors.where('recordId').equals('folder:w2.txt').toArray()).every((r) => r.recordVersion === v2?.version)).toBe(true);
  });

  it('A-CON-4: the same bytes in two folders are two records, one candidate, and duplicatesOf names the other', async () => {
    folder.write('a/W-2.txt', 'W-2 wages for 2025 from Quorrel Labs').write('old/W-2.txt', 'W-2 wages for 2025 from Quorrel Labs');
    await connectFolder(db);
    await scanFolder(db);
    await peekQueue(db)?.whenIdle();
    expect(await ids()).toEqual(['folder:a/W-2.txt', 'folder:old/W-2.txt']);
    const res = await search(db, 'W-2 wages Quorrel', { live: false });
    const hits = res.map((c) => c.recordId).filter((id) => id.endsWith('W-2.txt'));
    expect(hits).toHaveLength(1);
    expect((await duplicatesOf(db, hits[0] as string)).map((r) => r.id)).toHaveLength(1);
  });

  it('a moved file keeps its category and vectors, and the tombstone points at the new path', async () => {
    folder.write('Taxes/W-2.txt', 'W-2 statement for 2025');
    await connectFolder(db);
    await scanFolder(db);
    await peekQueue(db)?.whenIdle();
    const before = await db.records.get('folder:Taxes/W-2.txt');
    const calls = (await import('../../../../tests/harness/aiMock')).aiControl.labelCalls.length;
    folder.move('Taxes/W-2.txt', 'Taxes/2025/W-2.txt');
    await scanFolder(db);
    const after = await db.records.get('folder:Taxes/2025/W-2.txt');
    expect(after?.category).toBe(before?.category);
    expect(after?.categoryBy).toBe(before?.categoryBy);
    expect(await db.vectors.where('recordId').equals('folder:Taxes/2025/W-2.txt').count()).toBeGreaterThan(0);
    expect(await db.tombstones.get('folder:Taxes/W-2.txt')).toMatchObject({ reason: 'moved', movedTo: 'folder:Taxes/2025/W-2.txt' });
    await peekQueue(db)?.whenIdle();
    expect((await import('../../../../tests/harness/aiMock')).aiControl.labelCalls.length).toBe(calls);
  });
});

describe('permission and partial walks', () => {
  it('a prompt state sets permission-needed; reauthorize scans', async () => {
    folder.write('a.txt', 'alpha');
    await connectFolder(db);
    folder.setPermission('prompt');
    await scanFolder(db);
    expect(await db.sources.get('folder')).toMatchObject({ errorCode: 'permission-needed', error: 'Allow access to Documents again to keep it up to date' });
    folder.requestAnswer = 'granted';
    await reauthorize(db, 'folder');
    expect(await ids()).toEqual(['folder:a.txt']);
    expect((await db.sources.get('folder'))?.errorCode).toBeUndefined();
  });

  it('a NotAllowedError mid-walk deletes nothing; a missing root says so and deletes nothing', async () => {
    for (let i = 0; i < 12; i++) folder.write(`f${i}.txt`, `file ${i}`);
    await connectFolder(db);
    await scanFolder(db);
    expect(await ids()).toHaveLength(12);
    folder.resetWalkCount();
    folder.walkFailAfter = { count: 10, name: 'NotAllowedError' };
    folder.remove('f0.txt');
    await scanFolder(db);
    expect(await ids()).toHaveLength(12);
    expect((await db.sources.get('folder'))?.errorCode).toBe('permission-needed');
    folder.walkFailAfter = null;
    folder.rootMissing = true;
    await scanFolder(db);
    expect(await ids()).toHaveLength(12);
    expect(await db.sources.get('folder')).toMatchObject({ errorCode: 'folder-missing', error: 'Folder not found. Pick it again.' });
  });

  it('a file that changes while read is not counted and is indexed by the next rescan', async () => {
    folder.write('notes.md', 'hello');
    await connectFolder(db);
    folder.failNext('notes.md', 'NotReadableError');
    await scanFolder(db);
    expect(await ids()).toEqual([]);
    expect((await db.sources.get('folder'))?.skipped ?? {}).toEqual({});
    await scanFolder(db);
    expect(await ids()).toEqual(['folder:notes.md']);
  });

  it('a self loop stops at the depth limit', async () => {
    folder.write('a.txt', 'a');
    folder.selfLoop('deep');
    await connectFolder(db);
    await expect(scanFolder(db)).resolves.toBeUndefined();
    expect(await ids()).toEqual(['folder:a.txt']);
  });
});

describe('verifyFresh for folder files (A-CON-10)', () => {
  it('different bytes give changed and re-index; a missing file is gone; no permission is unknown', async () => {
    folder.write('n.txt', 'version one', { lastModified: 5 }).write('m.txt', 'other');
    await connectFolder(db);
    await scanFolder(db);
    expect(await verifyFresh(db, 'folder:n.txt')).toBe('ok');
    folder.write('n.txt', 'version two', { lastModified: 5 });
    expect(await verifyFresh(db, 'folder:n.txt')).toBe('changed');
    expect((await db.records.get('folder:n.txt'))?.text).toBe('version two');
    folder.remove('m.txt');
    expect(await verifyFresh(db, 'folder:m.txt')).toBe('gone');
    folder.setPermission('prompt');
    const why: string[] = [];
    expect(await verifyFresh(db, 'folder:n.txt', { onUnverified: (r) => why.push(r) })).toBe('unknown');
    expect(why).toEqual(['no-permission']);
  });
});
