// HTML pre-pass and inert parsing (11 section 4.2). The markup goes into a <template>, whose content document has
// no browsing context: nothing in it loads (no tracking pixel, no frame) and no script runs. It is never inserted
// into the live page.
import { SANITIZE_MAX_HTML_CHARS } from '../constants';

export interface Parsed {
  root: DocumentFragment;
  doc: Document;
}

/** Cuts at most max units without splitting a surrogate pair. */
function cutRaw(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

export function prepareHtml(html: string): string {
  let s = cutRaw(html, SANITIZE_MAX_HTML_CHARS);
  s = s.replace(/<\/?(html|head)(\s[^>]*)?>/gi, '');
  let found = false;
  s = s.replace(/<body(\s[^>]*)?>/gi, (_m: string, attrs: string | undefined) => {
    found = true;
    return `<div data-sieve-body${attrs ?? ''}>`;
  });
  s = s.replace(/<\/body\s*>/gi, '</div>');
  if (!found) s = `<div data-sieve-body>${s}</div>`;
  return s;
}

export function parseInert(html: string): Parsed {
  const doc = new DOMParser().parseFromString('<!doctype html><title></title>', 'text/html');
  const tpl = doc.createElement('template');
  // Parsing into an inert template that is never attached to the page (11 section 4.2); no text is rendered from it.
  // eslint-disable-next-line no-restricted-properties
  tpl.innerHTML = prepareHtml(html);
  return { root: tpl.content, doc };
}
