// Background enrichment (01 section 11.1): 20 owns the only background queue (startIngestQueue in web/src/index);
// these names are thin re-exports kept so 40's names work. 10 provides the task functions (labelBatch, captionPhoto)
// and the foreground/background priority inside runModel.
import { PROMPT_VERSIONS } from '@/ai';
import { startIngestQueue, type IngestQueue, type SieveDb } from '@/index';
import type { EnrichTask, IndexRecord, NanoAvailability } from '@sieve/shared';

export type { EnrichTask, EnrichMark } from '@sieve/shared';
export type EnrichController = IngestQueue;

const started = new Set<IngestQueue>();

/** 20's queue for this database (one per db; starting it again returns the same queue). */
export function startEnrichment(db: SieveDb, _opts?: { kind: 'real' | 'playground' }): EnrichController {
  const queue = startIngestQueue(db);
  started.add(queue);
  return queue;
}

/** Asks every started queue to look for new work (20's queue also picks up ingested items by itself). */
export function nudgeEnrichment(): void {
  for (const q of started) {
    try {
      q.start();
    } catch (e) {
      console.warn('Sieve: the background queue did not take the nudge.', e instanceof Error ? e.name : e);
    }
  }
}

/** Whether a model pass should (re)run for a record (10 section 11). Seeded marks never re-run. */
export function needsWork(rec: IndexRecord, task: EnrichTask, nano: { text: NanoAvailability; image: NanoAvailability }): boolean {
  const m = rec.enrich?.[task];
  if (m?.by === 'seed') return false;
  if (task === 'label') {
    if (rec.categoryBy === 'seed' || nano.text !== 'available') return false;
    const attempts = m?.attempts ?? 0;
    return !m || m.v < PROMPT_VERSIONS.label || (m.by === 'code' && attempts < 2) || (m.confidence === 'low' && attempts < 2);
  }
  if (rec.kind !== 'photo' || nano.image !== 'available') return false;
  if (!rec.caption) return true;
  return rec.captionBy !== 'seed' && (!m || m.v < PROMPT_VERSIONS.caption);
}

export function forgetEnrichmentForTests(): void {
  started.clear();
}
