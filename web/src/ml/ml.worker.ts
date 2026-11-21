// The one Web Worker that hosts Sieve's on-device ML tasks (20 section 6.2): embeddings (20), PII (11) and the
// reranker, under the task names 'embed', 'pii' and 'rerank'.
// env must load before any task touches transformers.js.
import './env';
import { embedTask } from './embed.task';
import { createMlHost, type AnyHandler } from './host';
import type { FromMl, ToMl } from './protocol';
// 11's PII task (20 section 22.4, 01 section 11.1): Rampart from /models/, the same ORT runtime from /ort/.
import { piiTask } from '../privacy/model/pii.task';

interface GpuNavigator { gpu?: { requestAdapter(): Promise<unknown> } }

const scope = self as unknown as { postMessage(msg: FromMl, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent<ToMl>) => void) | null };

/**
 * After a question's job, background jobs wait this long for its next one (the rerank follows the question's
 * embedding by the time the search takes to fuse). Without it a 16-chunk indexing batch, about 3 s on WASM, starts
 * in between and the rerank misses its 1.5 s budget (Nov 21, 2026).
 */
const FOREGROUND_HOLD_MS = 1500;

const host = createMlHost(
  {
    embed: embedTask as AnyHandler,
    pii: piiTask as unknown as AnyHandler,
    // loaded on the first rerank, so a page that never asks does not parse it
    rerank: async () => (await import('./rerank.task')).rerankTask as AnyHandler,
  },
  (msg, transfer) => scope.postMessage(msg, transfer ?? []),
  {
    hasWebGpu: async () => {
      const gpu = (navigator as unknown as GpuNavigator).gpu;
      if (!gpu) return false;
      try {
        return (await gpu.requestAdapter()) !== null;
      } catch {
        return false;
      }
    },
    foregroundHoldMs: FOREGROUND_HOLD_MS,
  },
);

scope.onmessage = (ev) => host.handle(ev.data);
