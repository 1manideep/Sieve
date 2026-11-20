import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SieveDb } from '@/index';
import type { SourceRowLike } from './localDb';
import {
  deriveActivity, deriveIndexing, ETA_UPDATE_MS, estimateEta, pushIndexingRowsForTests, resetIndexingForTests, roundEta, setIndexingRowsForTests,
  SHOW_EVERY_MS, useIndexing, watchBattery,
} from './indexing';
import { useSettings } from './settings';

const index = vi.hoisted(() => ({ setQueueConditions: vi.fn() }));
vi.mock('@/index', () => index);

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
    expect(useIndexing.getState().etaMs).toBe(60_000);                 // 80 s, shown rounded to the minute
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

/** A Battery API stand-in: getBattery() resolves to it, and plug() fires chargingchange. */
function fakeBattery(charging: boolean) {
  const target = new EventTarget() as EventTarget & { charging: boolean };
  target.charging = charging;
  Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(target), configurable: true });
  return {
    plug(on: boolean) {
      target.charging = on;
      target.dispatchEvent(new Event('chargingchange'));
    },
  };
}

describe('battery (20 section 13.5)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'getBattery');
    index.setQueueConditions.mockReset();
  });

  it('on battery with work left the state is paused by the battery; Resume or the charger lifts it', () => {
    const rows = [row({ progress: { done: 1, total: 5 } })];
    expect(deriveIndexing(rows, 0, { onBattery: true, batteryOverride: false })).toEqual({ state: 'paused', pausedBy: 'battery', left: 4, done: 1, total: 5 });
    expect(deriveIndexing(rows, 0, { onBattery: true, batteryOverride: true }).state).toBe('running');
    expect(deriveIndexing(rows, 0, { onBattery: false, batteryOverride: false }).state).toBe('running');
    expect(deriveIndexing([row({ progress: { done: 5, total: 5 } })], 0, { onBattery: true, batteryOverride: false }).state).toBe('idle');
    expect(deriveIndexing([row({ paused: true, progress: { done: 1, total: 5 } })], 0, { onBattery: true, batteryOverride: false }).pausedBy).toBe('person');
  });

  it('resumeOnBattery overrides for the session, and only when on battery', () => {
    useIndexing.getState().resumeOnBattery();
    expect(useIndexing.getState().batteryOverride).toBe(false);
    useIndexing.setState({ onBattery: true });
    setIndexingRowsForTests([row({ progress: { done: 0, total: 3 } })], 1);
    expect(useIndexing.getState()).toMatchObject({ state: 'paused', pausedBy: 'battery' });
    useIndexing.getState().resumeOnBattery();
    expect(useIndexing.getState()).toMatchObject({ state: 'running', batteryOverride: true });
    expect(useIndexing.getState().pausedBy).toBeUndefined();
  });

  it('watchBattery: no Battery API means on power (no call); otherwise now and on every change', async () => {
    const seen: boolean[] = [];
    watchBattery((b) => seen.push(b))();
    await Promise.resolve();
    expect(seen).toEqual([]);
    const battery = fakeBattery(false);
    const stop = watchBattery((b) => seen.push(b));
    await vi.waitFor(() => expect(seen).toEqual([true]));
    battery.plug(true);
    expect(seen).toEqual([true, false]);
    stop();
    battery.plug(false);
    expect(seen).toEqual([true, false]);
  });

  it('start hands the battery, the override and the captions switch to the queue', async () => {
    const battery = fakeBattery(false);
    const db = { sources: { toArray: async () => [row({ progress: { done: 0, total: 4 } })] } } as unknown as SieveDb;
    const stop = useIndexing.getState().start(db);
    await vi.waitFor(() => expect(index.setQueueConditions).toHaveBeenLastCalledWith(db, { onBattery: true, batteryOverride: false, captions: true }));
    await vi.waitFor(() => expect(useIndexing.getState()).toMatchObject({ state: 'paused', pausedBy: 'battery', onBattery: true }));
    useIndexing.getState().resumeOnBattery();
    expect(index.setQueueConditions).toHaveBeenLastCalledWith(db, { onBattery: true, batteryOverride: true, captions: true });
    useSettings.setState({ describePhotos: false });
    expect(index.setQueueConditions).toHaveBeenLastCalledWith(db, { onBattery: true, batteryOverride: true, captions: false });
    battery.plug(true);
    expect(index.setQueueConditions).toHaveBeenLastCalledWith(db, { onBattery: false, batteryOverride: true, captions: false });
    stop();
    useSettings.setState({ describePhotos: true });
    expect(useIndexing.getState()).toMatchObject({ onBattery: false, batteryOverride: false });
  });
});

