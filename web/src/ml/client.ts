// The page side of the ML worker (20 section 6.3): one worker per page, init per task, priorities, recovery.
import { EMBEDDING_MODEL } from '@sieve/shared';
import type { FromMl, MlDevice, MlInitErrorCode, MlPriority, MlTask, ToMl } from './protocol';

export interface MlTaskStatus { state: 'idle' | 'loading' | 'ready' | 'failed'; device?: MlDevice; progress?: number; loadMs?: number; error?: string }

export interface MlClient {
  warmup(task: MlTask): Promise<void>;                        // idempotent; resolves when ready, rejects when failed
  run<I, O>(task: MlTask, input: I, opts?: { priority?: MlPriority; signal?: AbortSignal; timeoutMs?: number }): Promise<O>;
  status(task: MlTask): MlTaskStatus;
  subscribe(fn: (task: MlTask, s: MlTaskStatus) => void): () => void;
}

export class MlUnavailableError extends Error {
  constructor(readonly task: MlTask, message: string) {
    super(message);
    this.name = 'MlUnavailableError';
  }
}

/** Cache folders per task, cleared before the one retry after a failed WASM load. */
const MODEL_FOLDERS: Record<MlTask, string> = { embed: EMBEDDING_MODEL, pii: 'rampart-b1993e4' };

export interface WorkerLike {
  postMessage(msg: ToMl, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FromMl>) => void) | null;
  onerror: ((ev: ErrorEvent | Event) => void) | null;
}

interface Pending { task: MlTask; priority: MlPriority; input: unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: ReturnType<typeof setTimeout> }

