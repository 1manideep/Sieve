// privacyTraceFor() (11 section 11.3): trace steps for the checks that ran when the item was indexed.
import type { IndexRecord, TraceStep } from '@sieve/shared';
import { matchInjectionPatterns } from './injection/patterns';
import { summarize } from './pii/detect';
import { mergeSpans } from './pii/merge';
import { plural } from './text';

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function privacyTraceFor(record: IndexRecord): TraceStep[] {
  const at = Date.now();
  const scan = record.privacyScan;
  const out: TraceStep[] = [];

  const hidden = record.hiddenRemoved.length;
  out.push({
    kind: 'clean', where: 'code', ms: 0, at,
    label: hidden > 0 ? `Plain code removed ${plural(hidden, 'piece', 'pieces')} of hidden text when this item was indexed` : 'No hidden text found when this item was indexed',
  });

  const pii = scan?.pii ?? {};
  const methods: string[] = [];
  if (pii.validators) methods.push('plain code');
  if (pii.model) methods.push('the privacy model on this device');
  if (pii.nano) methods.push('Gemini Nano on this device');
  const found = mergeSpans(record.pii);
  const summary = found.length > 0 ? summarize(found) : 'nothing found';
  out.push({
    kind: 'pii', at,
    where: pii.model || pii.nano ? 'device' : 'code',
    ms: (pii.validators?.ms ?? 0) + (pii.model?.ms ?? 0) + (pii.nano?.ms ?? 0),
    label: methods.length > 0
      ? `Personal details were checked when this item was indexed (${joinList(methods)}): ${summary}`
      : 'Personal details have not been checked on this item yet',
  });

  const inj = scan?.injection ?? {};
  const finding = record.injection;
  const codeFlag = [record.text ?? record.caption ?? '', ...record.hiddenRemoved].some((t) => matchInjectionPatterns(t).suspicious);
  let label: string;
  if (finding?.suspicious && finding.by === 'nano') label = codeFlag ? 'Plain code and Gemini Nano both flagged a sentence aimed at an AI' : 'Gemini Nano flagged a sentence aimed at an AI (a warning, not a guarantee)';
  else if (finding?.suspicious) label = 'Plain code flagged a sentence aimed at an AI';
  else label = inj.nano ? 'No instructions aimed at an AI found (plain code and Gemini Nano)' : 'No instructions aimed at an AI found (plain code; Gemini Nano not used)';
  out.push({
    kind: 'injection', at,
    where: inj.nano?.ran === 'cloud' ? 'cloud' : inj.nano?.ran === 'device' ? 'device' : 'code',
    ms: (inj.code?.ms ?? 0) + (inj.nano?.ms ?? 0),
    label: `${label} (when this item was indexed)`,
  });
  return out;
}