describe('deriveActivity (20 section 13.5)', () => {
  it('reading first, with the counts by kind; then the lanes in order, with their counts', () => {
    const live = { progress: { done: 0, total: 9 } };
    expect(deriveActivity([row({ ...live, stage: 'embed' }), row({ kind: 'folder', ...live, stage: 'reading', inventory: { pdfs: 7, notes: 3 } })]))
      .toEqual({ stage: 'reading', inventory: { pdfs: 7, notes: 3 } });
    expect(deriveActivity([row({ ...live, stage: 'caption', stageCount: 5 }), row({ kind: 'folder', ...live, stage: 'caption', stageCount: 7 })]))
      .toEqual({ stage: 'caption', count: 12 });
    expect(deriveActivity([row({ ...live, stage: 'privacy' }), row({ kind: 'folder', ...live, stage: 'label', stageCount: 2 })]))
      .toEqual({ stage: 'label', count: 2 });
    expect(deriveActivity([row({ progress: { done: 9, total: 9 }, stage: 'embed' })])).toBeUndefined();
    expect(deriveActivity([row({ kind: 'playground', ...live, stage: 'embed' })])).toBeUndefined();
    setIndexingRowsForTests([row({ kind: 'folder', ...live, stage: 'reading', inventory: { pdfs: 7 } })], 1);
    expect(useIndexing.getState().activity).toEqual({ stage: 'reading', inventory: { pdfs: 7 } });
  });
});

