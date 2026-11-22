// search (01 section 9, 20 section 10): the best records by meaning and by keyword, fused by weighted reciprocal rank
// with live Gmail ids, then the hint boosts, one candidate per contentHash, the reranker when it runs, and the thread
// cap (docs/research/local-vector-search.md section 5, Nov 21, 2026). The sender, the source and explicit dates are
// filters, dates read from loose words and the other hints boost (10.2); every hit is resolved with getRecord.
import { DEFAULT_CATEGORY_RULES, EMBEDDING_DIMS, KEYWORD_SAFETY_K, VECTOR_K } from '@sieve/shared';
import type { Candidate, Category, CategoryRule, IndexRecord, ItemKind, QueryHints, SourceKind } from '@sieve/shared';
import { getMl } from '../ml/client';
import type { EmbedInput, EmbedOutput } from '../ml/protocol';
import { errorLine } from '../robust/errorLine';
import { BOOST, GMAIL_LIVE_K, RERANK_TEXT_CHARS, SEARCH_TUNING } from './config';
import { repairOrphanHit } from './consistency';
import { asksLatest, holdsTopic, isRoleCue, knownSenderWordsOf, senderMatches, topicTerms } from './cues';
import { clockFor, type SieveDb } from './db';
import { iso } from './dates';
import { getRecord } from './ingest';
import { ready } from './lifecycle';
import { parseQuestion, type ParsedQuestion } from './parseQuestion';
import { queryWordsOf, reasonFor } from './reasons';
import type { RerankPassage, RerankResult } from './rerank';
import { getRuntime, type RecordMeta } from './runtime';
import { osaDistance } from './typos';
import { cutGraphemes, displayName, withEmojiNames } from './text';
import type { ChunkHit } from './vectorIndex';

export interface SearchReport {
  scope: { records: number; byKind: Partial<Record<ItemKind, number>> };
  searchedFor?: string;                 // corrected question, when a correction happened
  hints: QueryHints;
  vector: { ran: boolean; ms: number; reason?: 'model-loading' | 'model-failed' | 'timeout' };
  keyword: { ms: number; added: number };
  live?: { q: string; found: number; added: number; ms: number; charsSent: number; skipped?: 'no-token' | 'error' | 'timeout' };
  hydrated?: { fetched: number; skipped: number };
  repaired: number;                     // orphan hits dropped (20 section 5.7)
  filters?: HardFilter;                 // the sender and dates every candidate had to fit (10.2)
  senderDropped?: string;               // a sender read from the question's words that no item is from, but titles hold: it only ranks
  categoryRelaxed?: Category[];         // a category hint left too few results, or hid the newest item the question names, so the search ran again without it
  latest?: string[];                    // "the latest": the newest items from the named sender or about the named thing, newest first
  dateRelaxed?: { after?: string; before?: string };   // a date filter left too few results: run again, the dates only ranking
  fusion?: { vector: number; keyword: number; live: number; pool: number };   // list lengths fused, and the records after them
  rerank?: { ran: boolean; ms: number; passages: number; reason?: RerankResult['reason'] | 'few-candidates' | 'asks-latest' };
}

/** Hard filters (20 section 10.2): an item that fails one never becomes a candidate. */
/** `senderExact`: some sender in the index is spelled as the cue is, so a near spelling is another sender ("Kestral" for "Kestrel"). */
export interface HardFilter { sender?: string; senderExact?: boolean; after?: string; before?: string; source?: QueryHints['source']; categories?: Category[] }

/** A category hint that leaves fewer results than this is dropped, and the search runs again without it. */
export const CATEGORY_MIN_RESULTS = 3;
/** A date filter that leaves fewer results than this is dropped too; its dates then only rank (Nov 21, 2026). */
export const DATE_MIN_RESULTS = 3;

/**
 * Whether an item's category fits an outside assistant's category hint. Personal always fits: it is also where
 * mail that nothing has sorted yet sits, and a filter must not hide what it cannot judge.
 */
export function categoryFits(wanted: Category[], category: Category): boolean {
  return category === 'Personal' || wanted.includes(category);
}

