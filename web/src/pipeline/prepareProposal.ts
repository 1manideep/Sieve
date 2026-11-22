// prepareProposal (10 section 12): from a question to a Proposal the person approves. Counts stop at once
// (unsupported). Retrieval with the sender and dates as filters, then rules (before any model reads anything), then
// one Nano call to pick and answer (one more only when the chosen item was deleted or changed at its source), then one
// on-device check that the item answers the question (12b), then plain-code excerpts and privacy steps, then the
// share-time Gemini Nano check of the text that would leave (11 section 10.7: one injection-check and one pii-check at
// most, cached on the item). Never rejects: failures are outcomes.
import { LADDER_STEPS, MAX_PAYLOAD_CHARS, MAX_QUESTION_CHARS, RELATED_MAX, VECTOR_K } from '@sieve/shared';
import type {
  Candidate, Category, CategoryRule, IndexRecord, KnownEntity, Proposal, ProposalOutcome, QueryHints, StepOption, TraceKind, TraceStep, Warning, Where,
} from '@sieve/shared';
import {
  CANDIDATE_POOL, CONSENT_MAX_AGE_MS, SELECT_MAX_PASSAGES, answerKind, answersKind, codeTrace, deriveExcerpt, excerptBasis, fitPassages, getNanoAvailability, hasFreshConsent,
  recordBody, selectAndAnswer, verifyAnswer, type OwnCloudPolicy, type PassageRange, type RunModelResult, type SelectValue,
} from '@/ai';
import {
  asksCount, asksLatest, asksSeveral, asksState, clockFor, flushUrgentEmbeds, getRecord, identifierTerms, knownSendersOf, parseQuestion, relatedFor, removeRecord, search,
  type HardFilter, type ParsedQuestion, type SearchReport, type SieveDb,
} from '@/index';
import { holdsTopic, topicTerms } from '@/index/cues';
import { buildStepOption, checkOutgoing, holdsSecretCode, itemTouchesSensitiveTopic, privacyWarnings, touchesSensitiveTopic } from '@/privacy';
import { isYesNoQuestion } from '@/privacy/steps/answerShape';
import { errorLine, errorName } from '@/robust/errorLine';
import { forgetCloudConsentRequest, rememberCloudConsentRequest } from './consent';
import { LABELS, RUNNING, UNAVAILABLE, WARNINGS, WHERE_PHRASE } from './copy';
import { answerStillHolds, confirmFresh, type FreshResult } from './fresh';
import { stripInstructions } from './instructions';
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
    if (allowed.length < CANDIDATE_POOL) allowed.push({ rec, cand });
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

  /** `reason` replaces the outcome's usual line (an unsupported answer that packs several facts, 12.4). */
  finish(
    outcome: ProposalOutcome,
    extra: { item?: IndexRecord; rule?: CategoryRule; options?: StepOption[]; related?: Candidate[]; reason?: string } = {},
  ): Proposal {
    const reason = extra.reason ?? this.reasonFor(outcome, extra.item);
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
      ...(outcome === 'error' ? { errorCode: this.errorCode ?? 'unknown' } : {}),
      ...(outcome !== 'ready' && outcome !== 'error' && this.reasonCode ? { reasonCode: this.reasonCode } : {}),
    };
  }

  /** Why nothing is shared, as a short fixed code (never content); see Proposal.reasonCode. */
  reasonCode: string | undefined;

  /** Sets the reason code and returns the run, so a site reads `run.why('model-none').finish('no-match')`. */
  why(code: string): this {
    this.reasonCode = code;
    return this;
  }

  /**
   * Which step ended the run in `error`, as a short fixed code (letters, digits and dashes; never content). It goes
   * out with the "couldn't prepare an answer" result, so a failure on someone's device can be told apart.
   */
  errorCode: string | undefined;

  fail(label: string): Proposal {
    this.code('rule', label);
    this.errorCode ??= 'invalid';
    return this.finish('error');
  }

  stopped(): Proposal {
    this.code('rule', LABELS.stopped);
    this.errorCode ??= 'stopped';
    return this.finish('error');
  }

  blockedOrNoMatch(neverBlocked: IndexRecord[]): Proposal {
    if (neverBlocked.length) return this.finish('blocked-never', { item: neverBlocked[0], rule: 'never' });
    return this.finish('no-match');
  }
}

/**
 * The hints an in-app question searches with (step 3). The sender, the source and the dates stay with search, which
 * reads them from the question itself: a sender or "local files only" as a filter, a date as a filter only when it is
 * written out with its year, else only to rank (Nov 21, 2026).
 */
