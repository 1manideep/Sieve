// Approval copy shared by the web app and the extension, so both use exactly the same words.
// Owner: docs/spec/40-web-app.md (01 section 11.7, 40 CR-7). Every string here is quoted in 40; add new ones there first.
import type { Category, ItemKind, LadderStep, WarningKind } from './types';

/** Step names, as in the "Default step" setting and the approve trace step (40 sections 12.3 and 13.8.5). */
export const LADDER_LABELS: Readonly<Record<LadderStep, string>> = {
  answer: 'Answer only',
  excerpt: 'Excerpt',
  full: 'Full item',
};

/** The noun for each item kind, used in "Full email" and "the full email". */
export const KIND_NOUNS: Readonly<Record<ItemKind, string>> = {
  email: 'email',
  document: 'document',
  photo: 'photo',
  note: 'note',
};

/** "Full email", "Full photo"; "Full item" when the kind is unknown. */
export function fullStepLabel(kind?: ItemKind): string {
  return kind ? `Full ${KIND_NOUNS[kind]}` : LADDER_LABELS.full;
}

/** Ladder segment labels (40 section 16.3): "1 · Answer only", "2 · Excerpt", "3 · Full email". */
export function ladderSegmentLabel(step: LadderStep, kind?: ItemKind): string {
  switch (step) {
    case 'answer':
      return `1 · ${LADDER_LABELS.answer}`;
    case 'excerpt':
      return `2 · ${LADDER_LABELS.excerpt}`;
    case 'full':
      return `3 · ${fullStepLabel(kind)}`;
  }
}

/**
 * What was shared, as a phrase (40 section 11.8): "the answer", "an excerpt", "the full email";
 * with related items, " from {n} items" is added.
 */
export function stepPhrase(step: LadderStep, kind: ItemKind | undefined, itemCount: number): string {
  const base =
    step === 'answer' ? 'the answer' : step === 'excerpt' ? 'an excerpt' : `the full ${kind ? KIND_NOUNS[kind] : 'item'}`;
  return itemCount > 1 ? `${base} from ${itemCount} items` : base;
}

/**
 * Warning titles (40 section 16.6). `{Category}` is filled by warningTitle().
 * null: 40 has not given this kind a title yet; show the warning message on its own.
 */
export const WARNING_TITLES: Readonly<Record<WarningKind, string | null>> = {
  'injection': 'Possible instruction aimed at an AI',
  'hidden-text-removed': 'Hidden text removed before any model read it',
  'ask-first': '{Category} asks first',
  'cloud-fallback': 'Uses the cloud model',
  'sample-data-cloud': 'Sample data ran in the cloud',
  'pii-redacted': 'Personal details hidden',
  'pii-check-limited': null,
  'unverified-answer': null,
  'source-unchecked': null,
};

/** The display order of warnings in a list (40 section 16.6), followed by the kinds without a title yet. */
export const WARNING_ORDER: readonly WarningKind[] = [
  'injection',
  'hidden-text-removed',
  'ask-first',
  'cloud-fallback',
  'sample-data-cloud',
  'pii-redacted',
  'pii-check-limited',
  'unverified-answer',
  'source-unchecked',
];

export function warningTitle(kind: WarningKind, category?: Category): string | null {
  const title = WARNING_TITLES[kind];
  if (title === null) return null;
  return title.replace('{Category}', category ?? 'This category');
}

/** Decision result lines shown after a relay request ends (40 section 16.14, RelayResult). */
export const RESULT_LINES = {
  sent: (v: { aiName: string; stepPhrase: string }) => `Sent ${v.stepPhrase} to ${v.aiName}. Receipt saved.`,
  declined: (v: { aiName: string }) => `Denied. ${v.aiName} was told you declined.`,
  blocked: (v: { aiName: string; category: Category }) =>
    `${v.category} is never shared, so Sieve told ${v.aiName} no. Nothing left this device, and no model read the item.`,
  noMatch: (v: { aiName: string }) => `Nothing on this device matched, so Sieve told ${v.aiName} it found nothing.`,
  error: (v: { aiName: string }) =>
    `Sieve couldn't prepare an answer, so it told ${v.aiName} to try again later. Nothing was shared.`,
  expired: () => 'This request expired before you answered it. Nothing was sent.',
  revoked: (v: { aiName: string }) => `${v.aiName}'s connection was revoked, so this request was cancelled.`,
} as const;

export type ResultLineKind = keyof typeof RESULT_LINES;

/**
 * While a request is prepared (40 sections 12.4 and 13.5, 50 section 8.4): how long since it was asked, what is
 * usual, what happens next, and why it may be slow. The app's Requests card and the extension use the same words.
 */
export const WAITING = {
  asked: (time: string) => `Asked ${time} ago. Answers usually take 20 seconds to a minute.`,
  nextApprove: "You'll be asked to approve before anything is sent.",
  nextAuto: 'Auto-approve is on: the answer goes out without asking you.',
  busy: 'Taking longer than usual. The computer may be busy. Keep the Sieve tab open: it goes on by itself.',
  hidden: 'The Sieve tab is in the background, so Chrome may slow the on-device model. Bring it to the front and keep it open.',
  click: 'Sieve needs one click in its tab before the on-device model can start.',
} as const;

/** Past this, a preparation is slower than usual and the busy line shows. */
export const WAITING_SLOW_MS = 60_000;

/** "12 seconds", "1 second", "1 min 5 s", for the waiting lines. */
export function waitTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s === 1 ? '1 second' : `${s} seconds`;
  return s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * Why a request waits for the person although auto-approve is on for its connection (40 section 13.8.9): it covers
 * one-sentence answers that pass every check, and nothing else. The extension shows the same line.
 */
export type AutoWait = 'file' | 'excerpt' | 'full' | 'consent' | 'no-answer' | 'check';

export const AUTO_WAITS: Readonly<Record<AutoWait, string>> = {
  file: 'This asks for the file itself, so it waits for you.',
  excerpt: 'This asks for an excerpt, so it waits for you.',
  full: 'This asks for the whole item, so it waits for you.',
  consent: 'This needs your OK before the cloud model reads it, so it waits for you.',
  'no-answer': 'There is no one-sentence answer to send, so it waits for you.',
  check: "This answer didn't pass a check before sending, so it waits for you.",
};

/** "Auto-approve covers one-sentence answers. This asks for the file itself, so it waits for you." */
export function autoWaitLine(why: AutoWait): string {
  return `Auto-approve covers one-sentence answers. ${AUTO_WAITS[why]}`;
}
