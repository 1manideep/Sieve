// search (01 section 9, 20 section 10): vector top VECTOR_K, keyword extras for exact ids and names, live Gmail
// additions; the sender and the dates are filters, the other hints boost (10.2); every hit is resolved with getRecord;
// one candidate per contentHash.
import { EMBEDDING_DIMS, KEYWORD_SAFETY_K, VECTOR_K } from '@sieve/shared';
import type { Candidate, Category, IndexRecord, ItemKind, QueryHints, SourceKind } from '@sieve/shared';
import { getMl } from '../ml/client';
import type { EmbedInput, EmbedOutput } from '../ml/protocol';
import { BOOST, GMAIL_LIVE_K, MAX_PER_THREAD } from './config';
import { repairOrphanHit } from './consistency';
import { asksLatest, isRoleCue, senderMatches } from './cues';
import { clockFor, type SieveDb } from './db';
import { iso } from './dates';
import { getRecord } from './ingest';
import { ready } from './lifecycle';
import { parseQuestion, type ParsedQuestion } from './parseQuestion';
import { queryWordsOf, reasonFor } from './reasons';
import { getRuntime, type RecordMeta } from './runtime';
import { osaDistance } from './typos';
import { withEmojiNames } from './text';
import type { ChunkHit } from './vectorIndex';

export interface SearchReport {
  scope: { records: number; byKind: Partial<Record<ItemKind, number>> };
  searchedFor?: string;                 // corrected question, when a correction happened
  hints: QueryHints;
  vector: { ran: boolean; ms: number; reason?: 'model-loading' | 'model-failed' };
  keyword: { ms: number; added: number };
  live?: { q: string; found: number; added: number; ms: number; charsSent: number; skipped?: 'no-token' | 'error' | 'timeout' };
  hydrated?: { fetched: number; skipped: number };
  repaired: number;                     // orphan hits dropped (20 section 5.7)
  filters?: HardFilter;                 // the sender and dates every candidate had to fit (10.2)
}

/** Hard filters (20 section 10.2): an item that fails one never becomes a candidate. */
export interface HardFilter { sender?: string; after?: string; before?: string }

