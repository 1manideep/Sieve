// prepareProposal (10 section 12): from a question to a Proposal the person approves. Counts stop at once
// (unsupported). Retrieval with the sender and dates as filters, then rules (before any model reads anything), then
// one Nano call to pick and answer (one more only when the chosen item was deleted or changed at its source), then one
// on-device check that the item answers the question (12b), then plain-code excerpts and privacy steps, then the
// share-time Gemini Nano check of the text that would leave (11 section 10.7: one injection-check and one pii-check at
// most, cached on the item). Never rejects: failures are outcomes.
import { LADDER_STEPS, MAX_PAYLOAD_CHARS, MAX_QUESTION_CHARS, RELATED_MAX, VECTOR_K } from '@sieve/shared';
import type {
  Candidate, Category, CategoryRule, IndexRecord, KnownEntity, Proposal, ProposalOutcome, StepOption, TraceKind, TraceStep, Warning, Where,
} from '@sieve/shared';
import {
  CONSENT_MAX_AGE_MS, SELECT_MAX_PASSAGES, codeTrace, deriveExcerpt, fitPassages, getNanoAvailability, hasFreshConsent,
  recordBody, selectAndAnswer, verifyAnswer, type OwnCloudPolicy, type PassageRange, type RunModelResult, type SelectValue,
} from '@/ai';
import {
  asksCount, asksLatest, clockFor, flushUrgentEmbeds, getRecord, parseQuestion, relatedFor, removeRecord, search, type HardFilter, type SieveDb,
} from '@/index';
import { buildStepOption, checkOutgoing, holdsSecretCode, privacyWarnings } from '@/privacy';
import { forgetCloudConsentRequest, rememberCloudConsentRequest } from './consent';
import { LABELS, RUNNING, UNAVAILABLE, WARNINGS, WHERE_PHRASE } from './copy';
import { answerStillHolds, confirmFresh, type FreshResult } from './fresh';
import { patchRecordIfCurrent, photoBlobFor } from './optional';
import { actionVerb, splitDraftRequest } from './split';
import { recordDataClass, ruleFor, stepIndex, unavailableOption, unavailableOptions } from './steps';
import type { PipelineProgress, PrepareInput } from './types';

interface Allowed {
  rec: IndexRecord;
  cand: Candidate;
}
interface Screened {
  allowed: Allowed[];
  neverBlocked: IndexRecord[];
  label: string | null;      // the rule step label, when anything was excluded
}

function itemOf(rec: IndexRecord): NonNullable<Proposal['item']> {
  return { recordId: rec.id, title: rec.title, kind: rec.kind, category: rec.category, date: rec.date, ...(rec.from ? { from: rec.from } : {}) };
}

/**
 * The step-5 filter (10 section 12.3), in rank order, with no model involved. Also used for related items.
 * Missing records are dropped; with `repair`, their orphan index rows are removed in the background.
 */
