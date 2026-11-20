// 20 section 20: A-UP-1 (uploads), A-FD-4 (chat exports), readers (70 R-FILE-01, R-FILE-02, R-FILE-06, R-FILE-07),
// A-PH-1 (photo metadata on the Playground photos), image header sizes (70 R-FILE-08).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBlob } from '../../../tests/harness/dataset';
import { createHashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { dropDb, freshDb, nodeFile } from '../../../tests/harness/indexEnv';
import type { SieveDb } from '../index/db';
import { ready } from '../index/lifecycle';
import { setMlClient } from '../ml/client';
import { readPhotoMeta } from './photos/exif';
import { imageDims } from './photos/image';
import { chatToText, readFileForIndex } from './readers';
import { decodeBytes } from './readers/decode';
import { looksLikeGarbage, setPdfExtractor } from './readers/pdf';
import { addUploads, filesFromDataTransfer } from './uploads';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));

process.env.TZ = 'America/Chicago';
let db: SieveDb;

beforeEach(async () => {
  setMlClient(createHashEmbedClient());
  db = freshDb('real');
  await ready(db);
});

afterEach(async () => {
  await dropDb(db);
  setMlClient(null);
});

describe('uploads (A-UP-1)', () => {
  it('the same file twice is indexed then duplicate; six files give one too-many', async () => {
    const f = () => nodeFile('Move-out notes: return both keys.', 'move-out-notes.txt', { type: 'text/plain' });
    const [a] = await addUploads(db, [f()]);
    const [b] = await addUploads(db, [f()]);
    expect(a?.status).toBe('indexed');
    expect(b).toMatchObject({ status: 'duplicate', recordId: a?.recordId });
    expect(await db.sources.get('upload')).toMatchObject({ connected: true });
    expect((await db.blobs.get(a?.recordId ?? ''))?.blob).toBeDefined();
    const six = await addUploads(db, Array.from({ length: 6 }, (_, i) => nodeFile(`file ${i}`, `f${i}.txt`)));
    expect(six.filter((r) => r.reason === 'too-many')).toHaveLength(1);
    const rejected = await addUploads(db, [nodeFile('x', 'photo.heic'), nodeFile('x', 'sheet.xlsx'), nodeFile(new Uint8Array(11 * 1024 * 1024), 'huge.txt')]);
    expect(rejected.map((r) => r.reason)).toEqual(['heic', 'unsupported', 'too-large']);
  });

  it('a dropped folder is counted, files pass through', () => {
    const file = nodeFile('x', 'a.txt');
    const dt = { items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => null }, { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file }], files: [] } as unknown as DataTransfer;
    expect(filesFromDataTransfer(dt)).toEqual({ files: [file], rejectedFolders: 1 });
  });
});

describe('readers', () => {
  it('A-FD-4: the chat export gives 5 dated lines', () => {
    const chat = JSON.parse(readFileSync(join(process.cwd(), 'data/playground/documents/chat-jordan-ellis.json'), 'utf8'));
    const out = chatToText(chat);
    const lines = (out?.text ?? '').split('\n').slice(1);
    expect(lines).toHaveLength(5);
    expect(lines[0]?.startsWith('[2026-11-12 18:02] Jordan Ellis:')).toBe(true);
    expect(out?.title).toBe('Chat with Jordan Ellis');
  });

  it('decodes cp1252, UTF-16 with a BOM and UTF-8; NUL bytes in UTF-8 are binary', async () => {
    // Chrome maps 0x93 0x94 0x80 to curly quotes and the euro sign (Encoding Standard); Node's decoder in this test
    // realm maps them like Latin-1, so only the chosen label is checked here (browser check in the report).
    expect(decodeBytes(new Uint8Array([0x93, 0x68, 0x69, 0x94, 0x20, 0x80]), 'windows-1252')).toMatchObject({ encoding: 'windows-1252', lossy: false });
    const le = new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]);
    expect(decodeBytes(le).text).toBe('hi');
    expect(decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]), 'iso-8859-1').text).toBe('café');
    expect(decodeBytes(new Uint8Array([0x61]), 'iso-2022-kr').text).toBe('a');
    expect((await readFileForIndex(nodeFile(new Uint8Array([0x61, 0, 0x62]), 'x.txt'), 'text')).skip).toBe('binary');
    expect((await readFileForIndex(nodeFile(le, 'u.txt'), 'text')).text).toBe('hi');
  });

  it('empty text files index with no text; empty PDFs and images are unreadable; garbage PDF text counts as no text', async () => {
    expect(await readFileForIndex(nodeFile('', 'empty.txt'), 'text')).toEqual({ kind: 'note', text: '' });
    expect((await readFileForIndex(nodeFile('', 'empty.pdf'), 'pdf')).skip).toBe('unreadable');
    expect((await readFileForIndex(nodeFile('', 'empty.jpg'), 'jpeg')).skip).toBe('unreadable');
    setPdfExtractor(async () => ({ text: ''.repeat(300), pages: 1, truncated: false }));
    expect(await readFileForIndex(nodeFile('%PDF', 'cid.pdf'), 'pdf')).toMatchObject({ text: '', noText: true });
    setPdfExtractor(async () => {
      throw Object.assign(new Error('pw'), { name: 'PdfReadError', reason: 'password' });
    });
    expect((await readFileForIndex(nodeFile('%PDF', 'locked.pdf'), 'pdf')).skip).toBe('password');
    setPdfExtractor(null);
    expect(looksLikeGarbage('Plain words. '.repeat(30))).toBe(false);
    expect((await readFileForIndex(nodeFile('{"a": 1', 't.json'), 'json')).text).toBe('{"a": 1');
  });
});

describe('photos (A-PH-1, 70 R-FILE-08)', () => {
  it('reads GPS presence (never the numbers), the taken time, and a place only when the photo names one', async () => {
    const a = await readPhotoMeta(readBlob('photos/IMG_4821.jpg', 'image/jpeg'), 'IMG_4821.jpg', 0);
    expect(a.hadGps).toBe(true);
    expect(a.takenAt).toBe(Date.parse('2026-07-04T15:42:00-05:00'));
    expect(JSON.stringify(a)).not.toMatch(/41\.9|87\.7/);
    const b = await readPhotoMeta(readBlob('photos/IMG_5120.jpg', 'image/jpeg'), 'IMG_5120.jpg', 0);
    expect(b.place).toBe('Chicago');
    const fallback = Date.parse('2026-10-18T10:05:00-05:00');
    const c = await readPhotoMeta(readBlob('photos/cat-on-windowsill.png', 'image/png'), 'cat-on-windowsill.png', fallback);
    expect(c).toMatchObject({ hadGps: false, takenAt: fallback, mime: 'image/png' });
    expect(c.width).toBeGreaterThan(0);
  });

  it('reads image sizes from headers and refuses decompression bombs before decoding', async () => {
    const png = new Uint8Array(readFileSync(join(process.cwd(), 'data/playground/photos/cat-on-windowsill.png')));
    expect(imageDims(png)?.width).toBeGreaterThan(0);
    const jpg = new Uint8Array(readFileSync(join(process.cwd(), 'data/playground/photos/IMG_4821.jpg')));
    expect(imageDims(jpg)).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    const bomb = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x75, 0x30, 0, 0, 0x75, 0x30, 8, 2, 0, 0, 0]);
    expect(imageDims(bomb)).toEqual({ width: 30_000, height: 30_000 });
    await expect(readPhotoMeta(nodeFile(bomb, 'bomb.png', { type: 'image/png' }), 'bomb.png', 0)).rejects.toMatchObject({ code: 'too-large' });
  });
});
