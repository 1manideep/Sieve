// The reranker's page side (rerank.ts) with a fake ML client: score order, the passage cap, the model's states, the
// time budget, abort, and the session's memory of a slow device or a failing model. The model itself runs in
// Chrome only (ml/rerank.task.ts; its pure parts are tested in ml/rerank.task.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMlClient, type MlClient, type MlTaskStatus } from '../ml/client';
import type { MlDevice, MlTask, RerankInput, RerankOutput } from '../ml/protocol';
import { RERANK_BUDGET_MS, RERANK_MAX_PASSAGES, RERANK_MIN_PASSAGES, rerank, resetRerank, warmupRerank, type RerankPassage } from './rerank';

type RunOpts = { priority?: string; signal?: AbortSignal; timeoutMs?: number };

interface FakeMl extends MlClient {
  runs: { input: RerankInput; opts: RunOpts }[];
  warmups: number;
  state: MlTaskStatus['state'];
}

/** A client whose rerank task answers with `answer` (scores for what it was sent, unless the test says otherwise). */
function fakeMl(o: { state?: MlTaskStatus['state']; device?: MlDevice; answer?: (input: RerankInput, opts: RunOpts) => Promise<RerankOutput> } = {}): FakeMl {
  const answer = o.answer ?? (async (input: RerankInput) => ({ scores: input.passages.map((t) => Number(/score=(-?[\d.]+)/.exec(t)?.[1] ?? 0)), computeMs: 5, msPerPassage: 1 }));
  const ml: FakeMl = {
    runs: [],
    warmups: 0,
    state: o.state ?? 'ready',
    async warmup(task: MlTask) {
      if (task !== 'rerank') return;
      ml.warmups++;
      ml.state = 'loading';
    },
    async run<I, O>(task: MlTask, input: I, opts?: RunOpts): Promise<O> {
      if (task !== 'rerank') throw new Error('not a rerank');
      ml.runs.push({ input: input as unknown as RerankInput, opts: opts ?? {} });
      return (await answer(input as unknown as RerankInput, opts ?? {})) as unknown as O;
    },
    status(task: MlTask) {
      return task === 'rerank' ? { state: ml.state, device: o.device ?? 'webgpu' } : { state: 'idle' };
    },
    subscribe: () => () => undefined,
  };
  return ml;
}

const passages = (...scores: number[]): RerankPassage[] => scores.map((s, i) => ({ id: `p${i}`, text: `passage ${i} score=${s}` }));
const never = () => new Promise<RerankOutput>(() => undefined);

beforeEach(() => resetRerank());
afterEach(() => {
  setMlClient(null);
  vi.unstubAllGlobals();
});

