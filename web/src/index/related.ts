// relatedFor (01 section 9, 20 section 10.4): same thread, similar by vectors, same sender. No filters here:
// the pipeline applies rules, grants and blocks to related items like the main item (20 section 22.5).
import { RELATED_MAX } from '@sieve/shared';
import type { Candidate, IndexRecord } from '@sieve/shared';
import { RELATED_MIN_COSINE } from './config';
import { repairOrphanHit } from './consistency';
import type { SieveDb } from './db';
import { clockFor } from './db';
import { getRecord } from './ingest';
import { queryWordsOf, relativeWhen } from './reasons';
import { getRuntime } from './runtime';
import { ready } from './lifecycle';
import { displayName } from './text';
import { processTerm } from './tokenize';

function sharedWords(text: string, question: string): string[] {
  const q = queryWordsOf(question);
  const seen: string[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)) {
    const t = processTerm(m[0]);
    const hit = t ? q.find((x) => x.term === t) : undefined;
    if (hit && !seen.includes(hit.word)) seen.push(hit.word);
    if (seen.length >= 2) break;
  }
  return seen;
}

export async function relatedFor(db: SieveDb, recordId: string, question: string): Promise<Candidate[]> {
  await ready(db);
  const rt = getRuntime(db);
  const rec = await getRecord(db, recordId);
  if (!rec) return [];
  const now = clockFor(db);
  const out: (Candidate & { _id: string })[] = [];
  const taken = new Set<string>([rec.id]);

  // 1. same thread, nearest in date first, up to 2
  if (rec.threadId) {
    const thread = [...rt.meta.values()]
      .filter((m) => m.threadId === rec.threadId && m.id !== rec.id && m.contentHash !== rec.contentHash)
      .sort((a, b) => Math.abs(a.date - rec.date) - Math.abs(b.date - rec.date))
      .slice(0, 2);
    for (const m of thread) {
      out.push({ _id: m.id, recordId: m.id, score: 0.9, matchedBy: 'keyword', reason: `${relativeWhen(m.date, now)}: same thread, ${displayName(m.from) || 'same sender'}` });
      taken.add(m.id);
    }
  }

  // 2. similar by vectors (best pair), cosine at least 0.5, up to 2
  const similar = rt.vectors.similarTo(rec.id, 4, (id) => !taken.has(id) && rt.meta.get(id)?.contentHash !== rec.contentHash);
  let added = 0;
  for (const h of similar) {
    if (added >= 2 || h.score < RELATED_MIN_COSINE) break;
    const other = await getRecord(db, h.recordId);
    if (!other) {
      await repairOrphanHit(db, h.recordId);
      continue;
    }
    const text = h.end > h.start && other.text ? other.text.slice(h.start, h.end) : `${other.title} ${other.preview}`;
    const shared = sharedWords(text, question);
    const reason = shared.length > 0 ? `${relativeWhen(other.date, now)}: also mentions ${shared.join(' and ')}` : `${relativeWhen(other.date, now)}: similar to this item`;
    const c: Candidate & { _id: string } = { _id: other.id, recordId: other.id, score: Math.max(0, Math.min(1, h.score)), matchedBy: 'vector', reason };
    if (h.end > h.start) c.chunk = { start: h.start, end: h.end };
    out.push(c);
    taken.add(other.id);
    added++;
  }

  // 3. same sender, newest first, 1
  const addr = rt.meta.get(rec.id)?.fromAddr;
  if (addr) {
    const same = [...rt.meta.values()].filter((m) => m.fromAddr === addr && !taken.has(m.id) && m.contentHash !== rec.contentHash).sort((a, b) => b.date - a.date)[0];
    if (same) out.push({ _id: same.id, recordId: same.id, score: 0.5, matchedBy: 'keyword', reason: `${relativeWhen(same.date, now)}: also from ${displayName(same.from)}` });
  }

  // 4. resolve, take RELATED_MAX
  const result: Candidate[] = [];
  for (const c of out) {
    if (result.length >= RELATED_MAX) break;
    const r: IndexRecord | undefined = await getRecord(db, c._id);
    if (!r) {
      await repairOrphanHit(db, c._id);
      continue;
    }
    const { _id, ...cand } = c;
    void _id;
    result.push(cand);
  }
  return result;
}
