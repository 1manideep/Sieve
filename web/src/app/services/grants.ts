// users/{uid}/grants/{grantId} (40 section 10.5, 01 section 2 GrantMeta): read-only to the client, written by functions.
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { CATEGORIES, LADDER_STEPS, type Category, type LadderStep, type SourceKind } from '@sieve/shared';
import type { GrantView } from '@/state/types';
import { firestore, millis } from './firestore';

export const EXPIRING_MS = 3 * 24 * 60 * 60 * 1000;   // "expiring: within 3 days"
const SOURCES: readonly SourceKind[] = ['gmail', 'folder', 'upload', 'playground'];

export function grantState(g: Pick<GrantView, 'expiresAt' | 'revokedAt'>, now: number): GrantView['state'] {
  if (g.revokedAt !== undefined) return 'revoked';
  if (g.expiresAt <= now) return 'expired';
  if (g.expiresAt - now <= EXPIRING_MS) return 'expiring';
  return 'active';
}

export function toGrantView(id: string, data: DocumentData, now: number): GrantView {
  const maxStep = (LADDER_STEPS as readonly string[]).includes(data.maxStep) ? (data.maxStep as LadderStep) : 'answer';
  const base = {
    id,
    aiName: typeof data.aiName === 'string' ? data.aiName : '',
    maxStep,
    allowedCategories: (Array.isArray(data.allowedCategories) ? data.allowedCategories : []).filter(
      (c: unknown): c is Category => (CATEGORIES as readonly unknown[]).includes(c),
    ),
    allowedSources: (Array.isArray(data.allowedSources) ? data.allowedSources : []).filter(
      (s: unknown): s is SourceKind => (SOURCES as readonly unknown[]).includes(s),
    ),
    linkHint: typeof data.linkHint === 'string' ? data.linkHint : '',
    createdAt: millis(data.createdAt) ?? 0,
    expiresAt: millis(data.expiresAt) ?? 0,
    ...(millis(data.revokedAt) !== undefined ? { revokedAt: millis(data.revokedAt) } : {}),
    ...(millis(data.lastUsedAt) !== undefined ? { lastUsedAt: millis(data.lastUsedAt) } : {}),
  };
  return { ...base, state: grantState(base, now) };
}

export function listenGrants(
  uid: string,
  next: (g: GrantView[]) => void,
  onError: (e: FirestoreError) => void,
  now: () => number = Date.now,
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore(), 'users', uid, 'grants'), orderBy('createdAt', 'desc')),
    (snap) => next(snap.docs.map((d) => toGrantView(d.id, d.data({ serverTimestamps: 'estimate' }), now()))),
    onError,
  );
}
