// 70 section 3.7: imageDims (R-FILE-08) on the files/ and photos/ corpus, and expandMoved (R-IDX-06) on a real
// (fake-indexeddb) db.
import type { IndexRecord } from '@sieve/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corpusBytes } from '../../../tests/harness/robustCorpus';
import { forgetDb, openDbNamed, type SieveDb } from '@/index/db';
import { expandMoved, imageDims, MAX_IMAGE_PIXELS, safeToDecode } from './media';

const rec = (id: string, over: Partial<IndexRecord> = {}): IndexRecord => ({
  id, source: id.startsWith('folder:') ? 'folder' : 'gmail', sourceRef: id.slice(id.indexOf(':') + 1), kind: 'document', title: 'W-2.pdf', date: 1,
  preview: '', category: 'Money', categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 1, contentHash: 'h', version: 1, ...over,
});

describe('imageDims (R-FILE-08)', () => {
  it('the 30,000 x 30,000 PNG bomb is read from its header and is too large to decode', () => {
    const bytes = corpusBytes('files/bomb-30000.png');
    expect(bytes).not.toBeNull();
    expect(imageDims(bytes as Uint8Array)).toEqual({ width: 30000, height: 30000 });
    expect(30000 * 30000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(safeToDecode(bytes as Uint8Array, (bytes as Uint8Array).length)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('a truncated JPEG still gives its frame size', () => {
    expect(imageDims(corpusBytes('files/truncated.jpg') as Uint8Array)).toEqual({ width: 3000, height: 4000 });
  });

  it('16-bit and animated PNGs', () => {
    expect(imageDims(corpusBytes('photos/rgb16.png') as Uint8Array)).toEqual({ width: 2, height: 2 });
    expect(imageDims(corpusBytes('photos/apng.png') as Uint8Array)).toEqual({ width: 1, height: 1 });
  });

  it('skips fill bytes, standalone markers and DHT (C4) before the SOF', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd0, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]);
    expect(imageDims(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it('null for anything else: empty, text, a PDF, a JPEG that ends early or reaches SOS first', () => {
    expect(imageDims(new Uint8Array(0))).toBeNull();
    expect(imageDims(new TextEncoder().encode('not an image at all'))).toBeNull();
    expect(imageDims(corpusBytes('files/lease-text.pdf') as Uint8Array)).toBeNull();
    expect(imageDims(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
    expect(imageDims(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]))).toBeNull();
    expect(imageDims(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBeNull();
  });

  it('reads only the first 256 KB', () => {
    const big = new Uint8Array(300 * 1024);
    big.set([0xff, 0xd8]);
    for (let i = 2; i + 4 < big.length; i += 65_000) big.set([0xff, 0xe1, 0xfd, 0xe8], i);   // APPn segments of 65,000 bytes
    expect(imageDims(big)).toBeNull();
  });

  it('unknown dimensions block decoding only for files over 10 MB', () => {
    expect(safeToDecode(new Uint8Array(4), 1_000).ok).toBe(true);
    expect(safeToDecode(new Uint8Array(4), 11 * 1024 * 1024)).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('expandMoved (R-IDX-06)', () => {
  let db: SieveDb;
  let n = 0;
  beforeEach(async () => {
    db = openDbNamed(`sieve-robust-media-${process.pid}-${++n}`, 'real');
    await db.records.bulkPut([rec('folder:Taxes/2025/W-2.pdf'), rec('gmail:m1')]);
    await db.tombstones.bulkPut([
      { id: 'folder:W-2.pdf', deletedAt: 1, reason: 'moved', movedTo: 'folder:Taxes/W-2.pdf' },
      { id: 'folder:Taxes/W-2.pdf', deletedAt: 2, reason: 'moved', movedTo: 'folder:Taxes/2025/W-2.pdf' },
      { id: 'folder:old.pdf', deletedAt: 3, reason: 'source-deleted' },
      { id: 'folder:loop-a', deletedAt: 4, reason: 'moved', movedTo: 'folder:loop-b' },
      { id: 'folder:loop-b', deletedAt: 5, reason: 'moved', movedTo: 'folder:loop-a' },
    ]);
  });
  afterEach(async () => {
    db.close();
    forgetDb(db.name);
    await db.delete();
  });

  it('follows movedTo links and keeps the input', async () => {
    expect(await expandMoved(db, ['folder:W-2.pdf', 'gmail:m1'])).toEqual(['folder:W-2.pdf', 'gmail:m1', 'folder:Taxes/W-2.pdf', 'folder:Taxes/2025/W-2.pdf']);
    expect(await expandMoved(db, ['folder:old.pdf'])).toEqual(['folder:old.pdf']);
  });

  it('stops on a loop and after 5 hops', async () => {
    expect(await expandMoved(db, ['folder:loop-a'])).toEqual(['folder:loop-a', 'folder:loop-b']);
    await db.tombstones.bulkPut(Array.from({ length: 8 }, (_, i) => ({ id: `folder:c${i}`, deletedAt: 9, reason: 'moved' as const, movedTo: `folder:c${i + 1}` })));
    expect(await expandMoved(db, ['folder:c0'])).toHaveLength(6);
  });

  it('a block set on the old id follows the move', async () => {
    const blocked = await expandMoved(db, ['folder:Taxes/W-2.pdf']);
    expect(blocked).toContain('folder:Taxes/2025/W-2.pdf');
  });
});
