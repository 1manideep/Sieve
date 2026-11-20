// Stylesheet collection and declaration lookup (11 section 4.5).
// Declarations and style sheets are parsed by this file rather than by the CSSOM, for two reasons: the CSSOM drops
// properties it does not know (mso-hide, and some others in older engines), and the same parser gives the same result
// in the browser and in the test environment. Selectors are still matched by the engine (querySelectorAll).
import { DESKTOP_WIDTH_PX } from '../constants';

export interface Decl {
  prop: string;
  value: string;
  important: boolean;
  source: 'rule' | 'inline' | 'attr';
  order: number;
}

interface RawDecl { prop: string; value: string; important: boolean }

export const RELEVANT = new Set([
  'display', 'visibility', 'opacity', 'filter', 'font-size', 'color', '-webkit-text-fill-color',
  'background-color', 'background-image', 'position', 'left', 'top', 'right', 'bottom', 'text-indent', 'margin-left',
  'margin-top', 'transform', 'height', 'max-height', 'width', 'max-width', 'overflow', 'overflow-x', 'overflow-y',
  'line-height', 'clip', 'clip-path', 'content-visibility', 'white-space', 'mso-hide',
]);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ').replace(/<!--|-->/g, ' ');
}

/** Splits at `sep` outside quotes and parentheses. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Splits a value into tokens at whitespace outside quotes and parentheses. */
export function valueTokens(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < v.length; i++) {
    const c = v.charAt(i);
    if (quote) {
      cur += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(c) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function parseDeclarations(text: string): RawDecl[] {
  const out: RawDecl[] = [];
  for (const part of splitTop(stripComments(text), ';')) {
    if (part.includes('{') || part.includes('}')) continue;           // nested rules are ignored
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    let important = false;
    const imp = /!\s*important\s*$/i.exec(value);
    if (imp) {
      important = true;
      value = value.slice(0, imp.index).trim();
    }
    if (!prop || !value) continue;
    out.push({ prop, value: value.toLowerCase(), important });
  }
  return out;
}

const FONT_SIZE_KEYWORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'smaller', 'larger']);
const LENGTH_OR_PERCENT = /^-?\d*\.?\d+(?:px|pt|pc|em|rem|ex|ch|%|vw|vh|in|cm|mm|q)$/;

/** font-size and line-height from the `font` shorthand. A bare number other than 0 is a font weight. */
function fontShorthand(value: string): { size?: string; lineHeight?: string } {
  for (const tok of valueTokens(value)) {
    if (tok.startsWith('"') || tok.startsWith("'")) break;               // the family list started
    const slash = tok.indexOf('/');
    const sizePart = slash >= 0 ? tok.slice(0, slash) : tok;
    if (sizePart === '0' || LENGTH_OR_PERCENT.test(sizePart) || FONT_SIZE_KEYWORDS.has(sizePart)) {
      const lineHeight = slash >= 0 ? tok.slice(slash + 1) : undefined;
      return lineHeight ? { size: sizePart, lineHeight } : { size: sizePart };
    }
  }
  return {};
}

function boxSides(value: string): { top?: string; right?: string; bottom?: string; left?: string } {
  const t = valueTokens(value);
  if (t.length === 1) return { top: t[0], right: t[0], bottom: t[0], left: t[0] };
  if (t.length === 2) return { top: t[0], right: t[1], bottom: t[0], left: t[1] };
  if (t.length === 3) return { top: t[0], right: t[1], bottom: t[2], left: t[1] };
  if (t.length >= 4) return { top: t[0], right: t[1], bottom: t[2], left: t[3] };
  return {};
}

