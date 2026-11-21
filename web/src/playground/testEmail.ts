// The Playground's test email (40 section 13.9): a visitor writes an email that tries to trick the AI, with the
// trap hidden as white text on white, as invisible Unicode tag characters, or left in plain sight. Every field is
// escaped, so the visitor's text can never become markup.
import type { RawItem } from '@/index';
import type { TestEmailHideAs, TestEmailInput } from '@/state/playground';
import { TEST_EMAIL_COPY, TRICK_EMAIL_COPY } from '@/copy/screens-main';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** The composer's defaults (40 section 13.9). */
export const DEFAULT_TEST_EMAIL: TestEmailInput = { ...TEST_EMAIL_COPY.defaults };

export type TrickId = (typeof TRICK_EMAIL_COPY)[number]['id'];

export interface TrickEmail {
  id: TrickId;
  label: string;
  how: string;
  question: string;
  input: TestEmailInput;
}

/** The one-click trick emails, ready for the composer. */
export const TRICK_EMAILS: readonly TrickEmail[] = TRICK_EMAIL_COPY.map((t) => ({
  id: t.id,
  label: t.label,
  how: t.how,
  question: t.question,
  input: { ...t.email, hideAsWhiteText: t.email.hideAs === 'white' },
}));

/**
 * Printable ASCII spelled in Unicode tag characters (U+E0020 to U+E007E): no font draws them, so a mail app shows
 * nothing, yet the characters are in the text a model would read. Anything else is dropped.
 */
export function toTagCharacters(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) out += String.fromCodePoint(0xe0000 + cp);
  }
  return out;
}

/** How the hidden part is hidden: an explicit hideAs wins; otherwise the white-text checkbox decides. */
export function hideModeOf(i: TestEmailInput): TestEmailHideAs {
  return i.hideAs ?? (i.hideAsWhiteText ? 'white' : 'visible');
}

export function buildTestEmail(i: TestEmailInput): RawItem {
  const body = escapeHtml(i.body);
  const mode = hideModeOf(i);
  const html =
    mode === 'tags'
      ? `<p>${body}${toTagCharacters(i.hidden)}</p>`
      : mode === 'white'
        ? `<p>${body}</p><p style="color:#ffffff;background:#ffffff;font-size:1px">${escapeHtml(i.hidden)}</p>`
        : `<p>${body}</p><p>${escapeHtml(i.hidden)}</p>`;
  return {
    source: 'upload',
    sourceRef: 'test-email-' + crypto.randomUUID(),
    kind: 'email',
    title: i.subject,
    from: `${i.from} <${i.address ?? TEST_EMAIL_COPY.senderAddress}>`,
    date: Date.now(),
    html,
  };
}
