// A minimal SieveDb double: the consents and blobs stores the AI layer and the pipeline touch directly.
import type { SieveDb } from '@/index';
import type { ConsentRow } from '../policy';

interface FakeStores {
  consents: {
    rows: Map<string, ConsentRow>;
    bulkGet(keys: string[]): Promise<(ConsentRow | undefined)[]>;
    bulkPut(rows: ConsentRow[]): Promise<void>;
  };
  blobs: { get(id: string): Promise<{ id: string; blob: Blob } | undefined>; rows: Map<string, Blob> };
}

export function fakeDb(init: { name?: string; consents?: ConsentRow[]; blobs?: Record<string, Blob> } = {}): SieveDb {
  const rows = new Map((init.consents ?? []).map((r) => [r.recordId, r]));
  const blobRows = new Map(Object.entries(init.blobs ?? {}));
  const stores: FakeStores & { name: string } = {
    name: init.name ?? 'sieve-playground',
    consents: {
      rows,
      async bulkGet(keys) {
        return keys.map((k) => rows.get(k));
      },
      async bulkPut(list) {
        for (const r of list) rows.set(r.recordId, r);
      },
    },
    blobs: {
      rows: blobRows,
      async get(id) {
        const blob = blobRows.get(id);
        return blob ? { id, blob } : undefined;
      },
    },
  };
  return stores as unknown as SieveDb;
}

/** The consent rows a fakeDb holds. */
export function consentRows(db: SieveDb): ConsentRow[] {
  return [...(db as unknown as FakeStores).consents.rows.values()];
}

/** A handle with no stores at all. */
export function bareDb(): SieveDb {
  return { name: 'bare' } as unknown as SieveDb;
}
