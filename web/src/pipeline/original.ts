// The original of an item, for a request that asks for the file itself (Nov 22, 2026): the file in the connected
// folder, the stored photo, or an email's attachment fetched from Gmail. It is found here, before the person is
// asked, so the card can name it and say its size; it is uploaded only after they approve (relay/handoff.ts).
// An upload that is not a photo has no original on this computer: only its text was kept.
import { SHARED_FILE_MAX_BYTES, safeFileName, sharedFileTypeAllowed, sharedFileTypeOf, type IndexRecord } from '@sieve/shared';
import type { SieveDb } from '@/index';
import { photoBlobFor } from './optional';

export type OriginalMiss = 'none' | 'several' | 'kind' | 'too-large' | 'permission' | 'gone' | 'gmail' | 'reconnect';
export type Original = { ok: true; name: string; mime: string; bytes: number; blob: Blob } | { ok: false; why: OriginalMiss };

export interface OriginalDeps {
  readFolderFile(db: SieveDb, recordId: string): Promise<File>;
  listAttachments(messageId: string, signal?: AbortSignal): Promise<{ name: string; mime: string; bytes: number; attachmentId: string }[]>;
  fetchAttachment(messageId: string, ref: { name: string; mime: string; bytes: number; attachmentId: string }, signal?: AbortSignal): Promise<Blob>;
  pickAttachment(list: readonly { name: string; mime: string; bytes: number; attachmentId: string }[], asked: string): { name: string; mime: string; bytes: number; attachmentId: string } | 'none' | 'several';
}

async function loadDeps(): Promise<OriginalDeps> {
  const [folder, gmail] = await Promise.all([import('@/sources/folder/connect'), import('@/sources/gmail/attachments')]);
  return { readFolderFile: folder.readFolderFile, listAttachments: gmail.listAttachments, fetchAttachment: gmail.fetchAttachment, pickAttachment: gmail.pickAttachment };
}

function checked(name: string, blob: Blob, type?: string): Original {
  const safe = safeFileName(name);
  const mime = sharedFileTypeOf(safe) ?? (type ?? blob.type ?? '').toLowerCase();
  if (!sharedFileTypeAllowed(mime, safe)) return { ok: false, why: 'kind' };
  if (blob.size <= 0) return { ok: false, why: 'gone' };
  if (blob.size > SHARED_FILE_MAX_BYTES) return { ok: false, why: 'too-large' };
  return { ok: true, name: safe, mime, bytes: blob.size, blob };
}

/** The last part of a folder record's path, or a title that is a file name. */
function nameOf(rec: IndexRecord): string {
  const ref = rec.sourceRef ?? '';
  return rec.source === 'folder' && ref ? ref.slice(ref.lastIndexOf('/') + 1) : rec.title;
}

/**
 * `asked`: the question and its exact terms, to tell which attachment of an email is meant.
 * Never throws: a miss says why, in a word the card turns into a sentence.
 */
export async function originalFor(db: SieveDb, rec: IndexRecord, asked: string, opts: { signal?: AbortSignal; deps?: OriginalDeps } = {}): Promise<Original> {
  try {
    const deps = opts.deps ?? (await loadDeps());
    if (rec.kind === 'photo') {
      const blob = await photoBlobFor(db, rec.id);
      return blob ? checked(nameOf(rec), blob) : { ok: false, why: 'gone' };
    }
    if (rec.source === 'folder') {
      const file = await deps.readFolderFile(db, rec.id);
      return checked(file.name || nameOf(rec), file, file.type);
    }
    if (rec.source === 'gmail' && rec.kind === 'email') {
      const list = await deps.listAttachments(rec.sourceRef, opts.signal);
      const pick = deps.pickAttachment(list, asked);
      if (pick === 'none' || pick === 'several') return { ok: false, why: pick };
      if (pick.bytes > SHARED_FILE_MAX_BYTES) return { ok: false, why: 'too-large' };
      return checked(pick.name, await deps.fetchAttachment(rec.sourceRef, pick, opts.signal), pick.mime);
    }
    return { ok: false, why: 'none' };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'AbortError') throw e;
    if (name === 'PermissionNeededError') return { ok: false, why: 'permission' };
    if (name === 'NotFoundError' || name === 'GmailNotFoundError') return { ok: false, why: 'gone' };
    // Gmail's access on this computer ran out (it lasts an hour): the attachment cannot be fetched until it is renewed
    if (name === 'GmailAuthError') return { ok: false, why: 'reconnect' };
    if (rec.source === 'gmail') return { ok: false, why: 'gmail' };
    return { ok: false, why: 'gone' };
  }
}
