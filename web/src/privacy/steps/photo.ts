// Photos (11 section 10.6): the place name is never in any photo text; the shared copy is a re-encoded JPEG with no
// metadata, verified before it is offered (fail closed).
import type { IndexRecord } from '@sieve/shared';
import { PHOTO_ATTACHED_NOTE, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE } from '../constants';
import type { PreparedPhoto } from '../types';
import { formatDate } from './excerpt';
import { IMAGE_HEADER_BYTES, safeToDecode } from '@/robust/media';

type Exifr = typeof import('exifr');

function photoDate(record: Pick<IndexRecord, 'date' | 'photo'>): string {
  return formatDate(record.photo?.takenAt ?? record.date);
}

export function photoExcerptText(record: Pick<IndexRecord, 'date' | 'photo' | 'caption'>): string {
  return `Photo caption (${photoDate(record)}): ${record.caption ?? ''}`;
}

export function photoFullText(record: Pick<IndexRecord, 'date' | 'photo' | 'caption'>): string {
  const p = record.photo;
  const size = p && p.width > 0 && p.height > 0 ? ` (${p.width}×${p.height})` : '';
  const head = p?.takenAt !== undefined ? `Photo, taken ${formatDate(p.takenAt)}${size}.` : `Photo${size}.`;
  return `${head} Caption: ${record.caption ?? ''}\n${PHOTO_ATTACHED_NOTE}`;
}

const SENSITIVE_KEYS = /^(?:GPS|latitude$|longitude$|Make$|Model$|DateTimeOriginal$)/;

function metadataGroups(meta: Record<string, unknown> | undefined): string[] {
  if (!meta || typeof meta !== 'object') return [];
  const keys = Object.keys(meta);
  const out: string[] = [];
  if (keys.some((k) => /^GPS|^latitude$|^longitude$/.test(k))) out.push('location');
  if (keys.some((k) => k === 'Make' || k === 'Model')) out.push('camera');
  if (keys.includes('DateTimeOriginal')) out.push('date');
  if (keys.some((k) => !SENSITIVE_KEYS.test(k))) out.push('other metadata');
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const ATTEMPTS: readonly { edge: number; quality: number }[] = [
  { edge: PHOTO_MAX_EDGE, quality: 0.85 },
  { edge: PHOTO_MAX_EDGE, quality: 0.7 },
  { edge: 1200, quality: 0.7 },
  { edge: 1024, quality: 0.7 },
];

export async function preparePhotoForShare(blob: Blob): Promise<PreparedPhoto> {
  let exifr: Exifr | undefined;
  try {
    exifr = await import('exifr');
  } catch {
    exifr = undefined;
  }
  let removed: string[];
  try {
    removed = metadataGroups(exifr ? ((await exifr.parse(blob, true)) as Record<string, unknown> | undefined) : undefined);
  } catch {
    removed = [];
  }
  let bmp: ImageBitmap;
  // 70 R-FILE-08: never decode an image whose header declares more than MAX_IMAGE_PIXELS
  if (!safeToDecode(new Uint8Array(await blob.slice(0, IMAGE_HEADER_BYTES).arrayBuffer()), blob.size).ok) {
    return { ok: false, reason: 'This photo format cannot be prepared for sharing.' };
  }
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, reason: 'This photo format cannot be prepared for sharing.' };
  }
  try {
    let out: Blob | null = null;
    let width = 0;
    let height = 0;
    for (const a of ATTEMPTS) {
      const scale = Math.min(1, a.edge / Math.max(bmp.width, bmp.height));
      width = Math.max(1, Math.round(bmp.width * scale));
      height = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return { ok: false, reason: 'This photo is not available to share.' };
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bmp, 0, 0, width, height);
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality: a.quality });
      if (out.size <= PHOTO_MAX_BYTES) break;
      out = null;
    }
    if (!out) return { ok: false, reason: 'This photo is too large to share.' };
    // verify the copy carries no location, camera or date metadata; without the reader, it cannot be verified
    if (!exifr) return { ok: false, reason: 'Could not remove the location data from this photo.' };
    const gps = await exifr.gps(out).catch(() => undefined);
    const meta = (await exifr.parse(out).catch(() => undefined)) as Record<string, unknown> | undefined;
    if (gps !== undefined || (meta && Object.keys(meta).some((k) => SENSITIVE_KEYS.test(k)))) {
      return { ok: false, reason: 'Could not remove the location data from this photo.' };
    }
    const base64 = toBase64(new Uint8Array(await out.arrayBuffer()));
    return { ok: true, image: { mime: 'image/jpeg', base64, width, height, bytes: out.size }, removed };
  } catch {
    return { ok: false, reason: 'This photo is not available to share.' };
  } finally {
    bmp.close();
  }
}
