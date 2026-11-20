// PDF reading through pdf.js, loaded lazily, with the garbage-text check of 70 R-FILE-06.
export interface PdfText { text: string; pages: number; truncated: boolean }

type Extract = (data: ArrayBuffer) => Promise<PdfText>;
let extractor: Extract | null = null;

/** Tests replace the pdf.js extractor (pdf.js needs a browser worker). */
export function setPdfExtractor(fn: Extract | null): void {
  extractor = fn;
}

export async function extractPdfText(data: ArrayBuffer): Promise<PdfText> {
  if (extractor) return extractor(data);
  const mod = await import('./pdfjs');
  return mod.extractPdfText(data);
}

/** 200+ characters that are mostly not letters, digits, spaces or punctuation, or full of U+FFFD and private use. */
export function looksLikeGarbage(text: string): boolean {
  if (text.length < 200) return false;
  let good = 0;
  let bad = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}\s.,;:!?'"()[\]{}\-–—/\\@#$%&*+=<>_|~`^€£¥]/u.test(ch)) good++;
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '�' || (cp >= 0xe000 && cp <= 0xf8ff)) bad++;
  }
  const n = [...text].length;
  return good / n < 0.6 || bad / n > 0.1;
}

export function isPdfReadError(e: unknown): e is { reason: 'password' | 'unreadable' } {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'PdfReadError';
}
