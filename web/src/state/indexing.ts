// useIndexing (40 section 9.12): background indexing status, derived on the device. No model calls; it only observes.
// Dexie's liveQuery is loaded with a dynamic import, so Dexie stays out of the /welcome bundle.
import { create } from 'zustand';
import type { SieveDb } from '@/index';
import { tables, type SourceRowLike } from './localDb';

export interface IndexingState {
  state: 'idle' | 'running' | 'yielding' | 'paused';
  left: number;                                    // sum over connected real sources of (total - done)
  done: number; total: number;
  etaMs?: number;
  foregroundBusy: number;                          // count of running questions (ask + home base); > 0 means 'yielding'
  beginForeground(): () => void;                   // returns end(); used by useAsk and the engine around prepareProposal
  start(db: SieveDb): () => void;                  // liveQuery on db.sources; Google session only (real db)
}

export interface Sample { at: number; done: number }

export const SAMPLE_WINDOW_MS = 120_000;
export const MIN_SAMPLE_SPAN_MS = 20_000;

/** Pure: counts over connected real sources, and the state (40 section 9.12). */
export function deriveIndexing(rows: SourceRowLike[], foregroundBusy: number): Pick<IndexingState, 'state' | 'left' | 'done' | 'total'> {
  const connected = rows.filter((r) => r.connected && r.kind !== 'playground');
  let done = 0;
  let total = 0;
  for (const r of connected) {
    const t = Math.max(0, r.progress?.total ?? 0);
    const d = Math.min(t, Math.max(0, r.progress?.done ?? 0));
    done += d;
    total += t;
  }
  const left = total - done;
  let state: IndexingState['state'] = 'idle';
  if (connected.length > 0 && connected.every((r) => r.paused)) state = 'paused';
  else if (foregroundBusy > 0 && left > 0) state = 'yielding';
  else if (left > 0) state = 'running';
  return { state, left, done, total };
}

/** Pure: rate over the samples of the last 120 s; an ETA once 20 s of samples exist and the rate is positive. */
export function estimateEta(samples: Sample[], left: number): number | undefined {
  if (samples.length < 2 || left <= 0) return undefined;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const span = newest.at - oldest.at;
  if (span < MIN_SAMPLE_SPAN_MS) return undefined;
  const rate = (newest.done - oldest.done) / span;
  return rate > 0 ? Math.round(left / rate) : undefined;
}

let rows: SourceRowLike[] = [];
let samples: Sample[] = [];

/** Recomputes the derived fields from the last rows and the foreground count; samples feed the ETA. */
function recompute(now: number = Date.now()): void {
  const current = useIndexing.getState();
  const derived = deriveIndexing(rows, current.foregroundBusy);
  // Samples reset when the state changes to paused or yielding (and while it stays there).
  if (derived.state !== 'running' || current.state === 'paused' || current.state === 'yielding') samples = [];
  if (derived.state === 'running') {
    samples.push({ at: now, done: derived.done });
    samples = samples.filter((x) => now - x.at <= SAMPLE_WINDOW_MS);
  }
  useIndexing.setState({ ...derived, etaMs: derived.state === 'running' ? estimateEta(samples, derived.left) : undefined });
}

export const useIndexing = create<IndexingState>()((set) => ({
  state: 'idle',
  left: 0,
  done: 0,
  total: 0,
  etaMs: undefined,
  foregroundBusy: 0,

  beginForeground() {
    set((s) => ({ foregroundBusy: s.foregroundBusy + 1 }));
    recompute();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      set((s) => ({ foregroundBusy: Math.max(0, s.foregroundBusy - 1) }));
      recompute();
    };
  },

  start(db) {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('dexie')
      .then(({ liveQuery }) => {
        if (cancelled) return;
        const sub = liveQuery(() => tables(db).sources.toArray()).subscribe({
          next: (list) => {
            rows = list;
            recompute();
          },
          error: (error: unknown) => console.error('indexing status', error),
        });
        unsubscribe = () => sub.unsubscribe();
      })
      .catch((error: unknown) => console.error('indexing status', error));
    return () => {
      cancelled = true;
      unsubscribe?.();
      rows = [];
      samples = [];
      recompute();
    };
  },
}));

/** Test seam: feed source rows as the liveQuery would, at a given time. */
export function setIndexingRowsForTests(list: SourceRowLike[], now?: number): void {
  rows = list;
  recompute(now);
}

/** Test seam. */
export function resetIndexingForTests(): void {
  rows = [];
  samples = [];
  useIndexing.setState({ state: 'idle', left: 0, done: 0, total: 0, etaMs: undefined, foregroundBusy: 0 });
}
