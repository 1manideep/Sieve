// parseCssColor(), contrastRatio() and compositing (11 section 4.5).
// Named colors, hex, rgb() and hsl() are parsed in code, so results are the same in the browser and in tests;
// other syntaxes (lab(), color-mix(), ...) fall back to the canvas normalization the spec describes, when a canvas exists.

export interface RGBA { r: number; g: number; b: number; a: number }

const NAMED =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
  'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
  'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
  'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b ' +
  'darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a ' +
  'darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 ' +
  'darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff ' +
  'firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 ' +
  'goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 ' +
  'indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 ' +
  'lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 ' +
  'lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa ' +
  'lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 ' +
  'linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 ' +
  'mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc ' +
  'mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead ' +
  'navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 ' +
  'palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 ' +
  'peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f ' +
  'royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d ' +
  'silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f ' +
  'steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 ' +
  'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';

const NAMED_COLORS = new Map(NAMED.split(' ').map((pair) => pair.split(':') as [string, string]));
const KEYWORDS_WITHOUT_COLOR = new Set(['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none', '']);

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function hexColor(h: string): RGBA | null {
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h;
  if (full.length !== 6 && full.length !== 8) return null;
  const n = (k: number) => parseInt(full.slice(k, k + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
}

function channel(v: string): number | null {
  if (v === 'none') return 0;
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(%?)$/i.exec(v);
  if (!m) return null;
  const x = Number(m[1]);
  return clamp(m[2] ? (x * 255) / 100 : x, 0, 255);
}

function alpha(v: string | undefined): number | null {
  if (v === undefined) return 1;
  if (v === 'none') return 0;
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(%?)$/i.exec(v);
  if (!m) return null;
  const x = Number(m[1]);
  return clamp(m[2] ? x / 100 : x, 0, 1);
}

function hue(v: string): number | null {
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(deg|grad|rad|turn)?$/i.exec(v);
  if (!m) return v === 'none' ? 0 : null;
  const x = Number(m[1]);
  switch ((m[2] ?? 'deg').toLowerCase()) {
    case 'grad': return (x * 360) / 400;
    case 'rad': return (x * 180) / Math.PI;
    case 'turn': return x * 360;
    default: return x;
  }
}

function percent(v: string): number | null {
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)%?$/i.exec(v);
  return m ? clamp(Number(m[1]), 0, 100) / 100 : v === 'none' ? 0 : null;
}

/** Splits "a, b, c" or "a b c / d" into channel strings and an optional alpha. */
function functionArgs(body: string): { parts: string[]; alpha?: string } | null {
  const [main, slash, ...rest] = body.split('/');
  if (rest.length > 0 || main === undefined) return null;
  const parts = main.includes(',') ? main.split(',').map((p) => p.trim()) : main.trim().split(/\s+/);
  if (slash !== undefined) return { parts, alpha: slash.trim() };
  if (parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3] };
  return { parts };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

let canvasCtx: OffscreenCanvasRenderingContext2D | null | undefined;
const SENTINEL = '#010203';

function canvasColor(value: string): RGBA | null {
  if (canvasCtx === undefined) {
    try {
      canvasCtx = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
    } catch {
      canvasCtx = null;
    }
  }
  if (!canvasCtx) return null;
  canvasCtx.fillStyle = SENTINEL;
  canvasCtx.fillStyle = value;
  const got = String(canvasCtx.fillStyle).toLowerCase();
  if (got === SENTINEL) return null;
  if (got.startsWith('#')) return hexColor(got.slice(1));
  const m = /^rgba?\(([^)]*)\)$/.exec(got);
  if (!m) return null;
  const nums = m[1]!.split(',').map((p) => Number(p.trim()));
  return { r: nums[0] ?? 0, g: nums[1] ?? 0, b: nums[2] ?? 0, a: nums[3] ?? 1 };
}

/** A CSS color value as RGBA, or null when it is not a color (currentcolor, inherit, invalid). */
export function parseCssColor(input: string): RGBA | null {
  const v = input.trim().toLowerCase();
  if (KEYWORDS_WITHOUT_COLOR.has(v)) return null;
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS.get(v);
  if (named) return hexColor(named);
  if (v.startsWith('#')) return /^#[0-9a-f]+$/.test(v) ? hexColor(v.slice(1)) : null;
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(v);
  if (fn) {
    const args = functionArgs(fn[2]!);
    if (!args || args.parts.length !== 3) return null;
    const a = alpha(args.alpha);
    if (a === null) return null;
    if (fn[1]!.startsWith('rgb')) {
      const [r, g, b] = args.parts.map(channel);
      if (r == null || g == null || b == null) return null;
      return { r, g, b, a };
    }
    const h = hue(args.parts[0]!);
    const s = percent(args.parts[1]!);
    const l = percent(args.parts[2]!);
    if (h === null || s === null || l === null) return null;
    const [r, g, b] = hslToRgb(h, s, l);
    return { r, g, b, a };
  }
  return canvasColor(v);
}

function luminance(c: RGBA): number {
  const ch = (x: number) => {
    const s = x / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** fg drawn over an opaque bg. */
export function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** WCAG 2 contrast ratio of two opaque colors. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
