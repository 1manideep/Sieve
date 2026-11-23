// sanitizeIncoming() (11 section 4): the plain text a person actually sees, and every hidden piece, recorded.
// Synchronous, main thread only, pure: no network, no storage.
import {
  CUT_NOTE,
  HIDDEN_FRAGMENT_MAX_CHARS,
  HIDDEN_FRAGMENTS_MAX,
  SANITIZE_MAX_TEXT_CHARS,
} from '../constants';
import { matchInjectionPatterns } from '../injection/patterns';
import { cutGraphemes } from '../text';
import type { SanitizeOptions } from '../types';
import { cleanChars, normalizeWhitespace } from './chars';
import { BLACK, WHITE } from './color';
import { collectRuleDecls, type Decl } from './css';
import { nextTextStyle, ownOpacity, ownStyle, subtreeHidden, textHidden, type TextStyle } from './hidden';
import { parseInert } from './prepare';
import { stripQuotedHtml, stripQuotedText } from './quotes';
import { fragmentText, LINE_TAGS, PARAGRAPH_TAGS, TextBuilder } from './text-builder';
import { looksLikeHtmlDocument } from './htmlText';

const SILENT_TAGS = new Set(['script', 'style', 'title', 'meta', 'link', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'svg', 'math', 'canvas', 'video', 'audio', 'map', 'area', 'source', 'track', 'head']);
const ATTRIBUTE_TEXT = ['alt', 'title', 'aria-label', 'aria-description', 'placeholder'];

interface WalkCtx {
  style: TextStyle;
  opacity: number;
  pre: boolean;
  row: { cells: number } | null;
}

function suspicious(s: string): boolean {
  return matchInjectionPatterns(s).suspicious;
}

function walk(node: Node, ctx: WalkCtx, tb: TextBuilder, rules: Map<Element, Decl[]>): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const data = (child as Text).data;
      if (textHidden(ctx.style)) tb.addHidden(data);
      else tb.addText(data, ctx.pre);
      continue;
    }
    if (child.nodeType === 8) {
      const data = (child as Comment).data;
      if (data.startsWith('[if') || data.startsWith('<![endif')) {
        if (suspicious(data)) tb.record(data);
        continue;
      }
      const plain = data.replace(/<[^>]+>/g, '');
      if (plain.trim().split(/\s+/).filter(Boolean).length >= 3 || suspicious(plain)) tb.record(plain);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.localName;

    if (SILENT_TAGS.has(tag)) {
      if (tag === 'script' || tag === 'style') {
        const t = el.textContent ?? '';
        if (suspicious(t)) tb.record(t);
      }
      continue;
    }
    if (tag === 'template') {
      const t = ((el as HTMLTemplateElement).content?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t.replace(/\s/g, '').length >= 2) tb.record(t);
      continue;
    }
    if (tag === 'noscript') {
      tb.record(fragmentText(el));
      continue;
    }
    for (const attr of tag === 'input' ? [...ATTRIBUTE_TEXT, 'value'] : ATTRIBUTE_TEXT) {
      const v = el.getAttribute(attr);
      if (v && suspicious(v)) tb.record(v);
    }

    const own = ownStyle(el, rules.get(el));
    if (subtreeHidden(own, ctx.opacity)) {
      tb.record(fragmentText(el));
      continue;
    }
    const whiteSpace = own.last('white-space');
    const next: WalkCtx = {
      style: nextTextStyle(ctx.style, own),
      opacity: ctx.opacity * ownOpacity(own),
      pre: ctx.pre || tag === 'pre' || tag === 'textarea' || (whiteSpace !== undefined ? whiteSpace.startsWith('pre') : false),
      row: ctx.row,
    };

    if (tag === 'br') {
      tb.lineBreak();
      continue;
    }
    if (tag === 'hr') {
      tb.ensure(2);
      continue;
    }
    if (tag === 'img' || tag === 'input') continue;
    if (tag === 'select') {
      const options = Array.from(el.querySelectorAll('option'));
      const chosen = options.find((o) => o.hasAttribute('selected')) ?? options[0];
      if (chosen && !textHidden(next.style)) tb.addText(` ${chosen.textContent ?? ''} `, false);
      continue;
    }

    const isBody = el.hasAttribute('data-sieve-body');
    const breaks = PARAGRAPH_TAGS.has(tag) ? 2 : LINE_TAGS.has(tag) || isBody ? 1 : 0;
    if (breaks) tb.ensure(breaks);
    if (tag === 'li') tb.addText('- ', true);
    if ((tag === 'td' || tag === 'th') && ctx.row) {
      if (ctx.row.cells > 0) tb.addText(' ', true);
      ctx.row.cells++;
    }
    if (tag === 'tr') next.row = { cells: 0 };
    walk(el, next, tb, rules);
    if (breaks) tb.ensure(breaks);
  }
}

