// Photo metadata with exifr (20 section 16.7). GPS numbers are read only to set hadGps; they are never stored.
// No geocoding, ever: `place` comes only from names already written in the photo.
import type { PhotoMeta } from '@sieve/shared';
import { IngestError } from '../../index/errors';
import { assertDecodable } from './image';

interface ExifOut {
  DateTimeOriginal?: unknown; CreateDate?: unknown; latitude?: unknown; longitude?: unknown; Orientation?: unknown;
  Sublocation?: unknown; Location?: unknown; City?: unknown; State?: unknown; ProvinceState?: unknown; Country?: unknown; CountryName?: unknown;
}

const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

function validDate(v: unknown, now: number): number | undefined {
  const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : undefined;
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < Date.UTC(1990, 0, 1) || ms > now + 86_400_000) return undefined;
  return ms;
}

function placeOf(m: ExifOut | undefined): string | undefined {
  if (!m) return undefined;
  const parts = [m.Sublocation ?? m.Location, m.City, m.State ?? m.ProvinceState, m.Country ?? m.CountryName]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length === 0) return undefined;
  return unique.join(', ').slice(0, 80);
}

async function decodedSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    throw new IngestError('unreadable', 'This photo could not be opened.');
  }
}

export async function readPhotoMeta(blob: Blob, fileName: string, fallbackDate: number): Promise<PhotoMeta> {
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  let header: { width: number; height: number } | null;
  try {
    header = assertDecodable(head, blob.size);
  } catch {
    throw new IngestError('too-large', 'This photo is too large to open safely.');
  }
  let meta: ExifOut | undefined;
  try {
    const exifr = (await import('exifr')).default;
    // bytes, not the Blob: exifr reads a Uint8Array the same way everywhere (files are at most 30 MB)
    meta = (await exifr.parse(new Uint8Array(await blob.arrayBuffer()), {
      tiff: true, exif: true, gps: true, xmp: true, iptc: true, ihdr: true, icc: false, jfif: false,
      mergeOutput: true, translateValues: true, reviveValues: true,
    })) as ExifOut | undefined;
  } catch {
    meta = undefined;
  }
  const now = Date.now();
  const takenAt = validDate(meta?.DateTimeOriginal, now) ?? validDate(meta?.CreateDate, now) ?? fallbackDate;
  const hadGps = typeof meta?.latitude === 'number' && typeof meta?.longitude === 'number';
  let dims = await decodedSize(blob);
  if (!dims && header) {
    const o = typeof meta?.Orientation === 'number' ? meta.Orientation : typeof meta?.Orientation === 'string' && /90|270/.test(meta.Orientation) ? 6 : 1;
    dims = o >= 5 && o <= 8 ? { width: header.height, height: header.width } : header;
  }
  if (!dims) throw new IngestError('unreadable', 'This photo could not be opened.');
  const ext = /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1] ?? '';
  const out: PhotoMeta = { takenAt, width: dims.width, height: dims.height, mime: blob.type || MIME_BY_EXT[ext] || 'application/octet-stream', hadGps };
  const place = placeOf(meta);
  if (place) out.place = place;
  return out;
}
