// Live Gmail search at question time and body hydration (20 sections 10.5 and 10.6). The query holds only words
// from the question and its hints, never item content; operators come only from this builder (70 R-MAIL-13).
import type { QueryHints } from '@sieve/shared';
import { GMAIL_HYDRATE_TIMEOUT_MS, GMAIL_LIVE_FETCH_NEW_MAX, GMAIL_LIVE_MAX, GMAIL_LIVE_TIMEOUT_MS, GMAIL_QUERY_MAX_CHARS } from '../../index/config';
import { removeRecords } from '../../index/consistency';
import type { SieveDb } from '../../index/db';
import { ingestInternal } from '../../index/ingest';
import { getRuntime } from '../../index/runtime';
import { STOP_WORDS, processTerm, tokenize } from '../../index/tokenize';
import { getGmailToken } from './auth';
import { GmailAuthError, GmailNotFoundError, getMessage, listMessages } from './api';
import { isTrashed } from './mime';
import { rawFromMessage } from './sync';

const ROLE_WORDS = new Set(['landlord', 'doctor', 'dentist', 'bank', 'boss', 'manager', 'mom', 'dad', 'pharmacy', 'airline']);
const DATE_WORDS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|weekend|summer|winter|spring|fall|autumn|christmas|halloween|thanksgiving|\d+(st|nd|rd|th)?)$/i;
const FUTURE_WORDS = new Set(['upcoming', 'next', 'will', 'coming', 'due', 'leave', 'leaves', 'leaving', 'depart', 'departs', 'departure', 'arrive', 'arrives', 'arriving', 'scheduled']);
const SOURCE_WORDS = new Set(['photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images', 'selfie', 'screenshot', 'document', 'documents', 'doc', 'docs', 'pdf', 'note', 'notes', 'chat', 'draft', 'reply']);

