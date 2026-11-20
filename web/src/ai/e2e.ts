// The end-to-end model seam (60 section 3.9.1, 70 section 15.4). Active only when VITE_SIEVE_E2E is '1': Vite replaces
// the check with a constant, so production builds drop every branch below and never load testing/fakeModel.ts.
// Playwright's Chromium has no Gemini Nano: availability comes from window.__sieveE2E.nano, and the hybrid caller is
// replaced by a deterministic fake, so the real policy, scheduler, parsing and trace code still run.
import type { NanoAvailability } from '@sieve/shared';
import type { HybridCaller } from './hybrid';
import type { Purpose } from './types';

export interface SieveE2ECall {
  purpose: Purpose;
  mode: string;
  data: string;
  recordIds: string[];
  prompt: string;
  sdkReported?: 'on_device' | 'in_cloud';
}
export interface SieveE2EAnswer {
  match: string;                 // case-insensitive text of the question
  recordId?: string | null;      // the record that answers it; absent: the first candidate; null: none of them
  answer: string;
  verify?: boolean;              // what the verify-answer check says; absent: true
}
export interface SieveE2E {
  nano?: NanoAvailability;
  calls?: SieveE2ECall[];
  faults?: Partial<Record<Purpose, string[]>>;
  answers?: SieveE2EAnswer[];
  canaries?: string[];
  /** The ML worker's task states as web/src/ml/client.ts reports them (embed, pii), so a spec can wait for the embedder. */
  ml?: Partial<Record<'embed' | 'pii', 'idle' | 'loading' | 'ready' | 'failed'>>;
}

declare global {
  interface Window {
    __sieveE2E?: SieveE2E;
  }
}

export interface E2EHooks {
  hybrid: HybridCaller;
  /** Consumes an 'availability:<state>' fault at the head of the purpose's queue. */
  availabilityFault(purpose: Purpose): NanoAvailability | undefined;
}

let hooks: Promise<E2EHooks | null> | undefined;

export function isE2E(): boolean {
  return import.meta.env.VITE_SIEVE_E2E === '1';
}

export function getE2EHooks(): Promise<E2EHooks | null> {
  if (import.meta.env.VITE_SIEVE_E2E === '1') {
    hooks ??= import('./testing/fakeModel').then((m) => m.installE2EModel());
    return hooks;
  }
  return Promise.resolve(null);
}

/** Availability while the seam is on; undefined otherwise. */
export function e2eNano(): NanoAvailability | undefined {
  if (import.meta.env.VITE_SIEVE_E2E === '1') {
    return (typeof window !== 'undefined' ? window.__sieveE2E?.nano : undefined) ?? 'available';
  }
  return undefined;
}

/** Lets the seam's downloadNano mark the model ready. */
export function setE2ENano(n: NanoAvailability): void {
  if (import.meta.env.VITE_SIEVE_E2E === '1' && typeof window !== 'undefined') {
    window.__sieveE2E = { ...(window.__sieveE2E ?? {}), nano: n };
  }
}

export function resetE2EHooksForTests(): void {
  hooks = undefined;
}
