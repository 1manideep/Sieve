// Structural checks on outgoing text (11 section 9): verbatim runs (S3), hidden leaks (S4), the payload check (S2).
import type { Decision, IndexRecord, Proposal, RelayPayload } from '@sieve/shared';
import { LADDER_STEPS, MAX_PAYLOAD_CHARS } from '@sieve/shared';
import { ANSWER_MAX_VERBATIM_WORDS, HIDDEN_LEAK_MIN_CHARS } from '../constants';
import { isWellFormed, verbatimWords } from '../text';

/** S3: true when the answer copies more than ANSWER_MAX_VERBATIM_WORDS words in a row from the item. */
export function copiesTooMuch(answer: string, source: string): boolean {
  const n = ANSWER_MAX_VERBATIM_WORDS + 1;
  const a = verbatimWords(answer);
  if (a.length < n) return false;
  const s = verbatimWords(source);
  const grams = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) grams.add(s.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= a.length; i++) if (grams.has(a.slice(i, i + n).join(' '))) return true;
  return false;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const SYNTHETIC = /^(?:Invisible characters removed: \d+|and \d+ more hidden pieces)/;

/** S4: true when a hidden fragment (that is not also visible in the item) appears in the outgoing text. */
export function hiddenLeak(text: string, record: Pick<IndexRecord, 'hiddenRemoved' | 'text'>): boolean {
  const out = norm(text);
  const visible = norm(record.text ?? '');
  for (const fragment of record.hiddenRemoved) {
    if (SYNTHETIC.test(fragment)) continue;
    const pieces = [fragment];
    const tag = /^Invisible tag text: (.*)$/.exec(fragment);
    if (tag?.[1]) pieces.push(tag[1]);
    for (const p of pieces) {
      const f = norm(p.replace(/…$/, ''));
      if (f.length >= HIDDEN_LEAK_MIN_CHARS && !visible.includes(f) && out.includes(f)) return true;
    }
  }
  return false;
}

export class OutgoingMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutgoingMismatchError';
  }
}

/** S2: throws unless the payload is exactly the approved, available option at an allowed step. */
export function verifyOutgoing(payload: RelayPayload, proposal: Proposal, decision: Decision): void {
  const fail = (why: string): never => {
    throw new OutgoingMismatchError(`Nothing was sent: ${why}.`);
  };
  if (!decision.approved) fail('the request was not approved');
  if (decision.requestId !== proposal.requestId) fail('the decision is for another request');
  if (!decision.step) fail('no step was chosen');
  const option = proposal.options.find((o) => o.step === decision.step);
  if (!option) fail('that step was not offered');
  if (!option!.available) fail('that step is not available');
  if (LADDER_STEPS.indexOf(option!.step) > LADDER_STEPS.indexOf(proposal.maxStep)) fail('that step is above what this assistant may receive');
  if (payload.step !== decision.step) fail('the payload step differs from the approved step');
  if (payload.text !== option!.text) fail('the payload text differs from the approved text');
  if (payload.chars !== option!.text.length) fail('the character count does not match');
  if (payload.text.length > MAX_PAYLOAD_CHARS) fail('the text is longer than Sieve sends at once');
  if (!isWellFormed(payload.text)) fail('the text has broken characters');
  if ((payload.image?.base64 ?? '') !== (option!.image?.base64 ?? '')) fail('the image differs from the approved image');
}
