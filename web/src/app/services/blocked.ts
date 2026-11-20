// users/{uid}/blocked/{blockId} (40 section 10.4, 01 sections 3 and 11.8): items revoked for an AI.
// Stored as { recordRef, grantId, createdAt }; `recordId` is the local name, joined on this device from the ref.
import { collection, onSnapshot, type FirestoreError, type Unsubscribe } from 'firebase/firestore';
import { firestore } from './firestore';
import { resolveItemRefs } from './itemRefs';

export interface BlockedEntry {
  id: string;
  recordId: string;     // the record id on this device, or the stored ref when no record here matches (yet)
  grantId: string;      // may be '*'
  recordRef: string;    // the stored HMAC ref; the engine re-joins it right before preparing and sending
}

/** recordIds where grantId matches or is '*'. */
export function blockedFor(list: BlockedEntry[], grantId: string): string[] {
  return [...new Set(list.filter((b) => b.grantId === grantId || b.grantId === '*').map((b) => b.recordId))];
}

/** The stored refs for one grant (or '*'), for a fresh join at the moment they are used. */
export function blockedRefsFor(list: BlockedEntry[], grantId: string): string[] {
  return [...new Set(list.filter((b) => b.grantId === grantId || b.grantId === '*').map((b) => b.recordRef))];
}

export function listenBlocked(
  uid: string,
  next: (b: BlockedEntry[]) => void,
  onError: (e: FirestoreError) => void = (e) => console.error('blocked listener', e.code),
): Unsubscribe {
  let seq = 0;
  return onSnapshot(
    collection(firestore(), 'users', uid, 'blocked'),
    (snap) => {
      const mine = ++seq;
      const raw = snap.docs.flatMap((d) => {
        const data = d.data();
        const recordRef = typeof data.recordRef === 'string' ? data.recordRef : typeof data.recordId === 'string' ? data.recordId : '';
        const grantId = typeof data.grantId === 'string' ? data.grantId : '';
        return recordRef && grantId ? [{ id: d.id, recordRef, grantId }] : [];
      });
      import('@/index')
        .then(({ openDb }) => resolveItemRefs(uid, openDb('real'), raw.map((b) => b.recordRef)))
        .catch(() => ({}) as Record<string, string | null>)
        .then((map) => {
          if (mine === seq) next(raw.map((b) => ({ ...b, recordId: map[b.recordRef] ?? b.recordRef })));
        });
    },
    onError,
  );
}