function cleanTerm(t: string): string {
  return t.replace(/["{}():]/g, '').replace(/^-+/, '').trim();
}

function gmailDay(d: string, deltaDays: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, (day ?? 1) + deltaDays);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

/** 20 section 10.5: rarest content words first (unknown first), from:, dates with one day of slack, terms quoted. */
export function buildGmailQuery(p: { corrected: string; hints: QueryHints }, df: (term: string) => number): { q: string; fallback: string } {
  const hints = p.hints;
  // exact identifiers (digits, phrases) are quoted; a capitalized name is an ordinary content word
  const exact = (hints.terms ?? []).filter((t) => /\d|\s/.test(t));
  const termSet = new Set(exact.map((t) => t.toLowerCase()));
  const fromWords = new Set((hints.from ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  const words: string[] = [];
  for (const raw of tokenize(p.corrected)) {
    const w = cleanTerm(raw.toLowerCase());
    if (!w || STOP_WORDS.has(w) || DATE_WORDS.test(w) || FUTURE_WORDS.has(w) || SOURCE_WORDS.has(w) || termSet.has(w) || /\d/.test(w)) continue;
    if (fromWords.has(w) && !ROLE_WORDS.has(w)) continue;
    if (!processTerm(w) || words.includes(w)) continue;
    words.push(w);
  }
  const rank = (w: string) => {
    const f = df(processTerm(w) ?? w);
    return f === 0 ? -1 : f;
  };
  const content = words.map((w, i) => ({ w, i, f: rank(w) })).sort((a, b) => a.f - b.f || a.i - b.i).slice(0, 3).map((x) => x.w);
  const tail: string[] = [];
  if (hints.from) {
    const fw = cleanTerm(hints.from).split(/\s+/).filter(Boolean);
    if (fw.length === 1 && !ROLE_WORDS.has((fw[0] ?? '').toLowerCase())) tail.push(`from:${(fw[0] ?? '').toLowerCase()}`);
    else if (fw.length > 1) tail.push(`from:"${fw.join(' ')}"`);
  }
  const dates: string[] = [];
  if (hints.after) dates.push(`after:${gmailDay(hints.after, -1)}`);
  if (hints.before) dates.push(`before:${gmailDay(hints.before, 1)}`);
  tail.push(...dates);
  if (hints.source === 'photos') tail.push('has:attachment {filename:jpg filename:jpeg filename:png filename:heic}');
  if (hints.source === 'files') tail.push('has:attachment {filename:pdf filename:doc filename:docx}');
  const quoted = exact.map(cleanTerm).filter(Boolean).map((t) => `"${t}"`);
  tail.push(...quoted);
  const exclusions = '-in:chats -in:drafts';
  const build = (c: string[]) => [...c, ...tail, exclusions].filter(Boolean).join(' ');
  let use = [...content];
  let q = build(use);
  while (q.length > GMAIL_QUERY_MAX_CHARS && use.length > 0) {
    use = use.slice(0, -1);
    q = build(use);
  }
  const first = content[0] ?? quoted[0] ?? '';
  const fallback = [first, ...dates, exclusions].filter(Boolean).join(' ');
  return { q, fallback };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

export interface LiveReport { q: string; found: number; added: number; ms: number; charsSent: number; skipped?: 'no-token' | 'error' | 'timeout' }

/** Gmail's own search for ids the index has, or fetches a couple it lacks (older than the backfill window). */
export async function liveGmailSearch(db: SieveDb, p: { corrected: string; hints: QueryHints }, opts: { signal?: AbortSignal; accept?: (id: string) => boolean }): Promise<{ ids: string[]; report: LiveReport }> {
  const t0 = performance.now();
  if (!getGmailToken()) return { ids: [], report: { q: '', found: 0, added: 0, ms: 0, charsSent: 0, skipped: 'no-token' } };
  const vocab = getRuntime(db).vocab;
  const { q, fallback } = buildGmailQuery(p, (t) => vocab.frequency(t));
  let charsSent = q.length;
  const work = (async () => {
    let res = await listMessages(q, undefined, GMAIL_LIVE_MAX, 'interactive', opts.signal);
    if (!res.messages?.length && fallback && fallback !== q) {
      charsSent += fallback.length;
      res = await listMessages(fallback, undefined, GMAIL_LIVE_MAX, 'interactive', opts.signal);
    }
    const listed = res.messages ?? [];
    const ids = listed.map((m) => 'gmail:' + m.id);
    const known = await db.records.bulkGet(ids);
    const out: string[] = [];
    const unknown: string[] = [];
    ids.forEach((id, i) => (known[i] ? out.push(id) : unknown.push(id)));
    for (const id of unknown.slice(0, GMAIL_LIVE_FETCH_NEW_MAX)) {
      try {
        const msg = await getMessage(id.slice('gmail:'.length), 'full', 'interactive', opts.signal);
        if (isTrashed(msg.labelIds)) continue;
        const r = await rawFromMessage(msg, 'full');
        const rec = await ingestInternal(db, r.raw, 'own', { sizeBytes: r.sizeBytes, sourceModifiedAt: r.internalDate, contentHash: r.contentHash, priority: 'high' });
        if (rec) out.push(rec.id);
      } catch (e) {
        if (!(e instanceof GmailNotFoundError)) throw e;
      }
    }
    return { found: listed.length, ids: out.filter((id) => !opts.accept || opts.accept(id)) };
  })();
  try {
    const r = await withTimeout(work, GMAIL_LIVE_TIMEOUT_MS);
    const ms = Math.round(performance.now() - t0);
    if (r === 'timeout') {
      work.catch(() => undefined);   // late results are ingested but not added to this question
      return { ids: [], report: { q, found: 0, added: 0, ms, charsSent, skipped: 'timeout' } };
    }
    return { ids: r.ids, report: { q, found: r.found, added: 0, ms, charsSent } };
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') throw e;
    return { ids: [], report: { q, found: 0, added: 0, ms: Math.round(performance.now() - t0), charsSent, skipped: e instanceof GmailAuthError ? 'no-token' : 'error' } };
  }
}

/** Fetch bodies of Gmail candidates that only have metadata, within GMAIL_HYDRATE_TIMEOUT_MS in total. */
export async function hydrateGmail(db: SieveDb, ids: string[], signal?: AbortSignal): Promise<{ fetched: number; skipped: number }> {
  if (!getGmailToken()) return { fetched: 0, skipped: ids.length };
  let fetched = 0;
  const deadline = Date.now() + GMAIL_HYDRATE_TIMEOUT_MS;
  const work = Promise.all(ids.map(async (id) => {
    try {
      const msg = await getMessage(id.slice('gmail:'.length), 'full', 'interactive', signal);
      if (Date.now() > deadline) return;
      if (isTrashed(msg.labelIds)) {
        await removeRecords(db, [id], 'trashed');
        return;
      }
      const r = await rawFromMessage(msg, 'full');
      if (await ingestInternal(db, r.raw, 'own', { sizeBytes: r.sizeBytes, sourceModifiedAt: r.internalDate, contentHash: r.contentHash, priority: 'high' })) fetched++;
    } catch (e) {
      if (e instanceof GmailNotFoundError) await removeRecords(db, [id], 'source-deleted');
      else if ((e as { name?: string }).name === 'AbortError') throw e;
    }
  }));
  await withTimeout(work.catch((e: unknown) => {
    if ((e as { name?: string }).name === 'AbortError') throw e;
  }), GMAIL_HYDRATE_TIMEOUT_MS);
  return { fetched, skipped: ids.length - fetched };
}
