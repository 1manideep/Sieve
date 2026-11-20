// A small typed emitter for index events (20 section 2). 40 listens for db-closed and db-blocked.
import type { IntegrityReport } from './consistency';

export type IndexEvent =
  | { type: 'db-closed'; db: string }
  | { type: 'db-blocked'; db: string }
  | { type: 'integrity'; db: string; report: IntegrityReport }
  | { type: 'records-changed'; db: string; ids: string[] }
  | { type: 'records-removed'; db: string; ids: string[] }
  | { type: 'gmail-auth-lost' }
  | { type: 'gmail-forbidden'; reason: string }
  | { type: 'gmail-rate-limited' };

type Listener = (e: IndexEvent) => void;
const listeners = new Set<Listener>();

export function onIndexEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitIndexEvent(e: IndexEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(e);
    } catch (err) {
      console.error('index event listener failed', err);
    }
  }
}
