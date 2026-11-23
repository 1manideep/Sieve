// Question cues that act as filters (20 sections 9.4 and 10.2): who an item is from, whether the question wants the
// newest item, and whether it asks for a count. Plain code, no model.
import type { QueryHints } from '@sieve/shared';
import { isDictionaryLoaded, isEnglishWord } from './dictionary';
import { displayName, fromAddress } from './text';
import { STOP_WORDS, terms } from './tokenize';
import { osaDistance } from './typos';

/** Role words stay a boost: "my landlord" rarely appears in the landlord's sender name. */
export const ROLE_WORDS: ReadonlySet<string> = new Set(
  'landlord doctor dentist bank boss manager mom dad mother father pharmacy airline school teacher lawyer accountant insurer insurance employer vet gym hr wife husband'.split(' '),
);
const DETERMINERS = /^(?:my|the|our|your|a|an|this|that)\s+/i;
const FILLER: ReadonlySet<string> = new Set('inc llc ltd co corp the and of team support official'.split(' '));
/** Sender words that say nothing about who sent it (never "known sender" words on their own). */
const GENERIC: ReadonlySet<string> = new Set(
  ('mail email emails noreply no reply donotreply do not info hello support team news newsletter updates update notification notifications alert alerts ' +
    'notice service services account accounts admin contact help billing receipts receipt orders order shop store official www com net org co io app inbox digest auto confirm').split(' '),
);
const QUESTION_WORDS: ReadonlySet<string> = new Set(
  'what whats when where who whom whose why which how did does do is are was were has have had can could would should will may might shall i you we they he she it someone anyone everyone somebody anybody nobody please show find tell give get any all'.split(' '),
);
const CALENDAR: ReadonlySet<string> = new Set(
  ('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'monday tuesday wednesday thursday friday saturday sunday today yesterday tomorrow christmas halloween thanksgiving').split(' '),
);
const NOT_SENDERS: ReadonlySet<string> = new Set(['gmail', 'inbox', 'ai', 'pdf', 'drive']);
/** "flight from Seattle", "photos from Hawaii": a place, not a sender. */
const PLACE_BEFORE_FROM = /\b(?:flights?|fly|flying|flew|trains?|bus|buses|trips?|drive|driving|drove|ride|rides|travel|travelling|traveling|move|moving|moved|returning|return|coming|arrive|arriving|depart|departing|departure|leave|leaving|distance|miles|km|away|route|directions|commute|shipped|ship|photos?|pictures?|pics?|images?|selfies?|screenshots?)\s+$/i;

const NAME = String.raw`\p{Lu}[\p{L}\p{N}&'’.-]*`;
const VERBS = 'said|say|says|asked|ask|asks|sent|send|sends|emailed|email|emails|replied|reply|replies|wrote|write|writes|told|tell|tells|texted|messaged|mailed';
const NOUNS = 'emails?|e-mails?|mails?|messages?|orders?|receipts?|invoices?|newsletters?|notifications?|alerts?|statements?|codes?|confirmations?|updates?|bills?|shipments?|deliveries|subscriptions?|replies|reply|letters?|notes?|texts?';
const LATEST = 'latest|last|newest|most recent|recent|first|previous';

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Display-name words, address local-part words and domain labels (the top-level domain left out). */
export function senderTokens(from: string | undefined): string[] {
  if (!from) return [];
  const addr = fromAddress(from);
  const name = displayName(from);
  const out = new Set<string>(name.includes('@') ? [] : words(name));
  if (!name.includes('@')) {
    const joined = words(name).join('');
    if (joined) out.add(joined);
  }
  if (addr) {
    const [local = '', domain = ''] = addr.split('@');
    if (local) out.add(local.replace(/[^\p{L}\p{N}]/gu, ''));
    for (const w of words(local)) out.add(w);
    const labels = domain.split('.').filter(Boolean);
    for (const l of labels.slice(0, -1)) {
      out.add(l.replace(/[^\p{L}\p{N}]/gu, ''));
      for (const w of words(l)) out.add(w);
    }
  }
  out.delete('');
  return [...out];
}

/** "my landlord", "the bank": a role, so a boost and never a filter. */
export function isRoleCue(cue: string): boolean {
  const w = words(cue.replace(DETERMINERS, ''));
  return w.length === 1 && ROLE_WORDS.has(w[0]!);
}

function wordMatches(w: string, token: string, exact = false): boolean {
  if (w === token) return true;
  if (w.length >= 4 && token.startsWith(w)) return true;
  // An address with no display name holds the name inside one run of letters ("theorchardapts@relay.example" for
  // "The Orchard"): a cue of six or more letters fits anywhere in it. Before, such a sender's mail never passed its own
  // sender filter (Nov 22, 2026: 4 of about 35 emails did, the ones sent with a display name).
  if (w.length >= 6 && token.includes(w)) return true;
  return !exact && w.length >= 5 && token.length >= 5 && osaDistance(w, token, 1) <= 1;
}

/**
 * Whether an item from `from` fits the sender cue (20 section 10.2): word by word, case-insensitive, against the display
 * name, the address local part and the domain, so "Amazon" fits amazon.com and "Ivo" fits "Ivo Lindqvist". Every cue
 * word must fit; "Sunny Paws" also fits sunnypaws.example as one word. An address cue must equal the address or its domain.
 * `exact`: no near spelling ("Northgar" for Northgear); the search asks for it when some sender is spelled as the cue is.
 */
export function senderMatches(cue: string, from: string | undefined, exact = false): boolean {
  if (!from) return false;
  const c = cue.trim().toLowerCase();
  if (c.includes('@')) {
    const addr = fromAddress(from);
    return !!addr && (addr === c || addr.split('@')[1] === c.split('@')[1]);
  }
  const cw = words(c.replace(DETERMINERS, '')).filter((w) => !FILLER.has(w));
  if (cw.length === 0) return true;
  const tokens = senderTokens(from);
  if (cw.every((w) => tokens.some((t) => wordMatches(w, t, exact)))) return true;
  const joined = cw.join('');
  return joined.length >= 5 && tokens.some((t) => wordMatches(joined, t, exact));
}

/** The words of every sender in the index that could name a sender on their own (not English words, not generic). */
export function knownSenderWords(froms: Iterable<string | undefined>): Set<string> {
  const out = new Set<string>();
  if (!isDictionaryLoaded()) return out;
  for (const f of froms) {
    for (const t of senderTokens(f)) {
      if (t.length < 3 || /^\d+$/.test(t) || GENERIC.has(t) || ROLE_WORDS.has(t) || STOP_WORDS.has(t) || isEnglishWord(t)) continue;
      out.add(t);
    }
  }
  return out;
}

/** Mailboxes a company's system sends from, as the start of the part before the @. A person rarely writes from one. */
const SYSTEM_MAILBOX = /^(?:no-?reply|do-?not-?reply|donotreply|info|support|help|hello|team|news|newsletters?|notifications?|notify|alerts?|orders?|billing|receipts?|invoices?|service|services|customer|care|accounts?|mailer|mail|email|updates?|store|shop|sales|marketing|security|admin|contact|digest|bookings?|reservations?|tickets?|feedback|members?|rewards?)(?![a-z])/;
/** Hosts that carry anyone's mail: their name says nothing about who wrote. */
const MAIL_HOSTS = new Set('gmail googlemail yahoo ymail outlook hotmail live msn icloud me mac aol proton protonmail pm gmx zoho fastmail hey inbox relay privaterelay'.split(' '));

/**
 * Words that name an organisation in this index: a label of the domain a company's system mails from ("lumora" in
 * no-reply@mail.lumora.example). Not a mail host, not an English word, and only from a system mailbox, so a person
 * who writes from a domain of their own is not counted. The privacy pipeline does not mask such a word as a person's
 * name: a merchant in "a failed payment for Lumora" came out as "[name]" (Nov 22, 2026).
 */
export function knownOrgWords(froms: Iterable<string | undefined>): Set<string> {
  const out = new Set<string>();
  if (!isDictionaryLoaded()) return out;
  for (const f of froms) {
    const addr = f ? fromAddress(f) : '';
    if (!addr) continue;
    const [local = '', domain = ''] = addr.toLowerCase().split('@');
    if (!SYSTEM_MAILBOX.test(local)) continue;
    for (const label of domain.split('.').filter(Boolean).slice(0, -1)) {
      const t = label.replace(/[^\p{L}\p{N}]/gu, '');
      if (t.length < 3 || /^\d+$/.test(t) || GENERIC.has(t) || MAIL_HOSTS.has(t) || STOP_WORDS.has(t) || isEnglishWord(t)) continue;
      out.add(t);
    }
  }
  return out;
}

const orgCache = new WeakMap<object, { size: number; set: Set<string> }>();

/** knownOrgWords over a metadata map, cached until the map's size changes. */
export function knownOrgWordsOf(meta: Map<string, { from?: string }>): Set<string> {
  const hit = orgCache.get(meta);
  if (hit && hit.size === meta.size && hit.set.size > 0) return hit.set;
  const set = knownOrgWords([...meta.values()].map((m) => m.from));
  orgCache.set(meta, { size: meta.size, set });
  return set;
}

const knownCache = new WeakMap<object, { size: number; set: Set<string> }>();

/** knownSenderWords over a metadata map, cached until the map's size changes. */
export function knownSenderWordsOf(meta: Map<string, { from?: string }>): Set<string> {
  const hit = knownCache.get(meta);
  if (hit && hit.size === meta.size && hit.set.size > 0) return hit.set;
  const set = knownSenderWords([...meta.values()].map((m) => m.from));
  knownCache.set(meta, { size: meta.size, set });
  return set;
}

/** Drops question words in front of a captured run ("Did HelloSign" gives "HelloSign"), with the offset kept. */
function trimRun(raw: string): { name: string; offset: number } {
  let offset = 0;
  let rest = raw;
  for (;;) {
    const m = /^(\S+)(\s+)/.exec(rest);
    if (!m || !QUESTION_WORDS.has(m[1]!.toLowerCase())) break;
    offset += m[0].length;
    rest = rest.slice(m[0].length);
  }
  return { name: rest.trim(), offset };
}

function usable(raw: string, at: number, text: string, known: ReadonlySet<string>, titleCase: boolean): string | null {
  const t = trimRun(raw);
  const name = t.name.replace(/['’]s$/i, '').replace(/[.,]+$/, '');
  if (!name) return null;
  const ws = name.split(/\s+/);
  const low = ws.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
  if (low.some((w) => !w || CALENDAR.has(w) || NOT_SENDERS.has(w)) || low.every((w) => STOP_WORDS.has(w) || QUESTION_WORDS.has(w))) return null;
  if (low.length === 1 && ROLE_WORDS.has(low[0]!)) return null;
  if (low.length === 1 && known.has(low[0]!)) return name;
  const capital = ws.every((w) => /^\p{Lu}/u.test(w) || /\d/.test(w));
  const before = text.slice(0, at + t.offset).trim();
  const first = before === '' || /[.?!:;]$/.test(before);   // a sentence's first word is capitalised anyway
  if (!capital || titleCase || first) return null;
  return name;
}

/** Every match of a sticky pattern that starts at a word start (overlapping, unlike matchAll). */
function* atWordStarts(re: RegExp, text: string): Generator<RegExpExecArray> {
  for (const w of text.matchAll(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu)) {
    re.lastIndex = w.index;
    const m = re.exec(text);
    if (m) yield m;
  }
}

/**
 * The sender a question names, when it names one: "from X" (not a place: "flight from Seattle"), "X said", "did X send",
 * "X's latest email", "my latest X order", "X verification emails". X is a capitalised name that is not the first word,
 * or a word that names a sender in the index (`known`); "Draft a reply" after a question is a sentence start, not a name. Role words ("my landlord") are left to the boost.
 */
export function senderCue(text: string, known: ReadonlySet<string> = new Set()): string | undefined {
  const all = text.match(/\p{L}{3,}/gu) ?? [];
  const caps = all.filter((w) => /^\p{Lu}/u.test(w)).length;
  const titleCase = all.length >= 4 && caps / all.length >= 0.6;
  const who = String.raw`(${NAME}(?:\s+${NAME}){0,2}|[\p{L}\p{N}][\p{L}\p{N}&'’.-]*)`;
  const patterns: RegExp[] = [
    new RegExp(String.raw`${who}['’]s\s+(?:(?:${LATEST})\s+)?(?:${NOUNS})\b`, 'uy'),
    new RegExp(String.raw`${who}\s+(?:(?:has|have|just|already)\s+)?(?:${VERBS})\b`, 'uy'),
    new RegExp(String.raw`${who}\s+(?:\p{L}+\s+)?(?:${NOUNS})\b`, 'uy'),
  ];
  // "from X": the words after "from", up to three, before any stop word or date.
  for (const m of text.matchAll(/\bfrom\s+([^?!,;]+)/giu)) {
    if (PLACE_BEFORE_FROM.test(text.slice(0, m.index))) continue;
    const taken: string[] = [];
    for (const w of (m[1] ?? '').split(/\s+/)) {
      const clean = w.replace(/[^\p{L}\p{N}'’&@.-]/gu, '').replace(/[.]+$/, '');
      const lw = clean.toLowerCase();
      if (!lw || STOP_WORDS.has(lw) || CALENDAR.has(lw) || /^\d+$/.test(lw)) break;
      taken.push(clean);
      if (taken.length >= 3 || /[.]$/.test(w)) break;
    }
    if (taken.length === 0) continue;
    const name = taken.join(' ');
    if (name.includes('@')) return name;
    const ok = usable(name, m.index + m[0].indexOf(taken[0]!), text, known, titleCase);
    if (ok) return ok;
  }
  for (const re of patterns) {
    for (const m of atWordStarts(re, text)) {
      const ok = usable(m[1] ?? '', m.index, text, known, titleCase);
      if (ok) return ok;
    }
  }
  return undefined;
}

const LATEST_RE = /\b(?:latest|newest|most recent)\b/i;
const LAST_RE =
  /\blast\b(?!\s+(?:day|days|week|weeks|month|months|year|years|night|weekend|summer|winter|spring|fall|autumn|time|times|name|names|minute|minutes|hour|hours|few|couple|two|three|four|five|\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*))/i;

/** "latest", "newest", "most recent", or "last" not followed by a unit, a number or a date. */
export function asksLatest(text: string): boolean {
  return LATEST_RE.test(text) || LAST_RE.test(text);
}

/** The question's own words, each once (stop words and "latest" are not among them): what "the latest X" is about. */
export function topicTerms(question: string): string[] {
  return [...new Set(terms(question))];
}

/**
 * Whether an item is about the thing a "latest" question names when no sender says so: its title or its sender holds
 * two of the question's words ("Lumora payment did not go through" for "the most recent email about my Lumora
 * membership payment"). One shared word is not enough: a shop's newest sale email holds the shop's name too.
 */
export function holdsTopic(topic: readonly string[], title: string, from: string | undefined): boolean {
  if (topic.length < 2) return false;
  const have = new Set([...terms(title), ...senderTokens(from)]);
  return topic.filter((t) => have.has(t)).length > 1;
}

const SAID_RE = /\b(?:did\b.*\b(?:say|send|tell|remind|write|ask|notify|announce|email|message)|said|sent|told|reminded|wrote|asked|notified|announced|emailed|messaged)\b/i;

/** "What did X remind me about on March 3?", "what was sent last Friday": the days are when the item was sent. */
export function asksSaid(text: string): boolean {
  return SAID_RE.test(text);
}

/** The verbs that name a kind of message, and how that kind starts in a subject line ("Reminder: ...", "Notice of ..."). */
const SAID_KINDS: readonly [RegExp, RegExp][] = [
  [/\bremind(?:ed|s)?\b/i, /\bremind/i],
  [/\bannounc(?:e|ed|es)\b/i, /\bannounc/i],
  [/\bnotif(?:y|ied|ies)\b/i, /\bnoti(?:f|ce)/i],
];

/**
 * "What did X remind me about on March 3?" names the kind of message: a reminder. Given a subject line, this says
 * whether it is that kind; null when the question names no kind ("what did X say"). Two emails a sender sent on one
 * day are told apart this way before the model reads them: left to choose, the on-device model answered from the other
 * one 2 times of 5 (Nov 21, 2026).
 */
export function titleSaysAskedKind(question: string, title: string): boolean | null {
  const kind = SAID_KINDS.find(([asked]) => asked.test(question));
  return kind ? kind[1].test(title) : null;
}

const DESCRIBED_RE = /\b(?:did|does|has|have)\s+((?:my|our)\s+[\p{L}' -]{2,40}?)\s+(say|said|send|sent|remind(?:ed)?|ask(?:ed)?|tell|told|email(?:ed)?|write|wrote|written|announced?|notif(?:y|ied)|mention(?:ed)?|want(?:ed)?|need(?:ed)?)\b/iu;
/**
 * "What did my gym remind me about on March 3?": the question says who the item is from only by
 * describing them ("my gym"), and holds no other word to find the item by. Dates and numbers do not
 * count. Read from the question alone, never from what the index holds.
 */
export function describesOnlySender(question: string): boolean {
  const m = DESCRIBED_RE.exec(question);
  if (!m) return false;
  const given = new Set([...terms(m[1] ?? ''), ...terms(m[2] ?? '')]);
  return terms(question).every((t) => given.has(t) || CALENDAR.has(t) || /^\d/.test(t));
}

const STATE_RE = /\b(?:status|update on|any (?:update|news)|where is|where's|what happened (?:to|with)|still|yet|currently|right now|so far)\b/i;

/** "What is the status of order X?", "Has X shipped yet?": the newest item about X says how it stands now. */
export function asksState(text: string): boolean {
  return STATE_RE.test(text);
}

const ID_TOKEN = /#?[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)*/gu;
const DATE_LIKE = /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{1,2}[-./]\d{1,2})$/;

/**
 * The exact identifiers a question carries: an order, booking, receipt or invoice number, from the asker's own terms
 * and from the question's words. At least five characters with four digits among them; never a date, a time or an
 * amount of money. Lower case, without a leading "#".
 */
export function identifierTerms(question: string, terms: readonly string[] | undefined): string[] {
  const text = question.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  const out: string[] = [];
  for (const raw of [...(terms ?? []), ...(text.match(ID_TOKEN) ?? [])]) {
    const t = raw.trim().replace(/^#/, '').replace(/[.]+$/, '').toLowerCase();
    if (t.length < 5 || (t.match(/\d/g) ?? []).length < 4 || DATE_LIKE.test(t) || /\s/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 5);
}

const ITEMS =
  'emails?|e-mails?|mails?|messages?|texts?|orders?|receipts?|invoices?|photos?|pictures?|pics?|images?|screenshots?|files?|documents?|docs?|notes?|notifications?|newsletters?|alerts?|statements?|bills?|deliveries|packages?|parcels?|shipments?|replies|threads?|senders?|subscriptions?|transactions?|charges?|runs?|rides?|workouts?|activities|times';
const COUNT_RES: RegExp[] = [
  new RegExp(String.raw`\bhow\s+many\s+(?:[\p{L}\p{N}'-]+\s+){0,3}?(?:${ITEMS})\b(?!\s+(?:a|per|each)\s+(?:day|week|month|year)\b)`, 'iu'),
  // plural only: "the number of my orders" is a count, "the order number of my Amazon order" and "the total of my order" are not
  new RegExp(String.raw`\b(?:count|total|number|tally)\s+of\s+(?:(?:my|the|all)\s+)?(?:[\p{L}\p{N}'-]+\s+){0,2}?(?:${ITEMS.replace(/\?/g, '')})\b`, 'iu'),
  new RegExp(String.raw`\bcount\s+(?:up\s+)?(?:my|the|all)\s+(?:[\p{L}\p{N}'-]+\s+){0,2}?(?:${ITEMS})\b`, 'iu'),
  /\bhow\s+often\b.*\b(?:email|emails|emailed|write|writes|wrote|send|sends|sent|message|messages|messaged|text|texts|texted|order|ordered|run|ran)\b/iu,
];

/** "How many emails...", "the number of orders", "count my receipts", "how often does X email me". */
export function asksCount(text: string): boolean {
  return COUNT_RES.some((re) => re.test(text));
}

const NUM = 'two|three|four|five|six|seven|eight|nine|ten|\\d{1,2}';
const FIELDS = 'fields?|details?|things|facts|values|pieces of information|parts';
const FIELD_NOUNS = 'subjects|senders|titles|names|dates|amounts|totals|addresses|numbers|prices|fields|details';
const SEVERAL_RES: RegExp[] = [
  /^\W*(?:(?:please|can you|could you|would you)\s+)?(?:list|enumerate|itemi[sz]e)\b/iu,
  /\b(?:list|enumerate|itemi[sz]e)\s+(?:all|every|each|my|the|your|out)\b/iu,
  /\b(?:give|show|send|tell)\s+(?:me\s+)?(?:a|the)\s+list\b/iu,
  /\ba\s+list\s+of\s+(?:all\s+|my\s+|the\s+|your\s+)/iu,
  /\ball\s+of\b/iu,
  new RegExp(String.raw`\b(?:every|each)\s+(?:single\s+)?(?:${ITEMS}|${FIELDS}|payments?|accounts?)\b`, 'iu'),
  new RegExp(String.raw`\b(?:${NUM})\s+(?:[\p{L}-]+\s+)?(?:${FIELDS})\b`, 'iu'),
  new RegExp(String.raw`\b(?:${FIELD_NOUNS})\s+of\s+(?:my|the|all|each|every|your|these|those)\b`, 'iu'),
  new RegExp(String.raw`\b(?:last|latest|recent|newest|first|top|past)\s+(?:${NUM})\s+(?:[\p{L}-]+\s+)?(?:${ITEMS})\b`, 'iu'),
  new RegExp(String.raw`\b(?:${NUM})\s+(?:last|latest|recent|newest|most recent)\s+(?:[\p{L}-]+\s+)?(?:${ITEMS})\b`, 'iu'),
  /\bin\s+(?:one|a single)\s+(?:sentence|line|answer|reply|message)\b/iu,
  /\b(?:what|when|where|who|which|how)\b[^?]*?\band\s+(?:what|when|where|who|which|how)\b/iu,
];
/** "the amount, date and merchant": three or more things asked for at once, after "the", "my" or "of". */
const ASKED_LIST =
  /\b(?:the|my|your|their|its|of|for|about|me)\s+[\p{L}-]+(?:\s+[\p{L}-]+)?,\s+(?:the\s+|my\s+)?[\p{L}-]+(?:\s+[\p{L}-]+)?,?\s+(?:and|or)\s+(?:the\s+|my\s+)?[\p{L}-]+/iu;

/**
 * A question that asks for several fields or items at once (10 section 12.4, Nov 21): "list", "all of", "every",
 * "five fields", "subjects of my last emails", "my last five emails", "in one sentence", "what ... and when ...", or
 * three things in a row. This level shares one fact at a time, so it is unsupported before any model call.
 */
export function asksSeveral(text: string): boolean {
  return SEVERAL_RES.some((re) => re.test(text)) || ASKED_LIST.test(text);
}

const ONLY_RES: [NonNullable<QueryHints['source']>, RegExp][] = [
  ['files', /\b(?:local\s+(?:files?|documents?|docs?)|(?:files?|documents?|docs?)\s+only|only\s+(?:in\s+|from\s+)?(?:my\s+)?(?:local\s+)?(?:files?|documents?|docs?|folders?)|(?:in|from|among|on)\s+my\s+(?:local\s+)?(?:files?|documents?|docs?|folders?|computer|disk|drive))\b/iu],
  ['photos', /\b(?:(?:photos?|pictures?|pics)\s+only|only\s+(?:in\s+|from\s+)?(?:my\s+)?(?:photos?|pictures?|pics)|(?:in|from|among)\s+my\s+(?:photos?|pictures?|pics|camera roll|photo library))\b/iu],
  ['mail', /\b(?:(?:e-?mails?|mail|inbox)\s+only|only\s+(?:in\s+|from\s+)?(?:my\s+)?(?:e-?mails?|mail|inbox|gmail)|(?:in|from|among)\s+my\s+(?:e-?mails?|mail|inbox|gmail)|in\s+gmail)\b/iu],
];

/**
 * The source a question limits itself to (20 section 10.2, Nov 21): "local files only", "in my files", "from my
 * photos", "in my mail". A filter, unlike the `source` hint a single word gives ("the pdf", "emails"), which boosts.
 */
export function sourceCue(text: string): NonNullable<QueryHints['source']> | undefined {
  let best: { at: number; source: NonNullable<QueryHints['source']> } | undefined;
  for (const [source, re] of ONLY_RES) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, source };
  }
  return best?.source;
}
