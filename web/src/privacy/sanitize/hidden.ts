// The hidden-content rules (11 section 4.4) and the own-value policies of section 4.5.
import {
  MIN_VISIBLE_CONTRAST,
  MIN_VISIBLE_FONT_PX,
  MIN_VISIBLE_OPACITY,
  OFFSCREEN_PX,
  TINY_BOX_PX,
} from '../constants';
import { composite, contrastRatio, parseCssColor, type RGBA } from './color';
import { inlineDecls, valueTokens, type Decl } from './css';

/** Properties whose every declared value counts (attack-resistant union); the rest use last-wins. */
const LAST_WINS = new Set(['color', '-webkit-text-fill-color', 'background-color', 'background-image', 'white-space']);

export interface OwnStyle {
  /** Every counted value of a union property (only the inline !important ones when there are any). */
  all(prop: string): string[];
  /** The winning value of a last-wins property. */
  last(prop: string): string | undefined;
  /** Raw style attribute contains mso-hide: all (H12). */
  msoHide: boolean;
}

function attrDecls(el: Element): Decl[] {
  const out: Decl[] = [];
  const add = (prop: string, value: string | null) => {
    if (value !== null && value.trim()) out.push({ prop, value: value.trim().toLowerCase(), important: false, source: 'attr', order: -1 });
  };
  add('background-color', el.getAttribute('bgcolor'));
  if (el.localName === 'font') add('color', el.getAttribute('color'));
  if (el.hasAttribute('data-sieve-body')) add('color', el.getAttribute('text'));
  if (el.hasAttribute('hidden')) add('display', 'none');
  return out;
}

function rank(d: Decl): number {
  if (d.source === 'inline') return d.important ? 4 : 2;
  if (d.source === 'rule') return d.important ? 3 : 1;
  return 0;
}

export function ownStyle(el: Element, ruleDecls: readonly Decl[] | undefined): OwnStyle {
  const rawStyle = el.getAttribute('style') ?? '';
  const decls = [...attrDecls(el), ...(ruleDecls ?? []), ...(rawStyle ? inlineDecls(rawStyle) : [])];
  const byProp = new Map<string, Decl[]>();
  for (const d of decls) {
    const list = byProp.get(d.prop);
    if (list) list.push(d);
    else byProp.set(d.prop, [d]);
  }
  const msoHide = /mso-hide\s*:\s*all/i.test(rawStyle) || (byProp.get('mso-hide') ?? []).some((d) => d.value === 'all');
  return {
    msoHide,
    all(prop) {
      const list = byProp.get(prop);
      if (!list) return [];
      const inlineImportant = list.filter((d) => d.source === 'inline' && d.important);
      return (inlineImportant.length > 0 ? inlineImportant : list).map((d) => d.value);
    },
    last(prop) {
      const list = byProp.get(prop);
      if (!list || !LAST_WINS.has(prop)) return undefined;
      let best: Decl | undefined;
      for (const d of list) {
        if (!best || rank(d) > rank(best) || (rank(d) === rank(best) && d.order >= best.order)) best = d;
      }
      return best?.value;
    },
  };
}

/** A px length (or a unitless number) as a number. */
export function parsePx(v: string | undefined): number | null {
  const m = /^(-?\d*\.?\d+)(px)?$/.exec((v ?? '').trim());
  return m ? Number(m[1]) : null;
}

const FONT_KEYWORDS: Record<string, number> = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32 };

export function resolveFontPx(v: string, parentPx: number): number | null {
  const s = v.trim();
  if (s === '0') return 0;
  if (s in FONT_KEYWORDS) return FONT_KEYWORDS[s]!;
  if (s === 'smaller') return parentPx * 0.83;
  if (s === 'larger') return parentPx * 1.2;
  const m = /^(-?\d*\.?\d+)(px|pt|em|rem|%)$/.exec(s);
  if (!m) return null;
  const x = Number(m[1]);
  switch (m[2]) {
    case 'px': return x;
    case 'pt': return (x * 4) / 3;
    case 'em': return x * parentPx;
    case 'rem': return x * 16;
    default: return (x * parentPx) / 100;
  }
}

function number(v: string): number | null {
  const m = /^(-?\d*\.?\d+)(%?)$/.exec(v.trim());
  if (!m) return null;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
}

function functionCalls(value: string, names: RegExp): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`\\b(${names.source})\\(([^)]*)\\)`, 'g');
  for (const m of value.matchAll(re)) out.push(m[2]!.split(/[\s,]+/).filter(Boolean));
  return out;
}

/** Own opacity factor: the minimum of opacity values and filter: opacity() values (H5). */
export function ownOpacity(s: OwnStyle): number {
  let min = 1;
  for (const v of s.all('opacity')) {
    const x = number(v);
    if (x !== null) min = Math.min(min, x);
  }
  for (const v of s.all('filter')) {
    for (const args of functionCalls(v, /opacity/)) {
      const x = args[0] !== undefined ? number(args[0]) : null;
      if (x !== null) min = Math.min(min, x);
    }
  }
  return min;
}

const HIDING_OVERFLOW = new Set(['hidden', 'clip']);

function anyPx(values: string[], test: (px: number) => boolean): boolean {
  return values.some((v) => {
    const px = parsePx(v);
    return px !== null && test(px);
  });
}

