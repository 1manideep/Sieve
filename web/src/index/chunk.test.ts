// 20 section 7: A-IN-6 (the lease chunks), chunk invariants, what gets embedded (7.2), emoji offsets (A-EM-3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IndexRecord } from '@sieve/shared';
import { chunkText, embedTexts } from './chunk';

const LEASE = readFileSync(join(process.cwd(), 'data/playground/documents/src/Lease_2026.txt'), 'utf8');
const words = (s: string) => s.match(/\S+/g)?.length ?? 0;

function rec(p: Partial<IndexRecord>): IndexRecord {
  return { id: 'upload:x', source: 'upload', sourceRef: 'x', kind: 'email', title: 'Subject', date: 0, preview: 'preview text', category: 'Home', categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 0, contentHash: 'h', version: 1, ...p };
}

describe('chunkText', () => {
  it('A-IN-6: the lease gives sentence-aligned chunks of at most 160 words, one with all of section 12', () => {
    const chunks = chunkText(LEASE);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(words(c.text)).toBeLessThanOrEqual(160);
      expect(LEASE.slice(c.start, c.end)).toBe(c.text);
      expect(/[\s.!?]/.test(LEASE[c.end] ?? ' ') || c.end === LEASE.length).toBe(true);
    }
    const s12 = LEASE.slice(LEASE.indexOf('12. Pets.'), LEASE.indexOf('13. Parking.')).trim();
    expect(chunks.some((c) => c.text.includes(s12))).toBe(true);
  });

  it('empty text gives nothing; a short text gives one chunk covering it', () => {
    expect(chunkText('   \n ')).toEqual([]);
    const t = '  Hi Alex. The deposit was $1,200.  ';
    expect(chunkText(t)).toEqual([{ n: 0, start: 2, end: 34, text: 'Hi Alex. The deposit was $1,200.' }]);
  });

  it('splits a very long sentence into word windows and stops at 64 chunks', () => {
    const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(long);
    expect(chunks.map((c) => words(c.text))).toEqual([160, 160, 80]);
    const huge = Array.from({ length: 20_000 }, (_, i) => `Sentence number ${i}.`).join(' ');
    expect(chunkText(huge).length).toBe(64);
  });

  it('A-EM-3: chunk offsets in a text full of emoji slice back to whole graphemes', () => {
    const t = Array.from({ length: 120 }, (_, i) => `Line ${i} 👨‍👩‍👧 🇮🇳 1️⃣ party.`).join(' ');
    for (const c of chunkText(t)) {
      const piece = t.slice(c.start, c.end);
      expect(piece).toBe(c.text);
      const first = piece.charCodeAt(0);
      const last = piece.charCodeAt(piece.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);          // no lone low surrogate at the start
      expect([0x200d, 0xfe0f, 0x20e3].includes(first)).toBe(false);    // no joiner or selector at the start
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);            // no lone high surrogate at the end
      expect(last === 0x200d).toBe(false);
    }
  });
});

describe('embedTexts (20 sections 7.2 and 7.3)', () => {
  it('emails with text: one input per chunk with the subject and sender name', () => {
    const p = embedTexts(rec({ title: 'Re: Deposit', from: 'Dana Whitfield <dana@x.example>', text: 'We received your deposit.' }), 'approve');
    expect(p.inputs).toEqual(['Re: Deposit\nDana Whitfield\nWe received your deposit.']);
    expect(p.chunks[0]).toMatchObject({ start: 0, end: 25 });
  });

  it('never items: title and sender only, no range (rule 4)', () => {
    const p = embedTexts(rec({ title: 'Your test results are ready', from: 'Clinic <a@b.example>', text: 'Cholesterol is high.' }), 'never');
    expect(p.inputs).toEqual(['Your test results are ready\nClinic']);
    expect(p.chunks).toEqual([{ n: 0, start: 0, end: 0, text: '' }]);
  });

  it('photos: the caption; without a caption nothing', () => {
    expect(embedTexts(rec({ kind: 'photo', caption: 'A cat 🐱 asleep.' }), 'approve').inputs).toEqual(['Photo: A cat 🐱 asleep. (cat face)']);
    expect(embedTexts(rec({ kind: 'photo' }), 'approve').inputs).toEqual([]);
  });

  it('Gmail metadata phase: title, sender and preview; the hash follows the inputs', () => {
    const a = embedTexts(rec({ from: 'Bank <b@x.example>', preview: 'Your statement is ready' }), 'approve');
    expect(a.inputs).toEqual(['Subject\nBank\nYour statement is ready']);
    const b = embedTexts(rec({ from: 'Bank <b@x.example>', preview: 'Your statement is ready' }), 'never');
    expect(a.sourceHash).not.toBe(b.sourceHash);
  });
});
