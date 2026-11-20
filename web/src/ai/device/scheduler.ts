// One device call at a time (10 section 7.6, decisions A5). Foreground jobs (questions, drafts, live captions) run before
// background jobs and preempt a running background attempt; the preempted job runs again from the start later.
import { TIMING } from '../config';
import type { Priority } from '../types';

export type { Priority } from '../types';

export interface DeviceCallContext {
  signal: AbortSignal;
  priority: Priority;
  startedAt: number;
}

interface Job {
  priority: Priority;
  callerSignal?: AbortSignal;
  attempt: (signal: AbortSignal) => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  controller?: AbortController;
  preempted: boolean;
  detach: () => void;
}

const queues: Record<Priority, Job[]> = { foreground: [], background: [] };
let running: Job | null = null;
let context: DeviceCallContext | null = null;
let baseSignal: AbortSignal | null = null;
let lastForegroundEnd = -Infinity;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let pumpQueued = false;
let preemptions = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch (e) {
      console.error('A scheduler listener failed.', e);
    }
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function schedulePump(): void {
  if (pumpQueued) return;
  pumpQueued = true;
  queueMicrotask(() => {
    pumpQueued = false;
    pump();
  });
}

function pump(): void {
  if (running) return;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  const fg = queues.foreground.shift();
  if (fg) {
    start(fg);
    return;
  }
  if (queues.background.length === 0) return;
  const wait = lastForegroundEnd + TIMING.backgroundResumeDelayMs - Date.now();
  if (wait > 0) {
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      pump();
    }, wait);
    return;
  }
  const bg = queues.background.shift();
  if (bg) start(bg);
}

function start(job: Job): void {
  const controller = new AbortController();
  job.controller = controller;
  job.preempted = false;
  const signal = job.callerSignal ? AbortSignal.any([controller.signal, job.callerSignal]) : controller.signal;
  running = job;
  baseSignal = signal;
  context = { signal, priority: job.priority, startedAt: Date.now() };
  notify();
  let settled: Promise<unknown>;
  try {
    settled = Promise.resolve(job.attempt(signal));
  } catch (e) {
    settled = Promise.reject(e);
  }
  settled.then(
    (value) => finish(job, { ok: true, value }),
    (error: unknown) => finish(job, { ok: false, error }),
  );
}

function finish(job: Job, outcome: { ok: true; value: unknown } | { ok: false; error: unknown }): void {
  running = null;
  context = null;
  baseSignal = null;
  if (job.priority === 'foreground') lastForegroundEnd = Date.now();
  const callerAborted = job.callerSignal?.aborted === true;
  if (job.preempted && !callerAborted) {
    // Preempted: not an error. Back to the head of the background queue, to run again from the start.
    job.preempted = false;
    queues.background.unshift(job);
  } else {
    job.detach();
    if (outcome.ok) job.resolve(outcome.value);
    else job.reject(outcome.error);
  }
  notify();
  schedulePump();
}

/** Runs `attempt` when the device is free. The attempt may run more than once if a foreground job preempts it. */
export function scheduleDevice<T>(
  priority: Priority,
  callerSignal: AbortSignal | undefined,
  attempt: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (callerSignal?.aborted) return Promise.reject(abortReason(callerSignal));
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      priority,
      callerSignal,
      attempt,
      resolve: resolve as (v: unknown) => void,
      reject,
      preempted: false,
      detach: () => undefined,
    };
    if (callerSignal) {
      const onAbort = () => {
        const queue = queues[job.priority];
        const i = queue.indexOf(job);
        if (i >= 0) {
          queue.splice(i, 1);
          job.detach();
          reject(abortReason(callerSignal));
          notify();
        }
        // While running, the combined signal aborts the attempt and the job settles through finish().
      };
      callerSignal.addEventListener('abort', onAbort, { once: true });
      job.detach = () => callerSignal.removeEventListener('abort', onAbort);
    }
    queues[priority].push(job);
    if (priority === 'foreground' && running && running.priority === 'background' && !running.preempted) {
      running.preempted = true;
      preemptions += 1;
      running.controller?.abort(new DOMException('Preempted', 'AbortError'));
    }
    notify();
    schedulePump();
  });
}

/** The running attempt's signal and priority; null when the device is idle. */
export function currentDeviceCall(): DeviceCallContext | null {
  return context;
}

/**
 * Narrows the running call's signal for one try (runModel adds its timeout), so the adapter aborts the device
 * prompt on a timeout too. Pass null to restore the attempt's own signal.
 */
export function setDeviceTrySignal(signal: AbortSignal | null): void {
  if (!context || !baseSignal) return;
  context = { ...context, signal: signal ?? baseSignal };
}

export function deviceSchedulerState(): {
  running: Priority | null;
  queued: { foreground: number; background: number };
  preemptions: number;
} {
  return {
    running: running?.priority ?? null,
    queued: { foreground: queues.foreground.length, background: queues.background.length },
    preemptions,
  };
}

export function subscribeScheduler(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSchedulerForTests(): void {
  for (const q of [queues.foreground, queues.background]) q.length = 0;
  running = null;
  context = null;
  baseSignal = null;
  lastForegroundEnd = -Infinity;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
  pumpQueued = false;
  preemptions = 0;
  listeners.clear();
}
