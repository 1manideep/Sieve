// Every trace label, running label and warning message of the pipeline (10 sections 12.6 and 12.7, 70 R-MDL-07,
// R-IN-18, 01 section 11.8). Plain English, short sentences, no em dashes.
import type { Category, Candidate, IndexRecord, ItemKind, LadderStep, Warning } from '@sieve/shared';
import { countNoun } from '@/ai';

export const STEP_LABEL: Record<LadderStep, string> = { answer: 'answer only', excerpt: 'excerpt', full: 'full item' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "email", "photo", "file" or "item" for one record. */
export function kindNoun(kind: ItemKind): string {
  return kind === 'email' ? 'email' : kind === 'photo' ? 'photo' : kind === 'document' ? 'file' : 'item';
}

const METHOD_NAMES: [Candidate['matchedBy'], string][] = [
  ['vector', 'meaning search'],
  ['keyword', 'keyword search'],
  ['caption', 'photo captions'],
  ['gmail-search', 'Gmail search'],
];

export const RUNNING = {
  retrieve: 'Searching this device…',
  fresh: 'Checking the item is still there…',
  pii: 'Masking personal details on this device…',
  // 11 section 10.7: Gemini Nano reads the text that would leave, once per text (cached on the item)
  injectionCheck: 'Checking for hidden instructions…',
  piiCheck: 'Checking for personal details…',
  draft: 'Drafting in the cloud from the approved text…',
  selectDevice: (records: Pick<IndexRecord, 'kind'>[]) => `Reading ${countNoun(records)} on this device…`,
  selectCloudSample: (records: Pick<IndexRecord, 'kind'>[]) => {
    const [n, ...rest] = countNoun(records).split(' ');
    return `Reading ${n} sample ${rest.join(' ')} in the cloud…`;
  },
  selectCloudOwn: (records: Pick<IndexRecord, 'kind'>[]) => `Reading ${countNoun(records)} in the cloud (you allowed it)…`,
};

export const LABELS = {
  retrieveFound(candidates: Candidate[], ms: number): string {
    if (candidates.length === 0) return `Found nothing that matches on this device (${ms} ms)`;
    const used = new Set(candidates.map((c) => c.matchedBy));
    const methods = METHOD_NAMES.filter(([m]) => used.has(m)).map(([, name]) => name).join(' and ');
    return `Found ${candidates.length} likely ${candidates.length === 1 ? 'match' : 'matches'} on this device in ${ms} ms (${methods})`;
  },
  gmailSearch: "Gmail's own search was asked too (your search words went to Google, as with any Gmail search)",
  spellingFixed: (corrected: string) => `Searched for "${corrected}" (spelling fixed on this device)`,
  ambiguousDate: (text: string, as: string) => `Read "${text}" as ${as}. It could mean another date; check the result.`,
  ruleNever: (category: Category, n: number) =>
    `${plural(n, `${category} item`, `${category} items`)} never shared, stopped before any model read ${n === 1 ? 'it' : 'them'}`,
  ruleGrant: (n: number, aiName: string) => `${plural(n, 'item', 'items')} outside what ${aiName} may ask about`,
  ruleBlocked: (n: number, aiName: string) => `${plural(n, 'item', 'items')} you blocked for ${aiName}`,
  ruleSource: (n: number, aiName: string) => `${plural(n, 'item', 'items')} from sources ${aiName} may not use`,
  ruleStale: (n: number) => `${plural(n, 'stale search entry', 'stale search entries')} skipped`,
  freshChecked: (kind: ItemKind) => `Checked that the ${kindNoun(kind)} is still there`,
  freshGone: (kind: ItemKind) => `That ${kindNoun(kind)} was deleted, so it was skipped`,
  freshChangedHolds: (kind: ItemKind) => `That ${kindNoun(kind)} changed since it was indexed. Sieve re-read it and the answer still holds`,
  freshChangedReread: (kind: ItemKind) => `That ${kindNoun(kind)} changed since it was indexed, so Sieve read it again`,
  freshKeptChanging: 'The items changed while Sieve was reading them. Ask again.',
  freshGmailFailed: "Couldn't check the email with Gmail, so nothing was prepared. Check your connection.",
  excerptChosen: 'Chose the exact lines from the item that hold the answer',
  excerptNone: "Couldn't find lines in the item that hold this answer, so the excerpt step is off",
  excerptUnsupported: (facts: string[]) => `. Check the answer: ${facts.join(', ')} ${facts.length === 1 ? 'is' : 'are'} not in the item`,
  clean: 'Plain code removed hidden text from this item when it was indexed',
  sortedAt: (category: Category, wherePhrase: string) => `Sorted as ${category} ${wherePhrase} when it was indexed`,
  injectionChecked: (wherePhrase: string, flagged: boolean) =>
    `Checked for instructions aimed at an AI ${wherePhrase} when it was indexed: ${flagged ? 'one flagged' : 'none found'}`,
  injectionNotRun: "The AI-instruction check hasn't run on this item yet. Hidden text was still removed by plain code.",
  masked: (r: number) => (r > 0 ? `Masked ${plural(r, 'personal detail', 'personal details')} on this device` : 'No personal details to mask'),
  approved: (step: LadderStep, itemCount: number) =>
    itemCount > 1 ? `You approved: ${STEP_LABEL[step]} from ${itemCount} items` : `You approved: ${STEP_LABEL[step]}`,
  declined: 'You declined: nothing was shared',
  invalid: 'The question is empty or longer than 500 characters.',
  overGrant: 'This asks for more than this AI may receive.',
  stopped: 'Stopped: the request was cancelled or expired.',
  noModelOwnOff: 'Stopped before any model ran: this Chrome has no on-device model, and cloud fallback for your own data is off.',
  notSetUpOwnOff: 'Stopped before any model ran: the on-device model is not set up yet, and cloud fallback for your own data is off.',
  consentNothingSent: 'Nothing sent: your own files never go to the cloud without your OK',
  crashed: 'Something went wrong while preparing this. Nothing was shared.',
};

export const WHERE_PHRASE = {
  device: 'on this device',
  cloud: 'in the cloud',
  code: 'by plain code',
  seed: 'before shipping (sample data)',
} as const;

function cutQuote(s: string, max = 120): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 3);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}...`;
}

export const WARNINGS = {
  askFirst: (category: Category): Warning => ({ kind: 'ask-first', message: `${category} asks first. Check the exact text before you share it.` }),
  notSorted: (): Warning => ({ kind: 'ask-first', message: "Sieve hasn't finished sorting this item yet, so it asks first." }),
  injection: (quote: string | undefined): Warning => ({
    kind: 'injection',
    message: quote
      ? `This item seems to contain an instruction aimed at an AI: "${cutQuote(quote)}". It can't trigger anything, and the answer step never forwards its words.`
      : "This item seems to contain an instruction aimed at an AI. It can't trigger anything, and the answer step never forwards its words.",
  }),
  hiddenRemoved: (): Warning => ({ kind: 'hidden-text-removed', message: 'Hidden text was removed from this item before any model read it.' }),
  piiRedacted: (): Warning => ({ kind: 'pii-redacted', message: 'Personal details are masked in the excerpt and full item.' }),
  cloudFallback: (): Warning => ({ kind: 'cloud-fallback', message: 'Gemini in the cloud read your own data for this request, because you allowed it.' }),
  sampleDataCloud: (): Warning => ({ kind: 'sample-data-cloud', message: 'This Chrome has no on-device model, so the sample data ran in the cloud.' }),
  unverified: (facts: string[]): Warning => ({
    kind: 'unverified-answer',
    message: `Check the answer: ${facts.join(', ')} ${facts.length === 1 ? 'is' : 'are'} not in the item. Share the exact lines if you're not sure.`,
  }),
  sourceUnchecked: (): Warning => ({
    kind: 'source-unchecked',
    message: "Sieve couldn't check that this email still exists; it used the copy on this computer.",
  }),
  action: (verb: string): Warning => ({
    kind: 'injection',
    message: `This asks Sieve to ${verb}. Sieve can't do that: it only finds things and shares what you approve.`,
  }),
};

export const UNAVAILABLE = {
  maxStep: (aiName: string, maxStep: LadderStep) => `${aiName} may only receive ${maxStep === 'answer' ? 'the answer' : 'an excerpt'}.`,
  noExcerpt: "Sieve couldn't find the exact lines that hold this answer.",
  empty: 'Nothing to share at this step.',
  overCap: 'This is more than Sieve sends at once (8,000 characters).',
  relatedAnswer: 'Related items can be shared as an excerpt or the full item.',
  relatedGone: "This item was deleted, so it can't be shared.",
  never: (category: Category) => `${category} is never shared.`,
  noMatch: 'Nothing on this device matched.',
  needsConsent: 'This needs your OK before the cloud model can read it.',
  modelUnavailable: "The on-device model isn't available.",
  error: 'Nothing was prepared.',
};

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
}