export interface SearchOptions {
  k?: number; sources?: SourceKind[]; categories?: Category[]; hints?: QueryHints;
  live?: boolean; hydrate?: boolean; signal?: AbortSignal; now?: number; locale?: string;
  onReport?: (r: SearchReport) => void;
  /**
   * Other words the answering item may use ("bike cage" for "bicycle storage"), from the on-device model: what they find by
   * keyword is one more list. Measured Nov 22, 2026 with bench/search-eval and the model's own words for all 70
   * questions, on the distractor set: the right item first for 81% of questions against 66%, in the best five for 93%
   * against 90% (paraphrases 86% against 79%); with the reranker, in the best five for 96% against 91%. The same
   * words as one more meaning list scored no better, so they are not embedded.
   */
  expand?: string[];
  /** The person's rule per category (default: DEFAULT_CATEGORY_RULES): the reranker reads a never item's title only. */
  ruleOf?: (category: Category) => CategoryRule;
}

interface Scored {
  id: string; score: number; matchedBy: Candidate['matchedBy']; hit?: ChunkHit;
  fromBoost?: boolean; termMatched?: string;
}

const DAY = 86_400_000;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The search was stopped.', 'AbortError');
}

function definedFields(h?: QueryHints): QueryHints {
  const out: QueryHints = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h) as [keyof QueryHints, unknown][]) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function mergeHints(parsed: QueryHints, explicit?: QueryHints): QueryHints {
  const e = definedFields(explicit);
  const merged: QueryHints = { ...parsed, ...e };
  const interpreted = [...(parsed.interpreted ?? []), ...(e.interpreted ?? [])];
  if (interpreted.length > 0) merged.interpreted = interpreted;
  else delete merged.interpreted;
  if (e.terms || parsed.terms) merged.terms = [...new Set([...(e.terms ?? []), ...(parsed.terms ?? [])])].slice(0, 5);
  return merged;
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function inRange(day: string, hints: Pick<QueryHints, 'after' | 'before'>): boolean {
  if (hints.after && day < hints.after) return false;
  if (hints.before && day > hints.before) return false;
  return true;
}

/**
 * The request's `from` (unless it is a role such as "my landlord") or the sender the question names, the dates, and the
 * source (the request's `source`, or "local files only", "in my mail" in the question; a lone word such as "pdf" stays a
 * boost). Photos have no sender, so a sender never filters a photo question. Dates filter when an outside assistant sent
 * them or the question wrote them out with their year; dates Sieve read from loose words ("December 4", "on Friday",
 * "last week") only rank, because a wrong guess as a filter removes the answer (Nov 21, 2026: 6 of 40 questions).
 */
export function hardFilterOf(p: Pick<ParsedQuestion, 'sender' | 'only' | 'datesExplicit'>, explicit: QueryHints | undefined, merged: QueryHints): HardFilter {
  const out: HardFilter = {};
  const asked = explicit?.from?.trim();
  const sender = asked && !isRoleCue(asked) ? asked : p.sender;
  if (sender && merged.source !== 'photos') out.sender = sender;
  const dates = explicit?.after || explicit?.before ? explicit : p.datesExplicit ? merged : undefined;
  if (dates?.after) out.after = dates.after;
  if (dates?.before) out.before = dates.before;
  const source = explicit?.source ?? p.only;
  if (source) out.source = source;
  // Only what an outside assistant sent: Sieve never guesses a category from the question's words.
  if (explicit?.categories && explicit.categories.length > 0) out.categories = explicit.categories;
  return out;
}

/** The kinds a source filter lets through: mail is email, photos are photos, files are documents and notes. */
export function kindFits(source: NonNullable<QueryHints['source']>, kind: ItemKind | undefined): boolean {
  return source === 'mail' ? kind === 'email' : source === 'photos' ? kind === 'photo' : kind === 'document' || kind === 'note';
}

/** The sender fits, and the item's own day or a day it mentions falls inside the dates ("the flight on Dec 4"). */
export function passesFilter(f: HardFilter, r: { from?: string; date: number; mentionedDays?: string[]; kind?: ItemKind; category?: Category }): boolean {
  if (f.source && !kindFits(f.source, r.kind)) return false;
  if (f.categories && r.category && !categoryFits(f.categories, r.category)) return false;
  if (f.sender && !senderMatches(f.sender, r.from, f.senderExact)) return false;
  if ((f.after || f.before) && !inRange(iso(new Date(r.date)), f) && !(r.mentionedDays ?? []).some((d) => inRange(d, f))) return false;
  return true;
}

type RerankModule = typeof import('./rerank');
let rerankModule: Promise<RerankModule | null> | null = null;

/** The reranker's module, imported once; warmupRerank on every search, so the model loads before it is needed. */
function loadReranker(): Promise<RerankModule | null> {
  rerankModule ??= import('./rerank').catch(() => {
    rerankModule = null;   // a chunk that failed to load is tried again by the next search
    return null;
  });
  return rerankModule.then((m) => {
    try {
      m?.warmupRerank();
    } catch {
      // the search goes on in its own order
    }
    return m;
  });
}

/** A rerank that overruns its own budget by more than this is abandoned, and the fused order stands. */
const RERANK_GRACE_MS = 250;

/**
 * The text the reranker reads for a candidate: what the answer step would read (the best chunk, a caption, or the
 * part of the text with the question's words), under its title and sender, at most RERANK_TEXT_CHARS.
 */
function rerankText(rec: IndexRecord, hit: ChunkHit | undefined, words: { word: string }[]): string {
  const header = rec.kind === 'email' && rec.from ? `${rec.title}\n${displayName(rec.from)}` : rec.title;
  if (rec.kind === 'photo') return withEmojiNames(rec.caption ? `Photo: ${rec.caption}` : header);
  const text = rec.text ?? '';
  let body: string;
  if (hit && hit.end > hit.start && hit.end <= text.length) body = text.slice(hit.start, hit.end);
  else if (text.trim()) {
    const lower = text.toLowerCase();
    const at = Math.min(...words.map((w) => lower.indexOf(w.word)).filter((i) => i >= 0), text.length);
    const from = at >= text.length ? 0 : Math.max(0, at - Math.floor(RERANK_TEXT_CHARS / 3));
    body = text.slice(from, from + RERANK_TEXT_CHARS);
  } else body = rec.preview ?? '';
  return cutGraphemes(withEmojiNames(`${header}\n${body}`), RERANK_TEXT_CHARS);
}

/**
 * The reranker's contract (rerank.ts): up to RERANK_MAX_PASSAGES candidates in fused order, reordered by its order
 * when it ran. When it did not (no model yet, too slow, failed) the fused order stands, and the report says why.
 * A never item is not sent at all and keeps its place: no model reads its content (chunk.ts embedTexts), and from its
 * title alone the reranker sank it below items it could read ("Is RX-6620194 ready?" went from first to fourth). The
 * new order mixes the reranker's rank with the fused one (SEARCH_TUNING.rerankBlend), so what only the boosts know (a
 * date the item mentions, an exact id, "the latest") is not lost: with the app's reranker on the distractor set,
 * its order alone scored below the fused order (MRR 0.738 against 0.761), mixed it scored 0.795 (Nov 21, 2026).
 */
async function rerankRanked(
  ranked: Scored[], recs: Map<string, IndexRecord | undefined>, question: string, words: { word: string }[],
  opts: SearchOptions, reranker: Promise<RerankModule | null>, report: SearchReport,
): Promise<Scored[]> {
  const mod = await reranker;
  if (!mod) {
    report.rerank = { ran: false, ms: 0, passages: 0, reason: 'model-failed' };
    return ranked;
  }
  // "The latest" is about when, which a cross-encoder cannot read; the fused order carries it (BOOST.latest), and
  // reranking such questions put the newest matching item lower (Nov 21, 2026: MRR 0.77 to 0.45 on the 5 seed ones).
  if (asksLatest(question)) {
    report.rerank = { ran: false, ms: 0, passages: 0, reason: 'asks-latest' };
    return ranked;
  }
  const head = ranked.slice(0, mod.RERANK_MAX_PASSAGES);
  const ruleOf = opts.ruleOf ?? ((c: Category) => DEFAULT_CATEGORY_RULES[c]);
  const readable = head.filter((s) => ruleOf((recs.get(s.id) as IndexRecord).category) !== 'never');
  if (readable.length < 2) {
    report.rerank = { ran: false, ms: 0, passages: readable.length, reason: 'few-candidates' };
    return ranked;
  }
  const passages: RerankPassage[] = readable.map((s) => ({ id: s.id, text: rerankText(recs.get(s.id) as IndexRecord, s.hit, words) }));
  const controller = new AbortController();
  const stop = () => controller.abort();
  opts.signal?.addEventListener('abort', stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t0 = performance.now();
  let result: RerankResult;
  try {
    const late = new Promise<RerankResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ order: passages.map((x) => x.id), ran: false, ms: Math.round(performance.now() - t0), reason: 'timeout' });
      }, mod.RERANK_BUDGET_MS + RERANK_GRACE_MS);
    });
    result = await Promise.race([mod.rerank(question, passages, { budgetMs: mod.RERANK_BUDGET_MS, signal: controller.signal }), late]);
  } catch {
    result = { order: passages.map((x) => x.id), ran: false, ms: Math.round(performance.now() - t0), reason: 'model-failed' };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', stop);
  }
  report.rerank = { ran: result.ran, ms: result.ms, passages: passages.length, ...(result.reason ? { reason: result.reason } : {}) };
  if (!result.ran) return ranked;
  const byId = new Map(readable.map((s, i) => [s.id, { s, fusedAt: i }]));
  const order = result.order.filter((id, i, all) => byId.has(id) && all.indexOf(id) === i);
  for (const s of readable) if (!order.includes(s.id)) order.push(s.id);
  const T = SEARCH_TUNING;
  const blended = order
    .map((id, i) => ({ id, v: 1 / (T.rrfK + i + 1) + T.rerankBlend / (T.rrfK + (byId.get(id)?.fusedAt ?? i) + 1), i }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => byId.get(x.id)?.s as Scored);
  // never items stay in their slots; the others fill the rest in the new order
  let next = 0;
  const reordered = head.map((s) => (byId.has(s.id) ? (blended[next++] as Scored) : s));
  return [...reordered, ...ranked.slice(head.length)];
}

