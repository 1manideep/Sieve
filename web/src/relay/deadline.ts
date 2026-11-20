// Pure request helpers shared by decision.ts and the engine without Firestore: the decision deadline, Playground requests.
import type { RelayRequestView } from '@/state/types';
import { DECISION_WINDOW_MS } from './constants';

/**
 * The rules allow home-base writes only within 120 minutes of createdAt (30 section 15.1, RELAY_DECISION_MINUTES),
 * and expireAt (the 24 h TTL) is later, so the earlier of the two counts.
 */
export function decisionDeadline(r: Pick<RelayRequestView, 'createdAt' | 'expireAt'>): number {
  return Math.min(r.expireAt, r.createdAt + DECISION_WINDOW_MS);
}

/** A Playground request (00 D1): its grant's only source is the Playground sample data (the rules use the same test). */
export function isPlaygroundRequest(r: { allowedSources: readonly string[] }): boolean {
  return r.allowedSources.length === 1 && r.allowedSources[0] === 'playground';
}
