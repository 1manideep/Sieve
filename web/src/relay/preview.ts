// Previews for the extension (40 section 11.10, 50 section 6.4, 01 section 6) and the composed options the app shows.
// The extension gets the main item's three options only: it approves the main item only (01 section 6), so what it
// shows is exactly what it can send. Never record ids, `from`, `related`, `trace` or images.
import {
  LADDER_STEPS,
  MAX_PAYLOAD_CHARS,
  WARNING_ORDER,
  type LadderStep,
  type ProposalPreview,
  type StepOption,
  type Warning,
} from '@sieve/shared';
import type { composeOutgoingText } from '@/pipeline';
import type { PendingEntry } from '@/state/homeBase';
import { PREVIEW_COPY } from '@/copy/strings';
import { truncateGraphemes } from '@/robust/question';
import { MAX_PENDING_MESSAGE_CHARS, MAX_PREVIEWS } from './constants';

type Compose = typeof composeOutgoingText;

/** 50 section 6.6 limits, applied before sending so one long subject cannot poison the list (70 R-RLY-12). */
export const PREVIEW_LIMITS = { title: 300, warnings: 12, warning: 300, reason: 200, aiName: 80, question: 500 } as const;

/** The longest prefix of whole graphemes within `max` UTF-16 units (70 R-EMO-04: one shared helper). */
export { truncateGraphemes };

function stepIndex(step: LadderStep): number {
  return LADDER_STEPS.indexOf(step);
}

/**
 * The option the app shows for `step`: the main option alone, or the main option composed with every ticked related
 * item (CR-3 composeOutgoingText is the only builder of that text).
 */
export function composedOption(entry: PendingEntry, step: LadderStep, compose: Compose): StepOption {
  const options = entry.proposal?.options ?? [];
  const main = options[stepIndex(step)];
  if (!main) {
    return { step, text: '', chars: 0, redactions: 0, available: false, unavailableReason: PREVIEW_COPY.notAvailable };
  }
  if (entry.relatedSelected.length === 0) return main;
  const related = entry.relatedSelected.map((id) => entry.relatedOptions[id]?.[stepIndex(step)]);
  const parts = [main, ...related.filter((o): o is StepOption => o !== undefined)];
  const text = compose(parts);
  const chars = text.length;
  const missing = related.some((o) => o === undefined);
  const firstFailing = [main, ...related].find((o) => !o || !o.available);
  const available = main.available && !missing && related.every((o) => o?.available === true) && chars <= MAX_PAYLOAD_CHARS;
  const option: StepOption = {
    step,
    text,
    chars,
    redactions: parts.reduce((n, o) => n + o.redactions, 0),
    available,
  };
  if (!available) {
    option.unavailableReason = firstFailing
      ? (firstFailing.unavailableReason ?? PREVIEW_COPY.notAvailable)
      : chars > MAX_PAYLOAD_CHARS
        ? PREVIEW_COPY.tooLong
        : PREVIEW_COPY.notAvailable;
  }
  return option;
}

function previewOption(o: StepOption): StepOption {
  const out: StepOption = { step: o.step, text: o.text, chars: o.chars, redactions: o.redactions, available: o.available };
  if (o.unavailableReason) out.unavailableReason = truncateGraphemes(o.unavailableReason, PREVIEW_LIMITS.reason);
  return out;
}

function orderedWarnings(list: Warning[]): Warning[] {
  const rank = (w: Warning) => {
    const i = WARNING_ORDER.indexOf(w.kind);
    return i === -1 ? WARNING_ORDER.length : i;
  };
  return [...list]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, PREVIEW_LIMITS.warnings)
    .map((w) => ({ kind: w.kind, message: truncateGraphemes(w.message, PREVIEW_LIMITS.warning) }))
    .filter((w) => w.message.length > 0);
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The fields toPreview does not clamp, checked as the extension's parsePreview checks them (50 section 6.6, 70 R-RLY-12). */
function sendable(p: ProposalPreview): boolean {
  return REQUEST_ID.test(p.requestId) && p.question.length >= 1 && (!p.item || (p.item.title.length >= 1 && Number.isFinite(p.item.date) && p.item.date > 0));
}

/** One preview for one entry in phase 'awaiting-person' (null when the entry has no proposal). */
export function toPreview(entry: PendingEntry): ProposalPreview | null {
  const p = entry.proposal;
  if (!p) return null;
  const requester =
    p.requester.kind === 'outside'
      ? { kind: 'outside' as const, grantId: p.requester.grantId, aiName: truncateGraphemes(p.requester.aiName, PREVIEW_LIMITS.aiName) }
      : { kind: 'in-app' as const, aiName: 'Gemini (in Sieve)' as const };
  const preview: ProposalPreview = {
    requestId: p.requestId,
    requester,
    question: truncateGraphemes(p.question, PREVIEW_LIMITS.question),
    requestedStep: p.requestedStep,
    maxStep: p.maxStep,
    options: LADDER_STEPS.map((step, i) => previewOption(p.options[i] ?? { step, text: '', chars: 0, redactions: 0, available: false })),
    rule: p.rule,
    warnings: orderedWarnings(p.warnings),
    outcome: p.outcome,
  };
  if (p.item) {
    const title = truncateGraphemes(p.item.title, PREVIEW_LIMITS.title) || PREVIEW_COPY.untitled;
    preview.item = { title, kind: p.item.kind, category: p.item.category, date: p.item.date };
  }
  return preview;
}

/** The full list for sieve/pending: outside requests waiting for the person, oldest first, at most 20. */
export function pendingPreviews(entries: PendingEntry[]): { previews: ProposalPreview[]; ids: Record<string, string[]> } {
  const waiting = entries
    .filter((e) => e.phase === 'awaiting-person' && e.proposal && e.proposal.requester.kind === 'outside')
    .sort((a, b) => (a.proposal?.createdAt ?? 0) - (b.proposal?.createdAt ?? 0))
    .slice(0, MAX_PREVIEWS);
  const previews: ProposalPreview[] = [];
  const ids: Record<string, string[]> = {};
  for (const e of waiting) {
    try {
      const preview = toPreview(e);
      if (!preview) continue;
      if (!sendable(preview)) {
        console.error('preview dropped', e.requestId);
        continue;
      }
      previews.push(preview);
      ids[e.requestId] = e.proposal?.item ? [e.proposal.item.recordId] : [];
    } catch {
      console.error('preview dropped', e.requestId);
    }
  }
  // Keep the whole message under the extension's size limit: drop the newest until it fits.
  while (previews.length > 0 && JSON.stringify(previews).length > MAX_PENDING_MESSAGE_CHARS) {
    const dropped = previews.pop();
    if (dropped) delete ids[dropped.requestId];
  }
  return { previews, ids };
}