/** Subtree rules H1/H2/H3, H5, H8 to H13: true when the element and everything inside it is hidden. */
export function subtreeHidden(s: OwnStyle, parentOpacity: number): boolean {
  if (s.all('display').includes('none')) return true;                                       // H1, H2, H3
  if (s.all('content-visibility').includes('hidden')) return true;                          // H13
  if (s.msoHide) return true;                                                               // H12
  if (parentOpacity * ownOpacity(s) < MIN_VISIBLE_OPACITY) return true;                     // H5

  const positioned = s.all('position').some((p) => p === 'absolute' || p === 'fixed');     // H8
  if (positioned && ['left', 'top', 'right', 'bottom'].some((side) => anyPx(s.all(side), (px) => px <= -OFFSCREEN_PX))) return true;
  if (['text-indent', 'margin-left', 'margin-top'].some((p) => anyPx(s.all(p), (px) => px <= -OFFSCREEN_PX))) return true;
  for (const t of s.all('transform')) {
    for (const args of functionCalls(t, /translate(?:X|Y|3d)?/i)) {
      if (args.some((a) => /px$/.test(a) && Math.abs(Number.parseFloat(a)) >= OFFSCREEN_PX)) return true;
    }
    for (const args of functionCalls(t, /scale(?:X|Y|3d)?/i)) {                              // H11
      if (args.some((a) => {
        const x = number(a);
        return x !== null && x < 0.1;
      })) return true;
    }
    for (const args of functionCalls(t, /matrix/)) {
      const a = number(args[0] ?? '');
      const d = number(args[3] ?? '');
      if ((a !== null && a < 0.1) || (d !== null && d < 0.1)) return true;
    }
  }

  const overflowY = [...s.all('overflow'), ...s.all('overflow-y')].some((v) => valueTokens(v).some((t) => HIDING_OVERFLOW.has(t)));
  const overflowX = [...s.all('overflow'), ...s.all('overflow-x')].some((v) => valueTokens(v).some((t) => HIDING_OVERFLOW.has(t)));
  const tiny = (px: number) => px <= TINY_BOX_PX;
  if (overflowY && (anyPx(s.all('height'), tiny) || anyPx(s.all('max-height'), tiny))) return true;   // H9
  if (overflowX && (anyPx(s.all('width'), tiny) || anyPx(s.all('max-width'), tiny))) return true;
  if (overflowY && s.all('line-height').some((v) => v === '0' || (/px$/.test(v) && tiny(Number.parseFloat(v))))) return true;

  for (const v of s.all('clip')) {                                                          // H10
    const args = functionCalls(v, /rect/)[0];
    if (args && args.length === 4 && args.every((a) => {
      const px = parsePx(a);
      return px !== null && px <= 1;
    })) return true;
  }
  for (const v of s.all('clip-path')) {
    const inset = /^inset\(\s*(\d*\.?\d+)%/.exec(v);
    if (inset && Number(inset[1]) >= 50) return true;
    if (/^circle\(\s*0(?:px|%)?(?:\s|\)|$)/.test(v)) return true;
    const poly = /^polygon\(([^)]*)\)/.exec(v);
    if (poly) {
      const points = poly[1]!.split(',').map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (points.length > 0 && points.every((p) => p === points[0])) return true;
    }
  }
  return false;
}

export interface TextStyle {
  fontPx: number;
  color: RGBA;
  fill: RGBA | null;              // -webkit-text-fill-color, when set
  bg: RGBA | 'unknown';
  visibility: 'visible' | 'hidden';
}

/** Text rules H4, H6, H7: true when a text node with this inherited style is hidden. */
export function textHidden(t: TextStyle): boolean {
  if (t.visibility === 'hidden') return true;                                              // H4
  if (t.fontPx < MIN_VISIBLE_FONT_PX) return true;                                         // H6
  if (t.bg === 'unknown') return false;                                                    // H7 skipped over images
  if (t.color.a < 0.1) return true;
  if (t.fill && t.fill.a < 0.1) return true;
  const shown = t.fill ?? t.color;
  return contrastRatio(composite(shown, t.bg), t.bg) < MIN_VISIBLE_CONTRAST;
}

/** Applies an element's own declarations to the inherited text style (4.5 inherited properties). */
export function nextTextStyle(parent: TextStyle, s: OwnStyle): TextStyle {
  let fontPx = parent.fontPx;
  const sizes = s.all('font-size').map((v) => resolveFontPx(v, parent.fontPx)).filter((x): x is number => x !== null);
  if (sizes.length > 0) fontPx = Math.min(...sizes);

  let visibility = parent.visibility;
  const vis = s.all('visibility');
  if (vis.some((v) => v === 'hidden' || v === 'collapse')) visibility = 'hidden';
  else if (vis.length > 0) visibility = 'visible';

  const colorValue = s.last('color');
  const color = (colorValue !== undefined ? parseCssColor(colorValue) : null) ?? parent.color;
  const fillValue = s.last('-webkit-text-fill-color');
  const fill = fillValue !== undefined ? parseCssColor(fillValue) ?? parent.fill : parent.fill;

  let bg = parent.bg;
  const image = s.last('background-image');
  const bgValue = s.last('background-color');
  const bgColor = bgValue !== undefined ? parseCssColor(bgValue) : null;
  if (image !== undefined && image !== 'none') bg = 'unknown';
  else if (bgColor && bgColor.a >= 1) bg = bgColor;
  else if (bgColor && bgColor.a > 0 && bg !== 'unknown') bg = composite(bgColor, bg);
  return { fontPx, color, fill, bg, visibility };
}