/** Expands the shorthands the hidden-text rules care about into longhands; keeps only relevant properties. */
export function expand(d: RawDecl): RawDecl[] {
  const out: RawDecl[] = [];
  const add = (prop: string, value: string | undefined) => {
    if (value !== undefined && value !== '') out.push({ prop, value, important: d.important });
  };
  switch (d.prop) {
    case 'font': {
      const f = fontShorthand(d.value);
      add('font-size', f.size);
      add('line-height', f.lineHeight);
      break;
    }
    case 'background': {
      if (/url\(|gradient\(|image-set\(/.test(d.value)) add('background-image', d.value);
      else add('background-image', 'none');
      const layers = splitTop(d.value, ',');
      const last = layers[layers.length - 1] ?? '';
      const colorTok = valueTokens(last).find((t) => !/^url\(|gradient\(/.test(t) && looksLikeColor(t));
      add('background-color', colorTok ?? 'transparent');
      break;
    }
    case 'overflow': {
      const [x, y] = valueTokens(d.value);
      add('overflow', d.value);
      add('overflow-x', x);
      add('overflow-y', y ?? x);
      break;
    }
    case 'margin': {
      const s = boxSides(d.value);
      add('margin-top', s.top);
      add('margin-left', s.left);
      break;
    }
    case 'inset': {
      const s = boxSides(d.value);
      add('top', s.top);
      add('right', s.right);
      add('bottom', s.bottom);
      add('left', s.left);
      break;
    }
    default:
      if (RELEVANT.has(d.prop)) out.push(d);
  }
  return out;
}

function looksLikeColor(tok: string): boolean {
  return /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\)|[a-z]+)$/.test(tok) &&
    !/^(?:none|repeat|repeat-x|repeat-y|no-repeat|space|round|scroll|fixed|local|top|bottom|left|right|center|cover|contain|auto|border-box|padding-box|content-box|text|inherit|initial|unset)$/.test(tok);
}

/** Declarations of an inline style attribute. */
export function inlineDecls(styleAttr: string): Decl[] {
  const out: Decl[] = [];
  let i = 0;
  for (const raw of parseDeclarations(styleAttr)) {
    for (const d of expand(raw)) out.push({ ...d, source: 'inline', order: 1e12 + i++ });
  }
  return out;
}

// ---------------------------------------------------------------- style sheets

interface SheetRule { selector: string; body: string }

/** Media text that applies at desktop width (1280 px): empty, all or screen, optionally with min-width conditions <= 1280. */
export function mediaAppliesAtDesktop(mediaText: string): boolean {
  const m = mediaText.trim().toLowerCase();
  if (!m) return true;
  return splitTop(m, ',').some((q) => {
    let rest = q.trim().replace(/^only\s+/, '');
    const type = /^(all|screen)\b/.exec(rest);
    if (type) rest = rest.slice(type[0].length).trim();
    else if (!rest.startsWith('(')) return false;
    if (/\b(max-width|max-device-width|orientation|print|prefers-color-scheme|hover|pointer|not)\b/.test(rest)) return false;
    rest = rest.replace(/^and\s+/, '');
    if (!rest) return true;
    for (const cond of rest.split(/\s+and\s+/)) {
      const c = /^\(\s*(min-width|min-device-width)\s*:\s*(\d*\.?\d+)(px|em|rem)?\s*\)$/.exec(cond.trim());
      if (!c) return false;
      const px = Number(c[2]) * (c[3] === 'em' || c[3] === 'rem' ? 16 : 1);
      if (px > DESKTOP_WIDTH_PX) return false;
    }
    return true;
  });
}

/** Finds the matching close brace for the open brace at `open`, skipping strings. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

function parseRules(css: string, out: SheetRule[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (open < 0) return;
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith('@') && semi >= 0 && semi < open) {        // statement at-rule (@charset, @import, @namespace, @layer a, b;)
      i = semi + 1;
      continue;
    }
    const close = blockEnd(css, open);
    const body = css.slice(open + 1, close);
    if (prelude.startsWith('@')) {
      const name = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? '';
      if (name === 'media' && mediaAppliesAtDesktop(prelude.slice(6))) parseRules(body, out);
      else if (name === 'supports') parseRules(body, out);
    } else if (prelude) {
      out.push({ selector: prelude, body });
    }
    i = close + 1;
  }
}

/** Rewrites html, body and :root to the body stand-in the pre-pass created. */
export function rewriteSelector(selector: string): string {
  return selector
    .replace(/(^|[\s>+~,(])(html|body)(?=$|[\s>+~,.#:[)])/gi, '$1[data-sieve-body]')
    .replace(/:root\b/g, '[data-sieve-body]');
}

/** Rule declarations per element, from every style element in root, in sheet order. */
export function collectRuleDecls(root: DocumentFragment): Map<Element, Decl[]> {
  const map = new Map<Element, Decl[]>();
  let order = 0;
  for (const styleEl of Array.from(root.querySelectorAll('style'))) {
    const css = stripComments(styleEl.textContent ?? '').replace(/@import[^;]*;/gi, '');
    const rules: SheetRule[] = [];
    try {
      parseRules(css, rules);
    } catch {
      continue;
    }
    for (const rule of rules) {
      const decls = parseDeclarations(rule.body).flatMap(expand);
      if (decls.length === 0) {
        order++;
        continue;
      }
      let matched: Element[];
      try {
        matched = Array.from(root.querySelectorAll(rewriteSelector(rule.selector)));
      } catch {
        order++;
        continue;                                                     // invalid or unsupported selector: skipped
      }
      const ruleOrder = order++;
      for (const el of matched) {
        let list = map.get(el);
        if (!list) {
          list = [];
          map.set(el, list);
        }
        for (const d of decls) list.push({ ...d, source: 'rule', order: ruleOrder });
      }
    }
  }
  return map;
}
