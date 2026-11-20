// Photo helpers (20 section 16.7, 70 R-FILE-08): header dimensions, thumbnails, the original for sharing.
import { IMAGE_UNKNOWN_DIMS_MAX_BYTES, MAX_IMAGE_PIXELS, THUMB_MAX_EDGE } from '../../index/config';
import type { SieveDb } from '../../index/db';
import { getRuntime } from '../../index/runtime';

/** PNG IHDR or the first JPEG SOF marker, from the first 256 KB; null for anything else. */
export function imageDims(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes.subarray(0, 256 * 1024);
  const be16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const be32 = (i: number) => (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { width: be32(16), height: be32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1] ?? 0;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      const len = be16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: be16(i + 5), width: be16(i + 7) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** Throws when decoding would be dangerous: too many pixels, or unknown size on a big file. */
export function assertDecodable(bytes: Uint8Array, size: number): { width: number; height: number } | null {
  const dims = imageDims(bytes);
  if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) throw Object.assign(new Error('image too large to decode'), { skip: 'too-large' as const });
  if (!dims && size > IMAGE_UNKNOWN_DIMS_MAX_BYTES) throw Object.assign(new Error('image size unknown'), { skip: 'too-large' as const });
  return dims;
}

/** Long edge THUMB_MAX_EDGE, JPEG 0.8, upright; a canvas holds only pixels, so no EXIF survives. */
export async function makeThumbnail(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') throw new Error('thumbnails need createImageBitmap and OffscreenCanvas');
  assertDecodable(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer()), blob.size);
  const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(probe.width, probe.height));
  const w = Math.max(1, Math.round(probe.width * scale));
  const h = Math.max(1, Math.round(probe.height * scale));
  probe.close();
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

/** The original photo, for 11's preparePhotoForShare and 10's captionPhoto: blobs store, the folder file or the asset. */
export async function getPhotoBlob(db: SieveDb, recordId: string): Promise<Blob> {
  const row = await db.blobs.get(recordId);
  if (row?.blob) return row.blob;
  const rec = await db.records.get(recordId);
  if (!rec) throw new DOMException('That photo is no longer on this device.', 'NotFoundError');
  if (rec.source === 'folder') {
    const { readFolderFile } = await import('../folder/connect');
    return readFolderFile(db, recordId);
  }
  if (rec.source === 'playground') {
    const { fetchPlaygroundFile } = await import('../../playground/assets');
    return fetchPlaygroundFile(rec.sourceRef);
  }
  throw new DOMException('That photo is no longer on this device.', 'NotFoundError');
}

/** An object URL for the thumbnail (stored, or made on demand for folder photos and cached in memory). */
export async function getThumbnailUrl(db: SieveDb, recordId: string): Promise<string | undefined> {
  const rt = getRuntime(db);
  const cached = rt.thumbUrls.get(recordId);
  if (cached) return cached;
  let thumb = (await db.blobs.get(recordId))?.thumb;
  if (!thumb) {
    try {
      thumb = await makeThumbnail(await getPhotoBlob(db, recordId));
    } catch {
      return undefined;
    }
  }
  const url = URL.createObjectURL(thumb);
  rt.thumbUrls.set(recordId, url);
  return url;
}