interface TaskState {
  status: MlTaskStatus;
  ready: Promise<void> | null;
  settle?: { resolve: () => void; reject: (e: unknown) => void };
  device?: MlDevice;
  wasmRetried: boolean;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function preferredDevice(): Promise<MlDevice> {
  try {
    const forced = globalThis.localStorage?.getItem('sieve.mlDevice');
    if (forced === 'wasm' || forced === 'webgpu') return forced;
  } catch {
    // storage blocked
  }
  const gpu = (globalThis.navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
  if (!gpu) return 'wasm';
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

async function clearModelCache(task: MlTask): Promise<void> {
  try {
    const cache = await caches.open('transformers-cache');
    for (const req of await cache.keys()) if (req.url.includes(MODEL_FOLDERS[task])) await cache.delete(req);
  } catch {
    // Cache API missing or blocked
  }
}

/** A client over a worker factory; exported for tests (a fake worker) and used by getMl(). */
export function createWorkerMlClient(makeWorker: () => WorkerLike, opts?: { now?: () => number }): MlClient {
  const now = opts?.now ?? (() => Date.now());
  const listeners = new Set<(task: MlTask, s: MlTaskStatus) => void>();
  const tasks: Record<MlTask, TaskState> = {
    embed: { status: { state: 'idle' }, ready: null, wasmRetried: false },
    pii: { status: { state: 'idle' }, ready: null, wasmRetried: false },
  };
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let worker: WorkerLike | null = null;
  let lastCrash = 0;
  let dead = false;

  const setStatus = (task: MlTask, s: MlTaskStatus) => {
    tasks[task].status = s;
    if (import.meta.env.VITE_SIEVE_E2E === '1' && typeof window !== 'undefined') {
      // The e2e seam (60 section 3.9.1): Playwright waits for the embedder before it asks, as a person would have.
      const w = window as Window & { __sieveE2E?: { ml?: Partial<Record<MlTask, MlTaskStatus['state']>> } };
      w.__sieveE2E = { ...w.__sieveE2E, ml: { ...w.__sieveE2E?.ml, [task]: s.state } };
    }
    for (const fn of [...listeners]) fn(task, s);
  };

  const fail = (task: MlTask, message: string) => {
    const t = tasks[task];
    setStatus(task, { state: 'failed', error: message });
    t.settle?.reject(new MlUnavailableError(task, message));
    t.settle = undefined;
    for (const [id, p] of pending) {
      if (p.task !== task) continue;
      pending.delete(id);
      if (p.timer) clearTimeout(p.timer);
      p.reject(new MlUnavailableError(task, message));
    }
  };

  const onMessage = (ev: MessageEvent<FromMl>) => {
    const msg = ev.data;
    if (msg.kind === 'progress') {
      const t = tasks[msg.task];
      setStatus(msg.task, { ...t.status, state: 'loading', progress: msg.total > 0 ? msg.loaded / msg.total : undefined });
    } else if (msg.kind === 'ready') {
      const t = tasks[msg.task];
      t.device = msg.device;
      setStatus(msg.task, { state: 'ready', device: msg.device, loadMs: msg.loadMs });
      t.settle?.resolve();
      t.settle = undefined;
    } else if (msg.kind === 'init-error') {
      void onInitError(msg.task, msg.code, msg.message);
    } else if (msg.kind === 'result' || msg.kind === 'run-error') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.kind === 'result') p.resolve(msg.output);
      else p.reject(new Error(msg.message));
    }
  };

  const onCrash = () => {
    const at = now();
    const second = lastCrash > 0 && at - lastCrash < 60_000;
    lastCrash = at;
    worker?.terminate();
    worker = null;
    if (second) {
      dead = true;
      for (const task of Object.keys(tasks) as MlTask[]) if (tasks[task].status.state !== 'idle') fail(task, 'The on-device model stopped working. Reload the page to try again.');
      return;
    }
    const w = ensureWorker();
    for (const task of Object.keys(tasks) as MlTask[]) {
      const t = tasks[task];
      if (t.status.state === 'ready' || t.status.state === 'loading') {
        if (t.status.state === 'ready') {
          t.ready = new Promise<void>((resolve, reject) => (t.settle = { resolve, reject }));
          t.ready.catch(() => undefined);
        }
        setStatus(task, { state: 'loading' });
        w.postMessage({ kind: 'init', task, device: t.device ?? 'wasm' });
      }
    }
    for (const [id, p] of pending) w.postMessage({ kind: 'run', id, task: p.task, priority: p.priority, input: p.input });
  };

  const ensureWorker = (): WorkerLike => {
    if (worker) return worker;
    worker = makeWorker();
    worker.onmessage = onMessage;
    worker.onerror = () => onCrash();
    return worker;
  };

  const onInitError = async (task: MlTask, _code: MlInitErrorCode, message: string) => {
    const t = tasks[task];
    if (t.device === 'webgpu') {
      t.device = 'wasm';
      ensureWorker().postMessage({ kind: 'init', task, device: 'wasm' });
      return;
    }
    if (!t.wasmRetried && _code !== 'no-task') {
      t.wasmRetried = true;
      await clearModelCache(task);
      ensureWorker().postMessage({ kind: 'init', task, device: 'wasm' });
      return;
    }
    fail(task, message);
  };

  const warmup = (task: MlTask): Promise<void> => {
    const t = tasks[task];
    if (dead) return Promise.reject(new MlUnavailableError(task, 'The on-device model stopped working.'));
    if (t.status.state === 'ready') return Promise.resolve();
    if (t.status.state === 'failed') return Promise.reject(new MlUnavailableError(task, t.status.error ?? 'failed'));
    if (t.ready) return t.ready;
    t.ready = new Promise<void>((resolve, reject) => {
      t.settle = { resolve, reject };
    });
    t.ready.catch(() => undefined);
    setStatus(task, { state: 'loading', progress: 0 });
    void (async () => {
      try {
        t.device = await preferredDevice();
        ensureWorker().postMessage({ kind: 'init', task, device: t.device });
      } catch {
        // The worker could not be created (no Worker support, or blocked): fail the task instead of hanging warmup.
        worker = null;
        fail(task, 'The on-device model could not start in this browser.');
      }
    })();
    return t.ready;
  };

  return {
    warmup,
    async run<I, O>(task: MlTask, input: I, o?: { priority?: MlPriority; signal?: AbortSignal; timeoutMs?: number }): Promise<O> {
      const priority = o?.priority ?? 'background';
      if (o?.signal?.aborted) throw abortError();
      await warmup(task);
      if (o?.signal?.aborted) throw abortError();
      const id = nextId++;
      const timeoutMs = o?.timeoutMs ?? (priority === 'foreground' ? 10_000 : 30_000);
      return new Promise<O>((resolve, reject) => {
        const p: Pending = { task, priority, input, resolve: resolve as (v: unknown) => void, reject };
        const cancel = (err: unknown) => {
          if (!pending.has(id)) return;
          pending.delete(id);
          if (p.timer) clearTimeout(p.timer);
          worker?.postMessage({ kind: 'cancel', id });
          reject(err);
        };
        p.timer = setTimeout(() => cancel(new DOMException('The on-device model took too long.', 'TimeoutError')), timeoutMs);
        o?.signal?.addEventListener('abort', () => cancel(abortError()), { once: true });
        pending.set(id, p);
        ensureWorker().postMessage({ kind: 'run', id, task, priority, input });
      });
    },
    status(task) {
      return tasks[task].status;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

let client: MlClient | null = null;

/** One worker per page (A-ML-4: the embed and PII tasks share it). */
export function getMl(): MlClient {
  client ??= createWorkerMlClient(
    () => new Worker(new URL('./ml.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  );
  return client;
}

/** Replace the client (tests use a deterministic embedder; /dev/seed may inject one). null restores the default. */
export function setMlClient(c: MlClient | null): void {
  client = c;
}
