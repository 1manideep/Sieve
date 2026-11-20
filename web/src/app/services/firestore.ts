// The Firestore instance (40 sections 4.2 and 10): created on first use, never at boot, so Firestore stays out of the
// first load. Connects the emulator when VITE_USE_EMULATORS is set. Default memory cache: nothing lingers on disk.
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { EMULATOR_HOST, EMULATOR_PORTS, getFirebaseApp } from '@/app/firebase';
import { env } from '@/app/env';

let instance: Firestore | undefined;

export function firestore(): Firestore {
  if (!instance) {
    instance = getFirestore(getFirebaseApp());
    if (env.useEmulators) connectFirestoreEmulator(instance, EMULATOR_HOST, EMULATOR_PORTS.firestore);
  }
  return instance;
}

/** Test seam: use this instance (for example one connected to the emulator), or forget it. */
export function setFirestoreForTests(db: Firestore | undefined): void {
  instance = db;
}

/** A Firestore Timestamp (or anything with toMillis) as epoch ms; undefined when absent. */
export function millis(value: unknown): number | undefined {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis(): number }).toMillis();
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/** True when a Firestore error most likely means "no connection" rather than "not allowed". */
export function isOfflineError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'unavailable' || code === 'deadline-exceeded') return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
