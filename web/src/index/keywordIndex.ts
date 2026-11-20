// Keyword safety net (20 section 8): MiniSearch options, snapshot load and save, add/replace/discard, rebuild.
import MiniSearch, { type Options, type SearchResult } from 'minisearch';
import type { Category, IndexRecord, ItemKind, SourceKind } from '@sieve/shared';
import { INDEX_TEXT_CHARS, SEARCH_FINGERPRINT, SEARCH_SAVE_DEBOUNCE_MS, SEARCH_SAVE_MAX_WAIT_MS } from './config';
import type { SieveDb } from './db';
import { broadcast, isLeader } from './locks';
import { cutGraphemes, displayName, fromAddress, withEmojiNames } from './text';
import { processTerm, tokenize } from './tokenize';

export interface IndexDoc {
  id: string; title: string; from: string; preview: string; text: string; caption: string; category: Category;
  source: SourceKind; kind: ItemKind; date: number; threadId: string; fromAddr: string; contentHash: string;
}

export const MINISEARCH_OPTIONS: Options<IndexDoc> = {
  idField: 'id',
  fields: ['title', 'from', 'preview', 'text', 'caption', 'category'],
  storeFields: ['source', 'kind', 'category', 'date', 'threadId', 'fromAddr', 'contentHash'],
  tokenize: (t) => tokenize(t),
  processTerm: (t) => processTerm(t),
  autoVacuum: true,
};

export const KEYWORD_SEARCH = {
  boost: { title: 3, from: 2, caption: 3, preview: 1.5, text: 1, category: 1 },
  prefix: (t: string) => t.length >= 4 && !/\d/.test(t),
  fuzzy: (t: string) => (t.length >= 5 && !/\d/.test(t) ? 0.2 : false),
  maxFuzzy: 2,
  combineWith: 'OR' as const,
};

export function toIndexDoc(rec: IndexRecord): IndexDoc {
  return {
    id: rec.id,
    title: withEmojiNames(rec.title),
    from: displayName(rec.from) + (rec.from ? ' ' + fromAddress(rec.from) : ''),
    preview: withEmojiNames(rec.preview),
    text: withEmojiNames(cutGraphemes(rec.text ?? '', INDEX_TEXT_CHARS)),
    caption: withEmojiNames(rec.caption ?? ''),
    category: rec.category,
    source: rec.source,
    kind: rec.kind,
    date: rec.date,
    threadId: rec.threadId ?? '',
    fromAddr: fromAddress(rec.from),
    contentHash: rec.contentHash,
  };
}

export type KeywordHit = SearchResult & Partial<Pick<IndexDoc, 'source' | 'kind' | 'category' | 'date' | 'threadId' | 'fromAddr' | 'contentHash'>>;

export class KeywordIndex {
  ms: MiniSearch<IndexDoc> = new MiniSearch(MINISEARCH_OPTIONS);
  private dirty = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private maxWait: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private onHidden: (() => void) | null = null;

  constructor(private readonly db: SieveDb) {}

  get count(): number {
    return this.ms.documentCount;
  }

  has(id: string): boolean {
    return this.ms.has(id);
  }

  ids(): string[] {
    return this.ms.search(MiniSearch.wildcard).map((r) => String(r.id));
  }

  upsert(rec: IndexRecord): void {
    const doc = toIndexDoc(rec);
    if (this.ms.has(rec.id)) this.ms.replace(doc);
    else this.ms.add(doc);
    this.markDirty();
  }

  discard(id: string): void {
    if (!this.ms.has(id)) return;
    this.ms.discard(id);
    this.markDirty();
  }

  search(query: string, filter?: (hit: KeywordHit) => boolean): KeywordHit[] {
    if (!query.trim()) return [];
    return this.ms.search(query, { ...KEYWORD_SEARCH, filter: filter as ((r: SearchResult) => boolean) | undefined }) as KeywordHit[];
  }

  /** Load the snapshot; false when it is missing, corrupt or from other code (caller rebuilds). */
  async load(): Promise<boolean> {
    const row = await this.db.search.get('minisearch');
    if (!row) return false;
    if (row.fingerprint && row.fingerprint !== SEARCH_FINGERPRINT) return false;
    try {
      this.ms = MiniSearch.loadJSON(row.json, MINISEARCH_OPTIONS);
      return true;
    } catch (e) {
      console.info('integrity repair', { kind: 'keyword-snapshot-unreadable', error: String(e).slice(0, 80) });
      this.ms = new MiniSearch(MINISEARCH_OPTIONS);
      return false;
    }
  }

  /** 20 section 8.4: records in pages of 500 by date, newest first. */
  async rebuild(): Promise<void> {
    const ms = new MiniSearch(MINISEARCH_OPTIONS);
    const total = await this.db.records.count();
    for (let offset = 0; offset < total; offset += 500) {
      const page = await this.db.records.orderBy('date').reverse().offset(offset).limit(500).toArray();
      await ms.addAllAsync(page.map(toIndexDoc), { chunkSize: 200 });
    }
    this.ms = ms;
    this.markDirty();
    await this.flush();
  }

  private markDirty(): void {
    this.dirty = true;
    if (!isLeader(this.db)) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush(), SEARCH_SAVE_DEBOUNCE_MS);
    this.maxWait ??= setTimeout(() => void this.flush(), SEARCH_SAVE_MAX_WAIT_MS);
    if (!this.onHidden && typeof document !== 'undefined') {
      this.onHidden = () => {
        if (document.visibilityState === 'hidden') void this.flush();
      };
      document.addEventListener('visibilitychange', this.onHidden);
    }
  }

  /** Save now when there are unsaved changes (leader only). */
  async flush(): Promise<void> {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.maxWait) clearTimeout(this.maxWait);
    this.debounce = null;
    this.maxWait = null;
    if (!this.dirty || !isLeader(this.db)) return;
    if (this.saving) await this.saving;
    this.dirty = false;
    const updatedAt = Date.now();
    const json = JSON.stringify(this.ms);
    this.saving = this.db.search
      .put({ id: 'minisearch', json, updatedAt, fingerprint: SEARCH_FINGERPRINT })
      .then(() => broadcast(this.db, { type: 'keyword-saved', updatedAt }))
      .catch((e: unknown) => {
        this.dirty = true;
        console.warn('keyword snapshot save failed', String(e).slice(0, 80));
      })
      .finally(() => {
        this.saving = null;
      });
    await this.saving;
  }

  /** Stop timers (wipeDb, tests). Unsaved changes are dropped. */
  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.maxWait) clearTimeout(this.maxWait);
    this.debounce = null;
    this.maxWait = null;
    this.dirty = false;
    if (this.onHidden && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onHidden);
    this.onHidden = null;
  }
}