/** Cleans visible text: characters, the invisible-character summary, whitespace, the length cap. */
function finishVisible(text: string, fragments: string[]): string {
  const cc = cleanChars(text);
  for (const t of cc.tagText) fragments.push(`Invisible tag text: ${t}`);
  const total = cc.invisibleInWords + cc.bidi;
  if (cc.bidi >= 1) fragments.push(`Invisible characters removed: ${total} (including text-direction controls)`);
  else if (cc.invisibleInWords >= 2) fragments.push(`Invisible characters removed: ${total}`);
  let out = normalizeWhitespace(cc.text);
  if (out.length > SANITIZE_MAX_TEXT_CHARS) {
    const cut = out.lastIndexOf('\n', SANITIZE_MAX_TEXT_CHARS);
    out = (cut > 0 ? out.slice(0, cut) : cutGraphemes(out, SANITIZE_MAX_TEXT_CHARS)) + CUT_NOTE;
  }
  return out;
}

/** Fragments: cleaned, collapsed, deduplicated, capped (4.10). */
export function finishFragments(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    let t = cleanChars(f).text.replace(/\s+/g, ' ').trim();
    if (t.replace(/\s/g, '').length < 2) continue;
    t = cutGraphemes(t, HIDDEN_FRAGMENT_MAX_CHARS, '…');
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  if (out.length > HIDDEN_FRAGMENTS_MAX) {
    const extra = out.length - HIDDEN_FRAGMENTS_MAX + 1;
    return [...out.slice(0, HIDDEN_FRAGMENTS_MAX - 1), `and ${extra} more hidden pieces`];
  }
  return out;
}

function sanitizeHtml(html: string, opts: SanitizeOptions): { text: string; hiddenRemoved: string[] } {
  const { root, doc } = parseInert(html);
  if (!opts.keepQuoted) stripQuotedHtml(root, doc);
  const rules = collectRuleDecls(root);
  const tb = new TextBuilder();
  const ctx: WalkCtx = {
    style: { fontPx: 16, color: BLACK, fill: null, bg: WHITE, visibility: 'visible' },
    opacity: 1,
    pre: false,
    row: null,
  };
  walk(root, ctx, tb, rules);
  const fragments = [...tb.fragments];
  const text = finishVisible(tb.text(), fragments);
  return { text, hiddenRemoved: finishFragments(fragments) };
}

export { looksLikeHtmlDocument };

export function sanitizeIncoming(raw: { html?: string; text?: string }, opts: SanitizeOptions = {}): { text: string; hiddenRemoved: string[] } {
  if (raw.html !== undefined && /\S/.test(raw.html)) return sanitizeHtml(raw.html, opts);
  if (raw.text !== undefined && looksLikeHtmlDocument(raw.text)) return sanitizeHtml(raw.text, opts);
  if (raw.text !== undefined) {
    const fragments: string[] = [];
    const base = raw.text.replace(/\r\n?/g, '\n');
    const text = finishVisible(opts.keepQuoted ? base : stripQuotedText(base), fragments);
    return { text, hiddenRemoved: finishFragments(fragments) };
  }
  return { text: '', hiddenRemoved: [] };
}
