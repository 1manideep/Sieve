// draftReply (10 section 10.5): a reply drafted by Gemini in the cloud from the approved text only. Nothing else goes
// in the prompt: no item, no question, no metadata. Facts the draft adds are flagged for the person to check.
import { MAX_PAYLOAD_CHARS } from '@sieve/shared';
import { DRAFT_INSTRUCTION_MAX_CHARS, DRAFT_MAX_CHARS } from '../config';
import { findUnsupportedFacts } from '../facts';
import { DEFAULT_DRAFT_INSTRUCTION, DRAFT_SYSTEM } from '../prompts';
import { runModel } from '../runModel';
import { escapeDelimiters } from '../text';
import { codeTrace } from '../trace';
import type { RunModelResult } from '../types';

export { DEFAULT_DRAFT_INSTRUCTION, DRAFT_SYSTEM } from '../prompts';

export function draftPrompt(approvedText: string, instruction: string): string {
  return `Instruction: ${escapeDelimiters(instruction)}\n\nApproved text:\n<<<\n${escapeDelimiters(approvedText)}\n>>>`;
}

export async function draftReply(
  approvedText: string,
  instruction: string,
  opts?: { signal?: AbortSignal; onText?: (soFar: string) => void },
): Promise<RunModelResult<{ draft: string; unsupported?: string[] }>> {
  if (approvedText.trim() === '' || approvedText.length > MAX_PAYLOAD_CHARS) {
    const message = 'There is no approved text to draft from, or it is longer than Sieve sends at once.';
    return { ok: false, error: { code: 'too-long', message }, trace: codeTrace('draft', `Stopped before any model ran: ${message}`, 0, Date.now(), 0) };
  }
  const cut = instruction.trim().slice(0, DRAFT_INSTRUCTION_MAX_CHARS).trim();
  const used = cut || DEFAULT_DRAFT_INSTRUCTION;
  const res = await runModel<string>({
    purpose: 'draft',
    mode: 'PREFER_IN_CLOUD',
    data: 'approved',
    system: DRAFT_SYSTEM,
    prompt: draftPrompt(approvedText, used),
    dataChars: approvedText.length + used.length,
    onText: opts?.onText,
    signal: opts?.signal,
  });
  if (!res.ok) return res;
  const draft = res.value.trim().slice(0, DRAFT_MAX_CHARS);
  const unsupported = findUnsupportedFacts(draft, [approvedText, used]);
  const label =
    res.trace.where === 'device'
      ? 'Drafted a reply on this device from the approved text'
      : `Drafted a reply from the approved text: ${res.trace.charsSent ?? 0} characters of your data left this device`;
  return { ok: true, value: { draft, ...(unsupported.length ? { unsupported } : {}) }, trace: { ...res.trace, label } };
}
