// privacyWarnings() (11 section 11.1). Owner 10 adds them to Proposal.warnings; owner 40 may restyle the copy.
import type { IndexRecord, StepOption, Warning } from '@sieve/shared';
import { WARNING_QUOTE_MAX_CHARS } from './constants';
import { cutGraphemes, plural } from './text';

/** `share.nanoPii`: Gemini Nano's personal-details check read the outgoing text at share time (10.7). */
export function privacyWarnings(record: IndexRecord, options: readonly StepOption[], share: { nanoPii?: boolean } = {}): Warning[] {
  const out: Warning[] = [];
  const hidden = record.hiddenRemoved.length;
  if (hidden > 0) {
    out.push({ kind: 'hidden-text-removed', message: `Sieve removed ${plural(hidden, 'piece', 'pieces')} of hidden text from this item before any model read it.` });
  }
  if (record.injection?.suspicious) {
    const quote = record.injection.quote?.trim();
    const says = quote ? ` It says: "${cutGraphemes(quote, WARNING_QUOTE_MAX_CHARS, '…')}"` : '';
    out.push({ kind: 'injection', message: `This item has a sentence that looks like an instruction to an AI. Sieve keeps it out of what is shared.${says}` });
  }
  if (options.some((o) => o.available && o.redactions > 0)) {
    out.push({ kind: 'pii-redacted', message: 'Sieve hid personal details and links in this text. Check the exact words before you approve.' });
  }
  const stages = record.privacyScan?.pii ?? {};
  if (!stages.model && !stages.nano && !share.nanoPii) {
    out.push({ kind: 'pii-check-limited', message: 'Names and addresses may not all be hidden: the on-device checks for them were not available.' });
  }
  return out;
}
