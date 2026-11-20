// useIndexing (40 section 9.12): background indexing status, derived on the device. No model calls; it only observes.
// Dexie's liveQuery is loaded with a dynamic import, so Dexie stays out of the /welcome bundle. It also holds the
// battery state (navigator.getBattery, 20 section 13.5) that the card and the Sources screen read, and hands it to the
// queue with the "Describe photos" switch: on battery the model lanes hold until the machine is plugged in or the
// person presses Resume, which lasts for the session.
import { create } from 'zustand';
import type { SourceKind } from '@sieve/shared';
import type { SieveDb } from '@/index';
import { tables, type IndexingStage, type InventoryKind, type SourceRowLike } from './localDb';
import { useSettings } from './settings';

/** What the card says Sieve is working on: reading files, then the queue's lanes in order (20 section 13.5). */
export interface IndexingActivity {
  stage: IndexingStage;
  count?: number;                                          // label and caption: items waiting
  inventory?: Partial<Record<InventoryKind, number>>;      // reading: what the walk or listing found to read
}

/** What every bar of one source shows (SourceCard, its percent, the setup cards): the same numbers, one place. */
export interface SourceProgress {
  done: number;
  total: number;
  fraction: number;                                // 0..1, never lower than before within a pass
  counting: boolean;                               // the source is still finding items
}

export interface IndexingState {
  state: 'idle' | 'running' | 'yielding' | 'paused';
  /** The overall bar (0..1): never lower than before within a pass; every overall bar reads it. */
  fraction: number;
  bySource: Partial<Record<SourceKind, SourceProgress>>;
  /** Why the state is 'paused': the person's Pause, or the battery (the model lanes hold on their own). */
  pausedBy?: 'person' | 'battery';
  left: number;                                    // sum over connected real sources of (total - done)
  done: number; total: number;
  etaMs?: number;
  activity?: IndexingActivity;
  /** A source is still finding items: `total` only grows, and the card says "so far" instead of an ETA. */
  counting: boolean;
  onBattery: boolean;                              // the Battery API says not charging; no Battery API means on power
  batteryOverride: boolean;                        // Resume on battery; lasts for the session
  foregroundBusy: number;                          // count of running questions (ask + home base); > 0 means 'yielding'
  beginForeground(): () => void;                   // returns end(); used by useAsk and the engine around prepareProposal
  start(db: SieveDb): () => void;                  // liveQuery on db.sources; Google session only (real db)
  /** "Press Resume to index anyway": the model lanes run on battery until the session ends. */
  resumeOnBattery(): void;
}

export interface Sample { at: number; done: number }

export const SAMPLE_WINDOW_MS = 120_000;
export const MIN_SAMPLE_SPAN_MS = 20_000;
/** The numbers on screen change at most this often (rows can arrive every 500 ms): steps read as a flow. */
export const SHOW_EVERY_MS = 1_000;
/** The ETA (20 section 13.4): re-estimated at most this often, from an EWMA of the measured rate. */
export const ETA_UPDATE_MS = 10_000;
export const ETA_EWMA_ALPHA = 0.2;                 // the weight of the queue's COST_EWMA_ALPHA
/** In one steady run the ETA never goes up, and drops at most this much beyond the time that passed. */
export const ETA_MAX_STEP_MS = 3 * 60_000;

export interface PowerLike { onBattery: boolean; batteryOverride: boolean }

/** Pure: counts over connected real sources, and the state (40 section 9.12). */
export function deriveIndexing(
  rows: SourceRowLike[],
  foregroundBusy: number,
  power?: PowerLike,
): Pick<IndexingState, 'state' | 'pausedBy' | 'left' | 'done' | 'total'> {
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
  if (connected.length > 0 && connected.every((r) => r.paused)) return { state: 'paused', pausedBy: 'person', left, done, total };
  if (left > 0 && power?.onBattery && !power.batteryOverride) return { state: 'paused', pausedBy: 'battery', left, done, total };
  let state: IndexingState['state'] = 'idle';
  if (foregroundBusy > 0 && left > 0) state = 'yielding';
  else if (left > 0) state = 'running';
  return { state, left, done, total };
}

