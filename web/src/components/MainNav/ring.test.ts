// The ring in the rail: indexing progress while items are still being made searchable, never shared otherwise.
import { describe, expect, it } from 'vitest';
import { ringView } from './ring';

const idle = { left: 0, ready: false, total: 5675, searchLeft: 0 };

describe('ringView', () => {
  it('shows the share never shared when nothing is being indexed, and 100 only when nothing was ever shared', () => {
    expect(ringView(5675, 38, idle)).toEqual({ mode: 'never', pct: 99, arc: 1, never: 5637, total: 5675 });
    expect(ringView(5675, 0, idle)).toEqual({ mode: 'never', pct: 100, arc: 0, never: 5675, total: 5675 });
    expect(ringView(200, 50, idle)).toEqual({ mode: 'never', pct: 75, arc: 25, never: 150, total: 200 });
    // more shared than is here now (shared items were deleted since): never below zero
    expect(ringView(10, 12, idle)).toEqual({ mode: 'never', pct: 0, arc: 100, never: 0, total: 10 });
  });

  it('shows nothing before the items are counted, or with no items', () => {
    expect(ringView(undefined, 0, idle)).toBeNull();
    expect(ringView(0, 0, { ...idle, total: 0 })).toBeNull();
  });

  it('shows the indexing progress while items cannot be searched yet', () => {
    const half = ringView(3000, 5, { left: 4000, ready: false, total: 6000, searchLeft: 3000 });
    expect(half).toEqual({ mode: 'indexing', pct: 50, arc: 50, searchable: 3000, total: 6000 });
    // one item to go is not 100
    expect(ringView(5999, 5, { left: 1, ready: false, total: 6000, searchLeft: 1 })).toMatchObject({ mode: 'indexing', pct: 99, searchable: 5999 });
    // a source that is still counting reports no "search left" yet: the work left stands in
    expect(ringView(100, 0, { left: 900, ready: false, total: 1000, searchLeft: 0 })).toMatchObject({ mode: 'indexing', pct: 10, searchable: 100 });
    // before the first record is stored the count is unknown, and the ring still shows the indexing
    expect(ringView(undefined, 0, { left: 1000, ready: false, total: 1000, searchLeft: 1000 })).toMatchObject({ mode: 'indexing', pct: 0 });
  });

  it('goes back to never shared once everything can be searched, even with background work left', () => {
    expect(ringView(6000, 6, { left: 2500, ready: true, total: 6000, searchLeft: 0 })).toMatchObject({ mode: 'never', pct: 99, never: 5994 });
  });
});