/** Hint boosts (20 section 10.1 step 6). */
function boostFor(rec: IndexRecord, meta: RecordMeta | undefined, hints: QueryHints, question: string, now: number): { boost: number; fromBoost: boolean; termMatched?: string } {
  let boost = 0;
  let fromBoost = false;
  let termMatched: string | undefined;
  if (hints.after || hints.before) {
    if (inRange(iso(new Date(rec.date)), hints)) boost += BOOST.dateRecord;
    else if ((rec.mentionedDays ?? meta?.mentionedDays ?? []).some((d) => inRange(d, hints))) boost += BOOST.dateMentioned;
  }
  if (hints.source) {
    const k = rec.kind;
    if ((hints.source === 'mail' && k === 'email') || (hints.source === 'photos' && k === 'photo') || (hints.source === 'files' && (k === 'document' || k === 'note'))) boost += BOOST.source;
  }
  if (hints.from && rec.from) {
    const fw = words(rec.from);
    const hit = words(hints.from).filter((w) => w.length >= 3).some((w) => fw.some((r) => r === w || (w.length >= 5 && r.length >= 5 && osaDistance(w, r, 1) <= 1)));
    if (hit) {
      boost += BOOST.from;
      fromBoost = true;
    }
  }
  if (hints.terms && hints.terms.length > 0) {
    const hay = `${rec.title}\n${rec.from ?? ''}\n${rec.text ?? ''}`.toLowerCase();
    const t = hints.terms.find((x) => hay.includes(x.toLowerCase()));
    if (t) {
      boost += BOOST.term;
      termMatched = t;
    }
  }
  const ageDays = Math.max(0, (now - rec.date) / DAY);
  const latest = /\b(latest|newest|most recent)\b/i.test(question) || /\blast\b(?!\s+(day|days|week|weeks|month|months|year|years|night|weekend|summer|winter|spring|fall|autumn|time))/i.test(question);
  boost += latest ? BOOST.latest * Math.exp(-ageDays / 30) : BOOST.recency * Math.exp(-ageDays / 60);
  return { boost, fromBoost, termMatched };
}

