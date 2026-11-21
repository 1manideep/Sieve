// The reranker (docs/research/local-vector-search.md): a small cross-encoder reads the question against each of the
// top passages and puts them in order. The model runs in the shared ML worker as the 'rerank' task
// (ml/rerank.task.ts), as a question's foreground job and never in the indexing queue. This side keeps the time
// budget: it never throws, never waits for the model to load, and resolves within about budgetMs whatever the worker
// does. When it did not run, the search keeps its own order.
import { getMl, type MlClient } from '../ml/client';
import { RERANK_DEFAULT_MS_PER_PASSAGE, type MlDevice, type RerankInput, type RerankOutput } from '../ml/protocol';

export interface RerankPassage { id: string; text: string }

export interface RerankResult {
  /** Passage ids, best first. When `ran` is false this is the order the passages came in. */
  order: string[];
  ran: boolean;
  ms: number;
  /**
   * Why it did not run. Absent when there was nothing to do: fewer than two passages, or the caller's signal aborted.
   * 'unsupported': this browser cannot run it, or this session stopped trying because the device is too slow.
   */
  reason?: 'model-loading' | 'model-failed' | 'timeout' | 'unsupported';
}

/**
 * At most this many passages are reranked; the rest keep their place after them. WebGPU scores 20 in about 200 ms;
 * on one WASM thread the count is cut to what fits the budget, about 12 on an M2 (Nov 21, 2026).
 */
export const RERANK_MAX_PASSAGES = 20;
/**
 * A rerank that takes longer than this is dropped, and the search keeps its own order. Measured Nov 21, 2026 on an
 * M2 in Chrome: 20 passages take 200 ms on WebGPU and 12 take 1.4 s on one WASM thread.
 */
export const RERANK_BUDGET_MS = 1500;
/**
 * Fewer than this is not worth a rerank; it is also the WASM batch (ml/rerank.task.ts). A device whose first
 * measured run says it cannot score this many within RERANK_BUDGET_MS (more than 350 ms a passage, about 3 times
 * slower than an M2 on one WASM thread) stops trying for the session.
 */
export const RERANK_MIN_PASSAGES = 4;
/** Runs that fail (not the ones that are only late) before the session stops asking the model. */
const MAX_RUN_FAILURES = 2;

/** Messages, tokenizing and sorting around the model's own time (10 to 20 ms on WebGPU, Nov 21, 2026), with room. */
const OVERHEAD_MS = 100;
/** The worker stops this long before the budget ends, so its partial scores still arrive in time. */
const RETURN_MARGIN_MS = 60;

interface Session {
  /** Measured cost of one passage in the worker, per device. */
  msPerPassage: Partial<Record<MlDevice, number>>;
  /** Set once: the first measured run was too slow, or runs kept failing. */
  stopped?: 'too-slow' | 'failed';
  failures: number;
  /** The previous rerank's worker job; the next one waits for it (one rerank at a time). */
  last: Promise<unknown>;
}

let session: Session = { msPerPassage: {}, failures: 0, last: Promise.resolve() };

/** Forgets the session's measurements and give-ups (tests; a fresh ML worker). */
export function resetRerank(): void {
  session = { msPerPassage: {}, failures: 0, last: Promise.resolve() };
}

function failedRun(): void {
  session.failures++;
  if (session.failures >= MAX_RUN_FAILURES) session.stopped = 'failed';
}

function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function validScores(out: unknown, n: number): number[] | null {
  const scores = (out as Partial<RerankOutput> | null)?.scores;
  if (!Array.isArray(scores) || scores.length > n || !scores.every((s) => typeof s === 'number' && Number.isFinite(s))) return null;
  return scores;
}

/** A device that cannot score RERANK_MIN_PASSAGES within the default budget is too slow for this session. */
function learn(device: MlDevice, out: unknown, firstMeasured: boolean): void {
  const o = out as Partial<RerankOutput> | null;
  if (!o || !Array.isArray(o.scores) || o.scores.length === 0) return;
  const per = typeof o.msPerPassage === 'number' && o.msPerPassage > 0 ? o.msPerPassage : (o.computeMs ?? 0) / o.scores.length;
  if (!(per > 0) || !Number.isFinite(per)) return;
  session.msPerPassage[device] = per;
  if (firstMeasured && RERANK_MIN_PASSAGES * per + OVERHEAD_MS > RERANK_BUDGET_MS) session.stopped = 'too-slow';
}

function startLoad(ml: MlClient): void {
  try {
    ml.warmup('rerank').catch(() => undefined);
  } catch {
    // a client without the task: the next call reads its status again
  }
}

