// The queue's one loop (20 section 13.1): the lanes run one at a time in QUEUE_LANE_ORDER (embed, label, privacy,
// caption), the first lane with work always goes next, every job is followed by a yield, and every job that ran a
// model by a rest (QUEUE_PACING). Work a person is waiting for (priority 'high': a file they just added, a live Gmail
// hit, a share-time re-index; a handful of items) goes first, in the same order, and without the rest. Kept apart from ingestQueue.ts so the order and the rests can be tested with fake timers.
// Questions still go first: 10's scheduler preempts background Nano calls and the ML worker serves foreground jobs
// first.
import { QUEUE_LANE_ORDER, QUEUE_PACING } from '../config';

export type Lane = (typeof QUEUE_LANE_ORDER)[number];

/** The order for work a person is waiting for: the same, searchable first, then sorted (20 section 13.1). */
export const URGENT_LANE_ORDER: readonly Lane[] = QUEUE_LANE_ORDER;

/** What one job did: nothing it could run now, work without a model call, or a model call. */
export type JobResult = 'none' | 'quick' | 'ran';

/** The rest after a job that ran a model: Gemini Nano batches (label, caption), embedding batches, privacy items. */
export function restAfter(lane: Lane): number {
  if (lane === 'embed') return QUEUE_PACING.embedRestMs;
  if (lane === 'privacy') return QUEUE_PACING.privacyRestMs;
  return QUEUE_PACING.nanoRestMs;
}

/** Resolves after `ms`, or at once when `signal` aborts. The listener goes with the timer (the signal is long-lived). */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** `scheduler.postTask` at background priority when the browser has it, else a macrotask. */
export function yieldToIdle(): Promise<void> {
  const sched = (globalThis as unknown as { scheduler?: { postTask?: (cb: () => void, o: { priority: string }) => Promise<void> } }).scheduler;
  if (typeof sched?.postTask === 'function') return sched.postTask(() => undefined, { priority: 'background' });
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface SerialDeps {
  signal: AbortSignal;
  /** Paused by the person, or held on battery: no lane runs. */
  held(): boolean;
  /** The lane has work it can run now (its model is ready, its switch is on). */
  runnable(lane: Lane): boolean;
  /** The lane holds work a person is waiting for (enqueued with priority 'high'). */
  urgent?(lane: Lane): boolean;
  run(lane: Lane, signal: AbortSignal): Promise<JobResult>;
  /** Resolves when new work may have arrived (a wake, the idle recheck or the stop signal). */
  waitForWork(): Promise<void>;
  /** The lane that is working now, then null when its job and the bookkeeping after it are done. */
  onJob?(lane: Lane | null): void;
}

export async function runSerial(d: SerialDeps): Promise<void> {
  // Lanes that had nothing they could run this round; cleared after any job that did work, and after every wait.
  const skip = new Set<Lane>();
  while (!d.signal.aborted) {
    if (d.held()) {
      skip.clear();
      await d.waitForWork();
      continue;
    }
    const can = (l: Lane) => !skip.has(l) && d.runnable(l);
    const urgentLane = URGENT_LANE_ORDER.find((l) => can(l) && d.urgent?.(l) === true);
    const lane = urgentLane ?? QUEUE_LANE_ORDER.find(can);
    if (!lane) {
      skip.clear();
      await d.waitForWork();
      continue;
    }
    let result: JobResult = 'none';
    d.onJob?.(lane);
    try {
      result = await d.run(lane, d.signal);
    } catch (e) {
      console.warn(`background ${lane} job failed`, String((e as Error)?.message ?? e).slice(0, 80));
    } finally {
      d.onJob?.(null);
    }
    if (d.signal.aborted) break;
    if (result === 'none') {
      skip.add(lane);
      continue;
    }
    skip.clear();
    await yieldToIdle();
    if (result === 'ran' && !urgentLane) await sleep(restAfter(lane), d.signal);
  }
}