const STAGE_ORDER: readonly IndexingStage[] = ['reading', 'embed', 'label', 'privacy', 'caption'];   // the queue's order

/** Pure: the first stage in order that a connected source with work left reports, with its counts. */
export function deriveActivity(rows: SourceRowLike[]): IndexingActivity | undefined {
  const live = rows.filter((r) => r.connected && r.kind !== 'playground' && r.stage && (r.progress?.total ?? 0) > (r.progress?.done ?? 0));
  for (const stage of STAGE_ORDER) {
    const mine = live.filter((r) => r.stage === stage);
    if (mine.length === 0) continue;
    if (stage === 'reading') {
      const inventory: Partial<Record<InventoryKind, number>> = {};
      for (const r of mine) {
        for (const [k, n] of Object.entries(r.inventory ?? {}) as [InventoryKind, number][]) if (n > 0) inventory[k] = (inventory[k] ?? 0) + n;
      }
      return Object.keys(inventory).length > 0 ? { stage, inventory } : { stage };
    }
    if (stage === 'label' || stage === 'caption') return { stage, count: mine.reduce((n, r) => n + (r.stageCount ?? 0), 0) };
    return { stage };
  }
  return undefined;
}

/** Pure: items per ms over the samples of the last 120 s, once 20 s of samples exist and the rate is positive. */
export function measuredRate(samples: Sample[]): number | undefined {
  if (samples.length < 2) return undefined;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const span = newest.at - oldest.at;
  if (span < MIN_SAMPLE_SPAN_MS) return undefined;
  const rate = (newest.done - oldest.done) / span;
  return rate > 0 ? rate : undefined;
}

/** Pure: the ETA from the samples alone (no smoothing). */
export function estimateEta(samples: Sample[], left: number): number | undefined {
  if (left <= 0) return undefined;
  const rate = measuredRate(samples);
  return rate ? Math.round(left / rate) : undefined;
}

/** Pure: "about 45 minutes", not "44 minutes 13 seconds": minutes under 10 min, 5 min under an hour, 10 min above. */
export function roundEta(ms: number): number {
  if (ms < 60_000) return Math.max(0, Math.round(ms));
  const step = ms < 10 * 60_000 ? 60_000 : ms < 60 * 60_000 ? 5 * 60_000 : 10 * 60_000;
  return Math.max(step, Math.round(ms / step) * step);
}

interface BatteryLike {
  charging: boolean;
  addEventListener(type: 'chargingchange', fn: () => void): void;
  removeEventListener(type: 'chargingchange', fn: () => void): void;
}

/** Calls back with "on battery" now and on every change. No Battery API (or a failure) means on power: no call. */
export function watchBattery(onChange: (onBattery: boolean) => void): () => void {
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as (Navigator & { getBattery?: () => Promise<BatteryLike> }) | undefined;
  if (typeof nav?.getBattery !== 'function') return () => undefined;
  let stopped = false;
  let battery: BatteryLike | null = null;
  const read = () => {
    if (!stopped && battery) onChange(!battery.charging);
  };
  nav.getBattery().then(
    (b) => {
      if (stopped) return;
      battery = b;
      read();
      b.addEventListener('chargingchange', read);
    },
    () => undefined,
  );
  return () => {
    stopped = true;
    battery?.removeEventListener('chargingchange', read);
  };
}

let rows: SourceRowLike[] = [];                    // the snapshot on screen (at most one per SHOW_EVERY_MS)
let latestRows: SourceRowLike[] = [];              // what the liveQuery last gave
let shownAt = Number.NEGATIVE_INFINITY;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let samples: Sample[] = [];
/** Hands battery, override and the captions switch to the queue of the open real database (set by start). */
let pushConditions: (() => void) | null = null;
/** The current pass (from work appearing until none is left): `done` and the bar never go down in it. */
let pass: { done: number; total: number; fraction: number } | null = null;
const sourcePasses = new Map<SourceKind, { done: number; total: number; fraction: number }>();

