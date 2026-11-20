// Question cues that act as filters (20 sections 9.4 and 10.2): who an item is from, whether the question wants the
// newest item, and whether it asks for a count. Plain code, no model.
import { isDictionaryLoaded, isEnglishWord } from './dictionary';
import { displayName, fromAddress } from './text';
import { STOP_WORDS } from './tokenize';
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

function wordMatches(w: string, token: string): boolean {
  if (w === token) return true;
  if (w.length >= 5 && token.length >= 5 && osaDistance(w, token, 1) <= 1) return true;
  return w.length >= 4 && token.startsWith(w);
}

/**
 * Whether an item from `from` fits the sender cue (20 section 10.2): word by word, case-insensitive, against the display
 * name, the address local part and the domain, so "Amazon" fits amazon.com and "Kay" fits "Kay Narayanan". Every cue
 * word must fit; "Good Dog" also fits gooddog.example as one word. An address cue must equal the address or its domain.
 */
export function senderMatches(cue: string, from: string | undefined): boolean {
  if (!from) return false;
  const c = cue.trim().toLowerCase();
  if (c.includes('@')) {
    const addr = fromAddress(from);
    return !!addr && (addr === c || addr.split('@')[1] === c.split('@')[1]);
  }
  const cw = words(c.replace(DETERMINERS, '')).filter((w) => !FILLER.has(w));
  if (cw.length === 0) return true;
  const tokens = senderTokens(from);
  if (cw.every((w) => tokens.some((t) => wordMatches(w, t)))) return true;
  const joined = cw.join('');
  return joined.length >= 5 && tokens.some((t) => wordMatches(joined, t));
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

const ITEMS =
  'emails?|e-mails?|mails?|messages?|texts?|orders?|receipts?|invoices?|photos?|pictures?|pics?|images?|screenshots?|files?|documents?|docs?|notes?|notifications?|newsletters?|alerts?|statements?|bills?|deliveries|packages?|parcels?|shipments?|replies|threads?|senders?|subscriptions?|transactions?|charges?|runs?|rides?|workouts?|activities|times';
const COUNT_RES: RegExp[] = [
  new RegExp(String.raw`\bhow\s+many\s+(?:[\p{L}\p{N}'-]+\s+){0,3}?(?:${ITEMS})\b(?!\s+(?:a|per|each)\s+(?:day|week|month|year)\b)`, 'iu'),
  new RegExp(String.raw`\b(?:count|total|number|tally)\s+of\s+(?:(?:my|the|all)\s+)?(?:[\p{L}\p{N}'-]+\s+){0,2}?(?:${ITEMS})\b`, 'iu'),
  new RegExp(String.raw`\bcount\s+(?:up\s+)?(?:my|the|all)\s+(?:[\p{L}\p{N}'-]+\s+){0,2}?(?:${ITEMS})\b`, 'iu'),
  /\bhow\s+often\b.*\b(?:email|emails|emailed|write|writes|wrote|send|sends|sent|message|messages|messaged|text|texts|texted|order|ordered|run|ran)\b/iu,
];

/** "How many emails...", "the number of orders", "count my receipts", "how often does X email me". */
export function asksCount(text: string): boolean {
  return COUNT_RES.some((re) => re.test(text));
}
