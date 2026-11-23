// The same cases as functions/tests/unit/test_files.py: the two sides must agree on a name, or the relay refuses it.
import { describe, expect, it } from 'vitest';
import { SHARED_FILE_NAME_MAX_CHARS } from './constants';
import { describeSharedFile, safeFileName, sharedFileTypeOf } from './files';

describe('a file sent as itself', () => {
  it('keeps plain names and cleans the rest', () => {
    expect(safeFileName('Lease_2026.pdf')).toBe('Lease_2026.pdf');
    expect(safeFileName('Ünïcode résumé.docx')).toBe('Ünïcode résumé.docx');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\notes.txt')).toBe('notes.txt');
    expect(safeFileName('  .hidden.txt ')).toBe('hidden.txt');
    expect(safeFileName('a\u0000b\u202ec\u200bd.pdf')).toBe('abcd.pdf');
    expect(safeFileName('what<is>"this"?.pdf')).toBe('what_is__this__.pdf');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('///')).toBe('file');
    const long = safeFileName(`${'x'.repeat(300)}.pdf`);
    expect(long).toHaveLength(SHARED_FILE_NAME_MAX_CHARS);
    expect(long.endsWith('.pdf')).toBe(true);
    // cleaning twice changes nothing: what this side sends, the relay accepts
    for (const n of ['a\u0000b.pdf', '  .x.txt', 'q?.pdf', `${'y'.repeat(200)}.docx`]) expect(safeFileName(safeFileName(n))).toBe(safeFileName(n));
  });

  it('knows a type from a name, and says a file in one line', () => {
    expect(sharedFileTypeOf('Lease.PDF')).toBe('application/pdf');
    expect(sharedFileTypeOf('IMG_0042.jpeg')).toBe('image/jpeg');
    expect(sharedFileTypeOf('page.html')).toBeUndefined();
    expect(sharedFileTypeOf('all.zip')).toBeUndefined();
    expect(describeSharedFile('Lease_2026.pdf', 'application/pdf', 182_000)).toBe('Lease_2026.pdf (PDF, 182 KB)');
    expect(describeSharedFile('IMG_0042.jpg', 'image/jpeg', 3_400_000)).toBe('IMG_0042.jpg (image, 3.4 MB)');
    expect(describeSharedFile('notes.txt', 'text/plain', 812)).toBe('notes.txt (text, 812 bytes)');
  });
});