/** Score order of the first scores.length passages; ties keep the given order; the rest stay after them. */
function orderBy(passages: RerankPassage[], scores: number[]): string[] {
  const head = scores.map((s, i) => ({ id: (passages[i] as RerankPassage).id, s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  return [...head.map((x) => x.id), ...passages.slice(scores.length).map((p) => p.id)];
}

export async function rerank(question: string, passages: RerankPassage[], opts: { budgetMs?: number; signal?: AbortSignal } = {}): Promise<RerankResult> {
  const t0 = clock();
  const given = passages.map((p) => p.id);
  const result = (ran: boolean, reason?: RerankResult['reason'], order = given): RerankResult => ({ order, ran, ms: Math.round(clock() - t0), ...(reason ? { reason } : {}) });
  try {
    if (passages.length < 2 || opts.signal?.aborted) return result(false);
    if (session.stopped === 'too-slow') return result(false, 'unsupported');
    if (session.stopped === 'failed') return result(false, 'model-failed');
    const ml = getMl();
    const status = ml.status('rerank') as ReturnType<MlClient['status']> | undefined;
    if (!status) return result(false, 'unsupported');   // a client that does not know the task
    if (status.state === 'failed') return result(false, 'model-failed');
    if (status.state !== 'ready') {
      if (status.state === 'idle') startLoad(ml);
      return result(false, 'model-loading');
    }
    const device: MlDevice = status.device ?? 'wasm';
    const budget = Math.max(0, opts.budgetMs ?? RERANK_BUDGET_MS);
    const known = session.msPerPassage[device];
    const per = known ?? RERANK_DEFAULT_MS_PER_PASSAGE[device];
    const fits = Math.floor((budget - OVERHEAD_MS) / per);
    const n = Math.min(passages.length, RERANK_MAX_PASSAGES, Math.max(RERANK_MIN_PASSAGES, fits));
    const head = passages.slice(0, n);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const ended = new Promise<'timeout' | 'aborted'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, budget - (clock() - t0)));
      onAbort = () => resolve('aborted');
      opts.signal?.addEventListener('abort', onAbort, { once: true });
    });
    // One rerank at a time: the previous job ends at its own deadline, so this wait is short and inside the budget.
    const deadline = Date.now() + budget - (clock() - t0) - RETURN_MARGIN_MS;
    const job = session.last.then(async () => {
      if (Date.now() >= deadline || opts.signal?.aborted) return null;
      const input: RerankInput = { query: question, passages: head.map((p) => p.text), deadline };
      // the signal takes a job that is still queued out of the worker's list; a running one stops at its deadline
      return ml.run<RerankInput, RerankOutput>('rerank', input, { priority: 'foreground', signal: opts.signal, timeoutMs: budget + 10_000 });
    });
    session.last = job.catch(() => undefined);
    // A result that arrives after the budget still measures the device. Late and stopped runs are not failures.
    const firstMeasured = known === undefined;
    const settled = job.then(
      (out) => {
        if (out) learn(device, out, firstMeasured);
        return { out };
      },
      (e: unknown) => {
        const name = (e as { name?: string } | null)?.name;
        if (name !== 'TimeoutError' && name !== 'AbortError') failedRun();
        return { failed: true as const };
      },
    );
    const first = await Promise.race([settled, ended]);
    clearTimeout(timer);
    if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    if (first === 'aborted' || opts.signal?.aborted) return result(false);
    if (first === 'timeout') return result(false, 'timeout');
    if ('failed' in first) return result(false, 'model-failed');
    if (!first.out) return result(false, 'timeout');
    const scores = validScores(first.out, head.length);
    if (!scores) {
      failedRun();
      return result(false, 'model-failed');
    }
    if (scores.length < Math.min(RERANK_MIN_PASSAGES, head.length)) return result(false, 'timeout');
    return result(true, undefined, [...orderBy(head, scores), ...passages.slice(n).map((p) => p.id)]);
  } catch {
    return result(false, 'model-failed');
  }
}

let warmWhenVisible = false;

/**
 * Starts loading the model, so the first question does not wait for it. It returns at once. A hidden page waits
 * until it is shown: a question that comes first loads the model itself.
 */
export function warmupRerank(): void {
  try {
    if (typeof Worker !== 'function' || session.stopped) return;
    const doc = typeof document !== 'undefined' ? document : undefined;
    if (doc?.visibilityState === 'hidden') {
      if (warmWhenVisible) return;
      warmWhenVisible = true;
      const onShow = () => {
        if (doc.visibilityState === 'hidden') return;
        doc.removeEventListener('visibilitychange', onShow);
        warmWhenVisible = false;
        warmupRerank();
      };
      doc.addEventListener('visibilitychange', onShow);
      return;
    }
    const ml = getMl();
    if (ml.status('rerank')?.state === 'idle') startLoad(ml);
  } catch {
    // nothing to warm in this browser
  }
}