export async function screenCandidates(
  db: SieveDb,
  input: Pick<PrepareInput, 'blockedRecordIds' | 'allowedSources' | 'allowedCategories' | 'settings' | 'requester'>,
  cands: Candidate[],
  opts: { exclude?: string; repair: boolean },
): Promise<Screened> {
  const seen = new Set<string>(opts.exclude ? [opts.exclude] : []);
  const unique = cands.filter((c) => (seen.has(c.recordId) ? false : (seen.add(c.recordId), true)));
  const recs = await Promise.all(unique.map((c) => getRecord(db, c.recordId)));
  const blocked = new Set(input.blockedRecordIds ?? []);
  const allowed: Allowed[] = [];
  const neverBlocked: IndexRecord[] = [];
  const never = new Map<Category, number>();
  let stale = 0;
  let revoked = 0;
  let source = 0;
  let grant = 0;
  let secret = 0;
  unique.forEach((cand, i) => {
    const rec = recs[i];
    if (!rec) {
      stale += 1;
      if (opts.repair) {
        if (import.meta.env.DEV) console.info('integrity repair: orphan index entry');
        void removeRecord(db, cand.recordId, 'source-deleted').catch(() => undefined);
      }
      return;
    }
    if (blocked.has(rec.id)) {
      revoked += 1;
      return;
    }
    if (input.allowedSources && !input.allowedSources.includes(rec.source)) {
      source += 1;
      return;
    }
    if (input.allowedCategories && !input.allowedCategories.includes(rec.category)) {
      grant += 1;
      return;
    }
    if (ruleFor(input.settings, rec.category) === 'never') {
      neverBlocked.push(rec);
      never.set(rec.category, (never.get(rec.category) ?? 0) + 1);
      return;
    }
    // 11 section 5.2: one-time codes and sign-in links are never shared, so no model reads an item that holds one
    if (holdsSecretCode(rec)) {
      neverBlocked.push(rec);
      secret += 1;
      return;
    }
    if (allowed.length < SELECT_MAX_PASSAGES) allowed.push({ rec, cand });
  });
  const aiName = input.requester.aiName;
  const parts = [
    ...[...never].map(([category, n]) => LABELS.ruleNever(category, n)),
    ...(secret ? [LABELS.ruleSecret(secret)] : []),
    ...(grant ? [LABELS.ruleGrant(grant, aiName)] : []),
    ...(revoked ? [LABELS.ruleBlocked(revoked, aiName)] : []),
    ...(source ? [LABELS.ruleSource(source, aiName)] : []),
    ...(stale ? [LABELS.ruleStale(stale)] : []),
  ];
  return { allowed, neverBlocked, label: parts.length ? parts.join('; ') : null };
}

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** One run's state: the trace, warnings and live progress events. */
class Run {
  readonly trace: TraceStep[] = [];
  readonly warnings: Warning[] = [];
  private unverified: Warning | null = null;
  private n = 0;
  question: string;

  constructor(
    readonly input: PrepareInput,
    readonly now: number,
  ) {
    this.question = input.question;
  }

  get aborted(): boolean {
    return this.input.signal?.aborted === true;
  }

  private emit(e: PipelineProgress): void {
    try {
      this.input.onProgress?.(e);
    } catch (err) {
      console.error('A pipeline progress listener failed.', err);
    }
  }

  start(kind: TraceKind, label: string, where: Where): string {
    this.n += 1;
    const id = `${this.input.requestId}:${this.n}`;
    this.emit({ type: 'step-start', id, kind, label, where, at: Date.now() });
    return id;
  }

  /** Ends a live step; `keep: false` closes the live row without adding the step to the proposal's trace. */
  end(id: string, step: TraceStep, keep = true): void {
    if (keep) this.trace.push(step);
    this.emit({ type: 'step-end', id, step });
  }

  /** An instant step (plain code, already finished). */
  push(step: TraceStep): void {
    this.end(this.start(step.kind, step.label, step.where), step);
  }

  code(kind: TraceKind, label: string, ms = 0): void {
    this.push(codeTrace(kind, label, ms));
  }

  answerProgress(text: string): void {
    this.emit({ type: 'answer-progress', text });
  }

  warn(w: Warning): void {
    if (!this.warnings.some((x) => x.kind === w.kind && x.message === w.message)) this.warnings.push(w);
  }

  setUnverified(w: Warning | null): void {
    this.unverified = w;
  }

  /** The line every unavailable option carries (and the engine's table of automatic outcomes, 40 section 11.6). */
  private reasonFor(outcome: ProposalOutcome, item: IndexRecord | undefined): string {
    if (outcome === 'blocked-never' && item) {
      const secret = ruleFor(this.input.settings, item.category) !== 'never' && holdsSecretCode(item);
      return secret ? UNAVAILABLE.secretCode : UNAVAILABLE.never(item.category);
    }
    if (outcome === 'no-match') return UNAVAILABLE.noMatch;
    if (outcome === 'unsupported') return UNAVAILABLE.unsupported;
    if (outcome === 'needs-cloud-consent') return UNAVAILABLE.needsConsent;
    if (outcome === 'model-unavailable') return UNAVAILABLE.modelUnavailable;
    return UNAVAILABLE.error;
  }

