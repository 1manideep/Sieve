// Validation of PageToExtension messages (50 section 6.6). Hand-written guards only: the extension CSP forbids
// validators that compile schemas with `new Function`. Each guard returns a fresh object holding only the known
// fields (unknown fields are dropped), or null.
// Tolerant since 0.1.1: the web app deploys continuously while installed extensions lag, so a value this build does
// not know never breaks the connection. A warning of an unknown kind is dropped; a proposal that fails any check
// (an unknown outcome among them) is skipped and the rest of the list is kept; a message of an unknown type, or a
// resolved with an unknown outcome, is ignored. None of these counts as an invalid message (register.ts).
import {
  CATEGORIES,
  LADDER_STEPS,
  MAX_PAYLOAD_CHARS,
  MAX_QUESTION_CHARS,
  MESSAGE_VERSION,
} from '@sieve/shared';
import type {
  AutoWait,
  Category,
  CategoryRule,
  ItemKind,
  LadderStep,
  PageToExtension,
  PreparingPreview,
  ProposalOutcome,
  ProposalPreview,
  RequesterRef,
  StepOption,
  Warning,
  WarningKind,
} from '@sieve/shared';
import { SURFACES } from './internal';
import type { PanelToWorker, Preview } from './internal';

export const LIMITS = {
  maxMessageChars: 512 * 1024, // JSON.stringify(msg).length
  maxProposals: 20,
  maxWarnings: 12,
  maxWarningChars: 300,
  maxTitleChars: 300,
  maxAiNameChars: 80,
  maxAppVersionChars: 40,
  maxReasonChars: 200,
  maxGrantIdChars: 128,
  requestId: /^[A-Za-z0-9_-]{1,128}$/,
  textHash: /^[A-Za-z0-9_-]{1,64}$/, // the page's hash of a preview's option texts, echoed, never computed here
} as const;

export const IN_APP_AI_NAME = 'Gemini (in Sieve)';

// Local enum lists. `satisfies` breaks the build when a value leaves the contract; the Exhaustive checks below
// break it when the contract gains a value these lists do not have.
export const ITEM_KINDS = ['email', 'document', 'photo', 'note'] as const satisfies readonly ItemKind[];
export const RULES = ['approve', 'ask-first', 'never'] as const satisfies readonly CategoryRule[];
export const OUTCOMES = [
  'ready', 'blocked-never', 'no-match', 'unsupported', 'needs-cloud-consent', 'model-unavailable', 'error',
] as const satisfies readonly ProposalOutcome[];
export const WARNING_KINDS = [
  'ask-first', 'injection', 'hidden-text-removed', 'pii-redacted', 'pii-check-limited', 'cloud-fallback',
  'sample-data-cloud', 'unverified-answer', 'source-unchecked',
] as const satisfies readonly WarningKind[];
export const RESOLVED_OUTCOMES = ['approved', 'declined', 'expired', 'error'] as const;
export const AUTO_WAIT_KINDS = ['file', 'excerpt', 'full', 'consent', 'no-answer', 'check'] as const satisfies readonly AutoWait[];
export const PREPARING_WAITS = ['click', 'hidden'] as const satisfies readonly NonNullable<PreparingPreview['wait']>[];
export const PAGE_MESSAGE_TYPES = ['sieve/hello', 'sieve/pending', 'sieve/resolved'] as const satisfies readonly PageToExtension['type'][];

type Exhaustive<T, A extends readonly T[]> = [Exclude<T, A[number]>] extends [never] ? true : never;
const _allKinds: Exhaustive<ItemKind, typeof ITEM_KINDS> = true;
const _allRules: Exhaustive<CategoryRule, typeof RULES> = true;
const _allOutcomes: Exhaustive<ProposalOutcome, typeof OUTCOMES> = true;
const _allWarnings: Exhaustive<WarningKind, typeof WARNING_KINDS> = true;
const _allTypes: Exhaustive<PageToExtension['type'], typeof PAGE_MESSAGE_TYPES> = true;
const _allAutoWaits: Exhaustive<AutoWait, typeof AUTO_WAIT_KINDS> = true;

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function str(v: unknown, min: number, max: number): v is string {
  return typeof v === 'string' && v.length >= min && v.length <= max;
}

