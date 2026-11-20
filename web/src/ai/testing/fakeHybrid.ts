// A scriptable replacement for hybrid.ts (10 section 15): records every call and can stream through opts.onText.
// Use with setHybridForTests(createFakeHybrid(handler)).
import type { CallMeta, HybridCaller, ModelCallResult, ModelSpec, SdkPart } from '../hybrid';

export interface FakeReply {
  text: string;
  source: 'on_device' | 'in_cloud';
  /** Streamed pieces; their concatenation should equal `text`. */
  chunks?: string[];
  /** Delay before each streamed piece, in ms. */
  chunkDelayMs?: number;
}
export interface FakeCall {
  spec: ModelSpec;
  parts: SdkPart[];
  signal: AbortSignal;
  timeoutMs: number;
  streamed: boolean;
  meta?: CallMeta;
  n: number;                    // 1-based call number
}
export type FakeHandler = (
  spec: ModelSpec,
  parts: SdkPart[],
  opts: { signal: AbortSignal; call: FakeCall },
) => FakeReply | Promise<FakeReply>;

export interface FakeHybrid extends HybridCaller {
  calls: FakeCall[];
  /** Calls whose spec.purpose matches. */
  callsFor(purpose: ModelSpec['purpose']): FakeCall[];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function createFakeHybrid(handler: FakeHandler): FakeHybrid {
  const calls: FakeCall[] = [];
  const record = (spec: ModelSpec, parts: SdkPart[], signal: AbortSignal, timeoutMs: number, streamed: boolean, meta?: CallMeta) => {
    const call: FakeCall = { spec, parts, signal, timeoutMs, streamed, meta, n: calls.length + 1 };
    calls.push(call);
    return call;
  };
  return {
    calls,
    callsFor: (purpose) => calls.filter((c) => c.spec.purpose === purpose),
    async generate(spec, parts, opts): Promise<ModelCallResult> {
      const call = record(spec, parts, opts.signal, opts.timeoutMs, false, opts.meta);
      const reply = await handler(spec, parts, { signal: opts.signal, call });
      return { text: reply.text, source: reply.source };
    },
    async stream(spec, parts, opts): Promise<ModelCallResult> {
      const call = record(spec, parts, opts.signal, opts.timeoutMs, true, opts.meta);
      const reply = await handler(spec, parts, { signal: opts.signal, call });
      let soFar = '';
      for (const piece of reply.chunks ?? [reply.text]) {
        if (reply.chunkDelayMs) await sleep(reply.chunkDelayMs, opts.signal);
        soFar += piece;
        opts.onText(soFar);
      }
      return { text: reply.text, source: reply.source };
    },
  };
}

/** A handler that never settles until the call's signal aborts. */
export function hang(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

/** The text of all text parts of a call, joined. */
export function promptText(parts: SdkPart[]): string {
  return parts.flatMap((p) => ('text' in p ? [p.text] : [])).join('\n');
}

export { sleep as fakeSleep };
