// confirmFresh (10 section 12.3 step 12a, contracts invariant 8): before any step option is built, the chosen item is
// checked against its source. Deleted items are skipped; changed items are re-read.
import { deriveExcerpt, extractFacts, normFact, recordBody } from '@/ai';
import { getRecord, verifyFresh, type SieveDb } from '@/index';
import type { IndexRecord } from '@sieve/shared';

export type FreshResult =
  | { status: 'ok' | 'unknown'; record: IndexRecord }
  | { status: 'gone' }
  | { status: 'changed'; fresh: IndexRecord | undefined }
  | { status: 'unreachable' };   // verifyFresh threw for a Gmail item

export async function confirmFresh(db: SieveDb, record: IndexRecord, signal?: AbortSignal): Promise<FreshResult> {
  let status: Awaited<ReturnType<typeof verifyFresh>>;
  try {
    status = await verifyFresh(db, record.id, signal ? { signal } : undefined);
  } catch (e) {
    if (signal?.aborted || (e as { name?: unknown } | null)?.name === 'AbortError') throw e;
    // Offline or a Gmail error: local files and Playground items are answered from the local copy.
    return record.source === 'gmail' ? { status: 'unreachable' } : { status: 'ok', record };
  }
  if (status === 'ok' || status === 'unknown') return { status, record };
  if (status === 'gone') return { status: 'gone' };
  return { status: 'changed', fresh: await getRecord(db, record.id) };
}

/**
 * Whether an answer written from the old text still holds on the re-read text: every answer fact the old body had is
 * in the new body (so no new unsupported fact), and the new body still has lines that hold the answer.
 */
export function answerStillHolds(oldRecord: IndexRecord, fresh: IndexRecord, answer: string): boolean {
  const oldBody = recordBody(oldRecord);
  const newBody = recordBody(fresh);
  const facts = extractFacts(answer).map(normFact);
  const inOld = new Set(extractFacts(oldBody).map(normFact));
  const inNew = new Set(extractFacts(newBody).map(normFact));
  for (const f of facts) if (inOld.has(f) && !inNew.has(f)) return false;
  return deriveExcerpt(newBody, { start: 0, end: newBody.length }, answer).excerpt !== '';
}
