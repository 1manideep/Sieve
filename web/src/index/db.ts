// The IndexedDB layout (01 section 5, 20 section 4): SieveDb, schema, openDb, ready, clockFor, dataClassOf, wipeDb.
import Dexie, { type EntityTable } from 'dexie';
import { PLAYGROUND_DB_NAME, REAL_DB_NAME } from '@sieve/shared';
import type { IndexRecord, Receipt, SourceKind } from '@sieve/shared';
import { PLAYGROUND_NOW } from './config';
import { emitIndexEvent } from './events';
import type { SkipReason, SourceErrorCode, SourcePhase } from '../sources/types';

export type RemoveReason = 'source-deleted' | 'trashed' | 'user-removed' | 'disconnected' | 'moved';

export interface BlobRow { id: string; blob: Blob; thumb?: Blob }
export interface SearchRow { id: 'minisearch'; json: string; updatedAt: number; fingerprint?: string }
export interface TombstoneRow { id: string; deletedAt: number; reason: RemoveReason; movedTo?: string }
export interface VectorRow {
  id: string; recordId: string; start: number; end: number; vector: Float32Array; model: string; recordVersion: number;
  inputHash?: string;   // optional addition: embedTexts(...).sourceHash the row was made from (20 section 7.3)
}
export interface ConsentRow { recordId: string; cloudAllowedAt: number }
export interface SourceRow {
  kind: SourceKind; connected: boolean; cursor?: string; lastSyncAt?: number;
  progress: { done: number; total: number }; paused: boolean; folderHandle?: FileSystemDirectoryHandle;
  /** Who paused: the person's Pause, or Sieve when the browser ran out of space (Resume clears both). */
  pausedBy?: 'person' | 'storage';
  // optional additions (20 section 22.1; the first three are 40's CR-4)
  needsAuth?: boolean; error?: string; folderName?: string;
  account?: string; phase?: SourcePhase; errorCode?: SourceErrorCode; skipped?: Partial<Record<SkipReason, number>>; etaMs?: number;
  reconciledAt?: number;
  // 20 section 13.5: what the source job and the queue work on now, for 40's IndexingCard
  inventory?: SourceInventory;      // what the last walk or listing found to read, by kind ("7 PDFs, 3 notes, 12 photos")
  stage?: IndexingStage;            // the work on this source's items now: reading, then the queue's lanes in order
  stageCount?: number;              // items of this source waiting for that stage (label and caption only)
  counting?: boolean;               // the source job is still finding items: the total may only grow ("so far")
  /** Folder: files read once and found unindexable, by path, so a rescan skips them while size and date are unchanged. */
  skipCache?: Record<string, FolderSkip>;
}

/** A folder file Sieve could not index (a password PDF, binary text): not read again until it changes. */
export interface FolderSkip { size: number; lastModified: number; skip: SkipReason; at: number }

/** Files a folder walk found to read (or emails a Gmail listing found), by kind. */
export type SourceInventory = Partial<Record<'pdfs' | 'notes' | 'photos' | 'files' | 'emails', number>>;
/** Reading (text extraction by the source job), then the queue's lanes in QUEUE_LANE_ORDER. */
export type IndexingStage = 'reading' | 'label' | 'embed' | 'privacy' | 'caption';

export const SCHEMA_V1 = {
  records: 'id, source, kind, category, date',
  blobs: 'id',
  search: 'id',
  tombstones: 'id, deletedAt',
  vectors: 'id, recordId',
  sources: 'kind',
  receipts: 'id, createdAt',
  consents: 'recordId',
} as const;

export class SieveDb extends Dexie {
  records!: EntityTable<IndexRecord, 'id'>;
  blobs!: EntityTable<BlobRow, 'id'>;
  search!: EntityTable<SearchRow, 'id'>;
  tombstones!: EntityTable<TombstoneRow, 'id'>;
  vectors!: EntityTable<VectorRow, 'id'>;
  sources!: EntityTable<SourceRow, 'kind'>;
  receipts!: EntityTable<Receipt, 'id'>;
  consents!: EntityTable<ConsentRow, 'recordId'>;
  readonly sieveKind: 'real' | 'playground';
  /** Another tab deleted or upgraded this database: the handle is closed for good, and the tab must reload. */
  stale = false;
  constructor(name: string, sieveKind: 'real' | 'playground') {
    super(name);
    this.sieveKind = sieveKind;
    this.version(1).stores(SCHEMA_V1);
    this.on('versionchange', () => {
      // Another tab waits for this connection to close (delete, Clear it and continue, Reset, an upgrade). Close now
      // and keep it closed: Dexie's own handler (skipped by returning false) would reopen on the next query.
      this.stale = true;
      this.close({ disableAutoOpen: true });
      emitIndexEvent({ type: 'db-closed', db: name });
      return false;
    });
    this.on('blocked', () => {
      emitIndexEvent({ type: 'db-blocked', db: name });
    });
  }
}

const singletons = new Map<string, SieveDb>();

/** Singleton per kind (01 section 9). */
export function openDb(kind: 'real' | 'playground'): SieveDb {
  const name = kind === 'real' ? REAL_DB_NAME : PLAYGROUND_DB_NAME;
  return openDbNamed(name, kind);
}

/** Test and /dev/seed only: a database with another name (20 section 18.5). */
export function openDbNamed(name: string, kind: 'real' | 'playground'): SieveDb {
  let db = singletons.get(name);
  if (!db) {
    db = new SieveDb(name, kind);
    singletons.set(name, db);
  }
  return db;
}

/** The open handle of that name in this tab, if any (the db-closed event names the database). */
export function peekDb(name: string): SieveDb | undefined {
  return singletons.get(name);
}

/** Forget the singleton so the next openDb creates a fresh handle (wipeDb, tests). */
export function forgetDb(name: string): void {
  singletons.delete(name);
}

/** Real: Date.now(); playground: PLAYGROUND_NOW (20 section 18.1). */
export function clockFor(db: SieveDb): number {
  return db.sieveKind === 'playground' ? PLAYGROUND_NOW : Date.now();
}

/** Real db: always own. Playground: uploads and test emails are the visitor's own; seeds are sample. */
export function dataClassOf(db: SieveDb, record: Pick<IndexRecord, 'source'>): 'own' | 'sample' {
  if (db.sieveKind === 'real') return 'own';
  return record.source === 'upload' ? 'own' : 'sample';
}
