// users/{uid}/requests/{requestId} (40 section 11.5, 30 section 9.1, 01 sections 3 and 11.6).
// The home base changes only status, claimedAt, claimedBy, answeredAt, response and message, along the allowed
// transitions, each in a transaction. The answer (or decline, or block) and its receipt are one transaction.
import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  CATEGORIES,
  LADDER_STEPS,
  MCP_TOOLS,
  type Category,
  type QueryHints,
  type RelayPayload,
  type Receipt,
  type RequestStatus,
  type SourceKind,
} from '@sieve/shared';
import { firestore, millis } from '@/app/services/firestore';
import { normalizeQuestion, parseStoredHints as parseHintsChecked } from '@/robust/question';
import { toReceiptDoc } from '@/app/services/receipts';
import type { RelayRequestView } from '@/state/types';
export { decisionDeadline, isPlaygroundRequest } from './deadline';

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  'queued', 'claimed', 'awaiting-person', 'answered', 'declined', 'blocked', 'no-match', 'unsupported',
  'collected', 'expired', 'revoked', 'offline', 'error',
];
export const OPEN_STATUSES: readonly RequestStatus[] = ['queued', 'claimed', 'awaiting-person'];
export const TERMINAL_STATUSES: readonly RequestStatus[] = [
  'answered', 'declined', 'blocked', 'no-match', 'unsupported', 'collected', 'expired', 'revoked', 'offline', 'error',
];
const SOURCES: readonly SourceKind[] = ['gmail', 'folder', 'upload', 'playground'];

const TOOLS = Object.values(MCP_TOOLS) as string[];

/** The receipt is written with the request (receiptId = requestId), except for Playground requests (00 D1), whose
 * receipts stay in the Playground database on this device. */
export type FinishInput =
  | { status: 'answered'; response: RelayPayload; receipt?: Receipt; message?: string }
  | { status: 'declined'; message: string; receipt?: Receipt }
  | { status: 'blocked'; message: string; receipt?: Receipt }
  | { status: 'no-match' | 'unsupported' | 'error'; message: string };

/** A request doc that failed parseRequestDoc (70 R-RLY-11): only its id and status are trusted. */
export interface InvalidRequest { id: string; status: unknown; reason?: 'no-readable-words' }

function requestsCol(uid: string) {
  return collection(firestore(), 'users', uid, 'requests');
}

function requestRef(uid: string, id: string) {
  return doc(firestore(), 'users', uid, 'requests', id);
}

/** Drops every hint field that is not the shape 30 section 8.7 allows (70 R-MCP: never trust stored hints blindly). */
export function parseStoredHints(raw: unknown): QueryHints | undefined {
  return parseHintsChecked(raw);   // real dates, after <= before, 30 section 8.7 lengths, no Cc or Cf characters
}

/** Checks a request doc field by field (70 R-RLY-11). Null when it cannot be handled safely. */
export function parseRequestDoc(id: string, data: DocumentData): RelayRequestView | null {
  const status = data.status as RequestStatus;
  if (!REQUEST_STATUSES.includes(status)) return null;
  const r = data.requester as Record<string, unknown> | undefined;
  if (!r || r.kind !== 'outside' || typeof r.grantId !== 'string' || !r.grantId || typeof r.aiName !== 'string') return null;
  if (!(LADDER_STEPS as readonly unknown[]).includes(data.requestedStep)) return null;
  if (!(LADDER_STEPS as readonly unknown[]).includes(data.maxStep)) return null;
  if (typeof data.question !== 'string') return null;
  // 70 R-MCP-04: zero-width, direction and tag characters reach the doc (30 rejects only Cc); the card, the
  // extension preview, the trace and Nano all use the cleaned text.
  const cleaned = normalizeQuestion(data.question);
  if (cleaned.error === 'empty') return null;
  if (!Array.isArray(data.allowedCategories) || !data.allowedCategories.every((c: unknown) => (CATEGORIES as readonly unknown[]).includes(c))) return null;
  if (!Array.isArray(data.allowedSources) || !data.allowedSources.every((s: unknown) => (SOURCES as readonly unknown[]).includes(s))) return null;
  const expireAt = millis(data.expireAt);
  const createdAt = millis(data.createdAt);
  if (expireAt === undefined || createdAt === undefined) return null;
  const view: RelayRequestView = {
    id,
    requester: { kind: 'outside', grantId: r.grantId, aiName: r.aiName },
    tool: (TOOLS.includes(data.tool) ? data.tool : MCP_TOOLS.answer) as RelayRequestView['tool'],
    requestedStep: data.requestedStep,
    maxStep: data.maxStep,
    allowedCategories: [...data.allowedCategories] as Category[],
    allowedSources: [...data.allowedSources] as SourceKind[],
    question: cleaned.text,
    status,
    createdAt,
    expireAt,
  };
  const hints = parseStoredHints(data.hints);
  if (hints) view.hints = hints;
  if (data.wantFile === true) view.wantFile = true;
  const r0 = cleaned.removed;
  if (r0.invisible > 0 || r0.bidi > 0 || r0.tagText.length > 0) view.questionRemoved = r0;
  const claimedAt = millis(data.claimedAt);
  if (claimedAt !== undefined) view.claimedAt = claimedAt;
  const answeredAt = millis(data.answeredAt);
  if (answeredAt !== undefined) view.answeredAt = answeredAt;
  const collectedAt = millis(data.collectedAt);
  if (collectedAt !== undefined) view.collectedAt = collectedAt;
  if (typeof data.claimedBy === 'string') view.claimedBy = data.claimedBy;
  if (typeof data.message === 'string') view.message = data.message;
  return view;
}

