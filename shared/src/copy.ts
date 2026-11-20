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
