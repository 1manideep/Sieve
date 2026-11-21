// The worker side of the ML protocol (20 section 6.2), kept free of `self` so it can be tested without a Worker.
// Two FIFO lists (foreground, background); one job at a time across tasks; foreground first after each job. With
// foregroundHoldMs, background jobs also wait that long after a foreground job, for the same question's next one.
import type { FromMl, MlDevice, MlInitErrorCode, MlTask, MlTaskHandler, ToMl } from './protocol';
import { MlInitError } from './protocol';

interface Job { id: number; task: MlTask; input: unknown }

export type AnyHandler = MlTaskHandler<unknown, unknown>;

export interface MlHost {
  handle(msg: ToMl): void;
  /** Resolves when no job is running or queued (tests). */
  idle(): Promise<void>;
}

export function createMlHost(
  handlers: Partial<Record<MlTask, AnyHandler | (() => Promise<AnyHandler | undefined>)>>,
  post: (msg: FromMl, transfer?: Transferable[]) => void,
  opts: { hasWebGpu: () => Promise<boolean>; now?: () => number; foregroundHoldMs?: number },
): MlHost {
  const now = opts.now ?? (() => performance.now());
  const holdMs = opts.foregroundHoldMs ?? 0;
  const fg: Job[] = [];
  const bg: Job[] = [];
  const loaded = new Map<MlTask, AnyHandler>();
  const readyTasks = new Set<MlTask>();
  let running = false;
  let idleWaiters: (() => void)[] = [];
  let holdUntil = 0;
  let wake: (() => void) | null = null;

  /** Resolves when a foreground job arrives or the hold ends, whichever is first. */
  const waitForHold = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, Math.max(0, holdUntil - now()));
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });

  const resolveHandler = async (task: MlTask): Promise<AnyHandler | undefined> => {
    const cached = loaded.get(task);
    if (cached) return cached;
    const h = handlers[task];
    if (!h) return undefined;
    const handler = typeof h === 'function' ? await h() : h;
    if (handler) loaded.set(task, handler);
    return handler;
  };

  const init = async (task: MlTask, device: MlDevice) => {
    const t0 = now();
    try {
      if (device === 'webgpu' && !(await opts.hasWebGpu())) {
        post({ kind: 'init-error', task, code: 'no-webgpu', message: 'WebGPU is not available' });
        return;
      }
      const handler = await resolveHandler(task);
      if (!handler) {
        post({ kind: 'init-error', task, code: 'no-task', message: `No ${task} task in this build` });
        return;
      }
      let last = 0;
      await handler.init(device, (l, t) => {
        const at = now();
        if (at - last < 200 && l < t) return;
        last = at;
        post({ kind: 'progress', task, loaded: l, total: t });
      });
      readyTasks.add(task);
      post({ kind: 'ready', task, device, loadMs: Math.round(now() - t0) });
    } catch (e) {
      // 11's PII task throws its own error class with the same codes (no-webgpu, load-failed, probe-failed)
      const raw = e instanceof MlInitError ? e.code : (e as { code?: unknown })?.code;
      const code: MlInitErrorCode = raw === 'no-webgpu' || raw === 'probe-failed' || raw === 'load-failed' ? raw : 'load-failed';
      post({ kind: 'init-error', task, code, message: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  };

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (fg.length === 0 && bg.length > 0 && now() < holdUntil) {
          await waitForHold();
          continue;
        }
        const foreground = fg.length > 0;
        const job = fg.shift() ?? bg.shift();
        if (!job) break;
        const t0 = now();
        try {
          const handler = loaded.get(job.task);
          if (!handler || !readyTasks.has(job.task)) throw new Error(`${job.task} is not ready`);
          const { output, transfer } = await handler.run(job.input);
          post({ kind: 'result', id: job.id, task: job.task, output, ms: Math.round(now() - t0) }, transfer);
        } catch (e) {
          post({ kind: 'run-error', id: job.id, task: job.task, message: String((e as Error)?.message ?? e).slice(0, 200) });
        }
        if (foreground && holdMs > 0) holdUntil = now() + holdMs;
      }
    } finally {
      running = false;
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const w of waiters) w();
    }
  };

  return {
    handle(msg: ToMl) {
      if (msg.kind === 'init') {
        void init(msg.task, msg.device);
      } else if (msg.kind === 'run') {
        (msg.priority === 'foreground' ? fg : bg).push({ id: msg.id, task: msg.task, input: msg.input });
        if (msg.priority === 'foreground') wake?.();
        queueMicrotask(() => void pump());
      } else if (msg.kind === 'cancel') {
        for (const list of [fg, bg]) {
          const i = list.findIndex((j) => j.id === msg.id);
          if (i >= 0) list.splice(i, 1);
        }
      }
    },
    idle() {
      if (!running && fg.length === 0 && bg.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
