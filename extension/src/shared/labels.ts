// Panel copy (50 section 8.4, final), step labels and the date format. Ladder labels and warning titles come from
// @sieve/shared so the panel uses exactly the app's words (01 section 11.7).
import { LADDER_LABELS, LADDER_STEPS, warningTitle } from '@sieve/shared';
import type { Category, LadderStep, ProposalOutcome, RequesterRef, Warning } from '@sieve/shared';
import type { ConnectionState, DecideRejection, ResolvedEntry } from './internal';

export const COPY = {
  status: {
    connected: 'Home base online',
    'not-home-base': 'Sieve tab open',
    connecting: 'Connecting…',
    disconnected: 'Home base offline',
  } satisfies Record<ConnectionState, string>,
  connecting: 'Connecting to your Sieve tab…',
  disconnected: {
    heading: "Sieve isn't open",
    body: 'Requests reach this panel from your Sieve tab on this computer. Open Sieve in a tab and keep it open.',
  },
  empty: {
    heading: 'No requests waiting',
    body: 'When an AI assistant you connected asks Sieve for something, it shows up here for you to approve.',
  },
  requestHeading: 'A request is waiting',
  ladderLabel: 'How much to share',
  outgoingLabel: 'Exactly what will be sent',
  cleanTag: 'No hidden instructions flagged on this device',
  approve: 'Approve',
  deny: 'Deny',
  sending: 'Sending…',
  slowNote: 'Still waiting for your Sieve tab to confirm. Open Sieve to check.',
  sourceFootnote: 'This preview came from your Sieve tab on this computer, not through the server.',
  openSieve: 'Open Sieve',
  keepOpen: 'Keep open on the side',
  done: 'Done',
  recent: 'Recent',
  receiptShared: 'Receipt saved in "What has AI seen?"',
  receiptDeclined: 'Receipt saved: declined',
  stepUnavailable: "That step isn't available for this request.",
  openReceipt: 'Open the receipt',
} as const;

/** The result heading after an approval from this panel (board F8B): "Sent 41 characters to Gemini CLI". The name
 *  sits at the end so the card can isolate it (<bdi>); the count is known only to the panel that approved. */
export const SENT_HEADING = {
  before: 'Sent ',
  after: ' characters to ',
} as const;

export function sentHeading(chars: number, aiName: string): string {
  return `${SENT_HEADING.before}${chars.toLocaleString('en-US')}${SENT_HEADING.after}${aiName}`;
}

/** Text for a step button: "Answer only", "Excerpt", "Full item". */
export function stepLabel(step: LadderStep): string {
  return LADDER_LABELS[step];
}

export function stepIndex(step: LadderStep): number {
  return LADDER_STEPS.indexOf(step);
}

/** The name shown for a requester: the outside assistant's name, or "Sieve" for an in-app request. */
export function requesterName(r: RequesterRef): string {
  return r.kind === 'outside' ? r.aiName : 'Sieve';
}

/** 70 R-MCP-09, above the decision buttons; the name sits between the two parts so the card can isolate it (<bdi>). */
export const APPROVE_ONLY_IF_ASKED = {
  before: 'Approve only if you asked ',
  after: " for this. If you didn't, deny it and turn off this connection in Settings.",
} as const;

export function approveOnlyIfAsked(aiName: string): string {
  return `${APPROVE_ONLY_IF_ASKED.before}${aiName}${APPROVE_ONLY_IF_ASKED.after}`;
}

