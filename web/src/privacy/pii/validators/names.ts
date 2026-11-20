// Names from greetings, sign-offs and titles (11 section 5.2). The model and Nano find names elsewhere in the text.
import type { PiiSpan } from '@sieve/shared';
import { vspan } from './span';

/** A case-insensitive form of a word as character classes (no regex modifiers needed). */
function ci(word: string): string {
  return [...word].map((c) => (/[a-z]/i.test(c) ? `[${c.toUpperCase()}${c.toLowerCase()}]` : c === ' ' ? ' ' : c)).join('');
}

const NAME_WORD = String.raw`\p{Lu}[\p{L}'’-]+`;
const TITLES = '(?:Mr|Mrs|Ms|Mx|Dr|Prof)';
const GREETING_WORDS = ['Hi', 'Hello', 'Hey', 'Dear', 'Good morning', 'Good afternoon', 'Good evening'].map(ci).join('|');
const GREETING = new RegExp(String.raw`^\s*(?:${GREETING_WORDS})[ ,]+(?:${TITLES}\.?\s+)?(${NAME_WORD}(?:\s+${NAME_WORD}){0,2})\s*[,!:]`, 'du');
const TITLE = new RegExp(String.raw`\b${TITLES}\.?\s+(${NAME_WORD}(?:\s+${NAME_WORD})?)`, 'gu');
const SIGNOFF_NAME = new RegExp(String.raw`^${NAME_WORD}(?:\s+${NAME_WORD}){0,2}$`, 'u');

export const GREETING_EXCLUDE: ReadonlySet<string> = new Set(['All', 'Team', 'There', 'Everyone', 'Folks', 'Friends', 'Sir', 'Madam', 'Customer', 'Member', 'User', 'Neighbor', 'Neighbour', 'Tenant', 'Resident', 'Valued', 'Colleagues', 'Support']);
const SIGNOFFS = ['best', 'thanks', 'thank you', 'regards', 'kind regards', 'best regards', 'warm regards', 'cheers', 'sincerely', 'yours', 'love', 'take care'];
const SIGNOFFS_LONGEST_FIRST = [...SIGNOFFS].sort((a, b) => b.length - a.length);
export const ORG_WORDS: ReadonlySet<string> = new Set(['Management', 'Inc', 'LLC', 'Ltd', 'Team', 'Services', 'Bank', 'Group', 'Support', 'Office', 'Department', 'Company', 'Property', 'Health', 'Clinic', 'Store', 'Desk', 'Bot']);

function isSignoff(t: string): boolean {
  return SIGNOFFS.includes(t.trim().toLowerCase().replace(/[\s.,!:;]+$/, ''));
}

function startsWithSignoff(t: string): string | null {
  const low = t.trim().toLowerCase();
  return SIGNOFFS_LONGEST_FIRST.find((so) => low.startsWith(`${so},`)) ?? null;
}

function okName(candidate: string): boolean {
  return SIGNOFF_NAME.test(candidate) && !candidate.split(/\s+/).some((w) => ORG_WORDS.has(w));
}

function greetingNames(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    const m = GREETING.exec(line);
    const group = m?.indices?.[1];
    if (m && group) {
      const name = m[1]!;
      const first = name.split(/\s+/)[0]!;
      if (!GREETING_EXCLUDE.has(first) && !GREETING_EXCLUDE.has(name)) out.push(vspan(pos + group[0], pos + group[1], 'name'));
    }
    pos += line.length + 1;
  }
  return out;
}

function signoffNames(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  const lines = text.split('\n');
  const offsets: number[] = [];
  let pos = 0;
  for (const line of lines) {
    offsets.push(pos);
    pos += line.length + 1;
  }
  lines.forEach((line, i) => {
    if (isSignoff(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!;
        if (!next.trim()) continue;
        const candidate = next.trim();
        if (okName(candidate)) {
          const start = offsets[j]! + next.indexOf(candidate);
          out.push(vspan(start, start + candidate.length, 'name'));
        }
        break;
      }
      return;
    }
    // a sentence in the line that starts with a sign-off: the first comma-separated segment after it
    for (const m of line.matchAll(/(?:^|(?<=[.!?] ))([^.!?]*[.!?]?)/g)) {
      const sentence = m[1] ?? '';
      if (!sentence.trim()) continue;
      const so = startsWithSignoff(sentence);
      if (!so) continue;
      const restStart = sentence.toLowerCase().indexOf(`${so},`) + so.length + 1;
      const segment = sentence.slice(restStart).split(',')[0] ?? '';
      const candidate = segment.trim().replace(/[\s.!?]+$/, '');
      if (candidate && okName(candidate)) {
        const start = offsets[i]! + m.index + restStart + segment.indexOf(candidate);
        out.push(vspan(start, start + candidate.length, 'name'));
      }
    }
  });
  return out;
}

function titleNames(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(TITLE)) {
    const name = m[1]!;
    const start = m.index + m[0].length - name.length;
    out.push(vspan(start, start + name.length, 'name'));
  }
  return out;
}

export function findNames(text: string): PiiSpan[] {
  return [...greetingNames(text), ...signoffNames(text), ...titleNames(text)];
}

const ACTOR_START: ReadonlySet<string> = new Set(['The', 'Your', 'My', 'This', 'That', 'Our', 'Their', 'His', 'Her', 'A', 'An', 'Someone', 'Nobody', 'Everyone']);
const ACTOR = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${NAME_WORD}(?:\s+${NAME_WORD}){1,2})\s+(?:sent you|emailed you|wrote to you|wrote|replied|asked you|asked|said|told you|invited you|shared|messaged you|texted you|mentioned|signed)\b`,
  'gu',
);

/** "Priya Shah sent you an email": a first and last name in front of what they did (answers are written this way). */
export function findActorNames(text: string): PiiSpan[] {
  const out: PiiSpan[] = [];
  for (const m of text.matchAll(ACTOR)) {
    const name = m[1]!;
    const ws = name.split(/\s+/);
    if (ACTOR_START.has(ws[0]!) || ws.some((w) => ORG_WORDS.has(w) || GREETING_EXCLUDE.has(w))) continue;
    out.push(vspan(m.index, m.index + name.length, 'name'));
  }
  return out;
}
