// Telling an HTML document from plain text. On its own, with nothing imported, so the index can ask without loading
// the sanitizer.

/**
 * A body sent as plain text that is in fact an HTML document (some mail systems do that). Read as text, the model got
 * the tags with the words and answered from the wrong line (Nov 22, 2026), and hidden text in it was never looked
 * for. Only clear cases count: a document or body element, or many closing tags of the kinds a page is built from.
 */
export function looksLikeHtmlDocument(text: string): boolean {
  if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text.slice(0, 2000))) return true;
  if (/<body[\s>]/i.test(text) && /<\/body\s*>/i.test(text)) return true;
  return (text.match(/<\/(?:p|div|td|tr|table|tbody|span|li|ul|ol|h[1-6]|center|font)\s*>/gi)?.length ?? 0) >= 8;
}
