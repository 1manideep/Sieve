// Related items (10 section 12.8): ticking one adds it to the outgoing text at the chosen step. The only model work is
// the share-time Gemini Nano check of its outgoing text (11 section 10.7), cached on the item like the main item's.
import { LADDER_STEPS, MAX_PAYLOAD_CHARS } from '@sieve/shared';
import type { IndexRecord, KnownEntity, LadderStep, Proposal, StepOption } from '@sieve/shared';
import { EXCERPT_MAX_CHARS, bestWindow, recordBody, sentences, snapToSentences } from '@/ai';
import { getRecord, verifyFresh, type SieveDb } from '@/index';
import { buildStepOption, checkOutgoing } from '@/privacy';
import { formatDate, UNAVAILABLE } from './copy';
import { DecisionError } from './errors';
import { patchRecordIfCurrent } from './optional';
import { recordDataClass, stepIndex, unavailableOption, unavailableOptions } from './steps';

export { composeOutgoingText } from './steps';

/** Cuts a range to whole sentences within `max` characters (keeping at least the first sentence, cut hard if needed). */
function capRange(body: string, range: { start: number; end: number }, max: number): { start: number; end: number } {
  if (range.end - range.start <= max) return range;
  let end = range.start;
  for (const s of sentences(body)) {
    if (s.start < range.start) continue;
    if (s.end - range.start > max) break;
    end = s.end;
  }
  return { start: range.start, end: end > range.start ? end : range.start + max };
}

/**
 * Three options, in LADDER_STEPS order, for a related item: answer is never offered; excerpt and full are built by the
 * privacy pipeline with the same checks as the main item, each starting with an "Also shared:" header.
 */
export async function buildRelatedOptions(input: {
  db: SieveDb;
  proposal: Proposal;
  recordId: string;
  dataClass: 'own' | 'sample';
  signal?: AbortSignal;
}): Promise<StepOption[]> {
  const { db, proposal, recordId } = input;
  const cand = proposal.related.find((c) => c.recordId === recordId);
  if (!cand) throw new DecisionError('bad-items', "That item isn't one of the suggestions.");

  const status = await verifyFresh(db, recordId);
  if (status === 'gone') return unavailableOptions(UNAVAILABLE.relatedGone);
  const rec: IndexRecord | undefined = await getRecord(db, recordId);
  if (!rec) return unavailableOptions(UNAVAILABLE.relatedGone);

  const header = `Also shared: ${rec.title} (${formatDate(rec.date)})`;
  const body = recordBody(rec);
  const data = recordDataClass(rec);
  const shared = { maxStep: proposal.maxStep, question: proposal.question, ...(input.signal ? { signal: input.signal } : {}) };

  let range = cand.chunk && status !== 'changed' ? cand.chunk : bestWindow(body, proposal.question, EXCERPT_MAX_CHARS);
  range = capRange(body, snapToSentences(body, { start: Math.max(0, range.start), end: Math.min(body.length, range.end) }), EXCERPT_MAX_CHARS);
  const excerpt = rec.kind === 'photo' ? body : body.slice(range.start, range.end).trim();

  const buildBoth = (extra: { extraEntities?: KnownEntity[]; extraQuotes?: string[] } = {}) =>
    Promise.all([
      excerpt ? buildStepOption('excerpt', { excerpt }, rec, data, { ...shared, ...extra }) : Promise.resolve(unavailableOption('excerpt', UNAVAILABLE.empty)),
      buildStepOption('full', { full: body }, rec, data, { ...shared, ...extra }),
    ]);
  let [excerptOpt, fullOpt] = await buildBoth();

  // The same share-time Nano check as the main item (11 section 10.7), on this item's outgoing text.
  const check = await checkOutgoing(rec, data, [excerptOpt, fullOpt], { excerpt }, input.signal ? { signal: input.signal } : {});
  if (check.shareChecks) void patchRecordIfCurrent(db, rec, { shareChecks: check.shareChecks } as Partial<IndexRecord>);
  if (check.entities.length > 0 || check.quotes.length > 0) [excerptOpt, fullOpt] = await buildBoth({ extraEntities: check.entities, extraQuotes: check.quotes });
  const withCheck = (opt: StepOption): StepOption => (opt.available && check.trace.length > 0 ? { ...opt, trace: [...(opt.trace ?? []), ...check.trace] } : opt);
  excerptOpt = withCheck(excerptOpt);
  fullOpt = withCheck(fullOpt);

  const finish = (step: LadderStep, opt: StepOption): StepOption => {
    if (stepIndex(step) > stepIndex(proposal.maxStep)) return unavailableOption(step, UNAVAILABLE.maxStep(proposal.requester.aiName, proposal.maxStep));
    if (!opt.available) return unavailableOption(step, opt.unavailableReason ?? UNAVAILABLE.empty);
    if (opt.text === '') return unavailableOption(step, UNAVAILABLE.empty);
    const text = `${header}\n${opt.text}`;
    if (text.length > MAX_PAYLOAD_CHARS) return unavailableOption(step, UNAVAILABLE.overCap);
    return { ...opt, step, text, chars: text.length };
  };

  return LADDER_STEPS.map((step) =>
    step === 'answer'
      ? unavailableOption('answer', UNAVAILABLE.relatedAnswer)
      : step === 'excerpt'
        ? finish('excerpt', excerptOpt)
        : finish('full', fullOpt),
  );
}
