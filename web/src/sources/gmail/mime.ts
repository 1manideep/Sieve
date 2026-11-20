// MIME handling for Gmail messages (20 section 15.3, 70 R-MAIL-01, R-MAIL-02, R-MAIL-05, R-EMO-05).
import { MIME_MAX_DEPTH, MIME_MAX_PARTS } from '../../index/config';
import { decodeEncodedWords } from '@/robust/charset';
import { decodeBase64UrlBytes, decodeBytes, decodeEntities } from '../readers/decode';
import type { GmailMessage, GmailPart } from './api';

/** RFC 2047 encoded words (70 R-EMO-05): robust/charset.ts joins split words and decodes with decodeBytes. */
export function decodeMimeWords(value: string): string {
  return decodeEncodedWords(value);
}

/** Case-insensitive header, then decodeMimeWords. */
export function header(part: GmailPart | undefined, name: string): string | undefined {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? decodeMimeWords(h.value) : undefined;
}

function charsetOf(part: GmailPart): string | undefined {
  const ct = part.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  return /charset\s*=\s*"?([^";\s]+)"?/i.exec(ct)?.[1];
}

/** base64url body bytes to text (70 section 3.2 rules); null when the data is not base64. */
export function decodeBase64Url(data: string, charset?: string): string {
  const bytes = decodeBase64UrlBytes(data);
  return bytes ? decodeBytes(bytes, charset).text : '';
}

/**
 * Bodies of a message: text/plain and text/html decode body.data; multipart/alternative uses only HTML-yielding
 * children when any exist; other multipart parts in order; message/rfc822 its parts; attachments are counted.
 * Walks with an explicit stack, at most MIME_MAX_DEPTH levels and MIME_MAX_PARTS parts (70 R-MAIL-01).
 */
export function extractBodies(payload: GmailPart): { html?: string; text?: string; attachments: number } {
  const html: string[] = [];
  const text: string[] = [];
  let attachments = 0;
  let seen = 0;
  const yieldsHtml = (p: GmailPart, depth: number): boolean => {
    const stack: [GmailPart, number][] = [[p, depth]];
    let n = 0;
    while (stack.length > 0 && n < MIME_MAX_PARTS) {
      const [cur, d] = stack.pop() as [GmailPart, number];
      n++;
      if ((cur.mimeType ?? '').toLowerCase() === 'text/html' && cur.body?.data && !cur.filename) return true;
      if (d < MIME_MAX_DEPTH) for (const c of cur.parts ?? []) stack.push([c, d + 1]);
    }
    return false;
  };
  const stack: [GmailPart, number][] = [[payload, 0]];
  while (stack.length > 0) {
    if (seen >= MIME_MAX_PARTS) break;
    const [part, depth] = stack.pop() as [GmailPart, number];
    seen++;
    const mime = (part.mimeType || 'application/octet-stream').toLowerCase();
    const children = part.parts ?? [];
    if (part.filename || (!mime.startsWith('text/') && !mime.startsWith('multipart/') && mime !== 'message/rfc822' && part.body?.attachmentId)) {
      if (part.filename || part.body?.attachmentId) attachments++;
      continue;
    }
    if (mime === 'text/plain' || mime === 'text/html') {
      if (!part.body?.data) continue;   // a very large body with only an attachmentId is skipped
      const bytes = decodeBase64UrlBytes(part.body.data);
      if (!bytes) continue;
      const s = decodeBytes(bytes, charsetOf(part)).text;
      (mime === 'text/html' ? html : text).push(s);
      continue;
    }
    if (depth >= MIME_MAX_DEPTH) continue;
    if (mime === 'multipart/alternative') {
      const htmlKids = children.filter((c) => yieldsHtml(c, depth + 1));
      const use = htmlKids.length > 0 ? htmlKids : children;
      for (let i = use.length - 1; i >= 0; i--) stack.push([use[i] as GmailPart, depth + 1]);
      continue;
    }
    if (mime.startsWith('multipart/') || mime === 'message/rfc822') {
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i] as GmailPart, depth + 1]);
      continue;
    }
  }
  const out: { html?: string; text?: string; attachments: number } = { attachments };
  if (html.length > 0) out.html = html.join('<hr>');
  if (text.length > 0) out.text = text.join('\n\n');
  return out;
}

/** Gmail snippets carry HTML entities; decode them with no parser, so nothing can be fetched (70 R-MAIL-05). */
export function decodeSnippet(snippet: string): string {
  return decodeEntities(snippet.replace(/<[^>]*>/g, ''));
}

export function isTrashed(labelIds?: string[]): boolean {
  return !!labelIds && (labelIds.includes('TRASH') || labelIds.includes('SPAM'));
}

/** DRAFT, SPAM, TRASH or CHAT. */
export function isSkippable(msg: GmailMessage): boolean {
  const l = msg.labelIds ?? [];
  return l.includes('DRAFT') || l.includes('CHAT') || isTrashed(l);
}
