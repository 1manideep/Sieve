// Visible text assembly with paragraph structure (11 section 4.6), plus the hidden runs and fragments of 4.3.

export const PARAGRAPH_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote', 'ul', 'ol', 'pre', 'section', 'article', 'header', 'footer', 'hr', 'figure']);
export const LINE_TAGS = new Set(['div', 'tr', 'li', 'dt', 'dd', 'address', 'center', 'form', 'fieldset', 'figcaption', 'main', 'nav', 'aside', 'caption']);

export class TextBuilder {
  private readonly parts: string[] = [];
  private hasContent = false;
  private hiddenRun: string[] = [];
  readonly fragments: string[] = [];

  /** Makes sure the text ends with at least n newlines (no-op at the very start). */
  ensure(n: number): void {
    this.flushHidden();
    if (!this.hasContent) return;
    let newlines = 0;
    let skippingSpaces = true;
    outer: for (let p = this.parts.length - 1; p >= 0; p--) {
      const part = this.parts[p]!;
      for (let i = part.length - 1; i >= 0; i--) {
        const c = part[i];
        if (skippingSpaces && (c === ' ' || c === '\t')) continue;
        skippingSpaces = false;
        if (c === '\n') newlines++;
        else break outer;
      }
    }
    if (newlines < n) this.parts.push('\n'.repeat(n - newlines));
  }

  /** Visible text: verbatim inside pre, else CSS whitespace collapsing. */
  addText(s: string, pre: boolean): void {
    this.flushHidden();
    const t = pre ? s : s.replace(/[ \t\n\r\f]+/g, ' ');
    if (!t) return;
    this.parts.push(t);
    if (/\S/.test(t)) this.hasContent = true;
  }

  /** A line break from <br>. */
  lineBreak(): void {
    this.flushHidden();
    this.parts.push('\n');
  }

  /** Adjacent hidden text nodes join into one fragment; visible text or a block boundary ends the run. */
  addHidden(s: string): void {
    this.hiddenRun.push(s);
  }

  record(s: string): void {
    this.flushHidden();
    this.fragments.push(s);
  }

  flushHidden(): void {
    if (this.hiddenRun.length > 0) {
      this.fragments.push(this.hiddenRun.join(''));
      this.hiddenRun = [];
    }
  }

  text(): string {
    this.flushHidden();
    return this.parts.join('');
  }
}

const SILENT_FOR_FRAGMENTS = new Set(['script', 'style', 'title', 'meta', 'link', 'base', 'head']);

/** The text of a hidden subtree, as one fragment (block boundaries become spaces). */
export function fragmentText(node: Node): string {
  if (node.nodeType === 3) return (node as Text).data;
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const el = node as Element;
  const tag = node.nodeType === 1 ? el.localName : '';
  if (SILENT_FOR_FRAGMENTS.has(tag)) return '';
  const sep = PARAGRAPH_TAGS.has(tag) || LINE_TAGS.has(tag) || tag === 'br' || tag === 'td' || tag === 'th' ? ' ' : '';
  let out = sep;
  for (const child of Array.from(node.childNodes)) out += fragmentText(child);
  return out + sep;
}
