// 20 section 6 without a browser: the worker host's queue (A-ML-2), the client's fallbacks and recovery, one worker
// for both tasks (A-ML-4), and the embedder's load probe. A-ML-1 and A-ML-3 need Chrome (WASM and WebGPU).
import { describe, expect, it, vi } from 'vitest';
import { createWorkerMlClient, MlUnavailableError, type WorkerLike } from './client';
import { checkProbe } from './embed.task';
import { createMlHost, type AnyHandler } from './host';
import { MlInitError, type FromMl, type ToMl } from './protocol';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('the worker host (A-ML-2)', () => {
  it('runs one job at a time; a foreground job queued behind background batches runs next', async () => {
    const order: string[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    const handler: AnyHandler = {
      async init() {},
      async run(input) {
        const g = deferred();
        gates.push(g);
        order.push(String((input as { tag: string }).tag));
        await g.promise;
        return { output: input };
      },
    };
    const out: FromMl[] = [];
    const host = createMlHost({ embed: handler }, (m) => out.push(m), { hasWebGpu: async () => false });
    host.handle({ kind: 'init', task: 'embed', device: 'wasm' });
    await vi.waitFor(() => expect(out.some((m) => m.kind === 'ready')).toBe(true));
    for (let i = 0; i < 5; i++) host.handle({ kind: 'run', id: i + 1, task: 'embed', priority: 'background', input: { tag: `bg${i}` } });
    await vi.waitFor(() => expect(order).toEqual(['bg0']));
    host.handle({ kind: 'run', id: 99, task: 'embed', priority: 'foreground', input: { tag: 'fg' } });
    host.handle({ kind: 'cancel', id: 5 });
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(i));
      gates[i]?.resolve();
    }
    await host.idle();
    expect(order).toEqual(['bg0', 'fg', 'bg1', 'bg2', 'bg3']);
    expect(out.filter((m) => m.kind === 'result').map((m) => (m as { id: number }).id)).toEqual([1, 99, 2, 3, 4]);
  });

  it('reports no-webgpu, missing tasks and probe failures as init errors', async () => {
    const out: FromMl[] = [];
    const host = createMlHost({ embed: { init: async () => { throw new MlInitError('probe-failed', 'bad'); }, run: async () => ({ output: null }) } }, (m) => out.push(m), { hasWebGpu: async () => false });
    host.handle({ kind: 'init', task: 'embed', device: 'webgpu' });
    host.handle({ kind: 'init', task: 'pii', device: 'wasm' });
    host.handle({ kind: 'init', task: 'embed', device: 'wasm' });
    await vi.waitFor(() => expect(out.filter((m) => m.kind === 'init-error')).toHaveLength(3));
    expect(out.map((m) => (m.kind === 'init-error' ? m.code : m.kind))).toEqual(expect.arrayContaining(['no-webgpu', 'no-task', 'probe-failed']));
  });
});

