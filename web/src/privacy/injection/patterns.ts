// Plain-code injection patterns (11 section 8.1). Applied to foldForMatch(sentence): lower case, confusables folded,
// invisible characters removed. They encode one distinction: text addressed to the human reader is fine; text that
// addresses an AI, changes its instructions, hides things from "the user", approves requests or moves data out is not.
import { INJECTION_QUOTE_MAX_CHARS, STAGE_VERSIONS } from '../constants';
import { cyrb53 } from '../hash';
import { foldForMatch } from '../sanitize/chars';
import { cutGraphemes, sentenceRanges } from '../text';
import type { ExtraPattern, PatternMatch, PatternReport } from '../types';

// The assistant product names 11 lists, except one that the repo does not name (see the WP3 report); the
// override, approve-all and exfiltrate patterns still catch instructions addressed to it.
const AI = String.raw`(?:ai|a\.i\.|llms?|language models?|ai assistants?|ai agents?|chatbots?|chat bots?|ai systems?|automated systems?|gpt|chatgpt|gemini|copilot)`;
const AI_OR_ASSISTANT = String.raw`(?:${AI}|assistants?|bots?)`;

interface CompiledPattern { id: string; weight: 1 | 2; re: RegExp }

export const BUILTIN_PATTERNS: readonly CompiledPattern[] = [
  // Strong: tries to override instructions
  { id: 'override', weight: 2, re: new RegExp(String.raw`\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|every)\s+(?:of\s+)?)?(?:(?:your|all)\s+(?:(?:previous|prior|earlier|above|preceding|original|initial|system|current|existing|safety)\s+)?|(?:(?:the|these|those)\s+)?(?:previous|prior|earlier|above|preceding|original|initial|system|safety)\s+)(?:instructions?|prompts?|directions|rules|guidelines|programming|guardrails)\b`) },
  // Strong: addresses an AI directly
  { id: 'ai-colon', weight: 2, re: new RegExp(String.raw`(?:^|[\s"'(\[])${AI}\s*:`) },
  { id: 'ai-vocative', weight: 2, re: new RegExp(String.raw`\b(?:dear|hey|hi|hello|attention|attn)[,:]?\s+${AI}\b`) },
  { id: 'note-to-ai', weight: 2, re: new RegExp(String.raw`\b(?:note|message|instructions?|reminder|request|notice|memo)\s+(?:to|for)\s+(?:(?:any|all|every)\s+${AI_OR_ASSISTANT}|(?:the\s+)?${AI})\b`) },
  { id: 'if-you-are-ai', weight: 2, re: new RegExp(String.raw`\bif\s+(?:you\s+are|you're|youre|you\s+were)\s+(?:an?\s+)?(?:${AI}|assistant)\b`) },
  { id: 'if-ai-reading', weight: 2, re: new RegExp(String.raw`\b(?:if|when|while)\s+(?:an?|any|the|some)\s+${AI_OR_ASSISTANT}\s+(?:is\s+|are\s+)?(?:reading|reads|summari[sz]ing|summari[sz]es|processing|processes|parsing|parses|analy[sz]ing|analy[sz]es|scanning|scans)\b`) },
  { id: 'ai-reading-this', weight: 2, re: new RegExp(String.raw`\b(?:any|an|the)\s+${AI_OR_ASSISTANT}\s+(?:reading|summari[sz]ing|processing|parsing|analy[sz]ing|scanning)\s+(?:this|these|the)\b`) },
  // Strong: system and prompt-format tokens
  { id: 'system-token', weight: 2, re: /(?:system prompt|developer (?:message|mode)|<\|?(?:im_start|im_end|system|endoftext)\|?>|\[(?:system|inst|\/inst)\]|###\s*(?:system|instruction)|begin (?:system|admin|developer) (?:message|prompt|override|instructions)|jailbreak|\bdan mode\b|new (?:system )?instructions\s*:)/ },
  // Strong: hides something from the person
  { id: 'conceal', weight: 2, re: /\b(?:do not|don't|dont|never|without)\s+(?:mention(?:ing)?|tell(?:ing)?|reveal(?:ing)?|show(?:ing)?|disclos(?:e|ing)|inform(?:ing)?|alert(?:ing)?|referenc(?:e|ing))\s+(?:this sentence|this instruction|these instructions|this note|this request|this part|the user|the reader|the human|the person|the recipient)\b/ },
  // Strong: speaks about the person as "the user"
  { id: 'tell-the-user', weight: 2, re: /\b(?:tell|ask|instruct|convince|persuade|urge|remind|get)\s+(?:the user|the reader|the human|the person|the recipient)\s+(?:to|that)\b/ },
  // Strong: approval manipulation
  { id: 'approve-all', weight: 2, re: /\b(?:approve|accept|allow|authori[sz]e)\s+(?:all|every|any|each)\s+(?:of\s+)?(?:the\s+)?(?:pending\s+|open\s+|waiting\s+)?(?:requests?|shares?|permissions?|access|actions?)\b|\bauto-?approve\b/ },
  // Medium: moves data to an outside address
  { id: 'exfiltrate', weight: 1, re: /\b(?:forward|send|email|e-mail|share|upload|post|transmit|exfiltrate|copy|leak|export)\b[^.!?\n]{0,60}\b(?:bank statements?|statements?|passwords?|credentials?|logins?|api keys?|tokens?|secrets?|ssn|social security(?: numbers?)?|card numbers?|account numbers?|inbox|emails|messages|contacts|files|documents|addresses|photos|records|data|history|codes?)\b[^.!?\n]{0,40}\b(?:to|at|into)\s+(?:\S+@\S+|https?:\/\/\S+|www\.\S+|this (?:address|email|link|url))/ },
  // Medium: asks for the person's details in the third person
  { id: 'user-data', weight: 1, re: /\b(?:include|add|insert|append|reveal|list|give|provide|output|print|tell (?:me|us))\b[^.!?\n]{0,30}\b(?:the user'?s?|the person'?s?|the recipient'?s?)\s+(?:home\s+|full\s+|current\s+)?(?:address|phone(?: number)?|email|password|ssn|social security|date of birth|birthday|card|account|location|contacts|statements?)\b/ },
  // Medium: addresses the reader's output
  { id: 'your-reply', weight: 1, re: /\b(?:in|to|into)\s+your\s+(?:reply|response|summary|answer|output)\b/ },
];

let extraPatterns: CompiledPattern[] = [];
let extraVersion = '';

/** Adds patterns (for example from Remote Config); invalid ones are ignored. It can only add. */
export function setExtraInjectionPatterns(patterns: ExtraPattern[]): void {
  const compiled: CompiledPattern[] = [];
  for (const p of patterns) {
    try {
      compiled.push({ id: p.id, weight: p.weight === 2 ? 2 : 1, re: new RegExp(p.source, (p.flags ?? '').replace(/[gy]/g, '')) });
    } catch {
      // an invalid pattern is skipped
    }
  }
  extraPatterns = compiled;
  extraVersion = patterns.length > 0 ? cyrb53(JSON.stringify(patterns)).toString(36) : '';
}

/** The `code` injection stamp version, which changes when extra patterns change (8.1). */
export function patternsVersion(): string {
  return extraVersion ? `${STAGE_VERSIONS.patterns}:${extraVersion}` : STAGE_VERSIONS.patterns;
}

/** Scores each sentence of text; suspicious when one sentence scores 2 or more. */
export function matchInjectionPatterns(text: string): PatternReport {
  const patterns = extraPatterns.length > 0 ? [...BUILTIN_PATTERNS, ...extraPatterns] : BUILTIN_PATTERNS;
  const matches: PatternMatch[] = [];
  let score = 0;
  let quote: string | undefined;
  for (const r of sentenceRanges(text)) {
    const sentence = text.slice(r.start, r.end);
    const folded = foldForMatch(sentence);
    const ids = new Map<string, 1 | 2>();
    for (const p of patterns) {
      if (p.re.test(folded)) {
        ids.set(p.id, p.weight);
        matches.push({ id: p.id, weight: p.weight, sentence, start: r.start, end: r.end });
      }
    }
    let s = 0;
    for (const w of ids.values()) s += w;
    if (s > score) {
      score = s;
      quote = cutGraphemes(sentence.trim(), INJECTION_QUOTE_MAX_CHARS);
    }
  }
  const suspicious = score >= 2;
  return suspicious ? { score, suspicious, matches, quote } : { score, suspicious, matches };
}

/** Sentence ranges whose own score is at least 2, merged and in order. */
export function suspiciousSentences(text: string): { start: number; end: number }[] {
  const scores = new Map<string, { start: number; end: number; ids: Map<string, number> }>();
  for (const m of matchInjectionPatterns(text).matches) {
    const key = `${m.start}:${m.end}`;
    const entry = scores.get(key) ?? { start: m.start, end: m.end, ids: new Map<string, number>() };
    entry.ids.set(m.id, m.weight);
    scores.set(key, entry);
  }
  const out: { start: number; end: number }[] = [];
  for (const e of scores.values()) {
    let s = 0;
    for (const w of e.ids.values()) s += w;
    if (s >= 2) out.push({ start: e.start, end: e.end });
  }
  return out.sort((a, b) => a.start - b.start);
}
