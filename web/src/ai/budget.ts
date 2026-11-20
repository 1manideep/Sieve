// Token estimates from characters (10 section 9.4, decision A9). Nothing depends on the Prompt API's own counters.
// Han, Hiragana, Katakana, Hangul and Thai are close to one token per character (70 R-MDL-09), so they count 1 each.
import { CHARS_PER_TOKEN, IMAGE_TOKENS_ESTIMATE, RETRY_RESERVE_TOKENS } from './config';

// CJK punctuation and full-width forms (U+3000 to U+303F, U+FF00 to U+FFEF) count as dense too.
const DENSE_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\u3000-\u303F\uFF00-\uFFEF]/gu;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let dense = 0;
  let denseUnits = 0;
  for (const m of text.matchAll(DENSE_SCRIPT_RE)) {
    dense += 1;
    denseUnits += m[0].length;
  }
  return dense + Math.ceil((text.length - denseUnits) / CHARS_PER_TOKEN);
}

export function charsForTokens(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}

export function estimatePromptTokens(p: { system?: string; texts: string[]; images: number; schema?: object }): number {
  return (
    estimateTokens(p.system ?? '') +
    p.texts.reduce((sum, t) => sum + estimateTokens(t), 0) +
    estimateTokens(JSON.stringify(p.schema ?? '')) +
    p.images * IMAGE_TOKENS_ESTIMATE +
    RETRY_RESERVE_TOKENS
  );
}