export interface SearchOptions {
  k?: number; sources?: SourceKind[]; categories?: Category[]; hints?: QueryHints;
  live?: boolean; hydrate?: boolean; signal?: AbortSignal; now?: number; locale?: string;
  onReport?: (r: SearchReport) => void;
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
 * The request's `from` (unless it is a role such as "my landlord") or the sender the question names, and the dates
 * (from the request or the question). Photos have no sender, so a sender never filters a photo question.
 */
export function hardFilterOf(p: Pick<ParsedQuestion, 'sender'>, explicit: QueryHints | undefined, merged: QueryHints): HardFilter {
  const out: HardFilter = {};
  const asked = explicit?.from?.trim();
  const sender = asked && !isRoleCue(asked) ? asked : p.sender;
  if (sender && merged.source !== 'photos') out.sender = sender;
  if (merged.after) out.after = merged.after;
  if (merged.before) out.before = merged.before;
  return out;
}

/** The sender fits, and the item's own day or a day it mentions falls inside the dates ("the flight on Dec 4"). */
export function passesFilter(f: HardFilter, r: { from?: string; date: number; mentionedDays?: string[] }): boolean {
  if (f.sender && !senderMatches(f.sender, r.from)) return false;
  if ((f.after || f.before) && !inRange(iso(new Date(r.date)), f) && !(r.mentionedDays ?? []).some((d) => inRange(d, f))) return false;
  return true;
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

export async function search(db: SieveDb, question: string, opts: SearchOptions = {}): Promise<Candidate[]> {
  if (!question.trim()) return [];
  await ready(db);
  abortIfNeeded(opts.signal);
  const rt = getRuntime(db);
  const now = opts.now ?? clockFor(db);
  const locale = opts.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const p = parseQuestion(question, new Date(now), locale, { db });
  const hints = mergeHints(p.hints, opts.hints);
  const filter = hardFilterOf(p, opts.hints, hints);
  const filtered = Object.keys(filter).length > 0;
  const k = opts.k ?? VECTOR_K;

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

  // live Gmail search starts now and is merged at the end (20 section 10.5)
  const gmailRow = db.sieveKind === 'real' && opts.live !== false && (!opts.sources || opts.sources.includes('gmail')) ? await db.sources.get('gmail') : undefined;
  let livePromise: Promise<{ ids: string[]; report: NonNullable<SearchReport['live']> }> | null = null;
  if (gmailRow?.connected) {
    const live = await import('../sources/gmail/liveSearch');
    livePromise = live.liveGmailSearch(db, { corrected: p.corrected, hints }, { signal: opts.signal, accept });
  }

  // vector step
  const vectorHits = new Map<string, ChunkHit>();
  const ml = getMl();
  const status = ml.status('embed');
  if (status.state === 'ready') {
    const texts = [withEmojiNames(p.normalized)];
    const corrected = p.searchText ?? withEmojiNames(p.corrected);
    if (corrected !== texts[0]) texts.push(corrected);
    const t0 = performance.now();
    const out = await ml.run<EmbedInput, EmbedOutput>('embed', { texts }, { priority: 'foreground', signal: opts.signal });
    for (let i = 0; i < out.count; i++) {
      const qv = out.data.subarray(i * out.dims, (i + 1) * out.dims);
      const q = qv.length === EMBEDDING_DIMS ? qv : new Float32Array(EMBEDDING_DIMS);
      for (const h of rt.vectors.scan(q, accept, k * 4)) {
        const prev = vectorHits.get(h.recordId);
        if (!prev || h.score > prev.score) vectorHits.set(h.recordId, h);
      }
    }
    report.vector = { ran: true, ms: Math.round(performance.now() - t0) };
  } else {
    if (status.state === 'idle') ml.warmup('embed').catch(() => undefined);
    report.vector = { ran: false, ms: 0, reason: status.state === 'failed' ? 'model-failed' : 'model-loading' };
  }
  abortIfNeeded(opts.signal);

  // boosts, thread cap, one per contentHash, top k
  const recCache = new Map<string, IndexRecord | undefined>();
  const load = async (ids: string[]) => {
    const missing = ids.filter((id) => !recCache.has(id));
    if (missing.length === 0) return;
    const recs = await db.records.bulkGet(missing);
    missing.forEach((id, i) => recCache.set(id, recs[i]));
  };
  await load([...vectorHits.keys()]);
  const scored: Scored[] = [];
  for (const [id, hit] of vectorHits) {
    const rec = recCache.get(id);
    if (!rec) {
      await repairOrphanHit(db, id);
      report.repaired++;
      continue;
    }
    const b = boostFor(rec, rt.meta.get(id), hints, p.corrected, now);
    scored.push({ id, score: hit.score + b.boost, matchedBy: rec.kind === 'photo' ? 'caption' : 'vector', hit, fromBoost: b.fromBoost, termMatched: b.termMatched });
  }
  scored.sort((a, b) => b.score - a.score);
  const perThread = new Map<string, number>();
  const hashes = new Set<string>();
  const vectorList: Scored[] = [];
  for (const s of scored) {
    if (vectorList.length >= k) break;
    const rec = recCache.get(s.id) as IndexRecord;
    if (hashes.has(rec.contentHash)) continue;
    if (rec.threadId) {
      const n = perThread.get(rec.threadId) ?? 0;
      if (n >= MAX_PER_THREAD) continue;
      perThread.set(rec.threadId, n + 1);
    }
    hashes.add(rec.contentHash);
    vectorList.push(s);
  }

  // keyword safety net
  const t1 = performance.now();
  const kwTexts = [p.searchText ?? p.corrected];
  const norm = withEmojiNames(p.normalized);
  if (norm !== kwTexts[0]) kwTexts.push(norm);
  const query = [...kwTexts, ...(hints.terms ?? [])].join(' ');
  const kwHits = rt.keyword.search(query, (hit) => accept(String(hit.id)));
  const wanted = report.vector.ran ? KEYWORD_SAFETY_K : k + KEYWORD_SAFETY_K;
  const inVector = new Set(vectorList.map((s) => s.id));
  const extras: Scored[] = [];
  const lowest = vectorList.length > 0 ? Math.min(...vectorList.map((s) => s.score)) : 1;
  const top = kwHits[0]?.score ?? 1;
  for (const h of kwHits) {
    if (extras.length >= wanted) break;
    const id = String(h.id);
    if (inVector.has(id)) continue;
    if (h.contentHash && hashes.has(h.contentHash)) continue;
    await load([id]);
    const rec = recCache.get(id);
    if (!rec) {
      await repairOrphanHit(db, id);
      report.repaired++;
      continue;
    }
    if (hashes.has(rec.contentHash)) continue;
    hashes.add(rec.contentHash);
    const b = boostFor(rec, rt.meta.get(id), hints, p.corrected, now);
    const score = report.vector.ran ? Math.min(lowest, 1) * 0.99 - extras.length * 0.001 : h.score / top;
    // a record the vector scan saw but the thread cap left out keeps its best chunk for the pipeline's passage
    extras.push({ id, score, matchedBy: 'keyword', hit: vectorHits.get(id), fromBoost: b.fromBoost, termMatched: b.termMatched });
  }
  report.keyword = { ms: Math.round(performance.now() - t1), added: extras.length };

  // live Gmail additions
  const liveList: Scored[] = [];
  if (livePromise) {
    const live = await livePromise;
    report.live = live.report;
    for (const id of live.ids) {
      if (liveList.length >= GMAIL_LIVE_K) break;
      if (inVector.has(id) || extras.some((e) => e.id === id)) continue;
      await load([id]);
      const rec = recCache.get(id);
      if (!rec || hashes.has(rec.contentHash)) continue;
      hashes.add(rec.contentHash);
      liveList.push({ id, score: Math.min(lowest, 1) * 0.98, matchedBy: 'gmail-search' });
    }
    report.live = { ...report.live, added: liveList.length };
  }

  const merged = [...vectorList, ...extras, ...liveList];
  // "Ramki's latest email": the sender's newest items join the list, so the newest one is there to pick (20 section 10.2)
  if (filter.sender && asksLatest(p.corrected)) {
    const present = new Set(merged.map((s) => s.id));
    const newest = [...rt.meta.values()].filter((m) => !present.has(m.id) && accept(m.id)).sort((a, b) => b.date - a.date).slice(0, k);
    for (const m of newest) {
      if (hashes.has(m.contentHash)) continue;
      hashes.add(m.contentHash);
      merged.push({ id: m.id, score: Math.min(lowest, 1) * 0.97, matchedBy: 'keyword', fromBoost: true });
    }
  }
  abortIfNeeded(opts.signal);

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

/** Same contentHash, other ids: 40's "also in old/" line (01 invariant 3). */
export async function duplicatesOf(db: SieveDb, recordId: string): Promise<IndexRecord[]> {
  await ready(db);
  const rt = getRuntime(db);
  const hash = rt.meta.get(recordId)?.contentHash ?? (await getRecord(db, recordId))?.contentHash;
  if (!hash) return [];
  const ids = [...rt.meta.values()].filter((m) => m.contentHash === hash && m.id !== recordId).map((m) => m.id);
  return (await db.records.bulkGet(ids)).filter((r): r is IndexRecord => !!r);
}
