// Previews (20 section 12.2): quoted replies and signatures dropped for email, grapheme-safe cut at PREVIEW_CHARS.
import { PREVIEW_CHARS } from '@sieve/shared';
import type { ItemKind } from '@sieve/shared';
import { cutGraphemes } from './text';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function photoDateLabel(date: number): string {
  const d = new Date(date);
  return `Photo from ${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${d.getFullYear()}`;
}

export function isPhotoPlaceholder(preview: string): boolean {
  return /^Photo from [A-Z][a-z]+ \d{1,2}, \d{4}$/.test(preview);
}

function stripEmailQuotes(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*-----\s*Original Message\s*-----/i.test(line)) break;
    if (/^\s*On .+wrote:\s*$/.test(line)) break;
    if (/^-- ?$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

export function buildPreview(input: { kind: ItemKind; text?: string; caption?: string; date: number }): string {
  let s = input.kind === 'photo' ? input.caption ?? '' : input.text ?? '';
  if (input.kind === 'email') s = stripEmailQuotes(s);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) {
    if (input.kind === 'email') return '(No text)';
    if (input.kind === 'photo') return photoDateLabel(input.date);
    return '(No text found)';
  }
  if (s.length <= PREVIEW_CHARS) return s;
  let cut = cutGraphemes(s, PREVIEW_CHARS - 1);
  const lastSpace = cut.search(/\s\S*$/);
  if (lastSpace > 0 && cut.length - lastSpace <= 40) cut = cut.slice(0, lastSpace);
  return cut.replace(/\s+$/, '') + '…';
}
