import { beforeEach, describe, expect, it } from 'vitest';
import type { SourceRowLike } from './localDb';
import { deriveIndexing, estimateEta, resetIndexingForTests, setIndexingRowsForTests, useIndexing } from './indexing';

const row = (over: Partial<SourceRowLike>): SourceRowLike => ({
  kind: 'gmail',
  connected: true,
  paused: false,
  progress: { done: 0, total: 0 },
  ...over,
});

beforeEach(() => resetIndexingForTests());

describe('deriveIndexing', () => {
  it('idle with nothing left; running with work left; counts only connected real sources', () => {
    expect(deriveIndexing([], 0).state).toBe('idle');
    expect(deriveIndexing([row({ progress: { done: 10, total: 10 } })], 0)).toEqual({ state: 'idle', left: 0, done: 10, total: 10 });
    const d = deriveIndexing(
      [
        row({ progress: { done: 100, total: 500 } }),
        row({ kind: 'folder', progress: { done: 0, total: 12 } }),
        row({ kind: 'upload', connected: false, progress: { done: 0, total: 99 } }),
        row({ kind: 'playground', progress: { done: 0, total: 46 } }),
      ],
      0,
    );
    expect(d).toEqual({ state: 'running', left: 412, done: 100, total: 512 });
  });

  it('yielding while a question runs and work is left; paused when every connected source is paused', () => {
    expect(deriveIndexing([row({ progress: { done: 1, total: 5 } })], 1).state).toBe('yielding');
    expect(deriveIndexing([row({ progress: { done: 5, total: 5 } })], 1).state).toBe('idle');
    expect(deriveIndexing([row({ paused: true, progress: { done: 1, total: 5 } }), row({ kind: 'folder', paused: true })], 0).state).toBe('paused');
    expect(deriveIndexing([row({ paused: true, progress: { done: 1, total: 5 } }), row({ kind: 'folder' })], 0).state).toBe('running');
  });
});

describe('ETA', () => {
  it('needs at least 20 s of samples and a positive rate', () => {
    expect(estimateEta([{ at: 0, done: 0 }, { at: 19_999, done: 50 }], 100)).toBeUndefined();
    expect(estimateEta([{ at: 0, done: 0 }, { at: 20_000, done: 20 }], 100)).toBe(100_000);
    expect(estimateEta([{ at: 0, done: 5 }, { at: 30_000, done: 5 }], 100)).toBeUndefined();
  });

  it('appears after 20 s of running samples and resets on pause', () => {
    const t0 = 1_000_000;
    setIndexingRowsForTests([row({ progress: { done: 0, total: 100 } })], t0);
    expect(useIndexing.getState()).toMatchObject({ state: 'running', left: 100, etaMs: undefined });
    setIndexingRowsForTests([row({ progress: { done: 10, total: 100 } })], t0 + 10_000);
    expect(useIndexing.getState().etaMs).toBeUndefined();
    setIndexingRowsForTests([row({ progress: { done: 20, total: 100 } })], t0 + 20_000);
    expect(useIndexing.getState().etaMs).toBe(80_000);
    setIndexingRowsForTests([row({ paused: true, progress: { done: 20, total: 100 } })], t0 + 25_000);
    expect(useIndexing.getState()).toMatchObject({ state: 'paused', etaMs: undefined });
    setIndexingRowsForTests([row({ progress: { done: 25, total: 100 } })], t0 + 30_000);
    expect(useIndexing.getState()).toMatchObject({ state: 'running', etaMs: undefined });
    setIndexingRowsForTests([row({ progress: { done: 45, total: 100 } })], t0 + 50_000);
    expect(useIndexing.getState().etaMs).toBe(55_000);
  });

  it('beginForeground makes it yielding until end(), and end() is idempotent', () => {
    setIndexingRowsForTests([row({ progress: { done: 0, total: 10 } })], 1);
    const end = useIndexing.getState().beginForeground();
    expect(useIndexing.getState()).toMatchObject({ state: 'yielding', foregroundBusy: 1 });
    end();
    end();
    expect(useIndexing.getState()).toMatchObject({ state: 'running', foregroundBusy: 0 });
  });
});
