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
  words: 'Thinking of other words for the search…',
  retrieve: 'Searching this device…',
  fresh: 'Checking the item is still there…',
  verify: 'Checking the answer against the item…',
  yesNo: 'Reading the answer as yes or no…',
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
  ruleSecret: (n: number) =>
    `${plural(n, 'item holds', 'items hold')} a verification code or a sign-in link, never shared, stopped before any model read ${n === 1 ? 'it' : 'them'}`,
  countUnsupported: 'This asks for a count. Sieve answers from one item at a time, so nothing was searched.',
  // Nov 21, the second tester's B-cases
  severalUnsupported: 'This asks for several things at once. Sieve shares one fact at a time, so nothing was searched.',
  senderNotNamed: 'The request gives days and describes the sender without naming them, so Sieve cannot tell which email is meant. Nothing was searched.',
  freshLatestUnchecked: "Couldn't check Gmail for newer mail, so nothing was prepared. Use Continue on the Gmail notice, then ask again.",
  oneFactAnswer: 'The answer held more than one fact. Sieve shares one fact at a time at this level, so nothing was offered.',
  shapeRefused: "The model couldn't put the answer in one fact, so nothing was offered.",
  instructionsLeftOut: (phrases: string[]) => `Left words that read as instructions to Sieve out of the search: ${phrases.map((p) => `"${cutQuote(p, 60)}"`).join(', ')}`,
  nothingLeft: 'Nothing was left to search once those words were left out.',
  sourceOnly: (source: 'mail' | 'files' | 'photos') => `Searched only your ${source === 'mail' ? 'email' : source}, as the question asks`,
  categoryOnly: (names: string) => `Looked only under ${names}, as the assistant asked`,
  categoryRelaxed: (names: string) => `Too little under ${names}, so Sieve searched everything it may share`,
  dateRelaxed: (d: { after?: string; before?: string }) =>
    `Too little ${d.after && d.before ? (d.after === d.before ? `on ${d.after}` : `from ${d.after} to ${d.before}`) : d.after ? `from ${d.after} on` : `up to ${d.before}`}, so Sieve searched all dates and preferred those days`,
  sensitive: 'This touches a sensitive topic, so Sieve asks you first',
  newestFirst: 'Put the matches newest first, because the question asks for the latest',
  identifierOnly: (n: number) => `Read only the ${n === 1 ? 'item' : `${n} items`} that ${n === 1 ? 'holds' : 'hold'} the exact number in the question`,
  wordsFound: (n: number) => `Thought of ${n} other ${n === 1 ? 'word' : 'words'} the item may use, and searched for ${n === 1 ? 'it' : 'them'} too`,
  wordsNone: 'Searched with the question as it is',
  newestState: 'Read only the newest of those, because the newest says how it stands now',
  datedOnly: (left: number) => `Left out ${left === 1 ? '1 email that only mentions' : `${left} emails that only mention`} those days, because the question asks what was said then`,
  newestOnly: 'Read only the newest one, because that is the one the question asks about',
  saidKindOnly: (left: number) => `Left out ${left === 1 ? '1 email' : `${left} emails`} of those days, because another one's subject says it is what the question asks about`,
  kindOnly: (left: number) => `Left out ${left === 1 ? '1 item' : `${left} items`} with no amount or date in ${left === 1 ? 'it' : 'them'}, because the question asks for one`,
  kindMissing: 'The answer held no date or amount, though the question asks for one, so nothing is shared',
  exampleRepeated: 'The answer held an amount from the instructions the model was given, not from the item, so nothing is shared',
  numberRepaired: 'A long number in the answer was a digit off the one in the item or the question; the real number is written',
  verifyYes: 'The item answers the question',
  verifySkipped: (why: 'number' | 'newest') => (why === 'number' ? 'Not checked again: this is the only item that holds the number you gave' : 'Not checked again: this is the newest email from the sender you named'),
  yesNoRead: (answer: 'yes' | 'no') => `The answer was a sentence; read as "${answer === 'yes' ? 'Yes.' : 'No.'}"`,
  yesNoUnclear: 'The answer was a sentence that does not say yes or no',
  verifyNo: 'The item does not answer the question',
  verifyFailed: "Couldn't check the answer against the item on this device",
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
  fileFound: (line: string) => `Found the original to send as a file: ${line}`,
  fileMissing: 'The original file could not be offered',
  dayWritten: 'Wrote the date for "today" or "tomorrow", counted from the day the item is dated',
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

/** 11 section 11.5: the line of the sensitive-topic warning (kind 'ask-first', so the extension shows it too). */
export const SENSITIVE_LINE = 'This touches a sensitive topic. Sieve asks you first.';

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
  unchecked: (): Warning => ({
    kind: 'unverified-answer',
    message: "Sieve couldn't check that this item answers the question. Read the answer before you share it.",
  }),
  sourceUnchecked: (): Warning => ({
    kind: 'source-unchecked',
    message: "Sieve couldn't check that this email still exists; it used the copy on this computer.",
  }),
  sensitiveTopic: (): Warning => ({ kind: 'ask-first', message: SENSITIVE_LINE }),
  fileUnmasked: (): Warning => ({ kind: 'pii-check-limited', message: 'The file itself is sent as it is: personal details inside it are not masked, and the link works for 10 minutes.' }),
  questionInstruction: (phrase: string): Warning => ({
    kind: 'injection',
    message: `This question contained words that read as instructions to Sieve: "${cutQuote(phrase, 60)}". Sieve left them out of the search.`,
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
  secretCode: 'Verification codes and sign-in links are never shared.',
  noMatch: 'Nothing on this device matched.',
  unsupported: "Sieve answers from one item at a time at this level, so counts aren't available.",
  oneFact: 'Sieve shares one fact at a time at this level.',
  nameSender: "Sieve could not tell who that is from. Ask again with the sender's name.",
  badOutput: 'The answer was not one clean sentence, so it is not offered.',   // the privacy build's line (15.0)
  needsConsent: 'This needs your OK before the cloud model can read it.',
  modelUnavailable: "The on-device model isn't available.",
  error: 'Nothing was prepared.',
};

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
}

/** Why the file itself is not offered, as the card says it (original.ts gives the word). */
export const FILE_UNAVAILABLE = {
  none: 'There is no file to send for this item: only its text is on this computer.',
  several: 'This email has more than one attachment. Ask again with the name of the file.',
  kind: 'This kind of file cannot be sent.',
  'too-large': 'This file is larger than 20 MB, so it cannot be sent.',
  permission: 'Chrome needs your OK to read the folder again before this file can be sent.',
  gone: 'The original file is no longer where it was.',
  gmail: "Couldn't get the attachment from Gmail.",
  reconnect: 'Gmail needs reconnecting before this attachment can be sent. Open Sources, press Gmail and reconnect, then ask again.',
  instruction: 'This item seems to hold an instruction aimed at an AI, so the file itself is not offered.',
} as const;