describe('rerank', () => {
  it('puts the passages in score order, as one foreground job with a deadline', async () => {
    const ml = fakeMl();
    setMlClient(ml);
    const res = await rerank('the question', passages(0.1, 3, -2, 1));
    expect(res).toMatchObject({ ran: true, order: ['p1', 'p3', 'p0', 'p2'] });
    expect(res.reason).toBeUndefined();
    expect(ml.runs).toHaveLength(1);
    expect(ml.runs[0]?.opts.priority).toBe('foreground');
    expect(ml.runs[0]?.input.query).toBe('the question');
    expect(ml.runs[0]?.input.deadline).toBeGreaterThan(Date.now());
    expect(ml.runs[0]?.input.deadline).toBeLessThanOrEqual(Date.now() + RERANK_BUDGET_MS);
  });

  it('ties keep the order they came in', async () => {
    setMlClient(fakeMl());
    expect((await rerank('q', passages(1, 2, 1, 2))).order).toEqual(['p1', 'p3', 'p0', 'p2']);
  });

  it('sends fewer passages than the cap as they are, and only the cap of a longer list', async () => {
    const ml = fakeMl();
    setMlClient(ml);
    expect((await rerank('q', passages(1, 3, 2))).order).toEqual(['p1', 'p2', 'p0']);
    expect(ml.runs[0]?.input.passages).toHaveLength(3);
    const many = passages(...Array.from({ length: 25 }, (_, i) => i));
    const res = await rerank('q', many);
    expect(ml.runs[1]?.input.passages).toHaveLength(RERANK_MAX_PASSAGES);
    expect(res.order.slice(0, RERANK_MAX_PASSAGES)).toEqual(many.slice(0, RERANK_MAX_PASSAGES).map((p) => p.id).reverse());
    expect(res.order.slice(RERANK_MAX_PASSAGES)).toEqual(['p20', 'p21', 'p22', 'p23', 'p24']);
  });

  it('on one WASM thread sends only what fits the budget, and the rest keep their place', async () => {
    const ml = fakeMl({ device: 'wasm' });
    setMlClient(ml);
    const many = passages(...Array.from({ length: 20 }, (_, i) => i));
    const res = await rerank('q', many);
    const sent = ml.runs[0]?.input.passages.length ?? 0;
    expect(sent).toBeGreaterThanOrEqual(RERANK_MIN_PASSAGES);
    expect(sent).toBeLessThan(20);
    expect(res.ran).toBe(true);
    expect(res.order.slice(sent)).toEqual(many.slice(sent).map((p) => p.id));
  });

  it('has nothing to do with fewer than two passages', async () => {
    const ml = fakeMl();
    setMlClient(ml);
    expect(await rerank('q', passages(1))).toMatchObject({ ran: false, order: ['p0'] });
    expect(ml.runs).toHaveLength(0);
  });

  it('returns model-loading at once while the model loads, and starts the load once', async () => {
    const ml = fakeMl({ state: 'idle' });
    setMlClient(ml);
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-loading', order: ['p0', 'p1'] });
    expect(ml.warmups).toBe(1);
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-loading' });
    expect(ml.warmups).toBe(1);
    expect(ml.runs).toHaveLength(0);
    ml.state = 'ready';
    expect((await rerank('q', passages(1, 2))).ran).toBe(true);
  });

  it('a failed model gives model-failed and is not loaded again', async () => {
    const ml = fakeMl({ state: 'failed' });
    setMlClient(ml);
    for (let i = 0; i < 3; i++) expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-failed', order: ['p0', 'p1'] });
    expect(ml.warmups).toBe(0);
    expect(ml.runs).toHaveLength(0);
  });

  it('a client that does not know the task: unsupported', async () => {
    const ml = fakeMl();
    ml.status = (() => undefined) as unknown as MlClient['status'];
    setMlClient(ml);
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'unsupported' });
  });

  it('resolves near its budget with timeout when the model is slow, and never throws', async () => {
    setMlClient(fakeMl({ answer: never }));
    const t0 = performance.now();
    const res = await rerank('q', passages(1, 2, 3), { budgetMs: 80 });
    const took = performance.now() - t0;
    expect(res).toMatchObject({ ran: false, reason: 'timeout', order: ['p0', 'p1', 'p2'] });
    expect(took).toBeGreaterThanOrEqual(70);
    expect(took).toBeLessThan(400);
  });

  it('keeps the given order when the worker ran out of time before enough passages', async () => {
    setMlClient(fakeMl({ answer: async () => ({ scores: [1, 2, 3].slice(0, RERANK_MIN_PASSAGES - 1), computeMs: 10, msPerPassage: 5 }) }));
    expect(await rerank('q', passages(1, 2, 3, 4, 5, 6))).toMatchObject({ ran: false, reason: 'timeout', order: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] });
  });

  it('reorders the passages the worker reached in time and keeps the rest after them', async () => {
    setMlClient(fakeMl({ answer: async () => ({ scores: [1, 5, 2, 4, 3], computeMs: 10, msPerPassage: 2 }) }));
    expect(await rerank('q', passages(0, 0, 0, 0, 0, 0, 0))).toMatchObject({ ran: true, order: ['p1', 'p3', 'p4', 'p2', 'p0', 'p5', 'p6'] });
  });

  it('an aborted signal resolves without running, and an abort during a run resolves at once', async () => {
    const ml = fakeMl({ answer: never });
    setMlClient(ml);
    const done = new AbortController();
    done.abort();
    const before = await rerank('q', passages(1, 2), { signal: done.signal });
    expect(before).toMatchObject({ ran: false, order: ['p0', 'p1'] });
    expect(before.reason).toBeUndefined();
    expect(ml.runs).toHaveLength(0);
    const ac = new AbortController();
    const pending = rerank('q', passages(1, 2), { signal: ac.signal });
    await vi.waitFor(() => expect(ml.runs).toHaveLength(1));
    expect(ml.runs[0]?.opts.signal).toBe(ac.signal);
    const t0 = performance.now();
    ac.abort();
    const res = await pending;
    expect(res).toMatchObject({ ran: false, order: ['p0', 'p1'] });
    expect(res.reason).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('a device too slow on its first measured run stops trying for the session', async () => {
    // 400 ms a passage: four passages would take 1.6 s, more than the 1.5 s budget
    const ml = fakeMl({ device: 'wasm', answer: async (input) => ({ scores: input.passages.slice(0, 4).map((_, i) => i), computeMs: 1600, msPerPassage: 400 }) });
    setMlClient(ml);
    expect((await rerank('q', passages(1, 2, 3, 4, 5, 6))).ran).toBe(true);
    for (let i = 0; i < 2; i++) expect(await rerank('q', passages(1, 2, 3))).toMatchObject({ ran: false, reason: 'unsupported', ms: 0 });
    expect(ml.runs).toHaveLength(1);
    resetRerank();
    expect((await rerank('q', passages(1, 2, 3))).ran).toBe(true);
  });

  it('a result that comes after the budget still measures the device', async () => {
    let finish!: (o: RerankOutput) => void;
    const ml = fakeMl({ device: 'wasm', answer: () => new Promise((r) => (finish = r)) });
    setMlClient(ml);
    expect(await rerank('q', passages(1, 2, 3), { budgetMs: 120 })).toMatchObject({ ran: false, reason: 'timeout' });
    expect(ml.runs).toHaveLength(1);
    finish({ scores: [1], computeMs: 500, msPerPassage: 500 });
    await new Promise((r) => setTimeout(r, 0));
    expect(await rerank('q', passages(1, 2, 3))).toMatchObject({ ran: false, reason: 'unsupported' });
    expect(ml.runs).toHaveLength(1);
  });

  it('a fast first run keeps the session reranking', async () => {
    const ml = fakeMl({ device: 'wasm', answer: async (input) => ({ scores: input.passages.map((_, i) => -i), computeMs: 400, msPerPassage: 100 }) });
    setMlClient(ml);
    for (let i = 0; i < 3; i++) expect((await rerank('q', passages(1, 2, 3))).ran).toBe(true);
    expect(ml.runs).toHaveLength(3);
  });

  it('a run that fails gives model-failed; after two the session stops asking; late runs do not count', async () => {
    let mode: 'error' | 'timeout' | 'garbage' = 'timeout';
    const ml = fakeMl({
      answer: async () => {
        if (mode === 'timeout') throw new DOMException('slow', 'TimeoutError');
        if (mode === 'garbage') return { scores: [Number.NaN, 1], computeMs: 1, msPerPassage: 1 };
        throw new Error('ORT error');
      },
    });
    setMlClient(ml);
    for (let i = 0; i < 3; i++) expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-failed' });
    mode = 'garbage';
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-failed' });
    mode = 'error';
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-failed' });
    const runs = ml.runs.length;
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-failed' });
    expect(ml.runs).toHaveLength(runs);
  });

  it('never throws, even when the client does', async () => {
    const ml = fakeMl();
    ml.status = () => {
      throw new Error('broken client');
    };
    setMlClient(ml);
    expect(await rerank('q', passages(1, 2))).toMatchObject({ ran: false, reason: 'model-failed', order: ['p0', 'p1'] });
  });

  it('runs one rerank at a time: the next job starts when the previous one ends', async () => {
    const gates: ((o: RerankOutput) => void)[] = [];
    const ml = fakeMl({ answer: () => new Promise((r) => gates.push(r)) });
    setMlClient(ml);
    const a = rerank('first', passages(1, 2));
    const b = rerank('second', passages(2, 1));
    await vi.waitFor(() => expect(ml.runs).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(ml.runs).toHaveLength(1);
    gates[0]?.({ scores: [1, 2], computeMs: 1, msPerPassage: 1 });
    await vi.waitFor(() => expect(ml.runs).toHaveLength(2));
    expect(ml.runs[1]?.input.query).toBe('second');
    gates[1]?.({ scores: [2, 1], computeMs: 1, msPerPassage: 1 });
    expect((await a).order).toEqual(['p1', 'p0']);
    expect((await b).order).toEqual(['p0', 'p1']);
  });
});

describe('warmupRerank', () => {
  it('starts the load once, without waiting for it', () => {
    vi.stubGlobal('Worker', class {});
    const ml = fakeMl({ state: 'idle' });
    setMlClient(ml);
    warmupRerank();
    warmupRerank();
    expect(ml.warmups).toBe(1);
  });

  it('waits for a hidden page to be shown', () => {
    vi.stubGlobal('Worker', class {});
    const ml = fakeMl({ state: 'idle' });
    setMlClient(ml);
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    try {
      warmupRerank();
      warmupRerank();
      expect(ml.warmups).toBe(0);
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      expect(ml.warmups).toBe(1);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it('does nothing without Web Workers, or once the session stopped trying', async () => {
    const ml = fakeMl({ state: 'idle' });
    setMlClient(ml);
    warmupRerank();
    expect(ml.warmups).toBe(0);
    vi.stubGlobal('Worker', class {});
    ml.state = 'ready';
    ml.run = (async () => ({ scores: [0, 1, 2, 3, 4], computeMs: 5000, msPerPassage: 1000 })) as MlClient['run'];
    await rerank('q', passages(1, 2, 3, 4, 5));
    ml.state = 'idle';
    warmupRerank();
    expect(ml.warmups).toBe(0);
  });
});
