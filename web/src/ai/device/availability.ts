// Gemini Nano availability (10 section 7.2). One check at a time, cached for AVAILABILITY_MAX_AGE_MS.
// Simulation (the Playground's "Not available (simulate)") only ever lowers availability; real values stay cached.
import type { NanoAvailability } from '@sieve/shared';
import { AVAILABILITY_MAX_AGE_MS, IMAGE_CREATE_OPTIONS, TEXT_CREATE_OPTIONS } from '../config';
import { e2eNano } from '../e2e';
import { getLanguageModel } from './languageModel';
import { dropBaseSessions } from './sessions';

export interface NanoState {
  text: NanoAvailability;
  image: NanoAvailability;
  checkedAt: number;            // 0 before the first check
  simulated: boolean;           // setNanoSimulation(true) is active
  setupFraction: number | null; // 0..1 while downloadNano() runs in this tab, else null
}

type Pair = { text: NanoAvailability; image: NanoAvailability };

const KNOWN = new Set<string>(['available', 'downloadable', 'downloading', 'unavailable']);

let real: Pair = { text: 'unavailable', image: 'unavailable' };
let checkedAt = 0;
let simulated = false;
let setupFraction: number | null = null;
let inFlight: Promise<void> | null = null;
let last: NanoState = snapshot();
const listeners = new Set<(s: NanoState) => void>();

function visible(): Pair {
  return simulated ? { text: 'unavailable', image: 'unavailable' } : real;
}

function snapshot(): NanoState {
  const v = visible();
  return { text: v.text, image: v.image, checkedAt, simulated, setupFraction };
}

/** Publishes the current state; notifies when anything a listener can see changed. */
function commit(): void {
  const next = snapshot();
  const changed =
    next.text !== last.text || next.image !== last.image || next.simulated !== last.simulated || next.setupFraction !== last.setupFraction;
  const leftAvailable = last.text === 'available' && next.text !== 'available';
  last = next;
  if (leftAvailable) dropBaseSessions();
  if (!changed) return;
  for (const l of [...listeners]) {
    try {
      l(next);
    } catch (e) {
      console.error('A Nano state listener failed.', e);
    }
  }
}

async function safe(p: () => Promise<string>): Promise<NanoAvailability> {
  try {
    const v = await p();
    return KNOWN.has(v) ? (v as NanoAvailability) : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function check(): Promise<void> {
  const e2e = e2eNano();
  let next: Pair;
  if (e2e !== undefined) {
    next = { text: e2e, image: e2e };
  } else {
    const LM = getLanguageModel();
    if (!LM) {
      next = { text: 'no-api', image: 'no-api' };
    } else {
      const [text, image] = await Promise.all([
        safe(() => LM.availability(TEXT_CREATE_OPTIONS)),
        safe(() => LM.availability(IMAGE_CREATE_OPTIONS)),
      ]);
      next = { text, image };
    }
  }
  real = next;
  checkedAt = Date.now();
  commit();
}

export async function getNanoAvailability(opts?: { maxAgeMs?: number }): Promise<Pair> {
  const maxAge = opts?.maxAgeMs ?? AVAILABILITY_MAX_AGE_MS;
  if (!inFlight && checkedAt > 0 && Date.now() - checkedAt < maxAge) return visible();
  inFlight ??= check().finally(() => {
    inFlight = null;
  });
  await inFlight;
  return visible();
}

/** Last known value, synchronous. */
export function getNanoState(): NanoState {
  return last;
}

export function subscribeNano(listener: (s: NanoState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setNanoSimulation(on: boolean): void {
  simulated = on;
  commit();
}

export function isNanoSimulated(): boolean {
  return simulated;
}

/** Set by setup.ts while downloadNano() runs in this tab. */
export function setSetupFraction(f: number | null): void {
  setupFraction = f;
  commit();
}

export function resetAvailabilityForTests(): void {
  real = { text: 'unavailable', image: 'unavailable' };
  checkedAt = 0;
  simulated = false;
  setupFraction = null;
  inFlight = null;
  listeners.clear();
  last = snapshot();
}
