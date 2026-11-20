// Re-check at the moment of sending (70 section 3.3, R-RLY-09 and R-RLY-10, 01 section 11.8).
// The proposal was built with the settings, grant and blocks of its moment; the person may approve minutes later.
// These checks never edit the text, they only refuse. Pure apart from the getRecord lookup; no Firebase here.
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
import { SEND_CHECK } from '@/copy/strings';
import { cleanChars } from '@/privacy/sanitize/chars';
import { SEND_GUARD } from '@/robust/copy';
import { isWellFormed } from '@/robust/question';
import { unmaskedNumber } from '@/robust/sendGuard';

export type SendBlock =
  | 'text-mismatch' | 'empty' | 'too-long' | 'missing-item' | 'rule-never'
  | 'request-closed' | 'expired' | 'step-too-high' | 'category-not-allowed' | 'source-not-allowed' | 'blocked'
  | 'not-clean' | 'unmasked-number';

export interface SendCheckInput {
  step: LadderStep;
  approvedText: string;
  payloadText: string;
  itemIds: string[];
  question?: string;                           // check 11 ignores numbers the question already holds
  requester: RequesterRef;
  settings: Settings;                          // read now, not from the proposal
  blockedRecordIds: string[];                  // read now, joined fresh from the stored refs
  request?: { status: RequestStatus; maxStep: LadderStep; allowedCategories: Category[]; allowedSources: SourceKind[]; deadline: number };
  now: number;
  getRecord(id: string): Promise<IndexRecord | undefined>;
}

export type SendCheckResult =
  | { ok: true; trace: TraceStep }
  | { ok: false; code: SendBlock; message: string; trace: TraceStep };

function trace(label: string, now: number): TraceStep {
  return { kind: 'rule', label, where: 'code', ms: 0, at: now };
}

export async function checkBeforeSend(i: SendCheckInput): Promise<SendCheckResult> {
  const aiName = i.requester.aiName;
  const fail = (code: SendBlock, message: string): SendCheckResult => ({
    ok: false,
    code,
    message,
    trace: trace(SEND_CHECK.stoppedTrace(message), i.now),
  });

  if (i.payloadText !== i.approvedText) return fail('text-mismatch', SEND_CHECK.textMismatch);
  if (i.payloadText.length === 0) return fail('empty', SEND_CHECK.empty);
  if (i.payloadText.length > MAX_PAYLOAD_CHARS) return fail('too-long', SEND_CHECK.tooLong);
  if (!isWellFormed(i.payloadText) || cleanChars(i.payloadText).text !== i.payloadText) return fail('not-clean', SEND_GUARD.notClean);

  const records: IndexRecord[] = [];
  for (const id of i.itemIds) {
    const rec = await i.getRecord(id);
    if (!rec) return fail('missing-item', SEND_CHECK.missingItem);
    records.push(rec);
  }
  for (const rec of records) {
    if (i.settings.categoryRules[rec.category] === 'never') return fail('rule-never', SEND_CHECK.ruleNever(rec.category));
  }
  const r = i.request;
  if (r) {
    if (r.status !== 'awaiting-person' && r.status !== 'claimed') return fail('request-closed', SEND_CHECK.requestClosed);
    if (!(i.now < r.deadline)) return fail('expired', SEND_CHECK.expired);
    if (LADDER_STEPS.indexOf(i.step) > LADDER_STEPS.indexOf(r.maxStep)) return fail('step-too-high', SEND_CHECK.stepTooHigh(aiName));
    for (const rec of records) {
      if (!r.allowedCategories.includes(rec.category)) return fail('category-not-allowed', SEND_CHECK.categoryNotAllowed(aiName, rec.category));
      if (!r.allowedSources.includes(rec.source)) return fail('source-not-allowed', SEND_CHECK.sourceNotAllowed(aiName, rec.source));
    }
  }
  const blocked = new Set(i.blockedRecordIds);
  if (i.itemIds.some((id) => blocked.has(id))) return fail('blocked', SEND_CHECK.blocked(aiName));
  const unmasked = await unmaskedNumber(i.payloadText, i.question ?? '');
  if (unmasked) return fail('unmasked-number', SEND_GUARD.unmaskedNumber(unmasked));
  return { ok: true, trace: trace(SEND_CHECK.passedTrace, i.now) };
}
