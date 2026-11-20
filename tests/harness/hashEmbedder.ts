// The deterministic embedder for unit tests (20 section 20): bag-of-words hashing into 384 dims, L2-normalized.
// Implements MlClient, so the index code under test runs unchanged; `hold()` keeps jobs waiting (race tests).
import type { MlClient, MlTaskStatus } from '../../web/src/ml/client';
import type { EmbedInput, EmbedOutput, MlTask } from '../../web/src/ml/protocol';

const DIMS = 384;
const STOP = new Set('a an the my me i is are was were be do does did what when where who how can to of in on for and or at by from with about it this that'.split(' '));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stem(w: string): string {
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(raw)) continue;
    const w = stem(raw);
    const h = hash(w);
    v[h % DIMS] = (v[h % DIMS] ?? 0) + 1;
    const h2 = hash(w + '#');
    v[h2 % DIMS] = (v[h2 % DIMS] ?? 0) + 0.5;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIMS; i++) v[i] = (v[i] ?? 0) / n;
  return v;
}

export interface HashEmbedClient extends MlClient {
  calls: { task: MlTask; texts: string[]; priority: string }[];
  /** Jobs wait until release() is called. */
  hold(): void;
  release(): void;
  setStatus(task: MlTask, s: MlTaskStatus): void;
  /** Resolves once a run call whose texts satisfy `match` has been made (already, or later): no polling. */
  whenCalled(match: (texts: string[]) => boolean): Promise<void>;
}

export function createHashEmbedClient(): HashEmbedClient {
  const calls: HashEmbedClient['calls'] = [];
  const statuses: Record<MlTask, MlTaskStatus> = { embed: { state: 'ready', device: 'wasm' }, pii: { state: 'idle' } };
  const listeners = new Set<(t: MlTask, s: MlTaskStatus) => void>();
  let waiters: { match: (texts: string[]) => boolean; resolve: () => void }[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  return {
    calls,
    whenCalled(match) {
      if (calls.some((c) => match(c.texts))) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push({ match, resolve }));
    },
    hold() {
      gate = new Promise((r) => (open = r));
    },
    release() {
      open?.();
      gate = null;
      open = null;
    },
    setStatus(task, s) {
      statuses[task] = s;
      for (const fn of listeners) fn(task, s);
    },
    async warmup(task) {
      if (statuses[task].state === 'failed') throw new Error('failed');
      if (statuses[task].state !== 'ready') this.setStatus(task, { state: 'ready', device: 'wasm' });
    },
    async run<I, O>(task: MlTask, input: I, opts?: { priority?: 'foreground' | 'background'; signal?: AbortSignal }): Promise<O> {
      const { texts } = input as unknown as EmbedInput;
      calls.push({ task, texts, priority: opts?.priority ?? 'background' });
      const hit = waiters.filter((w) => w.match(texts));
      waiters = waiters.filter((w) => !hit.includes(w));
      for (const w of hit) w.resolve();
      if (gate && opts?.priority !== 'foreground') await gate;
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const data = new Float32Array(texts.length * DIMS);
      texts.forEach((t, i) => data.set(hashEmbed(t), i * DIMS));
      const out: EmbedOutput = { dims: DIMS, count: texts.length, data };
      return out as unknown as O;
    },
    status(task) {
      return statuses[task];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