describe('a steady pass (the owner\'s Gmail report, Nov 20)', () => {
  it('done never goes down, the ETA comes at most every 10 s, rounded, and never goes up within one run', () => {
    // 5,670 emails; the rows' counts wobble the way two writers made them wobble (128, 137, then lower again),
    // around a steady 2 items a second; a row update every 2 s for 10 minutes
    const t0 = 5_000_000;
    const total = 5_670;
    const wobble = [0, 9, -6, 4, -11, 7, -3, 12, -8, 2];
    const seen: { at: number; done: number; eta?: number; text?: string }[] = [];
    for (let i = 0; i <= 300; i++) {
      const at = t0 + i * 2_000;
      const done = Math.max(0, 128 + i * 4 + wobble[i % wobble.length]!);
      setIndexingRowsForTests([row({ progress: { done, total }, stage: 'embed' })], at);
      const st = useIndexing.getState();
      seen.push({ at, done: st.done, eta: st.etaMs });
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.done).toBeGreaterThanOrEqual(seen[i - 1]!.done);
    const etas = seen.filter((x) => x.eta !== undefined);
    expect(etas.length).toBeGreaterThan(200);
    // re-estimated at most every 10 s: the value changes only on updates at least ETA_UPDATE_MS apart
    let lastChange = etas[0]!;
    for (const x of etas.slice(1)) {
      if (x.eta !== lastChange.eta) {
        expect(x.at - lastChange.at).toBeGreaterThanOrEqual(ETA_UPDATE_MS);
        lastChange = x;
      }
    }
    // never up within the run, never more than a few minutes down at once, always rounded
    for (let i = 1; i < etas.length; i++) {
      expect(etas[i]!.eta!).toBeLessThanOrEqual(etas[i - 1]!.eta!);
      expect(etas[i - 1]!.eta! - etas[i]!.eta!).toBeLessThanOrEqual(5 * 60_000);
    }
    for (const x of etas) expect(roundEta(x.eta!)).toBe(x.eta);
    // about 45 minutes left at 2 items a second: the shown ETA is in that range, not 44 min 13 s
    const last = etas[etas.length - 1]!.eta!;
    expect(last % (5 * 60_000)).toBe(0);
    expect(last).toBeGreaterThanOrEqual(30 * 60_000);
    expect(last).toBeLessThanOrEqual(50 * 60_000);
  });

  it('a slower stretch holds the ETA instead of raising it; a lane finishing starts a new run', () => {
    const t0 = 9_000_000;
    let done = 0;
    let eta: number | undefined;
    const etas: number[] = [];
    for (let i = 0; i <= 60; i++) {
      done += i < 30 ? 10 : 2;                                          // the rate drops by 5 times half way
      setIndexingRowsForTests([row({ progress: { done, total: 5_000 }, stage: 'label', stageCount: 5_000 - done })], t0 + i * 5_000);
      eta = useIndexing.getState().etaMs;
      if (eta !== undefined) etas.push(eta);
    }
    for (let i = 1; i < etas.length; i++) expect(etas[i]!).toBeLessThanOrEqual(etas[i - 1]!);
    const before = etas[etas.length - 1]!;
    // the label lane finished: the next stage is a new run and may show a new estimate
    for (let i = 61; i <= 70; i++) {
      done += 2;
      setIndexingRowsForTests([row({ progress: { done, total: 5_000 }, stage: 'embed' })], t0 + i * 5_000);
    }
    expect(useIndexing.getState().etaMs).toBeGreaterThan(before);
  });

  it('while a source is still listing, the total only grows and the card says so far (no ETA)', () => {
    setIndexingRowsForTests([row({ progress: { done: 0, total: 500 }, counting: true, stage: 'reading' })], 1);
    expect(useIndexing.getState()).toMatchObject({ counting: true, total: 500, etaMs: undefined });
    setIndexingRowsForTests([row({ progress: { done: 0, total: 450 }, counting: true, stage: 'reading' })], 2);
    expect(useIndexing.getState().total).toBe(500);
    setIndexingRowsForTests([row({ progress: { done: 0, total: 1_000 }, counting: true, stage: 'reading' })], 3);
    expect(useIndexing.getState().total).toBe(1_000);
    // listing done: the total is the inventory again (a deleted item may lower it)
    setIndexingRowsForTests([row({ progress: { done: 3, total: 990 }, stage: 'reading' })], 4);
    expect(useIndexing.getState()).toMatchObject({ counting: false, total: 990, done: 3 });
  });

  it('roundEta', () => {
    expect([roundEta(45_000), roundEta(80_000), roundEta(9 * 60_000 + 20_000), roundEta(44 * 60_000 + 13_000), roundEta(127 * 60_000)])
      .toEqual([45_000, 60_000, 9 * 60_000, 45 * 60_000, 130 * 60_000]);
  });
});

