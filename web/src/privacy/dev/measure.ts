// Corpus measurements (11 sections 13.5 and 13.6): precision and recall per PII type, injection detection, latency.
// Used by the unit tests (validators, code patterns) and by the dev bench page (the real model and Nano).
import type { PiiSpan, PiiType } from '@sieve/shared';

export interface GoldSpan { match: string; occurrence?: number; type: PiiType; by?: 'validator' }

/** Offsets of the n-th (1-based) occurrence of match in text. */
export function locateGold(text: string, match: string, occurrence = 1): { start: number; end: number } {
  let at = -1;
  for (let i = 0; i < occurrence; i++) {
    at = text.indexOf(match, at + 1);
    if (at < 0) throw new Error(`"${match}" (occurrence ${occurrence}) is not in the text`);
  }
  return { start: at, end: at + match.length };
}

/** Every letter and digit of [start, end) is inside a span (of `type`, when given); spaces and commas between parts do not leak. */
export function covers(spans: readonly PiiSpan[], start: number, end: number, type?: PiiType, text?: string): boolean {
  for (let i = start; i < end; i++) {
    if (text !== undefined && !/[\p{L}\p{N}]/u.test(text.charAt(i))) continue;
    if (!spans.some((s) => s.start <= i && i < s.end && (type === undefined || s.type === type))) return false;
  }
  return true;
}

export function overlapsAny(spans: readonly PiiSpan[], start: number, end: number): boolean {
  return spans.some((s) => s.start < end && start < s.end);
}

export interface TypeScore { type: PiiType; gold: number; found: number; hidden: number; predicted: number; correct: number; recall: number; precision: number }

/**
 * Recall: a gold span counts as found when every letter and digit of it is covered by predicted spans of its type (a
 * partly hidden name still leaks); `hidden` counts it covered by spans of any type (what the person's privacy needs).
 * Precision: a predicted span is correct when it overlaps a gold span of its type.
 */
export function scoreSpans(cases: readonly { text: string; gold: readonly GoldSpan[]; predicted: readonly PiiSpan[] }[]): TypeScore[] {
  const types = new Map<PiiType, TypeScore>();
  const get = (t: PiiType) => {
    let s = types.get(t);
    if (!s) {
      s = { type: t, gold: 0, found: 0, hidden: 0, predicted: 0, correct: 0, recall: 0, precision: 0 };
      types.set(t, s);
    }
    return s;
  };
  for (const c of cases) {
    const gold = c.gold.map((g) => ({ ...g, ...locateGold(c.text, g.match, g.occurrence) }));
    for (const g of gold) {
      const s = get(g.type);
      s.gold++;
      if (covers(c.predicted, g.start, g.end, g.type, c.text)) s.found++;
      if (covers(c.predicted, g.start, g.end, undefined, c.text)) s.hidden++;
    }
    for (const p of c.predicted) {
      const s = get(p.type);
      s.predicted++;
      if (gold.some((g) => g.type === p.type && g.start < p.end && p.start < g.end)) s.correct++;
    }
  }
  return [...types.values()]
    .map((s) => ({ ...s, recall: s.gold ? s.found / s.gold : 1, precision: s.predicted ? s.correct / s.predicted : 1 }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

export function formatScores(title: string, scores: readonly TypeScore[]): string {
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(6);
  const rows = scores.map((s) => `  ${s.type.padEnd(8)} recall ${pct(s.recall)} (${s.found}/${s.gold})  hidden as any type ${s.hidden}/${s.gold}  precision ${pct(s.precision)} (${s.correct}/${s.predicted})`);
  return [title, ...rows].join('\n');
}

export interface InjectionScore { attacks: number; caught: number; benign: number; falseAlarms: number; quotesVerbatim: number; quotes: number }

export function scoreInjection(results: readonly { attack: boolean; suspicious: boolean; quote?: string; input: string }[]): InjectionScore {
  const s: InjectionScore = { attacks: 0, caught: 0, benign: 0, falseAlarms: 0, quotesVerbatim: 0, quotes: 0 };
  for (const r of results) {
    if (r.attack) {
      s.attacks++;
      if (r.suspicious) s.caught++;
    } else {
      s.benign++;
      if (r.suspicious) s.falseAlarms++;
    }
    if (r.suspicious && r.quote) {
      s.quotes++;
      if (r.input.includes(r.quote)) s.quotesVerbatim++;
    }
  }
  return s;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