/**
 * The search. With a category hint from an outside assistant it looks only in those categories first; when that
 * leaves fewer than CATEGORY_MIN_RESULTS, the hint was probably a wrong guess, so it runs again without it. It also runs
 * again without it when the question asks for the latest of something and the newest such item is filed elsewhere: the
 * person named the thing, and the category is only the assistant's guess at how Sieve filed it. Before, a "Money" hint
 * hid the newest order summary, which was filed under another category, and the answer came from another email
 * (Nov 22, 2026). Then a date
 * filter that leaves fewer than DATE_MIN_RESULTS is dropped the same way, and its dates only rank. The category goes
 * first: it is the assistant's guess at how Sieve sorted the item, while a date is something the person said.
 */
export async function search(db: SieveDb, question: string, opts: SearchOptions = {}): Promise<Candidate[]> {
  let report: SearchReport | undefined;
  const vector: VectorState = {};
  const once = (o: SearchOptions, datesSoft = false) => searchOnce(db, question, { ...o, onReport: (r) => (report = r) }, datesSoft, vector);
  let current = opts;
  let res = await once(current);
  let categoryRelaxed: Category[] | undefined;
  const hinted = opts.hints?.categories;
  if (hinted && hinted.length > 0) {
    const { categories: _dropped, ...rest } = opts.hints ?? {};
    const open = { ...opts, hints: rest };
    if (res.length < CATEGORY_MIN_RESULTS) {
      current = open;
      res = await once(current);
      categoryRelaxed = hinted;
    } else if (asksLatest(question)) {
      const kept = { res, report, newest: report?.latest?.[0] };
      const wide = await once(open);
      const newest = report?.latest?.[0];
      if (newest && newest !== kept.newest) {
        current = open;
        res = wide;
        categoryRelaxed = hinted;
      } else {
        res = kept.res;
        report = kept.report;
      }
    }
  }
  let dateRelaxed: SearchReport['dateRelaxed'];
  const f = report?.filters;
  // Few results on those days is a reason to doubt the days, except when the request names the sender and one of the
  // results is itself dated then: two emails that sender really sent that day are the answer's candidates. Dropping
  // the days put an email of four days earlier in front of them, and it was answered from (Nov 22, 2026). With no
  // sender, the few items of those days may have nothing to do with the question, and the days stay a guess.
  const meta = getRuntime(db).meta;
  const sentThen = (c: Candidate): boolean => {
    const m = meta.get(c.recordId);
    return !!m && !!f?.sender && inRange(iso(new Date(m.date)), f);
  };
  if (res.length < DATE_MIN_RESULTS && (f?.after || f?.before) && !res.some(sentThen)) {
    dateRelaxed = { ...(f.after ? { after: f.after } : {}), ...(f.before ? { before: f.before } : {}) };
    res = await once(current, true);
  }
  if (report) opts.onReport?.({ ...report, ...(categoryRelaxed ? { categoryRelaxed } : {}), ...(dateRelaxed ? { dateRelaxed } : {}) });
  return res;
}