export function isTerminal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function split(id: string, data: DocumentData, ok: RelayRequestView[], bad: InvalidRequest[]): void {
  const view = parseRequestDoc(id, data);
  if (view) ok.push(view);
  else {
    const noWords = typeof data.question === 'string' && data.question.length > 0 && normalizeQuestion(data.question).error === 'empty';
    bad.push(noWords ? { id, status: data.status, reason: 'no-readable-words' } : { id, status: data.status });
  }
}

/** The newest 50 request docs. `next` gets the valid ones (newest first); `onInvalid` the rest (R-RLY-11). */
export function listenRequests(
  uid: string,
  next: (r: RelayRequestView[]) => void,
  onError: (e: FirestoreError) => void,
  onInvalid: (bad: InvalidRequest[]) => void = () => undefined,
): Unsubscribe {
  return onSnapshot(
    query(requestsCol(uid), orderBy('createdAt', 'desc'), limit(50)),
    (snap) => {
      const ok: RelayRequestView[] = [];
      const bad: InvalidRequest[] = [];
      for (const d of snap.docs) split(d.id, d.data({ serverTimestamps: 'estimate' }), ok, bad);
      if (bad.length > 0) onInvalid(bad);
      next(ok);
    },
    onError,
  );
}

/** Open requests (queued, claimed, awaiting-person), for the resync after a sleep or freeze (70 R-PLAT-04). */
export async function listOpenRequests(uid: string): Promise<{ ok: RelayRequestView[]; bad: InvalidRequest[] }> {
  const snap = await getDocs(query(requestsCol(uid), where('status', 'in', [...OPEN_STATUSES])));
  const ok: RelayRequestView[] = [];
  const bad: InvalidRequest[] = [];
  for (const d of snap.docs) split(d.id, d.data({ serverTimestamps: 'estimate' }), ok, bad);
  ok.sort((a, b) => b.createdAt - a.createdAt);
  return { ok, bad };
}

/** queued to claimed. 'taken' when another home base (or tab) got there first. */
export async function claimRequest(uid: string, id: string, deviceId: string): Promise<'claimed' | 'taken' | 'gone'> {
  const ref = requestRef(uid, id);
  return runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return 'gone';
    if (snap.data().status !== 'queued') return 'taken';
    tx.update(ref, { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: deviceId });
    return 'claimed';
  });
}

/** claimed to awaiting-person (ours only). Already awaiting with our claim is a no-op. */
export async function markAwaiting(uid: string, id: string, deviceId: string): Promise<'ok' | 'gone'> {
  const ref = requestRef(uid, id);
  return runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return 'gone';
    const d = snap.data();
    if (d.claimedBy !== deviceId) return 'gone';
    if (d.status === 'awaiting-person') return 'ok';
    if (d.status !== 'claimed') return 'gone';
    tx.update(ref, { status: 'awaiting-person' });
    return 'ok';
  });
}

/**
 * The last home-base write for a request: its status with its fields, plus the receipt in the same transaction
 * (receiptId = requestId, so a retry can never make a second receipt).
 */
export async function finishRequest(uid: string, id: string, deviceId: string, f: FinishInput): Promise<'ok' | 'gone'> {
  const db = firestore();
  const ref = requestRef(uid, id);
  const receipt = 'receipt' in f && f.receipt ? { ...f.receipt, id } : undefined;
  const receiptData = receipt ? await toReceiptDoc(uid, receipt) : undefined;
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return 'gone';
    const d = snap.data();
    if (d.claimedBy !== deviceId) return 'gone';
    const from = d.status as RequestStatus;
    // The allowed transitions (30 section 9.1): answered and declined only from awaiting-person;
    // no-match, unsupported and blocked only from claimed; error from either.
    const allowed =
      f.status === 'answered' || f.status === 'declined'
        ? from === 'awaiting-person'
        : f.status === 'error'
          ? from === 'claimed' || from === 'awaiting-person'
          : from === 'claimed';
    if (!allowed) return 'gone';
    if (f.status === 'answered') {
      const response: DocumentData = { step: f.response.step, text: f.response.text, chars: f.response.chars, itemCount: f.response.itemCount };
      if (f.response.image) response.image = f.response.image;
      if (f.response.file) response.file = { name: f.response.file.name, mime: f.response.file.mime, bytes: f.response.file.bytes, path: f.response.file.path };
      tx.update(ref, { status: 'answered', answeredAt: serverTimestamp(), response, ...(f.message ? { message: f.message.slice(0, 300) } : {}) });
    } else {
      tx.update(ref, { status: f.status, message: f.message.slice(0, 300) });
    }
    if (receipt && receiptData) tx.set(doc(db, 'users', uid, 'receipts', receipt.id), receiptData);
    return 'ok';
  });
}

/** Revoking an uncollected answer from the home base (01 section 11.6): answered to revoked, response deleted. */
export async function revokeAnswered(uid: string, id: string): Promise<'ok' | 'gone'> {
  const ref = requestRef(uid, id);
  return runTransaction(firestore(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== 'answered') return 'gone';
    tx.update(ref, { status: 'revoked', response: deleteField() });
    return 'ok';
  });
}