/** One source's numbers: `done` and `fraction` never go down within its pass; `total` only grows while it counts. */
function shownSource(r: SourceRowLike): SourceProgress {
  const total = Math.max(0, r.progress?.total ?? 0);
  const raw = Math.min(total, Math.max(0, r.progress?.done ?? 0));
  const counting = r.counting === true;
  if (total - raw <= 0) {
    sourcePasses.delete(r.kind);
    return { done: total, total, fraction: total > 0 ? 1 : 0, counting };
  }
  const prev = sourcePasses.get(r.kind);
  const tot = prev && counting ? Math.max(total, prev.total) : total;
  const done = Math.max(0, Math.min(tot - 1, Math.max(raw, prev?.done ?? 0)));
  const fraction = Math.min(1, Math.max(prev?.fraction ?? 0, tot > 0 ? done / tot : 0));
  sourcePasses.set(r.kind, { done, total: tot, fraction });
  return { done, total: tot, fraction, counting };
}
/** One steady run (same state, same pause reason, same stage): the smoothed rate and the ETA last shown. */
let run: { key: string; rate?: number; eta?: number; at: number } | null = null;

/** Within a pass `done` only grows (a re-opened item never takes it back), and `total` only grows while counting. */
function withPass(d: ReturnType<typeof deriveIndexing>, counting: boolean): ReturnType<typeof deriveIndexing> & { fraction: number } {
  if (d.left <= 0) {
    pass = null;
    return { ...d, fraction: d.total > 0 ? 1 : 0 };
  }
  const total = pass && counting ? Math.max(d.total, pass.total) : d.total;
  const done = Math.max(0, Math.min(total - 1, Math.max(d.done, pass?.done ?? 0)));
  const fraction = Math.min(1, Math.max(pass?.fraction ?? 0, total > 0 ? done / total : 0));
  pass = { done, total, fraction };
  return { ...d, done, total, left: total - done, fraction };
}

/** The ETA shown: an EWMA of the measured rate, at most every ETA_UPDATE_MS, rounded, never up within a run. */
function smoothedEta(key: string, left: number, now: number): number | undefined {
  if (!run || run.key !== key) run = { key, at: Number.NEGATIVE_INFINITY };
  if (now - run.at < ETA_UPDATE_MS) return run.eta;
  const raw = measuredRate(samples);
  if (!raw) return run.eta;
  run.rate = run.rate === undefined ? raw : ETA_EWMA_ALPHA * raw + (1 - ETA_EWMA_ALPHA) * run.rate;
  let eta = left / run.rate;
  if (run.eta !== undefined) eta = Math.min(run.eta, Math.max(run.eta - (now - run.at) - ETA_MAX_STEP_MS, eta));
  run.eta = roundEta(eta);
  run.at = now;
  return run.eta;
}

/** Recomputes the derived fields from the last rows and the foreground count; samples feed the ETA. */
function recompute(now: number = Date.now()): void {
  const current = useIndexing.getState();
  const connected = rows.filter((r) => r.connected && r.kind !== 'playground');
  const counting = connected.some((r) => r.counting === true);
  // Each source's shown numbers first; the overall numbers are their sum, so no two bars disagree.
  const bySource: Partial<Record<SourceKind, SourceProgress>> = {};
  for (const kind of [...sourcePasses.keys()]) if (!connected.some((r) => r.kind === kind)) sourcePasses.delete(kind);
  const shownRows = rows.map((r) => {
    if (!r.connected || r.kind === 'playground') return r;
    const p = shownSource(r);
    bySource[r.kind] = p;
    return { ...r, progress: { done: p.done, total: p.total } };
  });
  const derived = withPass(deriveIndexing(shownRows, current.foregroundBusy, current), counting);
  const activity = derived.left > 0 ? deriveActivity(rows) : undefined;
  // Samples reset when the state changes to paused or yielding (and while it stays there).
  if (derived.state !== 'running' || current.state === 'paused' || current.state === 'yielding') samples = [];
  if (derived.state === 'running') {
    samples.push({ at: now, done: derived.done });
    samples = samples.filter((x) => now - x.at <= SAMPLE_WINDOW_MS);
  }
  let etaMs: number | undefined;
  if (derived.state === 'running' && !counting) etaMs = smoothedEta(`${derived.state}|${activity?.stage ?? ''}`, derived.left, now);
  else run = null;
  useIndexing.setState({ pausedBy: undefined, ...derived, bySource, activity, counting: counting && derived.left > 0, etaMs });
}

