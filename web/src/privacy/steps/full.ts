// The full step (11 section 10.5): header, blank line, body; the sender's address never in the header.
import type { IndexRecord } from '@sieve/shared';
import { MAX_PAYLOAD_CHARS } from '@sieve/shared';
import { FULL_CUT_NOTE } from '../constants';
import { senderName } from '../scan/scan';
import { graphemeFloor } from '../text';
import { formatDate } from './excerpt';

export function fullHeader(record: Pick<IndexRecord, 'kind' | 'date' | 'from' | 'title'>): string {
  const date = formatDate(record.date);
  if (record.kind === 'email') {
    const name = senderName(record.from) || (record.from ?? '').replace(/[<>]/g, '').trim();
    const who = name ? `Email from ${name}, ${date}` : `Email, ${date}`;
    return `${who}\nSubject: ${record.title}`;
  }
  if (record.kind === 'note') return `Note, ${date}`;
  return `Document: ${record.title}, ${date}`;
}

const TOKEN = /\[[^\]\n]{1,100}\]/g;

function insideToken(text: string, i: number): boolean {
  for (const m of text.matchAll(TOKEN)) {
    if (m.index >= i) return false;
    if (i < m.index + m[0].length) return true;
  }
  return false;
}

/** The last good cut at or before `limit`: a paragraph break, else a sentence end, else a space; never inside a token. */
export function lastCutBefore(text: string, limit: number): number {
  const head = text.slice(0, limit);
  const candidates = [
    head.lastIndexOf('\n\n'),
    Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n')) + 1,
    head.lastIndexOf(' '),
  ];
  for (const c of candidates) {
    if (c > 0 && !insideToken(text, c)) return c;
  }
  let at = graphemeFloor(text, limit);
  while (at > 0 && insideToken(text, at)) at--;
  return at;
}

/** Cuts a redacted full text that is longer than Sieve sends at once, and says so. */
export function capFull(text: string): string {
  if (text.length <= MAX_PAYLOAD_CHARS) return text;
  const cut = lastCutBefore(text, MAX_PAYLOAD_CHARS - FULL_CUT_NOTE.length);
  return text.slice(0, cut).trimEnd() + FULL_CUT_NOTE;
}
