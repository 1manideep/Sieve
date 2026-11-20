// Main-thread client for the browser PII model (11 section 5.4.5, 20 section 6.3).
// The model runs in 20's shared ML worker as the 'pii' task (model/pii.task.ts). This client finds that worker's
// client (web/src/ml/client.ts, getMl()) lazily, so the privacy module has no compile-time dependency on it, and
// an app or a test can also hand it a host directly with setPrivacyModelHost(). It never loads the model on its own
// thread and never waits for it at share time.
import { MODEL_DETECT_TIMEOUT_MS, MODEL_LOAD_TIMEOUT_MS } from '../constants';
import { abortError } from '../text';
import type { PrivacyModelStatus } from '../types';
import type { ModelSpan } from './labels';
import type { PiiDevice, PiiTaskInput, PiiTaskOutput } from './task-types';

export interface PiiModelRunOptions { priority: 'foreground' | 'background'; signal?: AbortSignal; timeoutMs: number }

/** What the client needs from whatever hosts the model. */
export interface PiiModelHost {
  warmup(): Promise<void>;
  run(input: PiiTaskInput, opts: PiiModelRunOptions): Promise<PiiTaskOutput>;
  status(): PrivacyModelStatus;
  subscribe(fn: (s: PrivacyModelStatus) => void): () => void;
}

/** The parts of 20's MlClient (20 section 6.3) this client uses. */
interface MlClientLike {
  warmup(task: 'pii'): Promise<void>;
  run<I, O>(task: 'pii', input: I, opts?: { priority?: 'foreground' | 'background'; signal?: AbortSignal; timeoutMs?: number }): Promise<O>;
  status(task: 'pii'): PrivacyModelStatus;
  subscribe(fn: (task: string, s: PrivacyModelStatus) => void): () => void;
}

export class ModelUnavailableError extends Error {
  constructor(message = 'The privacy model is not available on this device.') {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

export class ModelNotReadyError extends Error {
  constructor() {
    super('The privacy model is not ready yet.');
    this.name = 'ModelNotReadyError';
  }
}

export class ModelTimeoutError extends Error {
  constructor() {
    super('The privacy model took too long.');
    this.name = 'ModelTimeoutError';
  }
}

const mlClientModules = import.meta.glob<{ getMl?: () => MlClientLike }>('../../ml/client.ts');

function hostFromMl(ml: MlClientLike): PiiModelHost {
  return {
    warmup: () => ml.warmup('pii'),
    run: (input, opts) => ml.run<PiiTaskInput, PiiTaskOutput>('pii', input, opts),
    status: () => ml.status('pii'),
    subscribe: (fn) => ml.subscribe((task, s) => {
      if (task === 'pii') fn(s);
    }),
  };
}

let explicitHost: PiiModelHost | null | undefined;
let hostPromise: Promise<PiiModelHost | null> | undefined;
let hostUnsubscribe: (() => void) | undefined;
let status: PrivacyModelStatus = { state: 'idle' };
let warming: Promise<PrivacyModelStatus> | undefined;
let loadStartedAt = 0;
let generation = 0;
const listeners = new Set<(s: PrivacyModelStatus) => void>();

function setStatus(next: PrivacyModelStatus): void {
  status = next;
  for (const l of listeners) {
    try {
      l(status);
    } catch {
      // a listener's error never breaks the model client
    }
  }
}

async function findHost(): Promise<PiiModelHost | null> {
  if (explicitHost !== undefined) return explicitHost;
  const load = Object.values(mlClientModules)[0];
  if (!load) return null;
  try {
    const mod = await load();
    return typeof mod.getMl === 'function' ? hostFromMl(mod.getMl()) : null;
  } catch {
    return null;
  }
}

function getHost(): Promise<PiiModelHost | null> {
  hostPromise ??= findHost().then((host) => {
    if (host) {
      hostUnsubscribe = host.subscribe((s) => {
        if (status.state !== 'failed') setStatus({ ...s });
      });
    }
    return host;
  });
  return hostPromise;
}

/** Hands the client a host (20's ML client adapter, or a fake in tests); null means "no model on this device". */
export function setPrivacyModelHost(host: PiiModelHost | null): void {
  hostUnsubscribe?.();
  hostUnsubscribe = undefined;
  explicitHost = host;
  hostPromise = undefined;
  warming = undefined;
  generation++;
  setStatus({ state: 'idle' });
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => reject(new ModelTimeoutError()), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Starts loading the model; idempotent (returns the in-flight promise); never rejects. */
export function warmupPrivacyModel(): Promise<PrivacyModelStatus> {
  warming ??= (async () => {
    const host = await getHost();
    if (!host) {
      setStatus({ state: 'failed', error: 'The on-device privacy model is not available in this build.' });
      return status;
    }
    loadStartedAt = Date.now();
    const current = host.status();
    if (current.state !== 'ready') setStatus({ ...current, state: 'loading' });
    try {
      await withTimeout(host.warmup(), MODEL_LOAD_TIMEOUT_MS);
      const after = host.status();
      setStatus({ ...after, state: 'ready' });
    } catch (e) {
      setStatus({ ...host.status(), state: 'failed', error: e instanceof Error ? e.message : 'The privacy model could not load.' });
    }
    return status;
  })();
  return warming;
}

export function getPrivacyModelStatus(): PrivacyModelStatus {
  return { ...status };
}

export function onPrivacyModelStatus(cb: (s: PrivacyModelStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export interface ModelDetection { spans: ModelSpan[]; ms: number; device: PiiDevice | undefined }

/**
 * Runs the model on text. `wait`: wait for loading up to what is left of MODEL_LOAD_TIMEOUT_MS (background scans);
 * without it a model that is not ready throws ModelNotReadyError at once (share time never waits).
 */
export async function detectWithModel(text: string, opts: { signal?: AbortSignal; priority: 'foreground' | 'background'; wait: boolean }): Promise<ModelDetection> {
  if (status.state === 'failed') throw new ModelUnavailableError(status.error);
  if (status.state !== 'ready') {
    if (!opts.wait) throw new ModelNotReadyError();
    const remaining = loadStartedAt > 0 ? Math.max(1, loadStartedAt + MODEL_LOAD_TIMEOUT_MS - Date.now()) : MODEL_LOAD_TIMEOUT_MS;
    const ready = await withTimeout(warmupPrivacyModel(), remaining, opts.signal);
    if (ready.state !== 'ready') throw new ModelUnavailableError(ready.error);
  }
  const host = await getHost();
  if (!host) throw new ModelUnavailableError();
  const gen = generation;
  const t0 = performance.now();
  const out = await withTimeout(
    host.run({ text }, { priority: opts.priority, signal: opts.signal, timeoutMs: MODEL_DETECT_TIMEOUT_MS }),
    MODEL_DETECT_TIMEOUT_MS,
    opts.signal,
  );
  if (gen !== generation) throw abortError();                                // caches were cleared meanwhile: ignore the late result
  return { spans: out.spans, ms: Math.round(performance.now() - t0), device: status.device };
}

/** Drops results of detections still in flight (sign-out, Playground Reset). */
export function forgetPendingDetections(): void {
  generation++;
}
