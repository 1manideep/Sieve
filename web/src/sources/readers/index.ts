// Readers (20 section 16.6): file type to text for folder files and uploads.
import type { ItemKind } from '@sieve/shared';
import { MAX_BYTES } from '../../index/config';
import type { SkipReason } from '../types';
import { chatToText } from './chat';
import { extractPdfText, isPdfReadError, looksLikeGarbage } from './pdf';
import { readTextBlob } from './text';

export { chatToText } from './chat';
export { extractPdfText, setPdfExtractor } from './pdf';
export { decodeBytes, decodeBase64UrlBytes, decodeEntities } from './decode';

export type FileType = 'text' | 'markdown' | 'pdf' | 'json' | 'jpeg' | 'png' | 'webp' | 'heic';

export interface ReadResult { kind: ItemKind; text?: string; date?: number; skip?: SkipReason; noText?: boolean }

export function fileTypeOf(name: string): FileType | null {
  const ext = /\.([^./\\]+)$/.exec(name.toLowerCase())?.[1] ?? '';
  switch (ext) {
    case 'txt': return 'text';
    case 'md': case 'markdown': return 'markdown';
    case 'pdf': return 'pdf';
    case 'json': return 'json';
    case 'jpg': case 'jpeg': return 'jpeg';
    case 'png': return 'png';
    case 'webp': return 'webp';
    case 'heic': case 'heif': return 'heic';
    default: return null;
  }
}

export function typeFromMime(mime: string | undefined): FileType | null {
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/json') return 'json';
  if (mime === 'text/markdown') return 'markdown';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'image/jpeg') return 'jpeg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  return null;
}

export function maxBytesFor(type: FileType): number {
  if (type === 'pdf') return MAX_BYTES.pdf;
  if (type === 'json') return MAX_BYTES.json;
  if (type === 'jpeg' || type === 'png' || type === 'webp' || type === 'heic') return MAX_BYTES.image;
  return MAX_BYTES.text;
}

export function isImageType(t: FileType | null): boolean {
  return t === 'jpeg' || t === 'png' || t === 'webp' || t === 'heic';
}

async function readJson(blob: Blob): Promise<ReadResult> {
  const { text, binary } = await readTextBlob(blob);
  if (binary) return { kind: 'document', skip: 'binary' };
  try {
    const parsed: unknown = JSON.parse(text);
    const chat = chatToText(parsed);
    if (chat) return { kind: 'document', text: chat.text, date: chat.lastDate };
    return { kind: 'document', text: JSON.stringify(parsed, null, 2) };
  } catch {
    return { kind: 'document', text };
  }
}

/** One file to text. Never throws: an unexpected reader error is `unreadable` (70 R-FILE-02). */
export async function readFileForIndex(file: Blob, type: FileType): Promise<ReadResult> {
  try {
    if (type === 'heic') return { kind: 'photo', skip: 'heic' };
    if (file.size > maxBytesFor(type)) return { kind: isImageType(type) ? 'photo' : 'document', skip: 'too-large' };
    if (isImageType(type)) {
      if (file.size === 0) return { kind: 'photo', skip: 'unreadable' };
      return { kind: 'photo' };
    }
    if (type === 'text' || type === 'markdown') {
      const { text, binary } = await readTextBlob(file);
      if (binary) return { kind: 'note', skip: 'binary' };
      return { kind: 'note', text };
    }
    if (type === 'json') return await readJson(file);
    if (type === 'pdf') {
      if (file.size === 0) return { kind: 'document', skip: 'unreadable' };
      try {
        const res = await extractPdfText(await file.arrayBuffer());
        if (looksLikeGarbage(res.text)) return { kind: 'document', text: '', noText: true };
        if (!res.text.trim()) return { kind: 'document', text: '', noText: true };
        return { kind: 'document', text: res.text };
      } catch (e) {
        if (isPdfReadError(e)) return { kind: 'document', skip: e.reason };
        return { kind: 'document', skip: 'unreadable' };
      }
    }
    return { kind: 'document', skip: 'unsupported' };
  } catch {
    return { kind: isImageType(type) ? 'photo' : 'document', skip: 'unreadable' };
  }
}

/** Uploads: the reader by extension, then MIME (20 section 16.6). Used by ingest for blobs without text. */
export async function readBlobText(blob: Blob, name: string, mime?: string): Promise<{ text: string; skip?: SkipReason }> {
  const type = fileTypeOf(name) ?? typeFromMime(mime ?? blob.type);
  if (!type) return { text: '', skip: 'unsupported' };
  if (isImageType(type)) return { text: '', skip: 'unsupported' };
  const r = await readFileForIndex(blob, type);
  return r.skip ? { text: '', skip: r.skip } : { text: r.text ?? '' };
}