  finish(outcome: ProposalOutcome, extra: { item?: IndexRecord; rule?: CategoryRule; options?: StepOption[]; related?: Candidate[] } = {}): Proposal {
    const reason = this.reasonFor(outcome, extra.item);
    const i = this.input;
    return {
      requestId: i.requestId,
      requester: i.requester,
      question: this.question,
      requestedStep: i.requestedStep,
      maxStep: i.maxStep,
      ...(extra.item ? { item: itemOf(extra.item) } : {}),
      related: extra.related ?? [],
      options: extra.options ?? unavailableOptions(reason),
      rule: extra.rule ?? 'approve',
      warnings: this.unverified ? [this.unverified, ...this.warnings] : [...this.warnings],
      trace: [...this.trace],
      outcome,
      createdAt: this.now,
    };
  }

  fail(label: string): Proposal {
    this.code('rule', label);
    return this.finish('error');
  }

  stopped(): Proposal {
    this.code('rule', LABELS.stopped);
    return this.finish('error');
  }

  blockedOrNoMatch(neverBlocked: IndexRecord[]): Proposal {
    if (neverBlocked.length) return this.finish('blocked-never', { item: neverBlocked[0], rule: 'never' });
    return this.finish('no-match');
  }
}

function clockOf(db: SieveDb, fallback: number): number {
  try {
    const t = clockFor(db);
    return Number.isFinite(t) ? t : fallback;
  } catch {
    return fallback;
  }
}

function chunksOf(list: Allowed[]): Record<string, PassageRange> {
  const out: Record<string, PassageRange> = {};
  for (const a of list) if (a.cand.chunk) out[a.rec.id] = a.cand.chunk;
  return out;
}

export async function prepareProposal(input: PrepareInput): Promise<Proposal> {
  const run = new Run(input, input.now ?? Date.now());
  try {
    return await prepare(run);
  } catch (e) {
    if (run.aborted || isAbortError(e)) return run.stopped();
    if (import.meta.env.DEV) console.error('prepareProposal failed', e instanceof Error ? e.name : typeof e);
    run.code('rule', LABELS.crashed);
    return run.finish('error');
  }
}

