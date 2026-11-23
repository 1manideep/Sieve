// The attachments of one email, for sending a file as itself (Nov 22, 2026). The index only counts attachments, so
// they are listed from Gmail when a request asks for the file, and one is fetched only after it is chosen: the one
// the question names, or the only one that may be sent. Nothing here is stored.
import { sharedFileTypeAllowed, sharedFileTypeOf } from '@sieve/shared';
import { getAttachment, getMessage, type GmailPart } from './api';

export interface AttachmentRef { name: string; mime: string; bytes: number; attachmentId: string }

/** Every part of the message that is a named attachment with bytes held apart from the body. */
export function attachmentsOf(payload: GmailPart | undefined): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    const id = part.body?.attachmentId;
    if (part.filename && id) {
      out.push({ name: part.filename, mime: sharedFileTypeOf(part.filename) ?? (part.mimeType ?? '').toLowerCase(), bytes: Math.max(0, part.body?.size ?? 0), attachmentId: id });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

/**
 * The attachment a request means: one whose name the question or its exact terms hold, else the only one that may be
 * sent. 'none' when the email has none that may be sent, 'several' when it has more than one and none is named.
 */
export function pickAttachment(list: readonly AttachmentRef[], asked: string): AttachmentRef | 'none' | 'several' {
  const sendable = list.filter((a) => sharedFileTypeAllowed(a.mime, a.name));
  if (sendable.length === 0) return 'none';
  const text = asked.toLowerCase();
  const named = sendable.filter((a) => {
    const name = a.name.toLowerCase();
    const stem = name.replace(/\.[a-z0-9]{1,5}$/, '');
    return text.includes(name) || (stem.length >= 4 && text.includes(stem));
  });
  if (named.length === 1) return named[0] as AttachmentRef;
  if (named.length > 1) return 'several';
  return sendable.length === 1 ? (sendable[0] as AttachmentRef) : 'several';
}

/** base64url, as Gmail sends it, to bytes. */
export function bytesFromBase64Url(data: string): Uint8Array<ArrayBuffer> {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function listAttachments(messageId: string, signal?: AbortSignal): Promise<AttachmentRef[]> {
  const msg = await getMessage(messageId, 'full', 'interactive', signal);
  return attachmentsOf(msg.payload);
}

export async function fetchAttachment(messageId: string, ref: AttachmentRef, signal?: AbortSignal): Promise<Blob> {
  const got = await getAttachment(messageId, ref.attachmentId, 'interactive', signal);
  return new Blob([bytesFromBase64Url(got.data ?? '')], { type: ref.mime });
}
