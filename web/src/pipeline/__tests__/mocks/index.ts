// Mock of web/src/index for pipeline tests: vi.mock('@/index', () => import('./mocks/index')).
import { vi } from 'vitest';
import type { Candidate, IndexRecord, QueryHints } from '@sieve/shared';
import type { IngestQueue, SieveDb } from '@/index';

export type { IngestQueue, SieveDb, HardFilter } from '@/index';
export { asksCount, asksLatest, asksSeveral } from '@/index/cues';

export const records = new Map<string, IndexRecord>();

type Fresh = 'ok' | 'gone' | 'changed' | 'unknown';

export const search = vi.fn(async (_db: SieveDb, _q: string, _o?: unknown): Promise<Candidate[]> => []);
export const getRecord = vi.fn(async (_db: SieveDb, id: string): Promise<IndexRecord | undefined> => records.get(id));
export const relatedFor = vi.fn(async (_db: SieveDb, _id: string, _q: string): Promise<Candidate[]> => []);
export const parseQuestion = vi.fn((q: string, _now: Date, _locale: string): { normalized: string; corrected: string; hints: QueryHints } => ({
  normalized: q, corrected: q, hints: {},
}));
export const verifyFresh = vi.fn(async (_db: SieveDb, _id: string, _opts?: unknown): Promise<Fresh> => 'ok');
export const removeRecord = vi.fn(async (_db: SieveDb, _id: string, _reason: string): Promise<void> => undefined);
export const patchRecord = vi.fn(async (_db: SieveDb, _id: string, _v: number, _p: Partial<IndexRecord>): Promise<'ok' | 'gone' | 'stale'> => 'ok');
export const getPhotoBlob = vi.fn(async (_db: SieveDb, _id: string): Promise<Blob> => new Blob(['jpeg'], { type: 'image/jpeg' }));
export const fakeQueue = { start: vi.fn() } as unknown as IngestQueue & { start: ReturnType<typeof vi.fn> };
export const startIngestQueue = vi.fn((_db: SieveDb): IngestQueue => fakeQueue);
export const clockFor = vi.fn((_db: SieveDb): number => Date.now());
export const flushUrgentEmbeds = vi.fn(async (_db: SieveDb, _o?: unknown): Promise<'done' | 'timeout' | 'skipped'> => 'done');
export const knownSendersOf = vi.fn((_db: SieveDb): Set<string> => new Set());
export const openDb = vi.fn();
export const ingest = vi.fn();

export function resetIndexMock(list: IndexRecord[] = []): void {
  records.clear();
  for (const r of list) records.set(r.id, r);
  search.mockReset().mockImplementation(async () => []);
  getRecord.mockReset().mockImplementation(async (_db, id) => records.get(id));
  relatedFor.mockReset().mockImplementation(async () => []);
  parseQuestion.mockReset().mockImplementation((q) => ({ normalized: q, corrected: q, hints: {} }));
  verifyFresh.mockReset().mockImplementation(async () => 'ok');
  removeRecord.mockReset().mockImplementation(async () => undefined);
  patchRecord.mockReset().mockImplementation(async () => 'ok');
  getPhotoBlob.mockReset().mockImplementation(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
  fakeQueue.start.mockReset();
  startIngestQueue.mockReset().mockImplementation(() => fakeQueue);
  clockFor.mockReset().mockImplementation(() => Date.now());
  flushUrgentEmbeds.mockReset().mockImplementation(async () => 'done');
  knownSendersOf.mockReset().mockImplementation(() => new Set());
}

export function cand(recordId: string, matchedBy: Candidate['matchedBy'] = 'vector', chunk?: { start: number; end: number }): Candidate {
  return { recordId, score: 0.9, matchedBy, ...(chunk ? { chunk } : {}), reason: 'test' };
}