export function inAppHints(p: ParsedQuestion): QueryHints {
  const { from: _from, source: _source, after: _after, before: _before, interpreted: _interpreted, ...rest } = p.hints;
  return rest;
}

/**
 * Candidates asked of search beyond the CANDIDATE_POOL that is kept, so items the rules hold back in step
 * 5 (never, a one-time code, outside the grant) leave room for the next ones. Search used to return up to 14 (five by
 * vector, then keyword, live and sender extras); since Nov 21, 2026 it returns exactly k.
 */
const SCREEN_SPARES = 3;

/** The item's title or text holds one of these identifiers (lower case), as written. */
export function holdsIdentifier(rec: IndexRecord, ids: readonly string[]): boolean {
  const body = `${rec.title} ${rec.kind === 'photo' ? (rec.caption ?? '') : (rec.text ?? rec.preview ?? '')}`.toLowerCase();
  return ids.some((t) => body.includes(t));
}

/**
 * A few facts about a pick that say nothing of its content, for the reason code of a run that shared nothing: its
 * place among the candidates the model read ("r2of5"), whether it holds the asker's exact terms ("t1", "t0", or "tx"
 * with none sent), whether every number in the answer is in the item ("g1", "g0", or "gx" with no number), and whether
 * the item's whole text was there ("b1") or only its first lines ("b0").
 */