function int(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function isRequestId(v: unknown): v is string {
  return typeof v === 'string' && LIMITS.requestId.test(v);
}

export function isLadderStep(v: unknown): v is LadderStep {
  return oneOf(LADDER_STEPS, v);
}

function parseRequester(v: unknown): RequesterRef | null {
  if (!isObject(v)) return null;
  if (v.kind === 'in-app') return v.aiName === IN_APP_AI_NAME ? { kind: 'in-app', aiName: IN_APP_AI_NAME } : null;
  if (v.kind === 'outside') {
    if (!str(v.grantId, 1, LIMITS.maxGrantIdChars) || !str(v.aiName, 1, LIMITS.maxAiNameChars)) return null;
    return { kind: 'outside', grantId: v.grantId, aiName: v.aiName };
  }
  return null;
}

function parseItem(v: unknown): ProposalPreview['item'] | null {
  if (!isObject(v)) return null;
  if (!str(v.title, 1, LIMITS.maxTitleChars)) return null;
  if (!oneOf(ITEM_KINDS, v.kind) || !oneOf<Category>(CATEGORIES, v.category)) return null;
  if (typeof v.date !== 'number' || !Number.isFinite(v.date) || v.date <= 0) return null;
  return { title: v.title, kind: v.kind, category: v.category, date: v.date };
}

function parseOption(v: unknown, step: LadderStep): StepOption | null {
  if (!isObject(v) || v.step !== step) return null;
  if (!str(v.text, 0, MAX_PAYLOAD_CHARS)) return null;
  if (!int(v.chars, 0, MAX_PAYLOAD_CHARS) || !int(v.redactions, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (typeof v.available !== 'boolean') return null;
  const option: StepOption = { step, text: v.text, chars: v.chars, redactions: v.redactions, available: v.available };
  if (v.unavailableReason !== undefined) {
    if (!str(v.unavailableReason, 0, LIMITS.maxReasonChars)) return null;
    if (v.unavailableReason.length > 0) option.unavailableReason = v.unavailableReason;
  }
  return option;
}

export function isTextHash(v: unknown): v is string {
  return typeof v === 'string' && LIMITS.textHash.test(v);
}

/** A warning; 'unknown' for a kind this build does not know (dropped, the proposal stays); null when malformed. */
function parseWarning(v: unknown): Warning | 'unknown' | null {
  if (!isObject(v)) return null;
  if (!oneOf(WARNING_KINDS, v.kind)) return typeof v.kind === 'string' ? 'unknown' : null;
  if (!str(v.message, 1, LIMITS.maxWarningChars)) return null;
  return { kind: v.kind, message: v.message };
}

/** One ProposalPreview (with the page's text hash when it sent one), or null. */
export function parsePreview(raw: unknown): Preview | null {
  if (!isObject(raw)) return null;
  if (!isRequestId(raw.requestId)) return null;
  const requester = parseRequester(raw.requester);
  if (!requester) return null;
  if (!str(raw.question, 1, MAX_QUESTION_CHARS)) return null;
  if (!isLadderStep(raw.requestedStep) || !isLadderStep(raw.maxStep)) return null;
  let item: ProposalPreview['item'] | undefined;
  if (raw.item !== undefined) {
    const parsed = parseItem(raw.item);
    if (!parsed) return null;
    item = parsed;
  }
  if (!Array.isArray(raw.options) || raw.options.length !== LADDER_STEPS.length) return null;
  const options: StepOption[] = [];
  for (const [i, step] of LADDER_STEPS.entries()) {
    const option = parseOption(raw.options[i], step);
    if (!option) return null;
    options.push(option);
  }
  if (!oneOf(RULES, raw.rule)) return null;
  if (!Array.isArray(raw.warnings) || raw.warnings.length > LIMITS.maxWarnings) return null;
  const warnings: Warning[] = [];
  for (const w of raw.warnings) {
    const parsed = parseWarning(w);
    if (!parsed) return null;
    if (parsed !== 'unknown') warnings.push(parsed);
  }
  if (!oneOf(OUTCOMES, raw.outcome)) return null;
  if (raw.textHash !== undefined && !isTextHash(raw.textHash)) return null;
  // why auto-approve did not send it (since Nov 23); a value this build does not know is left out
  const autoWaits = oneOf(AUTO_WAIT_KINDS, raw.autoWaits) ? raw.autoWaits : undefined;
  return {
    requestId: raw.requestId,
    requester,
    question: raw.question,
    requestedStep: raw.requestedStep,
    maxStep: raw.maxStep,
    ...(item ? { item } : {}),
    options,
    rule: raw.rule,
    warnings,
    outcome: raw.outcome,
    ...(isTextHash(raw.textHash) ? { textHash: raw.textHash } : {}),
    ...(autoWaits ? { autoWaits } : {}),
  };
}

/** One request being prepared (since Nov 23), or null; an unknown `wait` is left out. */
export function parsePreparing(raw: unknown): PreparingPreview | null {
  if (!isObject(raw) || !isRequestId(raw.requestId)) return null;
  if (!str(raw.aiName, 1, LIMITS.maxAiNameChars) || !str(raw.question, 1, MAX_QUESTION_CHARS)) return null;
  if (raw.label !== undefined && !str(raw.label, 0, LIMITS.maxReasonChars)) return null;
  if (!int(raw.elapsedMs, 0, Number.MAX_SAFE_INTEGER)) return null;
  return {
    requestId: raw.requestId,
    aiName: raw.aiName,
    question: raw.question,
    ...(typeof raw.label === 'string' && raw.label.length > 0 ? { label: raw.label } : {}),
    elapsedMs: raw.elapsedMs,
    ...(raw.auto === true ? { auto: true as const } : {}),
    ...(oneOf(PREPARING_WAITS, raw.wait) ? { wait: raw.wait } : {}),
  };
}

function serializedLength(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * What one page message is: a message to act on ('message', with the count of proposals skipped from a pending
 * list), a well-formed message this build does not know ('unknown': ignored, not counted), or 'invalid' (counted
 * toward MAX_INVALID).
 */
export type PageMessageRead =
  | { kind: 'message'; msg: PageToExtension; skipped: number }
  | { kind: 'unknown' }
  | { kind: 'invalid' };

const INVALID: PageMessageRead = { kind: 'invalid' };
const UNKNOWN: PageMessageRead = { kind: 'unknown' };

export function readPageMessage(raw: unknown): PageMessageRead {
  if (!isObject(raw) || raw.version !== MESSAGE_VERSION || typeof raw.type !== 'string') return INVALID;
  if (serializedLength(raw) > LIMITS.maxMessageChars) return INVALID;
  if (!oneOf(PAGE_MESSAGE_TYPES, raw.type)) return UNKNOWN; // a type a newer page sends: ignore it
  const ok = (msg: PageToExtension, skipped = 0): PageMessageRead => ({ kind: 'message', msg, skipped });
  switch (raw.type) {
    case 'sieve/hello':
      if (typeof raw.homeBase !== 'boolean' || !str(raw.appVersion, 1, LIMITS.maxAppVersionChars)) return INVALID;
      return ok({ type: 'sieve/hello', version: MESSAGE_VERSION, homeBase: raw.homeBase, appVersion: raw.appVersion });
    case 'sieve/pending': {
      if (!Array.isArray(raw.proposals) || raw.proposals.length > LIMITS.maxProposals) return INVALID;
      const proposals: Preview[] = [];
      const ids = new Set<string>();
      let skipped = 0;
      for (const p of raw.proposals) {
        const parsed = parsePreview(p);
        // A proposal this build cannot read, or a second one with the same id, is left out; the rest still show.
        if (!parsed || ids.has(parsed.requestId)) {
          skipped += 1;
          continue;
        }
        ids.add(parsed.requestId);
        proposals.push(parsed);
      }
      // Since Nov 23: the requests being prepared, and Gmail access running out. A list that cannot be read is left out,
      // and the proposals still count.
      const preparing: PreparingPreview[] = [];
      if (Array.isArray(raw.preparing) && raw.preparing.length <= LIMITS.maxProposals) {
        for (const p of raw.preparing) {
          const parsed = parsePreparing(p);
          if (parsed && !preparing.some((x) => x.requestId === parsed.requestId)) preparing.push(parsed);
        }
      }
      return ok(
        {
          type: 'sieve/pending',
          version: MESSAGE_VERSION,
          proposals,
          ...(preparing.length > 0 ? { preparing } : {}),
          ...(raw.gmail === 'ended' ? { gmail: 'ended' as const } : {}),
        },
        skipped,
      );
    }
    case 'sieve/resolved':
      if (!isRequestId(raw.requestId) || typeof raw.outcome !== 'string') return INVALID;
      // An outcome a newer page sends: the request left the waiting state, and its next pending list says so.
      if (!oneOf(RESOLVED_OUTCOMES, raw.outcome)) return UNKNOWN;
      return ok({
        type: 'sieve/resolved',
        version: MESSAGE_VERSION,
        requestId: raw.requestId,
        outcome: raw.outcome,
        ...(str(raw.message, 1, LIMITS.maxWarningChars) ? { message: raw.message } : {}),
      });
  }
}

/** One PageToExtension message, or null when there is nothing to act on (invalid or unknown). */
export function parsePageMessage(raw: unknown): PageToExtension | null {
  const read = readPageMessage(raw);
  return read.kind === 'message' ? read.msg : null;
}

/** A message from the extension's own panel page, popup or side panel (50 section 8.1), or null. */
export function parsePanelMessage(raw: unknown): PanelToWorker | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'panel/hello':
      if (typeof raw.visible !== 'boolean') return null;
      return {
        type: 'panel/hello',
        visible: raw.visible,
        ...(typeof raw.windowId === 'number' && Number.isInteger(raw.windowId) ? { windowId: raw.windowId } : {}),
        ...(oneOf(SURFACES, raw.surface) ? { surface: raw.surface } : {}),
      };
    case 'panel/visibility':
      return typeof raw.visible === 'boolean' ? { type: 'panel/visibility', visible: raw.visible } : null;
    case 'panel/ping':
      return { type: 'panel/ping' };
    case 'panel/decide':
      if (!isRequestId(raw.requestId) || typeof raw.approved !== 'boolean') return null;
      if (raw.step !== undefined && !isLadderStep(raw.step)) return null;
      if (raw.textHash !== undefined && !isTextHash(raw.textHash)) return null;
      return {
        type: 'panel/decide',
        requestId: raw.requestId,
        approved: raw.approved,
        ...(isLadderStep(raw.step) ? { step: raw.step } : {}),
        ...(isTextHash(raw.textHash) ? { textHash: raw.textHash } : {}),
      };
    case 'panel/open-app':
      if (raw.requestId !== undefined && !isRequestId(raw.requestId)) return null;
      return { type: 'panel/open-app', ...(isRequestId(raw.requestId) ? { requestId: raw.requestId } : {}) };
    case 'panel/dismiss':
      return isRequestId(raw.requestId) ? { type: 'panel/dismiss', requestId: raw.requestId } : null;
    case 'panel/open-side':
      return { type: 'panel/open-side' };
    default:
      return null;
  }
}
