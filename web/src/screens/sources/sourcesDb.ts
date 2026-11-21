// Live reads of the real index for Sources and Settings (40 section 9.9): source rows, counts per category and
// source, a category's newest items and the senders seen most. Everything stays on the device. `db` is null while the index cannot
// be read (components/dbTables useDb), and every hook then returns undefined.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CATEGORIES, type Category, type ItemKind, type SourceKind } from '@sieve/shared';
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

export type CategorySplit = Record<Category, Record<RealSource, number>>;

/** Items per category and source, counted from the primary keys (`source:ref`), never by reading the items. */
export function useCategorySplit(db: SieveDb | null): CategorySplit | undefined {
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const records = tablesOf(db).records;
    const keys = await Promise.all(CATEGORIES.map((c) => records.where('category').equals(c).primaryKeys()));
    const split = {} as CategorySplit;
    CATEGORIES.forEach((c, i) => {
      const row: Record<RealSource, number> = { gmail: 0, folder: 0, upload: 0 };
      for (const key of keys[i] ?? []) {
        const source = key.slice(0, key.indexOf(':')) as RealSource;
        if (source in row) row[source] += 1;
      }
      split[c] = row;
    });
    return split;
  }, [db]);
}

export interface ItemBrief { id: string; title: string; from?: string; caption?: string; kind: ItemKind; source: SourceKind; date: number }

/** Up to `limit` of a category's latest items, newest first; read only while its row is open. */
export function useNewestItems(db: SieveDb | null, category: Category, enabled: boolean, limit = 8): ItemBrief[] | undefined {
  return useLiveQuery(
    async () => {
      if (!db || !enabled) return [];
      const rows = await tablesOf(db).records.where('category').equals(category).reverse().limit(limit).toArray();
      return rows
        .sort((a, b) => b.date - a.date)
        .map((r) => ({ id: r.id, title: r.title, from: r.from, caption: r.caption, kind: r.kind, source: r.source, date: r.date }));
    },
    [db, category, enabled, limit],
  );
}

/** "Dana Whitfield <dana@example.com>" is "Dana Whitfield"; a bare address is its name before the @. */
export function senderName(from: string): string {
  const named = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from)?.[1]?.trim();
  if (named) return named;
  const address = from.replace(/[<>]/g, '').trim();
  return address.includes('@') ? address.slice(0, address.indexOf('@')) : address;
}

export const SENDER_SAMPLE = 240;

/** The senders seen most in each category, among the newest items: up to three names each. Read once per visit. */
export function useFrequentSenders(db: SieveDb | null): Partial<Record<Category, string[]>> | undefined {
  const [senders, setSenders] = useState<Partial<Record<Category, string[]>> | undefined>(undefined);
  useEffect(() => {
    if (!db) return undefined;
    let live = true;
    tablesOf(db)
      .records.orderBy('date')
      .reverse()
      .limit(SENDER_SAMPLE)
      .toArray()
      .then((rows) => {
        if (!live) return;
        const counts = new Map<Category, Map<string, number>>();
        for (const r of rows) {
          if (!r.from) continue;
          const name = senderName(r.from);
          if (!name) continue;
          const byName = counts.get(r.category) ?? new Map<string, number>();
          byName.set(name, (byName.get(name) ?? 0) + 1);
          counts.set(r.category, byName);
        }
        const top: Partial<Record<Category, string[]>> = {};
        for (const [category, byName] of counts) {
          top[category] = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
        }
        setSenders(top);
      })
      .catch(() => {
        if (live) setSenders({});
      });
    return () => {
      live = false;
    };
  }, [db]);
  return senders;
}

/** Real sources that are connected; a new grant's default sources (40 section 13.8.2). */
export function connectedSources(rows: SourceRowView[] | undefined): RealSource[] {
  return REAL_SOURCES.filter((k) => rows?.some((r) => r.kind === k && r.connected));
}
