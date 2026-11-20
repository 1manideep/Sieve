// The one Web Worker that hosts Sieve's on-device ML tasks (20 section 6.2): embeddings (20) and PII (11), under
// the task names 'embed' and 'pii'.
// env must load before any task touches transformers.js.
import './env';
import { embedTask } from './embed.task';
import { createMlHost, type AnyHandler } from './host';
import type { FromMl, ToMl } from './protocol';
// 11's PII task (20 section 22.4, 01 section 11.1): Rampart from /models/, the same ORT runtime from /ort/.
import { piiTask } from '../privacy/model/pii.task';

interface GpuNavigator { gpu?: { requestAdapter(): Promise<unknown> } }

const scope = self as unknown as { postMessage(msg: FromMl, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent<ToMl>) => void) | null };

const host = createMlHost(
  { embed: embedTask as AnyHandler, pii: piiTask as unknown as AnyHandler },
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
  },
);

scope.onmessage = (ev) => host.handle(ev.data);
