// The IndexedDB stores this layer reads and writes directly (01 section 5): Playground receipts, per-file cloud
// consents, the sources rows (for useIndexing), record ids (for item refs) and deleting the real index.
// Typed structurally, so this layer compiles against the SieveDb handle that openDb returns (a Dexie database).
import type { IndexRecord, Receipt, SourceKind } from '@sieve/shared';
import type { SieveDb } from '@/index';

export interface SourceRowLike {
  kind: SourceKind;
  connected: boolean;
  paused: boolean;
  progress: { done: number; total: number };
  lastSyncAt?: number;
  needsAuth?: boolean;
  error?: string;
  folderName?: string;
  // 20 section 13.5: what the source job and the background queue work on now
  inventory?: Partial<Record<InventoryKind, number>>;
  stage?: IndexingStage;
  stageCount?: number;
  /** Items that cannot be found yet (still to read, or never embedded); absent on rows an older queue wrote. */
  searchLeft?: number;
  counting?: boolean;
}

export type InventoryKind = 'pdfs' | 'notes' | 'photos' | 'files' | 'emails';
export type IndexingStage = 'reading' | 'label' | 'embed' | 'privacy' | 'caption';

export interface ConsentRowLike { recordId: string; cloudAllowedAt: number }

export interface LocalTables {
  records: {
    get(id: string): Promise<IndexRecord | undefined>;
    where(index: 'source'): { equals(value: string): { toArray(): Promise<IndexRecord[]> } };
    toCollection(): { primaryKeys(): Promise<string[]> };
  };
  receipts: {
    put(receipt: Receipt): Promise<unknown>;
    orderBy(index: 'createdAt'): { reverse(): { limit(n: number): { toArray(): Promise<Receipt[]> } } };
  };
  consents: { put(row: ConsentRowLike): Promise<unknown> };
  sources: { toArray(): Promise<SourceRowLike[]> };
  delete(): Promise<void>;
}

export function tables(db: SieveDb): LocalTables {
  return db as unknown as LocalTables;
}
