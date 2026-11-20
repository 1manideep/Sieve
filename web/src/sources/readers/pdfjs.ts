// pdf.js text extraction (20 section 16.6, 70 R-FILE-03 and R-FILE-04). Loaded with import() on first use.
// Text only: nothing is rendered in Sieve's origin, and font faces are off (CVE-2024-4367). pdfjs-dist 6.5 no longer
// has the isEvalSupported option (70 V6), so it is not passed; the eval path it guarded was removed upstream.
import { getDocument, GlobalWorkerOptions, VerbosityLevel, PasswordException, InvalidPDFException } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_MAX_PAGES, PDF_TIMEOUT_MS } from '../../index/config';

GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfReadError extends Error {
  constructor(readonly reason: 'password' | 'unreadable', message: string) {
    super(message);
    this.name = 'PdfReadError';
  }
}

/** The getDocument options, exported so a test can assert them (R-FILE-04). */
export function pdfOptions(data: ArrayBuffer) {
  return {
    data: new Uint8Array(data),
    verbosity: VerbosityLevel.ERRORS,
    enableXfa: false,
    disableFontFace: true,
    cMapUrl: '/pdfjs/cmaps/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  };
}

export async function extractPdfText(data: ArrayBuffer): Promise<{ text: string; pages: number; truncated: boolean }> {
  const task = getDocument(pdfOptions(data));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfReadError('unreadable', 'PDF took too long to read')), PDF_TIMEOUT_MS);
  });
  try {
    const work = (async () => {
      const pdf = await task.promise;
      const pages = Math.min(pdf.numPages, PDF_MAX_PAGES);
      const parts: string[] = [];
      for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let s = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          s += item.str;
          if (item.hasEOL) s += '\n';
        }
        parts.push(s);
        page.cleanup();
      }
      return { text: parts.join('\n\n'), pages: pdf.numPages, truncated: pdf.numPages > PDF_MAX_PAGES };
    })();
    return await Promise.race([work, timeout]);
  } catch (e) {
    if (e instanceof PdfReadError) throw e;
    if (e instanceof PasswordException) throw new PdfReadError('password', 'PDF is password-protected');
    if (e instanceof InvalidPDFException) throw new PdfReadError('unreadable', 'PDF is damaged');
    throw new PdfReadError('unreadable', 'PDF could not be read');
  } finally {
    if (timer) clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}
