// Image bombs and moved items (70 section 3.7, R-FILE-08, R-IDX-06). The CR-6 item keys 70 described for R-OUT-10
// were replaced by HMAC item refs (01 section 11.8, app/services/itemRefs.ts), so none live here.
import type { SieveDb } from '@/index/db';

export const MAX_IMAGE_PIXELS = 100_000_000;
/** Only the start of a file is read for its dimensions. */
export const IMAGE_HEADER_BYTES = 256 * 1024;
/** R-FILE-08: a file over this size whose dimensions are unknown is not decoded. */
export const IMAGE_UNKNOWN_DIMS_MAX_BYTES = 10 * 1024 * 1024;
/** R-IDX-06: tombstone movedTo links followed at most this many times per id. */
export const MOVED_MAX_HOPS = 5;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Width and height from the header, without decoding: PNG IHDR (big-endian 32-bit values at bytes 16 and 20), or the
 * first JPEG SOF0 to SOF15 marker other than C4, C8 and CC (16-bit values at offsets 3 and 5 of the segment). Only
 * the first 256 KB are read; anything else, or a header that ends early, returns null.
 */
export function imageDims(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes.subarray(0, IMAGE_HEADER_BYTES);
  const u16 = (i: number) => ((b[i] as number) << 8) | (b[i + 1] as number);
  const u32 = (i: number) => (((b[i] as number) << 24) >>> 0) + ((b[i + 1] as number) << 16) + ((b[i + 2] as number) << 8) + (b[i + 3] as number);
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) {
    if (b.length < 24) return null;
    if (String.fromCharCode(b[12] as number, b[13] as number, b[14] as number, b[15] as number) !== 'IHDR') return null;
    return { width: u32(16), height: u32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;                       // a marker must start here
      let marker = b[i + 1] as number;
      let j = i + 1;
      while (marker === 0xff && j + 1 < b.length) {         // fill bytes
        j++;
        marker = b[j] as number;
      }
      i = j + 1;                                            // first byte after the marker code
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;   // no length
      if (marker === 0xd9 || marker === 0xda) return null;  // end of image or start of scan before any SOF
      if (i + 1 >= b.length) return null;
      const len = u16(i);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 6 >= b.length || len < 7) return null;
        return { height: u16(i + 3), width: u16(i + 5) };
      }
      i += len;
    }
  }
  return null;
}

/** R-FILE-08: decoding is safe only with known dimensions under the pixel cap, or a small file. */
export function safeToDecode(bytes: Uint8Array, fileSize: number): { ok: true; dims: { width: number; height: number } | null } | { ok: false; reason: 'too-large' } {
  const dims = imageDims(bytes);
  if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) return { ok: false, reason: 'too-large' };
  if (!dims && fileSize > IMAGE_UNKNOWN_DIMS_MAX_BYTES) return { ok: false, reason: 'too-large' };
  return { ok: true, dims };
}

/** The input ids plus every id reached by following tombstone movedTo links (at most 5 hops each), deduplicated. */
export async function expandMoved(db: SieveDb, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    out.push(id);
    return true;
  };
  for (const id of ids) add(id);
  for (const id of ids) {
    let cur = id;
    for (let hop = 0; hop < MOVED_MAX_HOPS; hop++) {
      const t = await db.tombstones.get(cur);
      const to = t?.movedTo;
      if (!to || to === cur) break;
      add(to);
      cur = to;
    }
  }
  return out;
}
