// Re-check the rules at the moment of sending (70 section 3.3, R-OUT-05, R-OUT-06, R-RLY-09, R-RLY-10).
// Defence in depth on top of 10's finalizeDecision and 11's verifyOutgoing. It never edits the text, it only refuses
// (P4). Reads records from the db only; no Firebase, no model calls.
import {
  LADDER_STEPS,
  MAX_PAYLOAD_CHARS,
  type Category,
  type IndexRecord,
  type LadderStep,
  type RequesterRef,
  type RequestStatus,
  type Settings,
  type SourceKind,
  type TraceStep,
} from '@sieve/shared';
import type { SieveDb } from '@/index/db';
import { prepareValidators, runValidators } from '@/privacy/pii/validators';
import { cleanChars } from '@/privacy/sanitize/chars';
import { SEND_GUARD } from './copy';
import { isWellFormed } from './question';

export type SendBlock = 'text-mismatch' | 'empty' | 'too-long' | 'not-clean' | 'missing-item' | 'rule-never'
  | 'request-closed' | 'expired' | 'step-too-high' | 'category-not-allowed' | 'source-not-allowed' | 'blocked' | 'unmasked-number';

export interface SendCheckInput {
  db: SieveDb;
  step: LadderStep;
  approvedText: string;            // the composed option text the person saw
  payloadText: string;             // the text about to leave (payload.text, or the approved text going to draftReply)
  itemIds: string[];
  question: string;
  requester: RequesterRef;
  settings: Settings;              // read now from useSettings, not from the proposal
  blockedRecordIds: string[];      // read now: blockedFor(getBlocked(), grantId), expanded by expandMoved() (R-IDX-06)
  request?: { status: RequestStatus; maxStep: LadderStep; allowedCategories: Category[]; allowedSources: SourceKind[]; expireAt: number };   // latest snapshot (outside requests only)
  now: number;                     // serverNow() (3.4)
}

export type SendCheckResult = { ok: true; trace: TraceStep } | { ok: false; code: SendBlock; message: string; trace: TraceStep };

type MaskedType = 'card' | 'iban' | 'ssn';
const MASKED_TYPES: readonly MaskedType[] = ['card', 'iban', 'ssn'];

function trace(label: string, now: number): TraceStep {
  return { kind: 'rule', label, where: 'code', ms: 0, at: now };
}

function stepIndex(step: LadderStep): number {
  return LADDER_STEPS.indexOf(step);
}

function compact(s: string): string {
  return s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** The first card, IBAN or SSN in the text that the question does not already contain (check 11). */
export async function unmaskedNumber(text: string, question: string): Promise<MaskedType | null> {
  try {
    await prepareValidators();
  } catch {
    // The phone metadata failed to load; the card, IBAN and SSN validators do not need it.
  }
  let spans: ReturnType<typeof runValidators>;
  try {
    spans = runValidators(text);
  } catch {
    return null;   // a validator bug must not block every send; 11's checks already ran when the text was built
  }
  const q = compact(question);
  for (const s of spans) {
    if (!(MASKED_TYPES as readonly string[]).includes(s.type)) continue;
    const value = compact(text.slice(s.start, s.end));
    if (value && q.includes(value)) continue;
    return s.type as MaskedType;
  }
  return null;
}

/** Checks 1 to 11 of 70 section 3.3, in order; the first failure returns. Every message ends with "Nothing was sent." */
export async function checkBeforeSend(i: SendCheckInput): Promise<SendCheckResult> {
  const aiName = i.requester.aiName;
  const fail = (code: SendBlock, message: string): SendCheckResult => ({
    ok: false,
    code,
    message,
    trace: trace(SEND_GUARD.stoppedTrace(message), i.now),
  });

  // 1. What you see is what is sent (P4).
  if (i.payloadText !== i.approvedText) return fail('text-mismatch', SEND_GUARD.textMismatch);
  // 2. Bounds, in UTF-16 code units (CR-1).
  if (i.payloadText.length < 1) return fail('empty', SEND_GUARD.empty);
  if (i.payloadText.length > MAX_PAYLOAD_CHARS) return fail('too-long', SEND_GUARD.tooLong);
  // 3. Nothing the person could not see.
  if (!isWellFormed(i.payloadText) || cleanChars(i.payloadText).text !== i.payloadText) return fail('not-clean', SEND_GUARD.notClean);
  // 4. Every item still on this device.
  const records: IndexRecord[] = [];
  for (const id of i.itemIds) {
    const rec = await i.db.records.get(id);
    if (!rec) return fail('missing-item', SEND_GUARD.missingItem);
    records.push(rec);
  }
  // 5. The rules as they are now.
  for (const rec of records) {
    if (i.settings.categoryRules[rec.category] === 'never') return fail('rule-never', SEND_GUARD.ruleNever(rec.category));
  }
  // 6 to 9. Outside requests: the latest request snapshot.
  const r = i.request;
  if (r && i.requester.kind === 'outside') {
    if (r.status !== 'awaiting-person') return fail('request-closed', SEND_GUARD.requestClosed);
    if (!(i.now < r.expireAt)) return fail('expired', SEND_GUARD.expired);
    if (stepIndex(i.step) < 0 || stepIndex(i.step) > stepIndex(r.maxStep)) return fail('step-too-high', SEND_GUARD.stepTooHigh(aiName));
    for (const rec of records) {
      if (!r.allowedCategories.includes(rec.category)) return fail('category-not-allowed', SEND_GUARD.categoryNotAllowed(aiName, rec.category));
    }
    for (const rec of records) {
      if (!r.allowedSources.includes(rec.source)) return fail('source-not-allowed', SEND_GUARD.sourceNotAllowed(aiName, rec.source));
    }
  }
  // 10. Blocks as they are now (already expanded through moves by the caller).
  const blocked = new Set(i.blockedRecordIds);
  if (i.itemIds.some((id) => blocked.has(id))) return fail('blocked', SEND_GUARD.blocked(aiName));
  // 11. A number 11 should have masked.
  const unmasked = await unmaskedNumber(i.payloadText, i.question);
  if (unmasked) return fail('unmasked-number', SEND_GUARD.unmaskedNumber(unmasked));
  return { ok: true, trace: trace(SEND_GUARD.passedTrace, i.now) };
}
