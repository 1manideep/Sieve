// Image parts for the model (10 section 10.4): decode, scale the long edge to IMAGE_MAX_EDGE_PX, re-encode as JPEG.
// Re-encoding drops EXIF, including GPS.
import { IMAGE_HEADER_BYTES, safeToDecode } from '@/robust/media';
import { IMAGE_JPEG_QUALITY, IMAGE_MAX_EDGE_PX } from './config';

const SLICE = 32 * 1024;

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += SLICE) {
    out += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(out);
}

export async function toJpegPart(blob: Blob): Promise<{ inlineData: { mimeType: 'image/jpeg'; data: string }; bytes: number }> {
  // 70 R-FILE-08: never decode an image whose header declares more than MAX_IMAGE_PIXELS
  if (!safeToDecode(new Uint8Array(await blob.slice(0, IMAGE_HEADER_BYTES).arrayBuffer()), blob.size).ok) {
    throw new DOMException('This image is too large to decode safely.', 'NotSupportedError');
  }
  const bitmap = await createImageBitmap(blob);   // rejects for formats Chrome cannot decode, such as HEIC
  try {
    const scale = Math.min(1, IMAGE_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: IMAGE_JPEG_QUALITY });
    return { inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(jpeg) }, bytes: jpeg.size };
  } finally {
    bitmap.close();
  }
}
