// redact() (11 section 7): readable tokens such as [name]; the same value always gets the same token.
import type { PiiSpan, PiiType } from '@sieve/shared';
import { mergeSpans } from './pii/merge';
import { snapToGraphemes } from './text';
import type { RedactOptions } from './types';

const NAME_GAP = /^[\s'’.-]{0,3}$/;
const ADDRESS_GAP = /^(?:[\s,.'’#-]{0,4}|\n)$/;
const UNNUMBERED: ReadonlySet<PiiType> = new Set(['card', 'iban', 'account', 'secret-code']);

function identityOf(type: PiiType, value: string): string {
  switch (type) {
    case 'phone': return value.replace(/\D/g, '').slice(-10);
    case 'card':
    case 'account':
    case 'ssn': return value.replace(/\D/g, '');
    case 'iban': return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    default: return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

function token(type: PiiType, value: string, n: number | null): string {
  const num = n === null ? '' : ` ${n}`;
  const digits = value.replace(/\D/g, '');
  switch (type) {
    case 'name': return `[name${num}]`;
    case 'address': return `[address${num}]`;
    case 'phone': return `[phone${num}]`;
    case 'email': return `[email${num}]`;
    case 'card': return digits.length >= 4 ? `[card ending ${digits.slice(-4)}]` : '[card]';
    case 'iban':
    case 'account': return digits.length >= 8 ? `[account ending ${digits.slice(-4)}]` : '[account]';
    case 'ssn': return `[ssn${num}]`;
    case 'dob': return `[date of birth${num}]`;
    case 'secret-code': return /^https?:/i.test(value) ? '[sign-in link]' : '[code]';
    default: return `[id number${num}]`;
  }
}

export function redact(text: string, spans: readonly PiiSpan[], opts: RedactOptions = {}): { text: string; redactions: number } {
  const keep = new Set(opts.keepTypes ?? []);
  // 1. drop out-of-range, empty and kept spans; never split a grapheme
  const usable = spans
    .filter((s) => s.end > s.start && s.start >= 0 && s.end <= text.length && !keep.has(s.type))
    .map((s) => ({ ...s, ...snapToGraphemes(text, s.start, s.end) }));
  // 2. merge
  const merged = mergeSpans(usable);
  // 3. join same-type neighbours
  const joined: PiiSpan[] = [];
  for (const s of merged) {
    const last = joined[joined.length - 1];
    if (last && last.type === s.type) {
      const gap = text.slice(last.end, s.start);
      if ((s.type === 'name' && NAME_GAP.test(gap)) || (s.type === 'address' && ADDRESS_GAP.test(gap))) {
        last.end = s.end;
        continue;
      }
    }
    joined.push({ ...s });
  }
  // 4. identities; a name whose words are a subset of exactly one longer name takes that name's identity
  const ids = joined.map((s) => identityOf(s.type, text.slice(s.start, s.end)));
  const names = [...new Set(joined.map((s, i) => (s.type === 'name' ? ids[i]! : '')).filter(Boolean))];
  joined.forEach((s, i) => {
    if (s.type !== 'name') return;
    const words = ids[i]!.split(' ');
    const longer = names.filter((n) => n !== ids[i] && n.split(' ').length > words.length && words.every((w) => n.split(' ').includes(w)));
    if (longer.length === 1) ids[i] = longer[0]!;
  });
  // 5. numbering per type, in order of first appearance
  const order = new Map<PiiType, string[]>();
  joined.forEach((s, i) => {
    const list = order.get(s.type) ?? [];
    if (!list.includes(ids[i]!)) list.push(ids[i]!);
    order.set(s.type, list);
  });
  // 6. build by slicing
  let out = '';
  let pos = 0;
  joined.forEach((s, i) => {
    const list = order.get(s.type) ?? [];
    const n = UNNUMBERED.has(s.type) || list.length < 2 ? null : list.indexOf(ids[i]!) + 1;
    out += text.slice(pos, s.start) + token(s.type, text.slice(s.start, s.end), n);
    pos = s.end;
  });
  return { text: out + text.slice(pos), redactions: joined.length };
}
