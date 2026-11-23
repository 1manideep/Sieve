// The original of an item for a request that asks for the file itself: where it comes from per source, which
// attachment of an email is meant, and why it is sometimes not there.
import { SHARED_FILE_MAX_BYTES, type IndexRecord } from '@sieve/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SieveDb } from '@/index';
import { attachmentsOf, bytesFromBase64Url, pickAttachment } from '@/sources/gmail/attachments';
import { originalFor, type OriginalDeps } from './original';

const photos = vi.hoisted(() => ({ blob: undefined as Blob | undefined }));
vi.mock('./optional', () => ({ photoBlobFor: async () => photos.blob }));

const db = {} as SieveDb;
const rec = (over: Partial<IndexRecord>): IndexRecord => ({
  id: 'folder:docs/Lease_2026.pdf', source: 'folder', sourceRef: 'docs/Lease_2026.pdf', kind: 'document', title: 'Lease_2026.pdf', date: 0,
  preview: '', category: 'Home', categoryBy: 'device', hiddenRemoved: [], pii: [], sizeBytes: 10, indexedAt: 0, contentHash: 'h', version: 1, ...over,
} as IndexRecord);
const pdf = (size = 1200) => new File([new Uint8Array(size)], 'Lease_2026.pdf', { type: 'application/pdf' });
const att = (name: string, bytes = 900) => ({ name, mime: name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'application/zip', bytes, attachmentId: `id-${name}` });

function deps(over: Partial<OriginalDeps> = {}): OriginalDeps {
  return {
    readFolderFile: async () => pdf(),
    listAttachments: async () => [],
    fetchAttachment: async (_id, ref) => new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }),
    pickAttachment,
    ...over,
  };
}

describe('originalFor', () => {
  it('reads a folder file as it is now, under its own name', async () => {
    const got = await originalFor(db, rec({}), 'Send me my lease', { deps: deps() });
    expect(got).toMatchObject({ ok: true, name: 'Lease_2026.pdf', mime: 'application/pdf', bytes: 1200 });
  });

  it('says why a folder file cannot be sent', async () => {
    const denied = Object.assign(new Error('x'), { name: 'PermissionNeededError' });
    const missing = Object.assign(new Error('x'), { name: 'NotFoundError' });
    expect(await originalFor(db, rec({}), '', { deps: deps({ readFolderFile: async () => { throw denied; } }) })).toEqual({ ok: false, why: 'permission' });
    expect(await originalFor(db, rec({}), '', { deps: deps({ readFolderFile: async () => { throw missing; } }) })).toEqual({ ok: false, why: 'gone' });
    expect(await originalFor(db, rec({}), '', { deps: deps({ readFolderFile: async () => pdf(SHARED_FILE_MAX_BYTES + 1) }) })).toEqual({ ok: false, why: 'too-large' });
    const page = new File(['<p>x</p>'], 'page.html', { type: 'text/html' });
    expect(await originalFor(db, rec({ id: 'folder:page.html', sourceRef: 'page.html', title: 'page.html' }), '', { deps: deps({ readFolderFile: async () => page }) })).toEqual({ ok: false, why: 'kind' });
  });

  it('gives a stored photo, and nothing for an upload whose text is all that was kept', async () => {
    photos.blob = new Blob([new Uint8Array(5000)], { type: 'image/jpeg' });
    const photo = await originalFor(db, rec({ id: 'upload:IMG_0042.jpg', source: 'upload', sourceRef: 'IMG_0042.jpg', kind: 'photo', title: 'IMG_0042.jpg' }), '', { deps: deps() });
    expect(photo).toMatchObject({ ok: true, name: 'IMG_0042.jpg', mime: 'image/jpeg', bytes: 5000 });
    photos.blob = undefined;
    expect(await originalFor(db, rec({ id: 'upload:x.jpg', source: 'upload', kind: 'photo', title: 'x.jpg' }), '', { deps: deps() })).toEqual({ ok: false, why: 'gone' });
    expect(await originalFor(db, rec({ id: 'upload:notes.pdf', source: 'upload', sourceRef: 'notes.pdf', kind: 'document', title: 'notes.pdf' }), '', { deps: deps() })).toEqual({ ok: false, why: 'none' });
  });

  it("fetches an email's attachment: the only one, or the one the question names", async () => {
    const mail = rec({ id: 'gmail:m1', source: 'gmail', sourceRef: 'm1', kind: 'email', title: 'Your signed lease' });
    const one = await originalFor(db, mail, 'Send me the lease', { deps: deps({ listAttachments: async () => [att('Lease_signed.pdf')] }) });
    expect(one).toMatchObject({ ok: true, name: 'Lease_signed.pdf', mime: 'application/pdf', bytes: 900 });
    const two = deps({ listAttachments: async () => [att('Lease_signed.pdf'), att('Floor_plan.png', 400)] });
    expect(await originalFor(db, mail, 'Send me the attachment', { deps: two })).toEqual({ ok: false, why: 'several' });
    expect(await originalFor(db, mail, 'Send me the floor plan image Floor_plan.png', { deps: two })).toMatchObject({ ok: true, name: 'Floor_plan.png', bytes: 400 });
    expect(await originalFor(db, mail, 'x', { deps: deps({ listAttachments: async () => [] }) })).toEqual({ ok: false, why: 'none' });
    expect(await originalFor(db, mail, 'x', { deps: deps({ listAttachments: async () => [att('all.zip')] }) })).toEqual({ ok: false, why: 'none' });
    expect(await originalFor(db, mail, 'x', { deps: deps({ listAttachments: async () => [att('big.pdf', SHARED_FILE_MAX_BYTES + 1)] }) })).toEqual({ ok: false, why: 'too-large' });
    expect(await originalFor(db, mail, 'x', { deps: deps({ listAttachments: async () => { throw new Error('offline'); } }) })).toEqual({ ok: false, why: 'gmail' });
  });
});

describe('attachments of a message', () => {
  it('lists the named parts that hold bytes apart from the body, at any depth', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: 'aGk' } }, { mimeType: 'text/html', body: { data: 'aGk' } }] },
        { mimeType: 'application/pdf', filename: 'Lease_signed.pdf', body: { attachmentId: 'a1', size: 900 } },
        { mimeType: 'application/octet-stream', filename: 'scan.PNG', body: { attachmentId: 'a2', size: 400 } },
        { mimeType: 'image/png', filename: '', body: { attachmentId: 'a3', size: 10 } },
      ],
    };
    expect(attachmentsOf(payload)).toEqual([
      { name: 'Lease_signed.pdf', mime: 'application/pdf', bytes: 900, attachmentId: 'a1' },
      { name: 'scan.PNG', mime: 'image/png', bytes: 400, attachmentId: 'a2' },
    ]);
    expect(attachmentsOf(undefined)).toEqual([]);
  });

  it('decodes what Gmail sends', () => {
    expect([...bytesFromBase64Url('aGk_-w')]).toEqual([104, 105, 63, 251]);
  });
});
