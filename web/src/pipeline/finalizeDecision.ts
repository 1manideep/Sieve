// finalizeDecision (10 section 12.9, 01 section 11.4): a Decision to the payload and receipt. Pure: it persists nothing.
// The caller stores the receipt when the text actually leaves (relay: one batched write with the request update; in-app:
// before the draft call). The payload text is exactly composeOutgoingText of the options the person saw.
import { MAX_PAYLOAD_CHARS, REQUEST_TTL_HOURS } from '@sieve/shared';
import type { OfferedFile, Category, Decision, Proposal, Receipt, RelayPayload, Settings, SourceKind, StepOption, TraceStep } from '@sieve/shared';
import { getRecord, verifyFresh, type SieveDb } from '@/index';
import { verifyOutgoing } from '@/privacy';
import { LABELS } from './copy';
import { DecisionError } from './errors';
import { composeOutgoingText, ruleFor, stepIndex } from './steps';

export interface FinalizeExtras {
  relatedOptions?: Record<string, StepOption[]>;
  /** When given, every item is checked against its source again (the person may approve minutes later). */
  db?: SieveDb;
  /** When given with db, the current rules, grant scope and blocks are re-checked (01 section 11.8). */
  current?: { settings?: Settings; allowedCategories?: Category[]; allowedSources?: SourceKind[]; blockedRecordIds?: string[] };
}

export interface FinalizeResult {
  payload: RelayPayload | null;
  receipt: Receipt;
  /** The approved step is the file itself: the home base uploads it and adds its place to the payload. */
  file?: OfferedFile;
  approveStep?: TraceStep;
}

async function recheck(proposal: Proposal, itemIds: string[], extras: FinalizeExtras): Promise<void> {
  const db = extras.db;
  if (!db) return;
  const statuses = await Promise.all(
    itemIds.map(async (id) => {
      try {
        return await verifyFresh(db, id);
      } catch {
        return id.startsWith('gmail:') ? 'unreachable' : 'ok';
      }
    }),
  );
  if (statuses.includes('gone')) throw new DecisionError('not-ready', 'That item was deleted, so nothing was sent.');
  if (statuses.includes('changed')) throw new DecisionError('not-ready', 'That item changed after Sieve read it. Ask again to see the new text.');
  if (statuses.includes('unreachable')) throw new DecisionError('not-ready', "Couldn't check the email with Gmail, so nothing was sent.");

  const current = extras.current;
  if (!current) return;
  const blocked = new Set(current.blockedRecordIds ?? []);
  const records = await Promise.all(itemIds.map((id) => getRecord(db, id)));
  for (const rec of records) {
    if (!rec) throw new DecisionError('not-ready', 'That item was deleted, so nothing was sent.');
    if (blocked.has(rec.id)) throw new DecisionError('not-ready', `You blocked this item for ${proposal.requester.aiName}, so nothing was sent.`);
    if (current.allowedSources && !current.allowedSources.includes(rec.source)) {
      throw new DecisionError('not-ready', `${proposal.requester.aiName} may no longer use this source, so nothing was sent.`);
    }
    if (current.allowedCategories && !current.allowedCategories.includes(rec.category)) {
      throw new DecisionError('not-ready', `${proposal.requester.aiName} may no longer ask about ${rec.category}, so nothing was sent.`);
    }
    if (current.settings && ruleFor(current.settings, rec.category) === 'never') {
      throw new DecisionError('not-ready', `${rec.category} is never shared now, so nothing was sent.`);
    }
  }
}

export async function finalizeDecision(proposal: Proposal, decision: Decision, extras: FinalizeExtras = {}): Promise<FinalizeResult> {
  // 1 and 2.
  if (decision.requestId !== proposal.requestId) throw new DecisionError('wrong-request', 'This decision is for a different request.');
  if (decision.decidedAt - proposal.createdAt > REQUEST_TTL_HOURS * 3600000) {
    throw new DecisionError('expired', 'This request expired. Nothing was sent.');
  }
  const base = {
    id: crypto.randomUUID(),
    requestId: proposal.requestId,
    requester: proposal.requester,
    question: proposal.question,
    createdAt: decision.decidedAt,
  };

  // 3. Declined (or blocked by a rule): nothing leaves.
  if (!decision.approved) {
    const blocked = proposal.outcome === 'blocked-never';
    const receipt: Receipt = {
      ...base,
      itemIds: proposal.item ? [proposal.item.recordId] : [],
      status: blocked ? 'blocked' : 'declined',
      decidedBy: blocked ? 'rule' : decision.decidedBy,
      chars: 0,
    };
    return blocked
      ? { payload: null, receipt }
      : { payload: null, receipt, approveStep: { kind: 'approve', label: LABELS.declined, where: 'device', ms: 0, at: decision.decidedAt } };
  }

  // 4 to 8.
  const item = proposal.item;
  if (proposal.outcome !== 'ready' || !item) throw new DecisionError('not-ready', "This request isn't ready to approve.");
  const step = decision.step;
  if (!step) throw new DecisionError('bad-step', 'Pick what to share first.');
  if (stepIndex(step) > stepIndex(proposal.maxStep)) throw new DecisionError('step-too-high', "That step isn't allowed for this request.");
  const ids = decision.itemIds;
  const relatedIds = new Set(proposal.related.map((c) => c.recordId));
  if (ids.length === 0 || ids[0] !== item.recordId || new Set(ids).size !== ids.length || ids.slice(1).some((id) => !relatedIds.has(id))) {
    throw new DecisionError('bad-items', "Those items don't match this request.");
  }
  const i = stepIndex(step);
  const main = proposal.options[i];
  const related = ids.slice(1).map((id) => extras.relatedOptions?.[id]?.[i]);
  if (!main?.available || main.step !== step || related.some((o) => !o?.available || o.step !== step)) {
    throw new DecisionError('option-unavailable', "That step isn't available for one of the items.");
  }

  // 9.
  const options = [main, ...(related as StepOption[])];
  const text = composeOutgoingText(options);
  if (text === '' || text.length > MAX_PAYLOAD_CHARS) {
    throw new DecisionError('too-long', 'This is more than Sieve sends at once (8,000 characters). Untick an item or pick a lower step.');
  }

  // 10. The gap between showing a proposal and approving it minutes later.
  await recheck(proposal, ids, extras);

  const payload: RelayPayload = {
    step,
    text,
    chars: text.length,
    itemCount: ids.length,
    ...(main.image ? { image: main.image } : {}),
  };
  // 11 section 11.2: the last check before anything is written. With related items the text is composed from several
  // options, so the single-option comparison applies only to one item (the composition is checked above).
  if (ids.length === 1) {
    try {
      verifyOutgoing(payload, proposal, decision);
    } catch (e) {
      throw new DecisionError('option-unavailable', e instanceof Error ? e.message : 'Nothing was sent.');
    }
  }
  const receipt: Receipt = {
    ...base,
    step,
    itemIds: ids,
    status: proposal.requester.kind === 'outside' ? 'pending-collection' : 'delivered',
    decidedBy: decision.decidedBy,
    chars: text.length,
    ...(main.file && ids.length === 1 ? { fileBytes: main.file.bytes } : {}),
  };
  const approveStep: TraceStep = { kind: 'approve', label: LABELS.approved(step, ids.length), where: 'device', ms: 0, at: decision.decidedAt };
  // a file is one item's original: with related items ticked the step is text, as always
  return main.file && ids.length === 1 ? { payload, receipt, approveStep, file: main.file } : { payload, receipt, approveStep };
}