class FakeWorker implements WorkerLike {
  sent: ToMl[] = [];
  onmessage: ((ev: MessageEvent<FromMl>) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  terminated = false;
  constructor(private readonly script: (w: FakeWorker, msg: ToMl) => void) {}
  postMessage(msg: ToMl): void {
    this.sent.push(msg);
    queueMicrotask(() => this.script(this, msg));
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(msg: FromMl): void {
    this.onmessage?.({ data: msg } as MessageEvent<FromMl>);
  }
}

describe('the client', () => {
  it('A-ML-4: one worker serves both tasks', async () => {
    const workers: FakeWorker[] = [];
    const client = createWorkerMlClient(() => {
      const w = new FakeWorker((self, msg) => {
        if (msg.kind === 'init') self.reply({ kind: 'ready', task: msg.task, device: msg.device, loadMs: 1 });
        if (msg.kind === 'run') self.reply({ kind: 'result', id: msg.id, task: msg.task, output: msg.task, ms: 1 });
      });
      workers.push(w);
      return w;
    });
    expect(await client.run('embed', { texts: ['a'] })).toBe('embed');
    expect(await client.run('pii', { text: 'b' }, { priority: 'foreground' })).toBe('pii');
    expect(workers).toHaveLength(1);
    expect(client.status('embed')).toMatchObject({ state: 'ready', device: 'wasm' });
  });

  it('falls back from WebGPU to WASM, then retries WASM once, then fails', async () => {
    const nav = navigator as unknown as { gpu?: unknown };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({}) } });
    const inits: string[] = [];
    const client = createWorkerMlClient(() => new FakeWorker((self, msg) => {
      if (msg.kind !== 'init') return;
      inits.push(msg.device);
      self.reply({ kind: 'init-error', task: msg.task, code: 'load-failed', message: 'nope' });
    }));
    await expect(client.warmup('embed')).rejects.toBeInstanceOf(MlUnavailableError);
    expect(inits).toEqual(['webgpu', 'wasm', 'wasm']);
    expect(client.status('embed').state).toBe('failed');
    await expect(client.run('embed', { texts: [] })).rejects.toBeInstanceOf(MlUnavailableError);
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: nav.gpu });
  });

  it('restarts a crashed worker and re-sends queued jobs; a second crash within 60 s fails', async () => {
    let now = 1_000;
    const workers: FakeWorker[] = [];
    let crashes = 1;
    const client = createWorkerMlClient(() => {
      const w = new FakeWorker((self, msg) => {
        if (msg.kind === 'init') self.reply({ kind: 'ready', task: msg.task, device: 'wasm', loadMs: 1 });
        if (msg.kind === 'run') {
          if (crashes > 0) {
            crashes--;
            self.onerror?.(new Event('error'));
          } else self.reply({ kind: 'result', id: msg.id, task: msg.task, output: 'ok', ms: 1 });
        }
      });
      workers.push(w);
      return w;
    }, { now: () => now });
    await client.warmup('embed');
    expect(await client.run('embed', { texts: ['x'] })).toBe('ok');
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    crashes = 1;
    now += 10_000;
    await expect(client.run('embed', { texts: ['y'] })).rejects.toBeInstanceOf(MlUnavailableError);
    expect(client.status('embed').state).toBe('failed');
  });

  it('times out and aborts with a cancel message', async () => {
    vi.useFakeTimers();
    const w = new FakeWorker((self, msg) => {
      if (msg.kind === 'init') self.reply({ kind: 'ready', task: msg.task, device: 'wasm', loadMs: 1 });
    });
    const client = createWorkerMlClient(() => w);
    await client.warmup('embed');
    const p = client.run('embed', { texts: [] }, { priority: 'foreground' });
    const assertion = expect(p).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
    expect(w.sent.some((m) => m.kind === 'cancel')).toBe(true);
    const ac = new AbortController();
    const q = client.run('embed', { texts: [] }, { signal: ac.signal });
    await vi.advanceTimersByTimeAsync(1);
    ac.abort();
    await expect(q).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();
  });
});

describe('the embedder probe (20 section 6.4)', () => {
  const vec = (...xs: number[]) => {
    const v = new Float32Array(384);
    xs.forEach((x, i) => (v[i] = x));
    return v;
  };
  it('passes normalized vectors where the deposit sentences are closer than the flight', () => {
    const data = new Float32Array(3 * 384);
    data.set(vec(1, 0), 0);
    data.set(vec(0.8, 0.6), 384);
    data.set(vec(0, 1), 768);
    expect(() => checkProbe({ dims: 384, count: 3, data })).not.toThrow();
  });
  it('fails garbage: wrong dims, not normalized, or no similarity order', () => {
    expect(() => checkProbe({ dims: 256, count: 3, data: new Float32Array(768) })).toThrow(MlInitError);
    const flat = new Float32Array(3 * 384);
    flat.set(vec(2, 0), 0);
    expect(() => checkProbe({ dims: 384, count: 3, data: flat })).toThrow(/normalized/);
    const same = new Float32Array(3 * 384);
    for (let i = 0; i < 3; i++) same.set(vec(1, 0), i * 384);
    expect(() => checkProbe({ dims: 384, count: 3, data: same })).toThrow(/probe/);
  });
});
