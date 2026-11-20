// Live reads of the real index for Sources and Settings (40 section 9.9): source rows, counts per category and
// source, and the newest titles of a category. Everything stays on the device. `db` is null while the index cannot
// be read (components/dbTables useDb), and every hook then returns undefined.
import { useLiveQuery } from 'dexie-react-hooks';
import { CATEGORIES, type Category, type SourceKind } from '@sieve/shared';
import { tablesOf } from '@/components/dbTables';
import type { SieveDb } from '@/index';
import type { SourceRowView } from '@/state/sources';

export type RealSource = Extract<SourceKind, 'gmail' | 'folder' | 'upload'>;
export const REAL_SOURCES: readonly RealSource[] = ['gmail', 'folder', 'upload'];

export function useSourceRows(db: SieveDb | null): SourceRowView[] | undefined {
  return useLiveQuery(async () => (db ? tablesOf(db).sources.toArray() : undefined), [db]);
}

export function useCategoryCounts(db: SieveDb | null): Record<Category, number> | undefined {
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const records = tablesOf(db).records;
    const counts = await Promise.all(CATEGORIES.map((c) => records.where('category').equals(c).count()));
    return Object.fromEntries(CATEGORIES.map((c, i) => [c, counts[i]])) as Record<Category, number>;
  }, [db]);
}

/** How many items the real index holds: the "Searched" cell on Requests. */
export function useRecordCount(db: SieveDb | null): number | undefined {
  return useLiveQuery(async () => (db ? tablesOf(db).records.count() : undefined), [db]);
}

export function useSourceCounts(db: SieveDb | null): Record<RealSource, number> | undefined {
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const records = tablesOf(db).records;
    const counts = await Promise.all(REAL_SOURCES.map((k) => records.where('source').equals(k).count()));
    return Object.fromEntries(REAL_SOURCES.map((k, i) => [k, counts[i]])) as Record<RealSource, number>;
  }, [db]);
}

/** Up to five newest titles in a category; read only while the row is expanded. */
export function useNewestTitles(db: SieveDb | null, category: Category, enabled: boolean): string[] | undefined {
  return useLiveQuery(
    async () => {
      if (!db || !enabled) return [];
      const rows = await tablesOf(db)
        .records.orderBy('date')
        .reverse()
        .filter((r) => r.category === category)
        .limit(5)
        .toArray();
      return rows.map((r) => r.title);
    },
    [db, category, enabled],
  );
}

/** Real sources that are connected; a new grant's default sources (40 section 13.8.2). */
export function connectedSources(rows: SourceRowView[] | undefined): RealSource[] {
  return REAL_SOURCES.filter((k) => rows?.some((r) => r.kind === k && r.connected));
}