/** "Mar 3", with the year when it is not the current year (50 section 8.4). */
export function formatDate(epochMs: number, now: number = Date.now()): string {
  const d = new Date(epochMs);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** "{date} · {category} · found on this device" */
export function itemMeta(item: { date: number; category: Category }, now?: number): string {
  return `${formatDate(item.date, now)} · ${item.category} · found on this device`;
}

/** "{chars} characters" plus " · {redactions} redacted" when there are redactions. */
export function outgoingMeta(chars: number, redactions: number): string {
  const base = `${chars.toLocaleString('en-US')} characters`;
  return redactions > 0 ? `${base} · ${redactions.toLocaleString('en-US')} redacted` : base;
}

export function ruleTag(rule: 'ask-first' | 'never', category: Category): string {
  return rule === 'ask-first' ? `${category} asks first` : `${category} is never shared`;
}

export function alsoWaitingHeading(n: number): string {
  return `Also waiting (${n})`;
}

export function newRequestAnnouncement(aiName: string): string {
  // Isolate the name so right-to-left names do not reorder the sentence (70 R-UI-05).
  return `New request from ⁨${aiName}⁩`;
}

/** Heading and body for a proposal whose outcome is not 'ready'. */
export function outcomeCopy(outcome: Exclude<ProposalOutcome, 'ready'>, category?: Category): { heading: string; body: string } {
  switch (outcome) {
    case 'blocked-never':
      return { heading: 'Blocked by your rules', body: `${category ?? 'This category'} is never shared. Nothing left this device.` };
    case 'no-match':
      return {
        heading: 'Nothing found',
        body: 'Sieve found nothing on this device that answers this. Deny to tell the assistant, or open Sieve to look yourself.',
      };
    case 'needs-cloud-consent':
      return {
        heading: 'Needs your OK for the cloud',
        body: 'This Chrome has no on-device model, so this request needs the cloud. Decide in Sieve, where you can see exactly what goes.',
      };
    case 'model-unavailable':
      return { heading: "Sieve can't read this yet", body: "The on-device model isn't ready. Open Sieve to see its status." };
    case 'error':
      return { heading: 'Something went wrong', body: "Sieve couldn't prepare this request. Open Sieve to see what happened." };
  }
}

export type ResultTone = 'cloud' | 'muted';

/** Heading, body and optional tag for a resolved request (50 section 8.4). */
export function resultCopy(r: Pick<ResolvedEntry, 'outcome' | 'decidedHere' | 'step'>): {
  heading: string;
  body: string;
  tag?: { text: string; tone: ResultTone };
} {
  switch (r.outcome) {
    case 'approved':
      return {
        heading: 'Shared',
        body: r.decidedHere && r.step
          ? `Sent: ${stepLabel(r.step).toLowerCase()}. Nothing else left this device.`
          : 'Approved in the Sieve app.',
        tag: { text: COPY.receiptShared, tone: 'cloud' },
      };
    case 'declined':
      return {
        heading: 'Declined',
        body: 'Nothing left this device. The assistant was told you declined.',
        tag: { text: COPY.receiptDeclined, tone: 'muted' },
      };
    case 'expired':
      return { heading: 'Expired', body: 'This request ran out of time before it was approved. Nothing was shared.' };
    case 'error':
      return { heading: 'Not sent', body: "Sieve couldn't finish this request. Nothing was sent. Open Sieve to see what happened." };
    case 'lost':
      return { heading: 'Not confirmed', body: 'Your Sieve tab closed before it confirmed. Open Sieve to check this request.' };
  }
}

/** The message shown when the worker refuses a decision; null when no message is needed. */
export function rejectionCopy(reason: DecideRejection): string | null {
  switch (reason) {
    case 'step-unavailable':
      return COPY.stepUnavailable;
    case 'unknown-request':
    case 'not-ready':
      return 'This request is no longer waiting.';
    case 'no-owner':
      return 'Your Sieve tab disconnected. Open Sieve to check.';
    case 'already-sent':
      return null;
  }
}

export type WarningTone = 'warn' | 'cloud';

export function warningTone(kind: Warning['kind']): WarningTone {
  return kind === 'cloud-fallback' || kind === 'sample-data-cloud' ? 'cloud' : 'warn';
}

/** The shared warning title for a kind, or null when the app gives it none (the message stands alone). */
export function warningHeading(w: Warning, category?: Category): string | null {
  return warningTitle(w.kind, category);
}
