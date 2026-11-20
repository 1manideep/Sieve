// users/{uid}/receipts/{receiptId} (40 section 10.3, 01 sections 3 and 11.8). Receipts never hold content.
// In Firestore the item ids are stored as `itemRefs` (HMAC with the local salt); on read they are joined back to
// record ids on this device. A ref that has no record here stays as the ref (shown as "not on this device").
import {
  collection,
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import type { LadderStep, Receipt, ReceiptStatus, RequesterRef } from '@sieve/shared';
import type { ReceiptView } from '@/state/types';
import { firestore, millis } from './firestore';
import { itemRefs, resolveItemRefs } from './itemRefs';

const STATUSES: readonly ReceiptStatus[] = ['pending-collection', 'delivered', 'declined', 'blocked', 'revoked', 'expired'];
const STEPS: readonly LadderStep[] = ['answer', 'excerpt', 'full'];

function receiptsCol(uid: string) {
  return collection(firestore(), 'users', uid, 'receipts');
}

/** The Firestore form of a receipt: `itemIds` become `itemRefs`, `createdAt` the server time, no undefined fields. */
export function receiptDoc(r: Receipt, refs: string[]): DocumentData {
  const out: DocumentData = {
    id: r.id,
    requestId: r.requestId,
    requester: r.requester.kind === 'outside'
      ? { kind: 'outside', grantId: r.requester.grantId, aiName: r.requester.aiName }
      : { kind: 'in-app', aiName: r.requester.aiName },
    question: r.question,
    itemRefs: refs,
    status: r.status,
    chars: r.chars,
    createdAt: serverTimestamp(),
  };
  if (r.step) out.step = r.step;
  if (r.decidedBy) out.decidedBy = r.decidedBy;
  return out;
}

export async function toReceiptDoc(uid: string, r: Receipt): Promise<DocumentData> {
  return receiptDoc(r, await itemRefs(uid, r.itemIds));
}

function readRequester(v: unknown): RequesterRef | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as Record<string, unknown>;
  if (q.kind === 'in-app') return { kind: 'in-app', aiName: 'Gemini (in Sieve)' };
  if (q.kind === 'outside' && typeof q.grantId === 'string' && typeof q.aiName === 'string') {
    return { kind: 'outside', grantId: q.grantId, aiName: q.aiName };
  }
  return null;
}

/** A stored receipt as a view, with `itemIds` still holding the stored refs. Null when the doc is malformed. */
export function toReceiptView(id: string, data: DocumentData): ReceiptView | null {
  const requester = readRequester(data.requester);
  const status = data.status as ReceiptStatus;
  if (!requester || !STATUSES.includes(status)) return null;
  const refs = Array.isArray(data.itemRefs) ? data.itemRefs : Array.isArray(data.itemIds) ? data.itemIds : [];
  const view: ReceiptView = {
    id: typeof data.id === 'string' ? data.id : id,
    requestId: typeof data.requestId === 'string' ? data.requestId : id,
    requester,
    question: typeof data.question === 'string' ? data.question : '',
    itemIds: refs.filter((x: unknown): x is string => typeof x === 'string'),
    status,
    chars: typeof data.chars === 'number' ? data.chars : 0,
    createdAt: millis(data.createdAt) ?? 0,
  };
  if (STEPS.includes(data.step as LadderStep)) view.step = data.step as LadderStep;
  if (data.decidedBy === 'app' || data.decidedBy === 'extension' || data.decidedBy === 'rule') view.decidedBy = data.decidedBy;
  return view;
}

/** Newest first, `n` at most. Refs are joined to local record ids before `next` is called. */
export function listenReceipts(
  uid: string,
  n: number,
  next: (r: ReceiptView[]) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  let seq = 0;
  return onSnapshot(
    query(receiptsCol(uid), orderBy('createdAt', 'desc'), limit(n)),
    (snap) => {
      const mine = ++seq;
      const views = snap.docs
        .map((d) => toReceiptView(d.id, d.data({ serverTimestamps: 'estimate' })))
        .filter((v): v is ReceiptView => v !== null);
      const refs = [...new Set(views.flatMap((v) => v.itemIds))];
      import('@/index')
        .then(({ openDb }) => resolveItemRefs(uid, openDb('real'), refs))
        .then((map) => views.map((v) => ({ ...v, itemIds: v.itemIds.map((r) => map[r] ?? r) })))
        .catch(() => views)
        .then((resolved) => {
          if (mine === seq) next(resolved);
        });
    },
    onError,
  );
}

/** In-app receipts (own data, 40 section 12.3): written before the approved text goes to the cloud model. */
export async function saveReceipt(uid: string, r: Receipt): Promise<void> {
  await setDoc(doc(receiptsCol(uid), r.id), await toReceiptDoc(uid, r));
}

/**
 * Revokes an outside receipt (40 section 10.3, 01 section 11.6), in one transaction: each item is blocked for that AI;
 * when the answer is still uncollected, the request goes `answered` to `revoked` (response deleted) and the receipt
 * `pending-collection` to `revoked` with it. The rules allow the receipt change only together with that request
 * change, so a delivered receipt keeps its status: the blocks are what stop the AI from getting the items again.
 */
export async function revokeReceipt(uid: string, r: ReceiptView): Promise<'withdrawn' | 'blocked'> {
  if (r.requester.kind !== 'outside') return 'blocked';
  if (r.status !== 'delivered' && r.status !== 'pending-collection') return 'blocked';
  const grantId = r.requester.grantId;
  const db = firestore();
  const refs = await itemRefs(uid, r.itemIds);
  const requestRef = doc(db, 'users', uid, 'requests', r.requestId);
  const receiptRef = doc(receiptsCol(uid), r.id);
  return runTransaction(db, async (tx) => {
    const request = r.status === 'pending-collection' ? await tx.get(requestRef) : undefined;
    const withdraw = request?.exists() === true && request.data().status === 'answered' && r.id === r.requestId;
    if (withdraw) {
      tx.update(requestRef, { status: 'revoked', response: deleteField() });
      tx.update(receiptRef, { status: 'revoked' });
    }
    for (const recordRef of refs) {
      tx.set(doc(collection(db, 'users', uid, 'blocked')), { recordRef, grantId, createdAt: serverTimestamp() });
    }
    return withdraw ? 'withdrawn' : 'blocked';
  });
}
