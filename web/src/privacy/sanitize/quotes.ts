// Quoted reply history (11 section 4.8): removed by default; forwarded content is kept.
import { QUOTED_NOTE } from '../constants';

const ATTRIBUTION = /^On .{5,200}wrote:\s*$/;
const ORIGINAL = /^-{2,}\s*Original Message\s*-{2,}$/i;
const FROM_LINE = /^From: .+/;
const SENT_LINE = /^(Sent|Date): /;
const FORWARD_MARKER = /-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:/i;

/** Text path: cuts quoted history and puts QUOTED_NOTE in its place. */
export function stripQuotedText(s: string): string {
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let kind: 'attr' | 'orig' | 'hdr' | null = null;
    if (ATTRIBUTION.test(line) || (i + 1 < lines.length && ATTRIBUTION.test(`${line} ${lines[i + 1]}`))) kind = 'attr';
    else if (ORIGINAL.test(line.trim())) kind = 'orig';
    else if (FROM_LINE.test(line) && lines.slice(i + 1, i + 5).some((x) => SENT_LINE.test(x))) {
      // the From/Date header of a forwarded message is the forward itself, not quoted history
      if (lines.slice(Math.max(0, i - 2), i).some((x) => FORWARD_MARKER.test(x))) continue;
      kind = 'hdr';
    }
    if (!kind) continue;
    let cut = kind !== 'attr';
    if (kind === 'attr') {
      const rest = lines.slice(i + 1).filter((x) => x.trim());
      cut = rest.length > 0 && rest.filter((x) => x.trimStart().startsWith('>')).length / rest.length >= 0.6;
    }
    if (cut) return [...lines.slice(0, i), QUOTED_NOTE].join('\n');
    return s;
  }
  return s;
}

function isConnected(root: DocumentFragment, el: Element): boolean {
  return root.contains(el);
}

function previousMeaningful(el: Element): Node | null {
  let p = el.previousSibling;
  while (p && p.nodeType === 3 && !(p as Text).data.trim()) p = p.previousSibling;
  return p;
}

/** HTML path, before styles are collected: removes quoted containers; one QUOTED_NOTE paragraph at the first removal. */
export function stripQuotedHtml(root: DocumentFragment, doc: Document): void {
  let noted = false;
  const remove = (node: Node) => {
    const parent = node.parentNode;
    if (!parent) return;
    if (!noted) {
      const p = doc.createElement('p');
      p.textContent = QUOTED_NOTE;
      parent.insertBefore(p, node);
      noted = true;
    }
    parent.removeChild(node);
  };
  const removeAttribution = (el: Element) => {
    const prev = previousMeaningful(el);
    if (prev && /wrote:\s*$/.test((prev.textContent ?? '').trim())) prev.parentNode?.removeChild(prev);
  };

  for (const el of Array.from(root.querySelectorAll('div.gmail_quote, div.gmail_quote_container'))) {
    if (!isConnected(root, el)) continue;
    if ((el.textContent ?? '').slice(0, 300).includes('Forwarded message')) continue;
    remove(el);
  }
  for (const el of Array.from(root.querySelectorAll('blockquote.gmail_quote'))) {
    if (!isConnected(root, el)) continue;
    removeAttribution(el);
    remove(el);
  }
  for (const el of Array.from(root.querySelectorAll('blockquote[type]'))) {
    if (!isConnected(root, el) || el.getAttribute('type')?.toLowerCase() !== 'cite') continue;
    const prev = previousMeaningful(el);
    if (prev && /Begin forwarded message/i.test(prev.textContent ?? '')) continue;
    removeAttribution(el);
    remove(el);
  }
  for (const el of Array.from(root.querySelectorAll('div.yahoo_quoted'))) {
    if (isConnected(root, el)) remove(el);
  }
  for (const el of Array.from(root.querySelectorAll('div.moz-cite-prefix'))) {
    if (!isConnected(root, el)) continue;
    let next = el.nextElementSibling;
    if (next && next.localName !== 'blockquote') next = null;
    remove(el);
    if (next) remove(next);
  }
  const divRply = root.querySelector('#divRplyFwdMsg');
  if (divRply && !/^Subject:\s*(FW|Fwd):/im.test(divRply.textContent ?? '')) {
    const following: Node[] = [];
    for (let n = divRply.nextSibling; n; n = n.nextSibling) following.push(n);
    remove(divRply);
    for (const n of following) remove(n);
  }
  const appendOnSend = root.querySelector('#appendonsend');
  if (appendOnSend) {
    const following: Node[] = [];
    for (let n = appendOnSend.nextSibling; n; n = n.nextSibling) following.push(n);
    for (const n of following) remove(n);
  }
}