async function prepare(run: Run): Promise<Proposal> {
  const { input } = run;
  const db = input.db;
  const aiName = input.requester.aiName;
  // "Today" for question dates and the select prompt: the Playground runs on its own fixed clock (20 section 18.1).
  const today = clockOf(db, run.now);

  // 1. Validate.
  forgetCloudConsentRequest(input.requestId);
  const q = input.question.trim();
  if (!q || q.length > MAX_QUESTION_CHARS) return run.fail(LABELS.invalid);
  run.question = q;
  if (stepIndex(input.requestedStep) > stepIndex(input.maxStep)) return run.fail(LABELS.overGrant);
  if (run.aborted) return run.stopped();

  // 3. The lookup (drafting words removed) and hints.
  let lookup = splitDraftRequest(q).lookup;
  let hints = input.hints;
  if (!input.hints && input.requester.kind === 'in-app') {
    try {
      const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
      const p = parseQuestion(lookup, new Date(today), locale, { db });
      // The parsed `from` stays a boost: search finds the sender the question names itself (20 section 10.2).
      const { from: _from, ...parsed } = p.hints;
      hints = parsed;
      if (p.corrected) lookup = p.corrected;
      if (p.corrected && p.corrected !== p.normalized) run.code('retrieve', LABELS.spellingFixed(p.corrected));
      for (const it of p.hints.interpreted ?? []) if (it.ambiguous) run.code('retrieve', LABELS.ambiguousDate(it.text, it.as));
    } catch (e) {
      console.warn('Sieve: the question parser failed; searching the question as typed.', e instanceof Error ? e.name : e);
    }
  }
  const verb = actionVerb(lookup);
  if (verb) run.warn(WARNINGS.action(verb));

  // 3a. A count needs every item, and this level answers from one: unsupported, before any search (12.4).
  if (asksCount(lookup)) {
    run.code('rule', LABELS.countUnsupported);
    return run.finish('unsupported');
  }

  // 4. Retrieve.
  if (run.aborted) return run.stopped();
  const retrieveId = run.start('retrieve', RUNNING.retrieve, 'code');
  // 4a. An item added a moment ago gets its vectors first (20 section 13.5): the queue's just-added embeddings are
  // flushed, 3 s at most; on a timeout (or with nothing to wait for) the search runs as it is.
  try {
    await flushUrgentEmbeds(db, input.signal ? { signal: input.signal } : {});
  } catch {
    // no queue in this module (a stand-in index): search at once
  }
  if (run.aborted) {
    run.end(retrieveId, codeTrace('retrieve', LABELS.stopped, 0));
    return run.finish('error');
  }
  const t0 = performance.now();
  let cands: Candidate[];
  let filters: HardFilter | undefined;
  try {
    cands = await search(db, lookup, {
      ...(input.allowedSources ? { sources: input.allowedSources } : {}),
      ...(hints ? { hints } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onReport: (r) => {
        filters = r.filters;
      },
    });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    if (run.aborted || isAbortError(e)) {
      run.end(retrieveId, codeTrace('retrieve', LABELS.stopped, ms));
      return run.finish('error');
    }
    run.end(retrieveId, codeTrace('retrieve', 'The search on this device failed. Nothing was shared.', ms));
    return run.finish('error');
  }
  const retrieveMs = Math.round(performance.now() - t0);
  run.end(retrieveId, codeTrace('retrieve', LABELS.retrieveFound(cands, retrieveMs), retrieveMs));
  if (cands.some((c) => c.matchedBy === 'gmail-search')) {
    run.push({ kind: 'retrieve', label: LABELS.gmailSearch, where: 'cloud', ms: 0, charsSent: lookup.length, at: Date.now() });
  }
  if (cands.length === 0) return run.finish('no-match');

  // 5 and 6. Load and filter, with no model involved.
  if (run.aborted) return run.stopped();
  const screened = await screenCandidates(db, input, cands, { repair: true });
  if (screened.label) run.code('rule', screened.label);
  const { neverBlocked } = screened;
  let allowed = screened.allowed;
  if (allowed.length === 0) return run.blockedOrNoMatch(neverBlocked);

  // 6a. "The latest": newest first by the item's date; with a sender or date filter, only the newest VECTOR_K.
  const latest = asksLatest(lookup);
  if (latest && allowed.length > 1) {
    allowed = [...allowed].sort((a, b) => b.rec.date - a.rec.date);
    if (filters?.sender || filters?.after || filters?.before) allowed = allowed.slice(0, VECTOR_K);
    run.code('retrieve', LABELS.newestFirst);
  }

  // 7. Data class and the own-data cloud policy.
  const ownCloud: OwnCloudPolicy = {
    allowed: input.dataClass === 'sample' ? true : input.settings.cloudFallbackForOwnData,
    db,
    maxAgeMs: input.dataClass === 'sample' ? null : CONSENT_MAX_AGE_MS,
  };
  const callDataOf = (list: Allowed[]): 'own' | 'sample' => (list.some((a) => recordDataClass(a.rec) === 'own') ? 'own' : 'sample');

  const askConsent = (list: Allowed[], missing: IndexRecord[]): Proposal => {
    const passages = fitPassages(lookup, list.map((a) => a.rec), chunksOf(list), { hints, today });
    const missingIds = new Set(missing.map((r) => r.id));
    const items = passages
      .filter((p) => missingIds.has(p.record.id))
      .map((p) => ({ recordId: p.record.id, title: p.record.title, kind: p.record.kind, text: p.text, chars: p.text.length }));
    rememberCloudConsentRequest({
      requestId: input.requestId,
      question: lookup,
      items,
      chars: lookup.length + items.reduce((n, it) => n + it.chars, 0),
      createdAt: Date.now(),
    });
    run.code('rule', LABELS.consentNothingSent);
    return run.finish('needs-cloud-consent', { item: missing[0], rule: ruleFor(input.settings, missing[0].category) });
  };

  const missingConsent = async (list: Allowed[]): Promise<IndexRecord[]> => {
    const out: IndexRecord[] = [];
    for (const a of list) {
      if (recordDataClass(a.rec) !== 'own') continue;
      if (!(await hasFreshConsent(ownCloud, [a.rec.id]))) out.push(a.rec);
    }
    return out;
  };

  // 8. Consent (own data and no Nano).
  const nano = await getNanoAvailability();
  if (callDataOf(allowed) === 'own' && nano.text !== 'available') {
    if (!ownCloud.allowed) {
      const notSetUp = nano.text === 'downloadable' || nano.text === 'downloading';
      run.code('rule', notSetUp ? LABELS.notSetUpOwnOff : LABELS.noModelOwnOff);
      return run.finish('model-unavailable');
    }
    const missing = await missingConsent(allowed);
    if (missing.length) {
      if (input.ownWithoutConsent === 'skip') {
        const drop = new Set(missing.map((r) => r.id));
        allowed = allowed.filter((a) => !drop.has(a.rec.id));
        if (allowed.length === 0) return run.finish('no-match');
      } else {
        return askConsent(allowed, missing);
      }
    }
  }

  // 9 to 12a. The one model call, and the freshness check with its one allowed re-run.
  let reruns = 0;
  let list = allowed;
  let chosen: IndexRecord;
  let value: SelectValue;
  let recomputeExcerpt = false;
  for (;;) {
    if (run.aborted) return run.stopped();
    const callData = callDataOf(list);
    const records = list.map((a) => a.rec);
    const where: Where = nano.text === 'available' ? 'device' : 'cloud';
    const running =
      where === 'device' ? RUNNING.selectDevice(records) : callData === 'sample' ? RUNNING.selectCloudSample(records) : RUNNING.selectCloudOwn(records);
    const selectId = run.start('select', running, where);
    const res: RunModelResult<SelectValue> = await selectAndAnswer(lookup, records, callData, {
      passages: chunksOf(list),
      signal: input.signal,
      ownCloud,
      hints,
      today,
      latest,
      onAnswerText: (t) => run.answerProgress(t),
    });
    run.end(selectId, res.trace);

    if (!res.ok) {
      if (res.error.code === 'aborted' || run.aborted) return run.stopped();
      if (res.error.code === 'needs-consent') {
        const missing = await missingConsent(list);
        return askConsent(list, missing.length ? missing : records.filter((r) => recordDataClass(r) === 'own'));
      }
      if (res.error.code === 'unavailable' || res.error.code === 'downloading') return run.finish('model-unavailable');
      return run.finish('error');
    }
    if (res.trace.where === 'cloud') run.warn(callData === 'sample' ? WARNINGS.sampleDataCloud() : WARNINGS.cloudFallback());
    if (res.value.recordId === null) return run.blockedOrNoMatch(neverBlocked);

    const pick = list.find((a) => a.rec.id === res.value.recordId);
    if (!pick) return run.finish('error');

    // 12a. Freshness, before any step option is built.
    const freshId = run.start('retrieve', RUNNING.fresh, 'code');
    const f0 = performance.now();
    const fresh: FreshResult = await confirmFresh(db, pick.rec, input.signal);
    const freshMs = Math.round(performance.now() - f0);
    const kind = pick.rec.kind;
    if (fresh.status === 'ok' || fresh.status === 'unknown') {
      run.end(freshId, codeTrace('retrieve', LABELS.freshChecked(kind), freshMs), false);
      if (fresh.status === 'unknown') run.warn(WARNINGS.sourceUnchecked());
      chosen = fresh.record;
      value = res.value;
      break;
    }
    if (fresh.status === 'unreachable') {
      run.end(freshId, codeTrace('retrieve', LABELS.freshGmailFailed, freshMs));
      return run.finish('error');
    }
    if (reruns >= 1) {
      run.end(freshId, codeTrace('retrieve', LABELS.freshKeptChanging, freshMs));
      return run.finish('no-match');
    }
    const reread: IndexRecord | undefined = fresh.status === 'changed' ? fresh.fresh : undefined;
    if (reread && answerStillHolds(pick.rec, reread, res.value.answer)) {
      run.end(freshId, codeTrace('retrieve', LABELS.freshChangedHolds(kind), freshMs));
      chosen = reread;
      value = res.value;
      recomputeExcerpt = true;
      break;
    }
    if (!reread) {
      run.end(freshId, codeTrace('retrieve', LABELS.freshGone(kind), freshMs));
      list = list.filter((a) => a.rec.id !== pick.rec.id);
      if (list.length === 0) return run.blockedOrNoMatch(neverBlocked);
    } else {
      run.end(freshId, codeTrace('retrieve', LABELS.freshChangedReread(kind), freshMs));
      list = list.map((a) => (a.rec.id === reread.id ? { rec: reread, cand: { ...a.cand, chunk: undefined } } : a));
    }
    reruns += 1;
  }

  // 12b. One more on-device call: does the item really answer the question (sender, date, the fact itself)? No:
  // nothing to share. A check that could not run leaves the answer for the person to read, with a warning.
  if (run.aborted) return run.stopped();
  const chosenData = recordDataClass(chosen);
  const verifyId = run.start('answer', RUNNING.verify, nano.text === 'available' ? 'device' : chosenData === 'sample' ? 'cloud' : 'code');
  const checked = await verifyAnswer(lookup, chosen, value.answer, chosenData, {
    ...(recomputeExcerpt || !value.passage ? {} : { passage: value.passage }),
    ...(input.signal ? { signal: input.signal } : {}),
    ownCloud,
    today,
  });
  if (!checked.ok) {
    run.end(verifyId, { ...checked.trace, label: LABELS.verifyFailed });
    if (checked.error.code === 'aborted' || run.aborted) return run.stopped();
    run.warn(WARNINGS.unchecked());
  } else {
    run.end(verifyId, { ...checked.trace, label: checked.value.answers ? LABELS.verifyYes : LABELS.verifyNo });
    if (!checked.value.answers) return run.finish('no-match');
  }

  // 13. The excerpt, chosen by plain code.
  const rec = chosen;
  const answer = value.answer;
  let excerpt = value.excerpt;
  let unsupported = value.unsupported ?? [];
  if (recomputeExcerpt) {
    const body = recordBody(rec);
    if (rec.kind === 'photo') {
      excerpt = body;
    } else {
      const d = deriveExcerpt(body, { start: 0, end: body.length }, answer);
      excerpt = d.excerpt;
      unsupported = d.unsupported;
    }
  }
  run.code('excerpt', (excerpt ? LABELS.excerptChosen : LABELS.excerptNone) + (unsupported.length ? LABELS.excerptUnsupported(unsupported) : ''));
  if (unsupported.length) run.setUnverified(WARNINGS.unverified(unsupported));

  // 14. Rule, warnings and the steps that ran when the item was indexed.
  let rule = ruleFor(input.settings, rec.category);
  const mark = rec.enrich?.label;
  const unsorted = rec.categoryBy !== 'seed' && (!mark || mark.by === 'code' || mark.confidence === 'low');
  if (rule === 'ask-first') run.warn(WARNINGS.askFirst(rec.category));
  if (unsorted) {
    rule = 'ask-first';
    run.warn(WARNINGS.notSorted());
  }
  if (rec.hiddenRemoved.length) {
    run.warn(WARNINGS.hiddenRemoved());
    run.code('clean', LABELS.clean);
  }
  if (rec.injection?.suspicious) run.warn(WARNINGS.injection(rec.injection.quote));
  run.push(indexTimeLabelStep(rec));
  run.push(indexTimeInjectionStep(rec));

  // 15. The three options: the exact outgoing texts, built by the privacy pipeline with plain code. The scan of a
  // stale record never runs Nano (allowNano: false); Nano reads the built text in 15a.
  if (run.aborted) return run.stopped();
  const piiId = run.start('pii', RUNNING.pii, 'code');
  const p0 = performance.now();
  const parts = { answer, excerpt: excerpt || undefined, full: recordBody(rec) };
  const photo = rec.kind === 'photo' ? await photoBlobFor(db, rec.id) : undefined;
  const data = recordDataClass(rec);
  let scanSaved = false;
  const buildAll = async (extra: { extraEntities?: KnownEntity[]; extraQuotes?: string[] } = {}): Promise<StepOption[]> => {
    const built = await Promise.all(
      LADDER_STEPS.map((step) =>
        buildStepOption(step, parts, rec, data, {
          maxStep: input.maxStep,
          question: lookup,
          rule,
          allowNano: false,
          ...extra,
          ...(photo ? { photo } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          onScanned: (patch) => {
            if (scanSaved) return;
            scanSaved = true;
            void patchRecordIfCurrent(db, rec, patch);
          },
        }),
      ),
    );
    return built;
  };
  const enforceAll = (built: StepOption[]) => LADDER_STEPS.map((step, i) => enforceOption(step, built[i], { maxStep: input.maxStep, aiName, hasExcerpt: !!excerpt }));
  const built = await buildAll();
  let options = enforceAll(built);
  const optionTraces = built.flatMap((o) => o.trace ?? []);
  const piiMs = Math.round(performance.now() - p0);
  if (optionTraces.length) {
    run.end(piiId, optionTraces[0]);
    for (const t of optionTraces.slice(1)) run.push(t);
  } else {
    run.end(piiId, codeTrace('pii', LABELS.masked(Math.max(0, ...options.filter((o) => o.available).map((o) => o.redactions))), piiMs));
  }

  // 15a. Gemini Nano on the text that would leave (11 section 10.7): "Checking for hidden instructions" and "Checking
  // for personal details", each with where it ran. What it finds is masked or removed in every step by plain code.
  if (run.aborted) return run.stopped();
  const rows: Partial<Record<'injection' | 'pii', string>> = {};
  const check = await checkOutgoing(rec, data, options, parts, {
    ...(input.signal ? { signal: input.signal } : {}),
    onStart: (kind, where) => {
      rows[kind] = run.start(kind, kind === 'injection' ? RUNNING.injectionCheck : RUNNING.piiCheck, where);
    },
    onEnd: (kind, step) => {
      const id = rows[kind];
      if (id) run.end(id, step);
      else run.push(step);
    },
  });
  if (check.shareChecks) void patchRecordIfCurrent(db, rec, { shareChecks: check.shareChecks } as Partial<IndexRecord>);
  if (check.entities.length > 0 || check.quotes.length > 0) {
    if (run.aborted) return run.stopped();
    options = enforceAll(await buildAll({ extraEntities: check.entities, extraQuotes: check.quotes }));
  }
  const maxRedactions = Math.max(0, ...options.filter((o) => o.available).map((o) => o.redactions));
  if (maxRedactions > 0) run.warn(WARNINGS.piiRedacted());
  if (check.quotes.length > 0 && !rec.injection?.suspicious) run.warn(WARNINGS.injection(check.quotes[0]));
  // 11 section 11.1: the privacy pipeline's own warnings, for kinds the pipeline has not already worded (pii-check-limited).
  for (const w of privacyWarnings(rec, options, { nanoPii: check.nanoPii })) if (!run.warnings.some((x) => x.kind === w.kind)) run.warn(w);

  // 16. Related items, filtered exactly like the main item.
  let related: Candidate[] = [];
  try {
    const rc = await relatedFor(db, rec.id, lookup);
    related = (await screenCandidates(db, input, rc, { exclude: rec.id, repair: false })).allowed.map((a) => a.cand).slice(0, RELATED_MAX);
  } catch (e) {
    console.warn('Sieve: related items were not found.', e instanceof Error ? e.name : e);
  }

  // 17. Ready.
  return run.finish('ready', { item: rec, rule, options, related });
}

function enforceOption(
  step: (typeof LADDER_STEPS)[number],
  opt: StepOption,
  ctx: { maxStep: Proposal['maxStep']; aiName: string; hasExcerpt: boolean },
): StepOption {
  if (stepIndex(step) > stepIndex(ctx.maxStep)) return unavailableOption(step, UNAVAILABLE.maxStep(ctx.aiName, ctx.maxStep));
  if (step === 'excerpt' && !ctx.hasExcerpt) return unavailableOption(step, UNAVAILABLE.noExcerpt);
  if (!opt.available) return unavailableOption(step, opt.unavailableReason ?? UNAVAILABLE.empty);
  if (opt.text === '') return unavailableOption(step, UNAVAILABLE.empty);
  if (opt.chars > MAX_PAYLOAD_CHARS || opt.text.length > MAX_PAYLOAD_CHARS) return unavailableOption(step, UNAVAILABLE.overCap);
  return opt;
}

function sdkWhere(by: string | undefined, sdk: 'on_device' | 'in_cloud' | undefined): { where: Where; sdkReported?: 'on_device' | 'in_cloud' } {
  if (sdk === 'on_device' || (!sdk && by === 'device')) return { where: 'device', sdkReported: 'on_device' };
  if (sdk === 'in_cloud' || (!sdk && by === 'cloud')) return { where: 'cloud', sdkReported: 'in_cloud' };
  return { where: 'code' };
}

/** "Sorted as Home on this device when it was indexed" (informational; ms and source from the stored mark). */
function indexTimeLabelStep(rec: IndexRecord): TraceStep {
  const mark = rec.enrich?.label;
  const by = mark?.by ?? (rec.categoryBy === 'seed' ? 'seed' : rec.categoryBy === 'rule' ? 'code' : rec.categoryBy);
  const phrase = by === 'device' ? WHERE_PHRASE.device : by === 'cloud' ? WHERE_PHRASE.cloud : by === 'seed' ? WHERE_PHRASE.seed : WHERE_PHRASE.code;
  const placed = sdkWhere(by, mark?.sdk);
  return { kind: 'label', label: LABELS.sortedAt(rec.category, phrase), ...placed, ms: mark?.ms ?? 0, at: mark?.at ?? rec.indexedAt };
}

/** The AI-instruction check that ran when the item was indexed (11's scan stamps), or a note that it has not run. */
function indexTimeInjectionStep(rec: IndexRecord): TraceStep {
  const stamps = rec.privacyScan?.injection;
  const nanoStamp = stamps?.nano;
  const codeStamp = stamps?.code;
  if (!nanoStamp && !codeStamp && !rec.injection) return codeTrace('injection', LABELS.injectionNotRun, 0, rec.indexedAt);
  const flagged = rec.injection?.suspicious === true;
  if (nanoStamp) {
    const phrase = nanoStamp.ran === 'device' ? WHERE_PHRASE.device : nanoStamp.ran === 'cloud' ? WHERE_PHRASE.cloud : WHERE_PHRASE.code;
    const placed = sdkWhere(nanoStamp.ran, undefined);
    return { kind: 'injection', label: LABELS.injectionChecked(phrase, flagged), ...placed, ms: nanoStamp.ms, at: nanoStamp.at };
  }
  const seeded = rec.categoryBy === 'seed' || rec.enrich?.label?.by === 'seed';
  return codeTrace('injection', LABELS.injectionChecked(seeded && !codeStamp ? WHERE_PHRASE.seed : WHERE_PHRASE.code, flagged), codeStamp?.ms ?? 0, codeStamp?.at ?? rec.indexedAt);
}
