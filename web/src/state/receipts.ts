// useReceipts (40 section 9.7). Real receipts come from Firestore (app/services/receipts.ts, loaded with a dynamic
// import); Playground receipts from a Dexie liveQuery on db.receipts. Receipts never hold content.
import { create } from 'zustand';
import type { SourceKind } from '@sieve/shared';
import { RECEIPTS_FLOW } from '@/copy/strings';
import { tables } from './localDb';
import type { DbKind, ReceiptView } from './types';

export interface ReceiptFilters { ai: string | 'all'; source: SourceKind | 'all'; range: 'any' | 'today' | '7d' | '30d' }
export interface ReceiptsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  receipts: ReceiptView[];                         // newest first
  filters: ReceiptFilters;
  limit: number;                                   // 100; +100 per "Show more"
  start(kind: DbKind, uid?: string): () => void;   // real: onSnapshot(query(receipts, orderBy('createdAt', 'desc'), limit(n))); playground: Dexie liveQuery on db.receipts
  setFilter<K extends keyof ReceiptFilters>(k: K, v: ReceiptFilters[K]): void;
  clearFilters(): void;
  showMore(): void;
  /** Listen again when the current list is for `kind`: a Playground reset replaces the database the live query read. */
  refresh(kind: DbKind): void;
  revoke(receiptId: string): Promise<void>;        // 10.3; throws an Error with a person-facing message on failure
  reset(): void;
}

export const RECEIPTS_PAGE = 100;
export const DEFAULT_RECEIPT_FILTERS: ReceiptFilters = { ai: 'all', source: 'all', range: 'any' };

const DAY_MS = 24 * 60 * 60 * 1000;

const initial = (): Pick<ReceiptsState, 'status' | 'receipts' | 'filters' | 'limit'> => ({
  status: 'idle',
  receipts: [],
  filters: { ...DEFAULT_RECEIPT_FILTERS },
  limit: RECEIPTS_PAGE,
});

interface Subscription { kind: DbKind; uid?: string; stop: () => void }
let current: Subscription | null = null;

function subscribe(kind: DbKind, uid: string | undefined, n: number, set: (p: Partial<ReceiptsState>) => void): () => void {
  let cancelled = false;
  let stop: (() => void) | undefined;
  set({ status: 'loading' });
  if (kind === 'real') {
    if (!uid) {
      set({ status: 'error' });
      return () => undefined;
    }
    void import('@/app/services/receipts')
      .then(({ listenReceipts }) => {
        if (cancelled) return;
        stop = listenReceipts(
          uid,
          n,
          (receipts) => set({ status: 'ready', receipts }),
          (e) => {
            console.error('receipts listener', e.code);
            set({ status: 'error' });
          },
        );
      })
      .catch(() => set({ status: 'error' }));
  } else {
    void Promise.all([import('dexie'), import('@/index')])
      .then(([{ liveQuery }, { openDb }]) => {
        if (cancelled) return;
        const db = openDb('playground');
        const sub = liveQuery(() => tables(db).receipts.orderBy('createdAt').reverse().limit(n).toArray()).subscribe({
          next: (receipts) => set({ status: 'ready', receipts }),
          error: () => set({ status: 'error' }),
        });
        stop = () => sub.unsubscribe();
      })
      .catch(() => set({ status: 'error' }));
  }
  return () => {
    cancelled = true;
    stop?.();
  };
}

export const useReceipts = create<ReceiptsState>()((set, get) => ({
  ...initial(),
  start(kind, uid) {
    current?.stop();
    const sub: Subscription = { kind, uid, stop: subscribe(kind, uid, get().limit, set) };
    current = sub;
    return () => {
      sub.stop();
      if (current === sub) current = null;
    };
  },
  setFilter: (k, v) => set((s) => ({ filters: { ...s.filters, [k]: v } })),
  clearFilters: () => set({ filters: { ...DEFAULT_RECEIPT_FILTERS } }),
  showMore() {
    set((s) => ({ limit: s.limit + RECEIPTS_PAGE }));
    const sub = current;
    if (sub) {
      // The query's limit changed: listen again with the new page size.
      sub.stop();
      sub.stop = subscribe(sub.kind, sub.uid, get().limit, set);
    }
  },
  refresh(kind) {
    const sub = current;
    if (!sub || sub.kind !== kind) return;
    sub.stop();
    sub.stop = subscribe(sub.kind, sub.uid, get().limit, set);
  },
  async revoke(receiptId) {
    const r = get().receipts.find((x) => x.id === receiptId);
    const uid = current?.kind === 'real' ? current.uid : undefined;
    if (!r || !uid || r.requester.kind !== 'outside') return;
    try {
      const { revokeReceipt } = await import('@/app/services/receipts');
      await revokeReceipt(uid, r);
    } catch (error) {
      console.error('revoke receipt', (error as { code?: string }).code ?? '');
      throw new Error(RECEIPTS_FLOW.revokeFailed, { cause: error });
    }
  },
  reset() {
    current?.stop();
    current = null;
    set(initial());
  },
}));

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Pure; source = itemId prefix before ':'. `today` is the local calendar day of `now`. */
export function filterReceipts(list: ReceiptView[], f: ReceiptFilters, now: number): ReceiptView[] {
  const since =
    f.range === 'today' ? startOfDay(now) : f.range === '7d' ? now - 7 * DAY_MS : f.range === '30d' ? now - 30 * DAY_MS : -Infinity;
  return list.filter((r) => {
    if (f.ai !== 'all' && r.requester.aiName !== f.ai) return false;
    if (f.source !== 'all' && !r.itemIds.some((id) => id.split(':')[0] === f.source)) return false;
    return r.createdAt >= since;
  });
}

/** Something left the device for this receipt (or will, once collected). */
export function isShared(r: Pick<ReceiptView, 'status'>): boolean {
  return r.status === 'delivered' || r.status === 'pending-collection' || r.status === 'revoked';
}

/** How many items have ever left, among these receipts: each item once, and only for shares that left. */
export function sharedItemCount(receipts: Pick<ReceiptView, 'status' | 'itemIds'>[]): number {
  const ids = new Set<string>();
  for (const r of receipts) {
    if (isShared(r)) for (const id of r.itemIds) ids.add(id);
  }
  return ids.size;
}