describe('what the bars show (the owner\'s second report, Nov 20)', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('the numbers on screen change at most once a second, and the latest rows win', async () => {
    expect(SHOW_EVERY_MS).toBe(1_000);
    const changes: { at: number; done: number }[] = [];
    const off = useIndexing.subscribe((st, prev) => {
      if (st.done !== prev.done || st.total !== prev.total || st.fraction !== prev.fraction) changes.push({ at: Date.now(), done: st.done });
    });
    // the queue writes rows every 500 ms or so, and a sync may write in between: here every 100 ms for 5 s
    for (let i = 0; i < 50; i++) {
      pushIndexingRowsForTests([row({ progress: { done: 100 + i, total: 5_670 } })]);
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(SHOW_EVERY_MS);
    off();
    expect(changes.length).toBeGreaterThanOrEqual(4);
    expect(changes.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.at - changes[i - 1]!.at).toBeGreaterThanOrEqual(SHOW_EVERY_MS);
    expect(useIndexing.getState().done).toBe(149);                     // the last rows are shown in the end
  });

  it('the bar never moves backwards within a pass, and every bar reads the same numbers', async () => {
    // counts that wobble (two writers), a Gmail listing that grows the total, a folder that finishes
    const steps: SourceRowLike[][] = [
      [row({ progress: { done: 0, total: 500 }, counting: true }), row({ kind: 'folder', progress: { done: 2, total: 9 } })],
      [row({ progress: { done: 0, total: 1_500 }, counting: true }), row({ kind: 'folder', progress: { done: 4, total: 9 } })],
      [row({ progress: { done: 0, total: 1_200 }, counting: true }), row({ kind: 'folder', progress: { done: 3, total: 9 } })],
      [row({ progress: { done: 128, total: 5_670 } }), row({ kind: 'folder', progress: { done: 6, total: 9 } })],
      [row({ progress: { done: 137, total: 5_670 } }), row({ kind: 'folder', progress: { done: 9, total: 9 } })],
      [row({ progress: { done: 120, total: 5_670 } }), row({ kind: 'folder', progress: { done: 9, total: 9 } })],
      [row({ progress: { done: 140, total: 5_673 } }), row({ kind: 'folder', progress: { done: 9, total: 9 } })],
      [row({ progress: { done: 139, total: 5_673 } }), row({ kind: 'folder', progress: { done: 9, total: 9 } })],
    ];
    let prev = { fraction: 0, gmail: 0, folder: 0, done: 0 };
    for (const list of steps) {
      pushIndexingRowsForTests(list);
      await vi.advanceTimersByTimeAsync(SHOW_EVERY_MS);
      const st = useIndexing.getState();
      const gmail = st.bySource.gmail!;
      const folder = st.bySource.folder!;
      expect(st.fraction).toBeGreaterThanOrEqual(prev.fraction);
      expect(gmail.fraction).toBeGreaterThanOrEqual(prev.gmail);
      expect(folder.fraction).toBeGreaterThanOrEqual(prev.folder);
      expect(st.done).toBeGreaterThanOrEqual(prev.done);
      // one place: the overall numbers are the sources' shown numbers added up
      expect(st.done).toBe(gmail.done + folder.done);
      expect(st.total).toBe(gmail.total + folder.total);
      prev = { fraction: st.fraction, gmail: gmail.fraction, folder: folder.fraction, done: st.done };
    }
    const st = useIndexing.getState();
    expect(st.bySource.gmail).toMatchObject({ done: 140, total: 5_673 });  // 139 after 140 is not shown
    expect(st.bySource.folder).toMatchObject({ done: 9, total: 9, fraction: 1 });
    // while Gmail was listing, its total only grew: 1,500 stayed after 1,200 came in
    expect(st.counting).toBe(false);
    // the pass ends when nothing is left; a new pass starts from its own numbers
    pushIndexingRowsForTests([row({ progress: { done: 5_673, total: 5_673 } }), row({ kind: 'folder', progress: { done: 9, total: 9 } })]);
    await vi.advanceTimersByTimeAsync(SHOW_EVERY_MS);
    expect(useIndexing.getState()).toMatchObject({ state: 'idle', fraction: 1 });
    pushIndexingRowsForTests([row({ progress: { done: 5_673, total: 5_700 } }), row({ kind: 'folder', progress: { done: 9, total: 9 } })]);
    await vi.advanceTimersByTimeAsync(SHOW_EVERY_MS);
    expect(useIndexing.getState().state).toBe('running');
    expect(useIndexing.getState().bySource.gmail!.fraction).toBeCloseTo(5_673 / 5_700, 5);
  });

  it('while listing, the total on screen only grows', async () => {
    pushIndexingRowsForTests([row({ progress: { done: 0, total: 1_500 }, counting: true })]);
    await vi.advanceTimersByTimeAsync(SHOW_EVERY_MS);
    pushIndexingRowsForTests([row({ progress: { done: 0, total: 1_200 }, counting: true })]);
    await vi.advanceTimersByTimeAsync(SHOW_EVERY_MS);
    expect(useIndexing.getState()).toMatchObject({ total: 1_500, counting: true });
    expect(useIndexing.getState().bySource.gmail).toMatchObject({ total: 1_500, counting: true });
  });
});
