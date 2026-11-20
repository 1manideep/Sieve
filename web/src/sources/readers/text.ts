// Text and Markdown files (20 section 16.6, 70 R-FILE-07): decoded by charset rules, binary check after decoding.
import { decodeBytes } from './decode';

export async function readTextBlob(blob: Blob): Promise<{ text: string; binary: boolean; lossy: boolean }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const d = decodeBytes(bytes);
  const utf16 = d.encoding.startsWith('utf-16');
  const binary = !utf16 && bytes.subarray(0, 1024).includes(0);
  return { text: d.text.replace(/^\uFEFF/, ''), binary, lossy: d.lossy };
}