/** The liveQuery's rows: shown at once if the last change on screen is SHOW_EVERY_MS old, else at that moment. */
function onRows(list: SourceRowLike[]): void {
  latestRows = list;
  if (showTimer) return;
  const wait = shownAt + SHOW_EVERY_MS - Date.now();
  const show = () => {
    showTimer = null;
    rows = latestRows;
    shownAt = Date.now();
    recompute(shownAt);
  };
  if (wait <= 0) show();
  else showTimer = setTimeout(show, wait);
}

function clearShown(): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  shownAt = Number.NEGATIVE_INFINITY;
  rows = [];
  latestRows = [];
  samples = [];
  pass = null;
  run = null;
  sourcePasses.clear();
}

export const useIndexing = create<IndexingState>()((set) => ({
  state: 'idle',
  fraction: 0,
  bySource: {},
  left: 0,
  done: 0,
  total: 0,
  etaMs: undefined,
  counting: false,
  onBattery: false,
  batteryOverride: false,
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

  resumeOnBattery() {
    if (!useIndexing.getState().onBattery) return;
    set({ batteryOverride: true });
    recompute();
    pushConditions?.();
  },

  start(db) {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('dexie')
      .then(({ liveQuery }) => {
        if (cancelled) return;
        const sub = liveQuery(() => tables(db).sources.toArray()).subscribe({
          next: (list) => onRows(list),
          error: (error: unknown) => console.error('indexing status', error),
        });
        unsubscribe = () => sub.unsubscribe();
      })
      .catch((error: unknown) => console.error('indexing status', error));

    // The queue of this database learns the battery state, the override and the captions switch (20 section 13.5).
    // '@/index' is loaded by the Google session already; the dynamic import keeps it out of the first load.
    void import('@/index')
      .then((index) => {
        if (cancelled || typeof index.setQueueConditions !== 'function') return;
        pushConditions = () => {
          const s = useIndexing.getState();
          index.setQueueConditions(db, { onBattery: s.onBattery, batteryOverride: s.batteryOverride, captions: useSettings.getState().describePhotos });
        };
        pushConditions();
      })
      .catch((error: unknown) => console.error('indexing conditions', error));
    const stopBattery = watchBattery((onBattery) => {
      if (cancelled) return;
      set({ onBattery });
      recompute();
      pushConditions?.();
    });
    const offSettings = useSettings.subscribe((s, prev) => {
      if (s.describePhotos !== prev.describePhotos) pushConditions?.();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      stopBattery();
      offSettings();
      pushConditions = null;
      clearShown();
      set({ onBattery: false, batteryOverride: false });
      recompute();
    };
  },
}));

/** Test seam: show source rows at once, at a given time (no throttle). */
export function setIndexingRowsForTests(list: SourceRowLike[], now?: number): void {
  rows = list;
  latestRows = list;
  recompute(now);
}

/** Test seam: feed rows exactly as the liveQuery does, through the once-a-second throttle. */
export function pushIndexingRowsForTests(list: SourceRowLike[]): void {
  onRows(list);
}

/** Test seam. */
export function resetIndexingForTests(): void {
  clearShown();
  pushConditions = null;
  useIndexing.setState({
    state: 'idle', pausedBy: undefined, fraction: 0, bySource: {}, left: 0, done: 0, total: 0, etaMs: undefined, activity: undefined, counting: false,
    onBattery: false, batteryOverride: false, foregroundBusy: 0,
  });
}