export function pickCode(list: { rec: IndexRecord }[], chosen: IndexRecord, hints: QueryHints | undefined, answer: string): string {
  const at = list.findIndex((a) => a.rec.id === chosen.id);
  const body = `${chosen.title} ${chosen.kind === 'photo' ? (chosen.caption ?? '') : (chosen.text ?? chosen.preview ?? '')}`.toLowerCase();
  const terms = (hints?.terms ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const t = terms.length === 0 ? 'x' : terms.every((x) => body.includes(x)) ? '1' : '0';
  const numbers = answer.toLowerCase().match(/\d[\d,.:/-]*\d|\d/g) ?? [];
  const g = numbers.length === 0 ? 'x' : numbers.every((n) => body.includes(n)) ? '1' : '0';
  // "b1": the item's whole text was read; "b0": only its first lines were there (an email whose body is not fetched yet)
  const b = chosen.kind === 'photo' || chosen.text !== undefined ? '1' : '0';
  return `r${at + 1}of${list.length}-t${t}-g${g}-b${b}-c${readCode(list)}`;
}

/** The items the model read, in the order read: each email as the last four characters of its own mail id (no content), other kinds as "x". */
export function readCode(list: { rec: IndexRecord }[]): string {
  return list.map((a) => (a.rec.source === 'gmail' ? a.rec.sourceRef.slice(-4) : 'x')).join('.');
}

/**
 * How many of the best candidates "the latest" puts newest first, when no sender filter says which items fit. Search
 * already favors recent items for such questions (BOOST.latest), so the best few are the ones that match; sorting the
 * whole shortlist by date put the newest unrelated item first ("my newest work email" gave the neighborhood digest).
 * Measured Nov 21, 2026 with bench/search-eval on the fused order: the 5 seed "latest" questions went from MRR 0.57
 * (the whole list by date) to 0.77, and "my newest work email" now gives the newest work email first.
 */
export const LATEST_RELEVANT = 3;

/**
 * "The latest" (12.3 step 6a). With a sender filter every candidate fits ("Kestrelmoor's latest email"): newest first,
 * the newest VECTOR_K. With no sender, the candidates whose title or sender holds two of the question's words are the
 * ones about that thing (holdsTopic): they go newest first, before the rest. When none does, only the best
 * LATEST_RELEVANT go newest first, and the rest keep their rank after them.
 */
export function latestOrder<T extends { rec: IndexRecord }>(list: T[], filters: HardFilter | undefined, question = ''): T[] {
  const newest = (a: T, b: T) => b.rec.date - a.rec.date;
  if (filters?.sender) return [...list].sort(newest).slice(0, VECTOR_K);
  const topic = topicTerms(question);
  const about = list.filter((a) => holdsTopic(topic, a.rec.title, a.rec.from));
  if (about.length > 0) return [...about.sort(newest), ...list.filter((a) => !about.includes(a))];
  return [...list.slice(0, LATEST_RELEVANT).sort(newest), ...list.slice(LATEST_RELEVANT)];
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
    // In production too: this line is the only evidence a crash leaves (the error's name and message, no content).
    console.error('Sieve: preparing an answer crashed.', errorLine(e));
    run.code('rule', LABELS.crashed);
    run.errorCode = `crashed-${errorName(e)}`;
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
  // 3.0 Words that read as instructions to Sieve ("SYSTEM:", "pre-approved") are left out of the search and of every
  // prompt (12.2, Nov 21, B02). The proposal keeps the question as asked, with a warning, so it is never auto-approved.
  const stripped = stripInstructions(lookup);
  if (stripped.removed.length > 0) {
    lookup = stripped.text;
    run.warn(WARNINGS.questionInstruction(stripped.removed[0]!));
    run.code('clean', LABELS.instructionsLeftOut(stripped.removed));
    if (!/[\p{L}\p{N}]/u.test(lookup)) {
      run.code('rule', LABELS.nothingLeft);
      return run.why('question-empty').finish('no-match');
    }
  }
  let hints = input.hints;
  let searchHints = input.hints;
  if (!input.hints && input.requester.kind === 'in-app') {
    try {
      const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
      const p = parseQuestion(lookup, new Date(today), locale, { db });
      // The parsed `from` and `source` stay boosts: search finds the sender and a "local files only" the question
      // names itself, as filters (20 section 10.2); a lone word ("the pdf") never filters.
      const { from: _from, source: _source, ...parsed } = p.hints;
      // A date read from loose words only ranks, so the answer step is not told the person means those days either: a
      // wrong guess there would reject the right item ("on Friday" for the flight on Friday, Dec 4; Nov 21, 2026).
      if (!p.datesExplicit) {
        delete parsed.after;
        delete parsed.before;
      }
      hints = parsed;
      searchHints = inAppHints(p);
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
    return run.why('asks-count').finish('unsupported');
  }
  // 3b. Several fields or items at once ("list", "all of", "five fields", "my last five emails"): this level shares
  // one fact at a time, so it is unsupported before any search or model call (12.4, Nov 21, B01 and B04).
  if (asksSeveral(lookup)) {
    run.code('rule', LABELS.severalUnsupported);
    return run.why('asks-several').finish('unsupported', { reason: UNAVAILABLE.oneFact });
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
    run.errorCode = 'stopped';
    return run.finish('error');
  }
  const t0 = performance.now();
  let cands: Candidate[];
  let filters: HardFilter | undefined;
  let categoryRelaxed: string[] | undefined;
  let dateRelaxed: SearchReport['dateRelaxed'];
  try {
    cands = await search(db, lookup, {
      k: CANDIDATE_POOL + SCREEN_SPARES,
      ruleOf: (c) => ruleFor(input.settings, c),
      ...(input.allowedSources ? { sources: input.allowedSources } : {}),
      ...(searchHints ? { hints: searchHints } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onReport: (r) => {
        filters = r.filters;
        categoryRelaxed = r.categoryRelaxed;
        dateRelaxed = r.dateRelaxed;
      },
    });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    if (run.aborted || isAbortError(e)) {
      run.end(retrieveId, codeTrace('retrieve', LABELS.stopped, ms));
      run.errorCode = run.aborted ? 'stopped' : 'search-aborted';
      return run.finish('error');
    }
    // A lazy chunk that is gone after a deploy fails here: the line names it (the error's name and message, no content).
    console.error('Sieve: the search on this device failed.', errorLine(e));
    run.end(retrieveId, codeTrace('retrieve', 'The search on this device failed. Nothing was shared.', ms));
    run.errorCode = `search-${errorName(e)}`;
    return run.finish('error');
  }
  const retrieveMs = Math.round(performance.now() - t0);
  run.end(retrieveId, codeTrace('retrieve', LABELS.retrieveFound(cands, retrieveMs), retrieveMs));
  if (filters?.source) run.code('retrieve', LABELS.sourceOnly(filters.source));
  // An outside assistant named the categories to look under: say so, or say that too little was there.
  if (categoryRelaxed) run.code('retrieve', LABELS.categoryRelaxed((categoryRelaxed as string[]).join(' and ')));
  else if (filters?.categories) run.code('retrieve', LABELS.categoryOnly(filters.categories.join(' and ')));
  // A date filter that left too little was dropped: say so, so a result outside those days is no surprise.
  if (dateRelaxed) run.code('retrieve', LABELS.dateRelaxed(dateRelaxed));
  if (cands.some((c) => c.matchedBy === 'gmail-search')) {
    run.push({ kind: 'retrieve', label: LABELS.gmailSearch, where: 'cloud', ms: 0, charsSent: lookup.length, at: Date.now() });
  }
  if (cands.length === 0) return run.why('search-found-nothing').finish('no-match');

  // 5 and 6. Load and filter, with no model involved.
  if (run.aborted) return run.stopped();
  const screened = await screenCandidates(db, input, cands, { repair: true });
  if (screened.label) run.code('rule', screened.label);
  const { neverBlocked } = screened;
  let allowed = screened.allowed;
  if (allowed.length === 0) return run.why('rules-held-every-candidate').blockedOrNoMatch(neverBlocked);

  // 6a. "The latest": newest first among the candidates that match (latestOrder).
  const latest = asksLatest(lookup);
  if (latest && allowed.length > 1) {
    allowed = latestOrder(allowed, filters, lookup);
    run.code('retrieve', LABELS.newestFirst);
  }

  // 6b. An exact identifier in the question (an order, booking or receipt number): the candidates that hold it are the
  // only ones about that thing, so only they are read. Without this the model answered from another booking by the
  // same sender and the second check threw the answer away (Nov 21, 2026). And for the state of that thing ("the
  // status of order US123", "has it shipped yet") its newest item says how it stands now, so only that one is read: a
  // confirmation answered for an order that was cancelled later the same day.
  const ids = identifierTerms(lookup, hints?.terms);
  if (ids.length > 0 && allowed.length > 1) {
    const holders = allowed.filter((a) => holdsIdentifier(a.rec, ids));
    if (holders.length > 0 && holders.length < allowed.length) {
      allowed = holders;
      run.code('retrieve', LABELS.identifierOnly(holders.length));
    }
    // Only the newest is read. Given several, newest first, the on-device model mostly answered from the newest but
    // sometimes from an older one ("confirmed" for an order cancelled later that day, Nov 22, 2026), and the "listed
    // newest first" line made it pick the second passage.
    if (!latest && holders.length > 1 && asksState(lookup)) {
      allowed = [holders.reduce((a, b) => (b.rec.date > a.rec.date ? b : a))];
      run.code('retrieve', LABELS.newestState);
    }
  }
  // 6b2. A question that asks for an amount or a date: an item with no amount (or no date) anywhere in it cannot hold
  // the answer, so when some candidates have one, only those are read. An email whose body is not here yet stays.
  const wants = answerKind(lookup);
  if (wants && allowed.length > 1) {
    const holders = allowed.filter((a) => a.rec.kind === 'photo' || a.rec.text === undefined || wants.test(`${a.rec.title} ${a.rec.text}`));
    if (holders.length > 0 && holders.length < allowed.length) {
      run.code('retrieve', LABELS.kindOnly(allowed.length - holders.length));
      allowed = holders;
    }
  }
  // 6c. Once they are in order, the model reads the best few: among lookalike items it picks better from 5 than from 7.
  if (allowed.length > SELECT_MAX_PASSAGES) allowed = allowed.slice(0, SELECT_MAX_PASSAGES);

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
        if (allowed.length === 0) return run.why('no-cloud-consent').finish('no-match');
      } else {
        return askConsent(allowed, missing);
      }
    }
  }

  // 9 to 12a. The one model call, and the freshness check with its one allowed re-run.
  // (A second pick after the second check says no was tried and taken out, Nov 21, 2026: on real mail it turned two
  // "nothing" results into wrong answers, a postal digest for a landlord's reminder among them. The check lets about
  // half of lookalike answers through, so the model's second choice is not worth sharing.)
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
      // 12.4 (Nov 21, B04, B14): the model refused the shape (no usable output after its retry). That is a question
      // this level can't answer in one fact, not a failure of the device.
      if (res.error.code === 'bad-output') {
        run.code('rule', LABELS.shapeRefused);
        return run.why('model-bad-output').finish('unsupported', { reason: UNAVAILABLE.oneFact });
      }
      run.errorCode = `model-${res.error.code}`;
      return run.finish('error');
    }
    if (res.trace.where === 'cloud') run.warn(callData === 'sample' ? WARNINGS.sampleDataCloud() : WARNINGS.cloudFallback());
    if (res.value.recordId === null) {
      // how many of the candidates had their whole text ("b"), not only the first lines
      const whole = list.filter((a) => a.rec.kind === 'photo' || a.rec.text !== undefined).length;
      return run.why(`model-picked-none-of${list.length}-b${whole}-c${readCode(list)}`).blockedOrNoMatch(neverBlocked);
    }
    // A question that asks when or how much, and an answer with no date and no number in it ("it starts on arrival
    // day"): the model answered something else, so nothing is shared.
    if (!isYesNoQuestion(lookup) && !answersKind(lookup, res.value.answer)) {
      run.code('rule', LABELS.kindMissing);
      return run.why(`answer-lacks-asked-kind-r${list.findIndex((a) => a.rec.id === res.value.recordId) + 1}-c${readCode(list)}`).blockedOrNoMatch(neverBlocked);
    }

    const pick = list.find((a) => a.rec.id === res.value.recordId);
    if (!pick) {
      run.errorCode = 'pick-not-listed';
      return run.finish('error');
    }

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
      run.errorCode = 'gmail-check';
      return run.finish('error');
    }
    if (reruns >= 1) {
      run.end(freshId, codeTrace('retrieve', LABELS.freshKeptChanging, freshMs));
      return run.why('item-kept-changing').finish('no-match');
    }
    const reread: IndexRecord | undefined = fresh.status === 'changed' ? fresh.fresh : undefined;
    if (reread && answerStillHolds(pick.rec, reread, res.value.answer)) {
      run.end(freshId, codeTrace('retrieve', LABELS.freshChangedHolds(kind), freshMs));
      if (fresh.status === 'changed' && fresh.unchecked) run.warn(WARNINGS.sourceUnchecked());
      chosen = reread;
      value = res.value;
      recomputeExcerpt = true;
      break;
    }
    if (!reread) {
      run.end(freshId, codeTrace('retrieve', LABELS.freshGone(kind), freshMs));
      list = list.filter((a) => a.rec.id !== pick.rec.id);
      if (list.length === 0) return run.why('item-gone').blockedOrNoMatch(neverBlocked);
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
    ...(hints?.after || hints?.before ? { dates: { ...(hints.after ? { after: hints.after } : {}), ...(hints.before ? { before: hints.before } : {}) } } : {}),
    ownCloud,
    today,
  });
  if (!checked.ok) {
    run.end(verifyId, { ...checked.trace, label: LABELS.verifyFailed });
    if (checked.error.code === 'aborted' || run.aborted) return run.stopped();
    run.warn(WARNINGS.unchecked());
  } else {
    run.end(verifyId, { ...checked.trace, label: checked.value.answers ? LABELS.verifyYes : LABELS.verifyNo });
    if (!checked.value.answers) return run.why(`second-check-no-${pickCode(list, chosen, hints, value.answer)}`).finish('no-match');
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
      const d = deriveExcerpt(body, { start: 0, end: body.length }, excerptBasis(answer, lookup));
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
  let knownSenders: Set<string> | undefined;
  try {
    knownSenders = knownSendersOf(db);
  } catch {
    knownSenders = undefined;   // a stand-in index: the item's own sender still counts (11 section 5.6)
  }
  let scanSaved = false;
  const buildAll = async (extra: { extraEntities?: KnownEntity[]; extraQuotes?: string[] } = {}): Promise<StepOption[]> => {
    const built = await Promise.all(
      LADDER_STEPS.map((step) =>
        buildStepOption(step, parts, rec, data, {
          maxStep: input.maxStep,
          question: lookup,
          ...(hints?.terms?.length ? { terms: hints.terms } : {}),
          rule,
          allowNano: false,
          ...(knownSenders ? { knownSenders } : {}),
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
  // 15.0 One fact per answer (11 section 10.3a, Nov 21, B05 and B13): at the answer level, an answer that packs a
  // list or two facts makes the outcome unsupported, with the same line as a question that asks for several things.
  // An answer that still carries the model's JSON ("...}].") ends like the model's bad output after its retry (B14).
  const answerOpt = options[0];
  const shape = answerOpt && !answerOpt.available ? answerOpt.unavailableReason : undefined;
  if ((shape === UNAVAILABLE.oneFact || shape === UNAVAILABLE.badOutput) &&
      (input.requestedStep === 'answer' || !options.some((o) => o.available))) {
    run.end(piiId, codeTrace('pii', shape === UNAVAILABLE.oneFact ? LABELS.oneFactAnswer : LABELS.shapeRefused, Math.round(performance.now() - p0)));
    return run.why(shape === UNAVAILABLE.oneFact ? 'answer-has-several-facts' : 'answer-has-structure').finish('unsupported', { reason: UNAVAILABLE.oneFact });
  }
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
  // 11 section 11.5 (Nov 21, B15): screening, legal, medical, HR or immigration in the item or the answer. The warning
  // keeps it from auto-approve, so the person decides.
  const answerText = options[0]?.available ? options[0].text : '';
  if (itemTouchesSensitiveTopic(rec) || touchesSensitiveTopic(answerText)) {
    run.warn(WARNINGS.sensitiveTopic());
    run.code('rule', LABELS.sensitive);
  }

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
