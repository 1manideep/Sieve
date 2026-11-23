import { describe, expect, it } from 'vitest';
import type { IndexRecord } from '@sieve/shared';
import { answerKind } from '@/ai';
import { ATTACHMENT_TEXT_CHARS, attachmentMayHold, withAttachmentText, type AttachmentTextDeps } from './attachmentText';

const mail = (text: string | undefined, over: Partial<IndexRecord> = {}): IndexRecord => ({
  id: 'gmail:m1', source: 'gmail', sourceRef: 'm1', kind: 'email', title: 'Thank you for purchasing Premium', from: 'Lumora <billing@lumora.example>',
  date: 0, preview: '', text, category: 'Money', categoryBy: 'device', hiddenRemoved: [], pii: [], sizeBytes: 10, indexedAt: 0, contentHash: 'h', version: 1, ...over,
} as IndexRecord);
const att = (name: string, bytes = 900, mime = name.endsWith('.pdf') ? 'application/pdf' : 'image/png') => ({ name, mime, bytes, attachmentId: `id-${name}` });
const deps = (over: Partial<AttachmentTextDeps> = {}): AttachmentTextDeps => ({
  listAttachments: async () => [att('receipt.pdf')],
  fetchAttachment: async (_id, ref) => new Blob([ref.name]),
  pdfText: async () => 'Invoice 1093.   Total: $39.99.',
  ...over,
});
const money = answerKind('How much did I pay?') as RegExp;

describe('attachmentMayHold', () => {
  it('an email that says something is attached and holds no fact of the asked kind', () => {
    expect(attachmentMayHold(mail('Your receipt is attached.'), money)).toBe(true);
    expect(attachmentMayHold(mail('Please find the invoice enclosed.'), money)).toBe(true);
    expect(attachmentMayHold(mail('Your receipt is attached. Total $39.99.'), money)).toBe(false);    // the email holds it
    expect(attachmentMayHold(mail('Thanks for your purchase.'), money)).toBe(false);                    // no attachment named
    expect(attachmentMayHold(mail(undefined), money)).toBe(false);                                      // its body is not here yet
    expect(attachmentMayHold(mail('Your receipt is attached.', { source: 'folder', kind: 'document' }), money)).toBe(false);
  });
});

describe('withAttachmentText', () => {
  it('puts the PDF text after the email text, without changing the record it was given', async () => {
    const rec = mail('Your receipt is attached.');
    const got = await withAttachmentText(rec, { deps: deps() });
    expect(got?.text).toBe('Your receipt is attached.\n\nAttached file receipt.pdf: Invoice 1093. Total: $39.99.');
    expect(rec.text).toBe('Your receipt is attached.');
  });

  it('reads only PDFs of a sensible size, at most two, and cuts a long text', async () => {
    const long = 'x'.repeat(ATTACHMENT_TEXT_CHARS + 500);
    const got = await withAttachmentText(mail('Attached.'), { deps: deps({
      listAttachments: async () => [att('photo.png'), att('big.pdf', 6 * 1024 * 1024), att('a.pdf'), att('b.pdf'), att('c.pdf')],
      pdfText: async () => long,
    }) });
    const text = got?.text ?? '';
    expect(text).not.toContain('photo.png');
    expect(text).not.toContain('big.pdf');
    expect(text).toContain('Attached file a.pdf');
    expect(text).toContain('Attached file b.pdf');
    expect(text).not.toContain('c.pdf');
    expect(text.split('Attached file a.pdf: ')[1]?.split('\n')[0]).toHaveLength(ATTACHMENT_TEXT_CHARS);
  });

  it('gives null when there is nothing to read or Gmail cannot be reached, and passes a stop through', async () => {
    expect(await withAttachmentText(mail('Attached.'), { deps: deps({ listAttachments: async () => [] }) })).toBeNull();
    expect(await withAttachmentText(mail('Attached.'), { deps: deps({ pdfText: async () => '' }) })).toBeNull();
    expect(await withAttachmentText(mail('Attached.'), { deps: deps({ listAttachments: async () => { throw new Error('offline'); } }) })).toBeNull();
    const stop = Object.assign(new Error('stopped'), { name: 'AbortError' });
    await expect(withAttachmentText(mail('Attached.'), { deps: deps({ fetchAttachment: async () => { throw stop; } }) })).rejects.toBe(stop);
  });
});