/**
 * Shared by the passes of one search: once the question's embedding has failed, a pass that relaxes a filter skips
 * the vector step instead of waiting out the model's limit again (10 s in the foreground, ml/client.ts).
 */
interface VectorState { failed?: 'model-failed' | 'timeout' }

/** One pass. `datesSoft`: the dates of the hints and the question only rank, even an explicit one. */
async function searchOnce(db: SieveDb, question: string, opts: SearchOptions, datesSoft: boolean, vector: VectorState): Promise<Candidate[]> {
  if (!question.trim()) return [];
  await ready(db);
  abortIfNeeded(opts.signal);
  const rt = getRuntime(db);
  const now = opts.now ?? clockFor(db);
  const locale = opts.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const p = parseQuestion(question, new Date(now), locale, { db });
  const hints = mergeHints(p.hints, opts.hints);
  const filter = hardFilterOf(p, opts.hints, hints);
  if (datesSoft) {
    delete filter.after;
    delete filter.before;
  }
  // A sender Sieve read from the question's own words ("my latest SIP order") that no item is from, while titles hold
  // the word: it names a thing, not a sender, so it only ranks. A name the index does not know at all ("my Delta
  // flight", with no mail from or about Delta) stays a filter and finds nothing, as it should. A sender the asking
  // assistant sent is never dropped (Nov 21, 2026: the filter left a "my latest order" question with no candidates).
  let senderDropped: string | undefined;
  if (filter.sender && !opts.hints?.from?.trim() && !filter.sender.includes('@')) {
    const cue = filter.sender;
    let known = false;
    for (const m of rt.meta.values()) {
      if (senderMatches(cue, m.from)) {
        known = true;
        break;
      }
    }
    if (!known && rt.keyword.inTitles(cue)) {
      senderDropped = cue;
      delete filter.sender;
    }
  }
  // A sender spelled as the cue is: then only such senders fit, and a near spelling ("Kestral" for "Kestrel") is another
  // sender. With no sender spelled that way the cue may be a typo ("Northgar"), and near spellings fit.
  if (filter.sender) {
    const cue = filter.sender;
    for (const m of rt.meta.values()) {
      if (senderMatches(cue, m.from, true)) {
        filter.senderExact = true;
        break;
      }
    }
  }
  const filtered = Object.keys(filter).length > 0;
  const k = opts.k ?? VECTOR_K + KEYWORD_SAFETY_K;

  const byKind: Partial<Record<ItemKind, number>> = {};
  const accept = (id: string): boolean => {
    const m = rt.meta.get(id);
    if (!m) return true;   // resolved below: a hit without a record is dropped and repaired
    if (opts.sources && !opts.sources.includes(m.source)) return false;
    if (opts.categories && !opts.categories.includes(m.category)) return false;
    return !filtered || passesFilter(filter, m);
  };
  let scopeCount = 0;
  for (const m of rt.meta.values()) {
    if (!accept(m.id)) continue;
    scopeCount++;
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  }
  const report: SearchReport = { scope: { records: scopeCount, byKind }, hints, vector: { ran: false, ms: 0 }, keyword: { ms: 0, added: 0 }, repaired: 0 };
  if (p.corrected !== p.normalized) report.searchedFor = p.corrected;
  if (filtered) report.filters = filter;
  if (senderDropped) report.senderDropped = senderDropped;

  // live Gmail search starts now and is merged at the end (20 section 10.5)
  // a question limited to files or photos never asks Gmail (nothing it finds could pass)
  const liveAllowed = opts.live !== false && (!filter.source || filter.source === 'mail') && (!opts.sources || opts.sources.includes('gmail'));
  const gmailRow = db.sieveKind === 'real' && liveAllowed ? await db.sources.get('gmail') : undefined;
  let livePromise: Promise<{ ids: string[]; report: NonNullable<SearchReport['live']> }> | null = null;
  if (gmailRow?.connected) {
    const live = await import('../sources/gmail/liveSearch');
    // a sender the question itself names is asked of Gmail too, as one the assistant sent would be
    const liveHints = !hints.from && filter.sender ? { ...hints, from: filter.sender } : hints;
    livePromise = live.liveGmailSearch(db, { corrected: p.corrected, hints: liveHints }, { signal: opts.signal, accept });
  }

  // The reranker's module loads beside this search and never holds it up (it is a lazy chunk, 20 section 6.3).
  const reranker = loadReranker();

  // vector step: the best retrieveK records by their best chunk, for the typed and the corrected question
  const T = SEARCH_TUNING;
  const vectorHits = new Map<string, ChunkHit>();
  const ml = getMl();
  const status = ml.status('embed');
  if (vector.failed) {
    report.vector = { ran: false, ms: 0, reason: vector.failed };
  } else if (status.state === 'ready') {
    const texts = [withEmojiNames(p.normalized)];
    const corrected = p.searchText ?? withEmojiNames(p.corrected);
    if (corrected !== texts[0]) texts.push(corrected);
    const t0 = performance.now();
    let out: EmbedOutput | undefined;
    try {
      out = await ml.run<EmbedInput, EmbedOutput>('embed', { texts }, { priority: 'foreground', signal: opts.signal });
    } catch (e) {
      // A stopped search stays stopped. Any other failure (a worker that died, the client's time limit) only means
      // there is no vector list: the search goes on with the keyword list, and the report says why.
      abortIfNeeded(opts.signal);
      const name = (e as { name?: unknown } | null)?.name;
      if (name === 'AbortError') throw e;
      vector.failed = name === 'TimeoutError' ? 'timeout' : 'model-failed';
      console.warn('Sieve: the question embedding failed; searching by keyword.', errorLine(e));
      report.vector = { ran: false, ms: Math.round(performance.now() - t0), reason: vector.failed };
    }
    if (out) {
      for (let i = 0; i < out.count; i++) {
        const qv = out.data.subarray(i * out.dims, (i + 1) * out.dims);
        const q = qv.length === EMBEDDING_DIMS ? qv : new Float32Array(EMBEDDING_DIMS);
        for (const h of rt.vectors.scan(q, accept, T.retrieveK)) {
          const prev = vectorHits.get(h.recordId);
          if (!prev || h.score > prev.score) vectorHits.set(h.recordId, h);
        }
      }
      report.vector = { ran: true, ms: Math.round(performance.now() - t0) };
    }
  } else {
    if (status.state === 'idle') ml.warmup('embed').catch(() => undefined);
    report.vector = { ran: false, ms: 0, reason: status.state === 'failed' ? 'model-failed' : 'model-loading' };
  }
  abortIfNeeded(opts.signal);
  const vectorList = [...vectorHits.values()].sort((a, b) => b.score - a.score).slice(0, T.retrieveK).map((h) => h.recordId);

  // keyword step: MiniSearch's best retrieveK, ranked on their own
  const t1 = performance.now();
  const kwTexts = [p.searchText ?? p.corrected];
  const norm = withEmojiNames(p.normalized);
  if (norm !== kwTexts[0]) kwTexts.push(norm);
  const query = [...kwTexts, ...(hints.terms ?? [])].join(' ');
  const keywordList = rt.keyword.search(query, (hit) => accept(String(hit.id))).slice(0, T.retrieveK).map((h) => String(h.id));
  const expand = (opts.expand ?? []).join(' ');
  const expandList = expand.trim() ? rt.keyword.search(expand, (hit) => accept(String(hit.id))).slice(0, T.retrieveK).map((h) => String(h.id)) : [];
  const keywordMs = Math.round(performance.now() - t1);

  // live Gmail ids, in Gmail's own order
  let liveList: string[] = [];
  if (livePromise) {
    const live = await livePromise;
    report.live = live.report;
    liveList = live.ids.slice(0, GMAIL_LIVE_K);
  }

  // "Benji's latest email": the sender's newest items are a list of their own, so the newest one is there to pick (20 section 10.2).
  // "The latest email about my Lumora membership payment" names no sender: the newest items about that thing (holdsTopic)
  // are the list. Without it a better keyword fit from two days earlier stood before the newest one (Nov 22, 2026).
  const topic = !filter.sender && asksLatest(p.corrected) ? topicTerms(p.corrected) : [];
  const latestList = asksLatest(p.corrected) && (filter.sender || topic.length > 1)
    ? [...rt.meta.values()].filter((m) => accept(m.id) && (filter.sender || holdsTopic(topic, m.title, m.from))).sort((a, b) => b.date - a.date).slice(0, k).map((m) => m.id)
    : [];

  // Weighted reciprocal rank fusion: a record high in either list ranks high, one in both higher still, and the
  // keyword list counts fully when the question holds an exact term (an order number, a quoted phrase).
  const exact = (hints.terms ?? []).some((t) => /\d/.test(t) || /\s/.test(t));
  const lists: { ids: string[]; weight: number }[] = [
    { ids: vectorList, weight: T.vectorWeight },
    { ids: keywordList, weight: exact ? T.exactKeywordWeight : T.keywordWeight },
    { ids: liveList, weight: T.liveWeight },
    { ids: latestList, weight: T.vectorWeight },
    { ids: expandList, weight: T.expandWeight },
  ];
  const fused = new Map<string, number>();
  for (const l of lists) l.ids.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + l.weight / (T.rrfK + i + 1)));
  const unit = T.vectorWeight / (T.rrfK + 1);
  const inKeyword = new Set(keywordList);
  const inLive = new Set(liveList);
  const inLatest = new Set(latestList);
  if (latestList.length > 0) report.latest = latestList;

  // boosts on the fused list, then one per contentHash
  const recCache = new Map<string, IndexRecord | undefined>();
  const ids = [...fused.keys()];
  const recs = ids.length > 0 ? await db.records.bulkGet(ids) : [];
  ids.forEach((id, i) => recCache.set(id, recs[i]));
  const scored: Scored[] = [];
  for (const id of ids) {
    const rec = recCache.get(id);
    if (!rec) {
      // an index hit without a record is repaired; a live Gmail id not stored yet is only skipped, as before
      if (vectorHits.has(id) || inKeyword.has(id)) {
        await repairOrphanHit(db, id);
        report.repaired++;
      }
      continue;
    }
    const b = boostFor(rec, rt.meta.get(id), hints, p.corrected, now);
    const hit = vectorHits.get(id);
    const matchedBy: Candidate['matchedBy'] = hit ? (rec.kind === 'photo' ? 'caption' : 'vector') : inKeyword.has(id) ? 'keyword' : inLive.has(id) ? 'gmail-search' : 'keyword';
    scored.push({ id, score: (fused.get(id) ?? 0) / unit + T.boostScale * b.boost, matchedBy, hit, fromBoost: b.fromBoost || (!!filter.sender && inLatest.has(id)), termMatched: b.termMatched });
  }
  scored.sort((a, b) => b.score - a.score);
  const hashes = new Set<string>();
  let ranked = scored.filter((s) => {
    const hash = (recCache.get(s.id) as IndexRecord).contentHash;
    if (hashes.has(hash)) return false;
    hashes.add(hash);
    return true;
  });
  report.keyword = { ms: keywordMs, added: 0 };
  report.fusion = { vector: vectorList.length, keyword: keywordList.length, live: liveList.length, pool: ranked.length };

  // the reranker reads the best passages and may reorder them; when it does not run, the fused order stands
  ranked = await rerankRanked(ranked, recCache, p.searchText ?? p.corrected, queryWordsOf(p.corrected), opts, reranker, report);
  abortIfNeeded(opts.signal);

  // at most MAX_PER_THREAD per thread, once the order is settled, then the top k (70 R-MAIL-07: a long thread never fills the list)
  const perThread = new Map<string, number>();
  const merged: Scored[] = [];
  for (const s of ranked) {
    if (merged.length >= k) break;
    const threadId = (recCache.get(s.id) as IndexRecord).threadId;
    if (threadId) {
      const n = perThread.get(threadId) ?? 0;
      if (n >= T.maxPerThread) continue;
      perThread.set(threadId, n + 1);
    }
    merged.push(s);
  }
  report.keyword.added = merged.filter((s) => s.matchedBy === 'keyword').length;
  if (report.live) report.live = { ...report.live, added: merged.filter((s) => s.matchedBy === 'gmail-search').length };
  // relevance next to the best candidate, 0 to 1, never rising down the list (a reranked order keeps its own)
  const top = merged[0]?.score ?? 1;
  let prev = 1;
  for (const s of merged) {
    s.score = Math.min(prev, top > 0 ? s.score / top : 0);
    prev = s.score;
  }

  // resolve again (a delete may have committed meanwhile) and hydrate Gmail bodies
  const final: { s: Scored; rec: IndexRecord }[] = [];
  for (const s of merged) {
    const rec = await getRecord(db, s.id);
    if (!rec) {
      await repairOrphanHit(db, s.id);
      report.repaired++;
      continue;
    }
    if (filtered && !passesFilter(filter, rec)) continue;   // a live Gmail id or a hit without metadata
    final.push({ s, rec });
  }
  if (opts.hydrate !== false && db.sieveKind === 'real') {
    const need = final.filter((f) => f.rec.source === 'gmail' && f.rec.kind === 'email' && f.rec.text === undefined).map((f) => f.rec.id);
    if (need.length > 0) {
      const { hydrateGmail } = await import('../sources/gmail/liveSearch');
      const h = await hydrateGmail(db, need, opts.signal);
      report.hydrated = h;
      for (const f of final) {
        if (!need.includes(f.rec.id)) continue;
        const fresh = await getRecord(db, f.rec.id);
        if (fresh) f.rec = fresh;
      }
    }
  }

  const queryWords = queryWordsOf(p.corrected);
  const candidates: Candidate[] = final.map(({ s, rec }) => {
    const c: Omit<Candidate, 'reason'> = { recordId: rec.id, score: Math.max(0, Math.min(1, s.score)), matchedBy: s.matchedBy };
    if (s.hit && s.hit.end > s.hit.start && rec.text && s.hit.end <= rec.text.length) c.chunk = { start: s.hit.start, end: s.hit.end };
    return { ...c, reason: reasonFor({ record: rec, candidate: { ...c, fromBoost: s.fromBoost, termMatched: s.termMatched }, queryWords, hints, now }) };
  });
  opts.onReport?.(report);
  return candidates;
}

/** The words that name a sender in this index (cues.ts), for the privacy pipeline's ID-number rule (11 section 5.6). */
export function knownSendersOf(db: SieveDb): Set<string> {
  return knownSenderWordsOf(getRuntime(db).meta);
}

/** Same contentHash, other ids: 40's "also in old/" line (01 invariant 3). */
export async function duplicatesOf(db: SieveDb, recordId: string): Promise<IndexRecord[]> {
  await ready(db);
  const rt = getRuntime(db);
  const hash = rt.meta.get(recordId)?.contentHash ?? (await getRecord(db, recordId))?.contentHash;
  if (!hash) return [];
  const ids = [...rt.meta.values()].filter((m) => m.contentHash === hash && m.id !== recordId).map((m) => m.id);
  return (await db.records.bulkGet(ids)).filter((r): r is IndexRecord => !!r);
}
