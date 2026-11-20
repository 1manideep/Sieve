// RedactedText (40 section 16.4): plain text in which each redaction token renders as a chip. The token format is
// 11's (lower-case: [name], [name 2], [card ending 1234], [link: host], [removed: ...]), per 70 R-UI-11, which
// replaces 40's upper-case pattern. Text is rendered as text only; nothing is parsed as HTML or Markdown.
import { REDACTED_COPY } from '@/copy/screens-main';
import styles from './RedactedText.module.css';

export const REDACTION_PATTERN =
  /\[(name(?: \d+)?|address|phone(?: \d+)?|email(?: \d+)?|card ending \d{4}|account(?: ending \d{4})?|ssn|date of birth|id number|link: [a-z0-9.-]{1,80}|removed: [^\]]{1,80}|quoted text not included)\]/g;

export type TextPart = { kind: 'text'; text: string } | { kind: 'redaction'; text: string };

/** Splits text into plain runs and redaction tokens; joining every part's text gives back the input exactly. */
export function splitRedactions(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(REDACTION_PATTERN.source, 'g'))) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'redaction', text: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

export interface RedactedTextProps {
  text: string;
  className?: string;
}

export function RedactedText({ text, className }: RedactedTextProps) {
  return (
    <span className={[styles.text, className].filter(Boolean).join(' ')} dir="auto">
      {splitRedactions(text).map((part, i) =>
        part.kind === 'redaction' ? (
          <span key={i} className={styles.redaction} title={REDACTED_COPY.title}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}
