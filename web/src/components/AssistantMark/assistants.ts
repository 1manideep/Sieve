// The assistants Sieve knows by name (docs/design/final-flow.md F5, the Nov 20 Settings board): a mark drawn here as
// plain SVG paths, its colour, and the rule that maps a connection's `aiName` to a kind. Anything unrecognised is
// "other". Nothing here is a trademark asset: each mark is a simple shape in the assistant's colour.

export const ASSISTANT_KINDS = ['claude', 'claudeCode', 'gemini', 'geminiCli', 'chatgpt', 'cursor', 'other'] as const;
export type AssistantKind = (typeof ASSISTANT_KINDS)[number];

export interface AssistantSpec {
  kind: AssistantKind;
  name: string;
  /** The disc behind the mark and its ring, in the assistant's colour. */
  bg: string;
  ring: string;
  /** The mark's path, stroke (or fill) and width. */
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** A small terminal badge at the corner: the command-line variants. */
  terminal: boolean;
}

/** Eleven rays around a centre: the Claude mark. */
function rays(): string {
  let d = '';
  const n = 11;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.2;
    const r2 = i % 2 ? 7.4 : 9.6;
    d += `M${(12 + Math.cos(a) * 2.3).toFixed(2)} ${(12 + Math.sin(a) * 2.3).toFixed(2)}L${(12 + Math.cos(a) * r2).toFixed(2)} ${(12 + Math.sin(a) * r2).toFixed(2)}`;
  }
  return d;
}

/** Three crossed ellipses: the ChatGPT mark. */
function knot(): string {
  return [0, 60, 120]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const x1 = (12 - Math.cos(a) * 7.6).toFixed(2);
      const y1 = (12 - Math.sin(a) * 7.6).toFixed(2);
      const x2 = (12 + Math.cos(a) * 7.6).toFixed(2);
      const y2 = (12 + Math.sin(a) * 7.6).toFixed(2);
      return `M${x1} ${y1}A7.6 3.3 ${deg} 1 1 ${x2} ${y2}A7.6 3.3 ${deg} 1 1 ${x1} ${y1}`;
    })
    .join('');
}

const STAR = 'M12 2.5C12.6 7.6 16.4 11.4 21.5 12C16.4 12.6 12.6 16.4 12 21.5C11.4 16.4 7.6 12.6 2.5 12C7.6 11.4 11.4 7.6 12 2.5Z';
const CUBE = 'M12 3L19.8 7.5V16.5L12 21L4.2 16.5V7.5ZM4.2 7.5L12 12L19.8 7.5M12 12V21';
const SPARK = 'M12 4v4M12 16v4M4 12h4M16 12h4M6.6 6.6l2.3 2.3M15.1 15.1l2.3 2.3M17.4 6.6l-2.3 2.3M8.9 15.1l-2.3 2.3';

const CLAUDE = '#D97757';
const GEMINI_FILL = 'url(#assistant-mark-gemini)';

export const ASSISTANTS: Record<AssistantKind, AssistantSpec> = {
  claude: { kind: 'claude', name: 'Claude', bg: 'rgba(217, 119, 87, 0.14)', ring: 'rgba(217, 119, 87, 0.45)', d: rays(), fill: 'none', stroke: CLAUDE, strokeWidth: 2.3, terminal: false },
  claudeCode: { kind: 'claudeCode', name: 'Claude Code', bg: 'rgba(217, 119, 87, 0.14)', ring: 'rgba(217, 119, 87, 0.45)', d: rays(), fill: 'none', stroke: CLAUDE, strokeWidth: 2.3, terminal: true },
  gemini: { kind: 'gemini', name: 'Gemini', bg: 'rgba(138, 180, 248, 0.12)', ring: 'rgba(142, 124, 248, 0.5)', d: STAR, fill: GEMINI_FILL, stroke: 'none', strokeWidth: 0, terminal: false },
  geminiCli: { kind: 'geminiCli', name: 'Gemini CLI', bg: 'rgba(138, 180, 248, 0.12)', ring: 'rgba(142, 124, 248, 0.5)', d: STAR, fill: GEMINI_FILL, stroke: 'none', strokeWidth: 0, terminal: true },
  chatgpt: { kind: 'chatgpt', name: 'ChatGPT', bg: '#FFFFFF', ring: '#FFFFFF', d: knot(), fill: 'none', stroke: '#000000', strokeWidth: 1.7, terminal: false },
  cursor: { kind: 'cursor', name: 'Cursor', bg: 'rgba(255, 255, 255, 0.08)', ring: 'rgba(255, 255, 255, 0.35)', d: CUBE, fill: 'none', stroke: '#FFFFFF', strokeWidth: 1.7, terminal: false },
  other: { kind: 'other', name: 'Other', bg: 'rgba(255, 255, 255, 0.06)', ring: 'rgba(255, 255, 255, 0.25)', d: SPARK, fill: 'none', stroke: 'rgba(255, 255, 255, 0.85)', strokeWidth: 1.9, terminal: false },
};

/**
 * Which assistant a connection name means. The longer names win ("claude code" before "claude", "gemini cli" before
 * "gemini"); "openai" counts as ChatGPT; anything else is "other".
 */
export function assistantKindOf(aiName: string | undefined): AssistantKind {
  const n = (aiName ?? '').toLowerCase();
  if (/claude[\s-]*code/.test(n)) return 'claudeCode';
  if (n.includes('claude')) return 'claude';
  if (/gemini[\s-]*cli/.test(n)) return 'geminiCli';
  if (n.includes('gemini')) return 'gemini';
  if (n.includes('chatgpt') || n.includes('openai')) return 'chatgpt';
  if (n.includes('cursor')) return 'cursor';
  return 'other';
}
