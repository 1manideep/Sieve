// Index vocabulary: processed term to document frequency (20 section 9.2), for typo correction and Gmail queries.
import type { IndexRecord } from '@sieve/shared';
import type { SieveDb } from './db';
import { cutGraphemes } from './text';
import { terms } from './tokenize';
import { INDEX_TEXT_CHARS } from './config';

export class Vocab {
  private df = new Map<string, number>();
  private byRecord = new Map<string, string[]>();
  /** Raw lowercase words (before stemming), so correction can propose a whole word. */
  private words = new Map<string, number>();
  private wordsByRecord = new Map<string, string[]>();

  get size(): number {
    return this.df.size;
  }

  has(term: string): boolean {
    return this.df.has(term);
  }

  frequency(term: string): number {
    return this.df.get(term) ?? 0;
  }

  /** Whole lowercase words seen in the index, with document frequency. */
  wordEntries(): IterableIterator<[string, number]> {
    return this.words.entries();
  }

  wordFrequency(word: string): number {
    return this.words.get(word) ?? 0;
  }

  update(rec: IndexRecord): void {
    this.remove(rec.id);
    const text = [rec.title, rec.from ?? '', rec.preview, cutGraphemes(rec.text ?? '', INDEX_TEXT_CHARS), rec.caption ?? ''].join('\n');
    const unique = [...new Set(terms(text))];
    for (const t of unique) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.byRecord.set(rec.id, unique);
    const raw = [...new Set((text.toLowerCase().match(/[a-z][a-z']*[a-z]/g) ?? []).map((w) => w.replace(/'/g, '')))];
    for (const w of raw) this.words.set(w, (this.words.get(w) ?? 0) + 1);
    this.wordsByRecord.set(rec.id, raw);
  }

  remove(id: string): void {
    for (const t of this.byRecord.get(id) ?? []) {
      const n = (this.df.get(t) ?? 1) - 1;
      if (n <= 0) this.df.delete(t);
      else this.df.set(t, n);
    }
    this.byRecord.delete(id);
    for (const w of this.wordsByRecord.get(id) ?? []) {
      const n = (this.words.get(w) ?? 1) - 1;
      if (n <= 0) this.words.delete(w);
      else this.words.set(w, n);
    }
    this.wordsByRecord.delete(id);
  }

  clear(): void {
    this.df.clear();
    this.byRecord.clear();
    this.words.clear();
    this.wordsByRecord.clear();
  }

  async build(db: SieveDb): Promise<void> {
    this.clear();
    await db.records.each((rec) => this.update(rec));
  }
}
