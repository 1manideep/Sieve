// When a question asks for an amount or a date and an email says its receipt or invoice is attached, the answer is
// often only in the attached PDF: "Your subscription is now active and your receipt is attached" holds no amount
// (Nov 23, 2026). For that answer only, the text of the PDF is read from Gmail and put after the email's own text.
// It is never stored: the index keeps the email as it was. Like the email's own text, it is scanned for personal
// details and for instructions aimed at an AI before anything leaves.
import type { IndexRecord } from '@sieve/shared';
import { recordBody } from '@/ai';

/** The email says something is attached. */
const MENTIONS = /\b(?:attached|attachment|attachments|enclosed)\b/i;
/** At most this much of an attachment's text is read, and at most this many PDFs per email. */
export const ATTACHMENT_TEXT_CHARS = 4000;
const MAX_PDFS = 2;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

type Ref = { name: string; mime: string; bytes: number; attachmentId: string };

export interface AttachmentTextDeps {
  listAttachments(messageId: string, signal?: AbortSignal): Promise<Ref[]>;
  fetchAttachment(messageId: string, ref: Ref, signal?: AbortSignal): Promise<Blob>;
  /** The PDF's text, or '' when it has none that reads as words. */
  pdfText(data: ArrayBuffer): Promise<string>;
}

async function loadDeps(): Promise<AttachmentTextDeps> {
  const [gmail, pdf] = await Promise.all([import('@/sources/gmail/attachments'), import('@/sources/readers/pdf')]);
  return {
    listAttachments: gmail.listAttachments,
    fetchAttachment: gmail.fetchAttachment,
    pdfText: async (data) => {
      const { text } = await pdf.extractPdfText(data);
      return pdf.looksLikeGarbage(text) ? '' : text;
    },
  };
}

/** An email whose own text lacks the kind of fact asked for and says something is attached. */
export function attachmentMayHold(rec: IndexRecord, wants: RegExp): boolean {
  if (rec.source !== 'gmail' || rec.kind !== 'email' || rec.text === undefined) return false;
  const body = recordBody(rec);
  return !wants.test(`${rec.title} ${body}`) && MENTIONS.test(body);
}

/**
 * The record with the text of its PDF attachments after its own text, or null when it has none that can be read
 * (no PDF, too large, unreadable, Gmail not reachable). Never throws, except when the request is stopped.
 */
export async function withAttachmentText(rec: IndexRecord, opts: { signal?: AbortSignal; deps?: AttachmentTextDeps } = {}): Promise<IndexRecord | null> {
  try {
    const deps = opts.deps ?? (await loadDeps());
    const list = await deps.listAttachments(rec.sourceRef, opts.signal);
    const pdfs = list
      .filter((a) => (a.mime === 'application/pdf' || /\.pdf$/i.test(a.name)) && a.bytes > 0 && a.bytes <= MAX_PDF_BYTES)
      .slice(0, MAX_PDFS);
    const parts: string[] = [];
    for (const a of pdfs) {
      const blob = await deps.fetchAttachment(rec.sourceRef, a, opts.signal);
      const text = (await deps.pdfText(await blob.arrayBuffer())).replace(/\s+/g, ' ').trim();
      if (text) parts.push(`Attached file ${a.name}: ${text.slice(0, ATTACHMENT_TEXT_CHARS)}`);
    }
    if (parts.length === 0) return null;
    return { ...rec, text: `${recordBody(rec)}\n\n${parts.join('\n\n')}` };
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
    return null;
  }
}
