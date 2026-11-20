// A typed view of the Dexie tables the UI reads (01 section 5, 20 section 4.1). The index module owns the database;
// this only names the tables, so components can run live queries on the handle that openDb() returns.
import { useEffect, useState } from 'react';
import type { Table } from 'dexie';
import type { IndexRecord, Receipt, SourceKind } from '@sieve/shared';
import type { SieveDb } from '@/index';
import type { DbKind } from '@/state/types';

export interface BlobRowView { id: string; blob: Blob; thumb?: Blob }
export interface SourceRowView {
  kind: SourceKind;
  connected: boolean;
  paused: boolean;
  progress: { done: number; total: number };
  lastSyncAt?: number;
  needsAuth?: boolean;
  error?: string;
  folderName?: string;
}
export interface ConsentRowView { recordId: string; cloudAllowedAt: number }

export interface DbTables {
  records: Table<IndexRecord, string>;
  blobs: Table<BlobRowView, string>;
  receipts: Table<Receipt, string>;
  sources: Table<SourceRowView, SourceKind>;
  consents: Table<ConsentRowView, string>;
}

export function tablesOf(db: SieveDb): DbTables {
  return db as unknown as DbTables;
}

/** The index module, loaded on first use so it stays out of the first load (40 section 17.2). */
export function loadIndex(): Promise<typeof import('@/index')> {
  return import('@/index');
}

/**
 * The database handle (openDb is a singleton per kind), or null until the index module has loaded, when it cannot be
 * opened, or when it must not be read yet (the real index waits for the owner check, 40 section 6.4).
 */
export function useDb(kind: DbKind, enabled: boolean = true): SieveDb | null {
  const [opened, setOpened] = useState<{ kind: DbKind; db: SieveDb } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    loadIndex()
      .then((m) => {
        if (live) setOpened({ kind, db: m.openDb(kind) });
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      live = false;
    };
  }, [kind, enabled]);
  return enabled && opened?.kind === kind ? opened.db : null;
}
