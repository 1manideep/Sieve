// useRecords (40 section 9.13): titles for record ids without holding content. The index is loaded with a dynamic
// import (it is in the /playground graph, never in /welcome).
import { create } from 'zustand';
import type { Category, ItemKind, SourceKind } from '@sieve/shared';
import type { DbKind } from './types';

export interface RecordMeta { title: string; kind: ItemKind; category: Category; date: number; source: SourceKind; from?: string }
export interface RecordsState {
  meta: Record<string, RecordMeta | null>;               // null: not on this device
  ensure(kind: DbKind, ids: string[]): Promise<void>;   // getRecord for missing ids; keeps only these fields
  clear(): void;
}

const inFlight = new Set<string>();

export const useRecords = create<RecordsState>()((set, get) => ({
  meta: {},
  async ensure(kind, ids) {
    const key = (id: string) => `${kind}|${id}`;
    const missing = [...new Set(ids)].filter((id) => !(id in get().meta) && !inFlight.has(key(id)));
    if (missing.length === 0) return;
    for (const id of missing) inFlight.add(key(id));
    try {
      const { openDb, getRecord } = await import('@/index');
      const db = openDb(kind);
      const found = await Promise.all(
        missing.map(async (id): Promise<[string, RecordMeta | null]> => {
          try {
            const r = await getRecord(db, id);
            if (!r) return [id, null];
            const meta: RecordMeta = { title: r.title, kind: r.kind, category: r.category, date: r.date, source: r.source };
            if (r.from) meta.from = r.from;
            return [id, meta];
          } catch {
            return [id, null];
          }
        }),
      );
      set((s) => ({ meta: { ...s.meta, ...Object.fromEntries(found) } }));
    } finally {
      for (const id of missing) inFlight.delete(key(id));
    }
  },
  clear: () => set({ meta: {} }),
}));
