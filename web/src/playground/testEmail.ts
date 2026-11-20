// The Playground's test email (40 section 13.9): a visitor writes an email that tries to trick the AI, with the
// trap hidden as white text on white. Every field is escaped, so the visitor's text can never become markup.
import type { RawItem } from '@/index';
import type { TestEmailInput } from '@/state/playground';
import { TEST_EMAIL_COPY } from '@/copy/screens-main';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** The composer's defaults (40 section 13.9). */
export const DEFAULT_TEST_EMAIL: TestEmailInput = { ...TEST_EMAIL_COPY.defaults };

export function buildTestEmail(i: TestEmailInput): RawItem {
  const hidden = i.hideAsWhiteText
    ? `<p style="color:#ffffff;background:#ffffff;font-size:1px">${escapeHtml(i.hidden)}</p>`
    : `<p>${escapeHtml(i.hidden)}</p>`;
  return {
    source: 'upload',
    sourceRef: 'test-email-' + crypto.randomUUID(),
    kind: 'email',
    title: i.subject,
    from: `${i.from} <${TEST_EMAIL_COPY.senderAddress}>`,
    date: Date.now(),
    html: `<p>${escapeHtml(i.body)}</p>${hidden}`,
  };
}
