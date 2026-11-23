// What the ring at the bottom of the rail shows. While items are still being made searchable it is the indexing
// progress, the number that is changing; otherwise it is the share of items no AI has ever received. One ring, two
// readings, so the caption under it and its tooltip always say which one it is.
import { wholePercent } from '../percent';

export interface RingIndexing {
  left: number;            // items with any work left
  ready: boolean;          // everything found can be searched: only background model work is left
  total: number;
  searchLeft: number;      // items that cannot be found yet
}

export type RingView =
  | { mode: 'indexing'; pct: number; arc: number; searchable: number; total: number }
  | { mode: 'never'; pct: number; arc: number; never: number; total: number };

/**
 * `count`: the items in the index now (undefined until counted); `shared`: the items any AI has received.
 * The arc is the blue part of the ring: the share done while indexing, the share that has left otherwise.
 */
export function ringView(count: number | undefined, shared: number, indexing: RingIndexing): RingView | null {
  if (indexing.total > 0 && indexing.left > 0 && !indexing.ready) {
    const waiting = Math.min(indexing.total, indexing.searchLeft > 0 ? indexing.searchLeft : indexing.left);
    const searchable = indexing.total - waiting;
    const pct = wholePercent(searchable, indexing.total);
    return { mode: 'indexing', pct, arc: pct, searchable, total: indexing.total };
  }
  if (count === undefined || count <= 0) return null;
  const never = Math.max(0, count - shared);
  const pct = wholePercent(never, count);
  return { mode: 'never', pct, arc: 100 - pct, never, total: count };
}
