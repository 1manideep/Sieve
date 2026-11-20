// ingest (01 section 9, 20 section 12): fast, no model calls. Sanitize, preview, code label, Health safety net,
// mentioned dates, photo metadata, contentHash; one transaction; then the in-memory indexes and the queue.
import { CATEGORIES } from '@sieve/shared';
import type { Category, IndexRecord, ItemKind, PhotoMeta, SourceKind } from '@sieve/shared';
import { HIDDEN_FRAGMENT_MAX_CHARS, HIDDEN_FRAGMENTS_MAX, MAX_TEXT_CHARS, SOURCE_REF_MAX_CHARS, TITLE_MAX_CHARS } from './config';
import { applyRecordInMemory, emailContentHash, nextVersion, writeIfCurrentDetailed } from './consistency';
import type { SieveDb } from './db';
import { mentionedDays } from './dates';
import { aiApi, sanitizeIncoming } from './deps';
import { IngestError } from './errors';
import { blobBytes, sha256Hex } from './hash';
import { buildPreview, photoDateLabel } from './preview';
import { getRuntime } from './runtime';
import { ensureSpace, isQuotaError } from './storage';
import { cutGraphemes, utf8Length } from './text';
import { SOURCE_COPY } from '../sources/types';

export { IngestError } from './errors';

export interface RawItem { source: SourceKind; sourceRef: string; kind: ItemKind; title: string; from?: string; threadId?: string; date: number; html?: string; text?: string; blob?: Blob }

export interface IngestOptions {
  bodyPending?: boolean;            // Gmail metadata phase: raw.text is the snippet; record.text stays undefined
  sizeBytes?: number;               // Gmail sizeEstimate
  sourceModifiedAt?: number;
  contentHash?: string;             // precomputed by the caller (Gmail, folder scan)
  seed?: { category: Category; caption?: string };
  photo?: { meta?: Partial<PhotoMeta>; storeBlob?: boolean };
  ownAddress?: string;              // the Gmail account (11's rules decide what the privacy scan does with it)
  priority?: 'normal' | 'high';
  notTombstonedSince?: number;      // sync jobs: skip ids deleted after the job started (20 section 5.6)
  deferSave?: boolean;              // bulk jobs: the caller flushes the keyword snapshot at the end
  /** A move (70 R-IDX-06): the old record whose derived fields and vectors carry over to this id. */
  movedFrom?: IndexRecord;
}

const SOURCES: SourceKind[] = ['gmail', 'folder', 'upload', 'playground'];
const KINDS: ItemKind[] = ['email', 'document', 'photo', 'note'];

export async function getRecord(db: SieveDb, id: string): Promise<IndexRecord | undefined> {
  return db.records.get(id);
}

function cleanTitle(raw: RawItem): { title: string; hidden: string[] } {
  let title = raw.title ?? '';
  let hidden: string[] = [];
  if (title) {
    const s = sanitizeIncoming({ text: title });
    title = s.text;
    hidden = s.hiddenRemoved;
  }
  title = cutGraphemes(title.replace(/\s+/g, ' ').trim(), TITLE_MAX_CHARS);
  if (!title) title = raw.kind === 'email' ? '(no subject)' : cutGraphemes((raw.title ?? '').replace(/\p{Cc}|[\u202a-\u202e\u2066-\u2069]/gu, '').trim(), TITLE_MAX_CHARS) || '(untitled)';
  return { title, hidden };
}

function mergeHidden(...lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const f of list) {
      const cut = cutGraphemes(f, HIDDEN_FRAGMENT_MAX_CHARS);
      if (cut && !out.includes(cut)) out.push(cut);
      if (out.length >= HIDDEN_FRAGMENTS_MAX) return out;
    }
  }
  return out;
}

function storesBlob(raw: RawItem, opts: IngestOptions): boolean {
  if (!raw.blob) return false;
  if (opts.photo?.storeBlob !== undefined && raw.kind === 'photo') return opts.photo.storeBlob;
  return raw.source === 'upload' || raw.source === 'playground';
}

async function readBlobAsText(raw: RawItem): Promise<string> {
  if (!raw.blob) return '';
  const { readBlobText } = await import('../sources/readers');
  const r = await readBlobText(raw.blob, raw.title, raw.blob.type);
  if (r.skip) {
    const code = r.skip === 'limit' || r.skip === 'no-text' ? 'unreadable' : r.skip;
    throw new IngestError(code, 'This file could not be read.');
  }
  return r.text;
}

async function pauseForStorage(db: SieveDb, source: SourceKind): Promise<void> {
  getRuntime(db).queue?.pause();
  try {
    await db.sources.update(source, { error: SOURCE_COPY.storageFull, errorCode: 'storage-full' });
  } catch {
    // the row may not exist (Playground uploads); the error still reaches the caller
  }
}

/** The contract call: throws IngestError when the item is skipped. */
export async function ingest(db: SieveDb, raw: RawItem, data: 'own' | 'sample'): Promise<IndexRecord> {
  const rec = await ingestInternal(db, raw, data, {});
  if (!rec) throw new IngestError('invalid', 'This item was deleted while it was being added.');
  return rec;
}

export async function ingestInternal(db: SieveDb, raw: RawItem, _data: 'own' | 'sample', opts: IngestOptions): Promise<IndexRecord | null> {
  // 1. validate
  if (!SOURCES.includes(raw.source) || !KINDS.includes(raw.kind) || !raw.sourceRef || raw.sourceRef.length > SOURCE_REF_MAX_CHARS) {
    throw new IngestError('invalid', 'This item could not be added.');
  }
  const date = Number.isFinite(raw.date) ? raw.date : Date.now();
  // 2. id, existing, tombstone
  const id = `${raw.source}:${raw.sourceRef}`;
  const [existing, tomb] = await Promise.all([db.records.get(id), db.tombstones.get(id)]);
  if (opts.notTombstonedSince !== undefined && tomb && tomb.deletedAt >= opts.notTombstonedSince) return null;
  // 3. contentHash
  let contentHash = opts.contentHash;
  if (!contentHash) {
    if (raw.blob) contentHash = await sha256Hex(await blobBytes(raw.blob));
    else if (raw.kind === 'email') contentHash = await emailContentHash({ id: raw.sourceRef, subject: raw.title, from: raw.from, internalDate: date, html: raw.html, text: raw.text, phase: opts.bodyPending ? 'meta' : 'full' });
    else contentHash = await sha256Hex(raw.html ?? raw.text ?? '');
  }
  // 4. unchanged
  if (existing && !tomb && existing.contentHash === contentHash && existing.kind === raw.kind && existing.from === raw.from && existing.title === cleanTitle(raw).title) {
    if (opts.sourceModifiedAt !== undefined && opts.sourceModifiedAt !== existing.sourceModifiedAt) {
      const { record } = await writeIfCurrentDetailed(db, id, existing.version, () => ({ sourceModifiedAt: opts.sourceModifiedAt }));
      return record ?? existing;
    }
    return existing;
  }
  // 5. text
  let text = '';
  let hiddenText: string[] = [];
  if (raw.kind !== 'photo') {
    if (raw.html && raw.html.trim()) {
      const s = sanitizeIncoming({ html: raw.html });
      text = s.text;
      hiddenText = s.hiddenRemoved;
    } else if (raw.text !== undefined) {
      const s = sanitizeIncoming({ text: raw.text });
      text = s.text;
      hiddenText = s.hiddenRemoved;
    } else if (raw.blob) {
      const s = sanitizeIncoming({ text: await readBlobAsText(raw) });
      text = s.text;
      hiddenText = s.hiddenRemoved;
    }
    text = cutGraphemes(text, MAX_TEXT_CHARS);
  }
  // 6. title
  const { title, hidden: hiddenTitle } = cleanTitle(raw);
  const hiddenRemoved = mergeHidden(hiddenTitle, hiddenText);
  const from = raw.from ? raw.from.replace(/\s+/g, ' ').trim() : undefined;
  // 7. photo
  let photo: PhotoMeta | undefined;
  let recordDate = date;
  let thumb: Blob | undefined;
  const store = storesBlob(raw, opts);
  if (raw.kind === 'photo') {
    if (!raw.blob) throw new IngestError('invalid', 'This photo could not be added.');
    const { readPhotoMeta } = await import('../sources/photos/exif');
    photo = { ...(await readPhotoMeta(raw.blob, raw.title, date)), ...opts.photo?.meta } as PhotoMeta;
    recordDate = photo.takenAt ?? date;
    if (store) {
      try {
        const { makeThumbnail } = await import('../sources/photos/image');
        thumb = await makeThumbnail(raw.blob);
      } catch {
        thumb = undefined;   // no decoder (tests) or an image Chrome cannot thumbnail; the grid shows a placeholder
      }
    }
  }
  // 8. preview
  const caption = raw.kind === 'photo' ? opts.seed?.caption ?? opts.movedFrom?.caption : undefined;
  const preview = buildPreview({ kind: raw.kind, text, caption, date: recordDate });
  // 9. category
  const promptV = aiApi.promptVersions();
  let category: Category;
  let categoryBy: IndexRecord['categoryBy'];
  let enrich: IndexRecord['enrich'];
  const keepModelLabel = existing && (existing.categoryBy === 'device' || existing.categoryBy === 'cloud') && existing.title === title && existing.from === from;
  if (opts.seed) {
    category = CATEGORIES.includes(opts.seed.category) ? opts.seed.category : 'Personal';
    categoryBy = 'seed';
    enrich = { label: { v: promptV.label, by: 'seed', at: Date.now() } };
    if (raw.kind === 'photo' && opts.seed.caption) enrich.caption = { v: promptV.caption, by: 'seed', at: Date.now() };
  } else if (opts.movedFrom) {
    category = opts.movedFrom.category;
    categoryBy = opts.movedFrom.categoryBy;
    enrich = opts.movedFrom.enrich;
  } else if (keepModelLabel && existing) {
    category = existing.category;
    categoryBy = existing.categoryBy;
    enrich = existing.enrich?.label ? { label: existing.enrich.label } : undefined;
  } else if (raw.kind === 'photo') {
    category = 'Photos';
    categoryBy = 'rule';
  } else {
    category = aiApi.codeLabel({ title, from, preview, kind: raw.kind }).category;
    categoryBy = 'code';
  }
  if (!opts.seed && category !== 'Health' && aiApi.isHealthStrong({ title, from, preview })) {
    category = 'Health';
    categoryBy = 'rule';
  }
  // 10. mentioned dates
  const mentioned = text && !opts.bodyPending ? mentionedDays(text, recordDate, typeof navigator !== 'undefined' ? navigator.language : 'en-US') : [];
  // 11. record
  const sizeBytes = opts.sizeBytes ?? raw.blob?.size ?? utf8Length(raw.html ?? raw.text ?? '');
  const record: IndexRecord = {
    id, source: raw.source, sourceRef: raw.sourceRef, kind: raw.kind, title, date: recordDate, preview,
    category, categoryBy, hiddenRemoved, pii: [], sizeBytes, indexedAt: Date.now(), contentHash,
    version: nextVersion(existing && !tomb ? existing : undefined),
  };
  if (from) record.from = from;
  if (raw.threadId) record.threadId = raw.threadId;
  if (raw.kind !== 'photo' && !opts.bodyPending) record.text = text;
  if (caption) {
    record.caption = caption;
    record.captionBy = opts.seed ? 'seed' : opts.movedFrom?.captionBy;
  }
  if (photo) record.photo = photo;
  if (opts.sourceModifiedAt !== undefined) record.sourceModifiedAt = opts.sourceModifiedAt;
  if (mentioned.length > 0) record.mentionedDays = mentioned;
  if (enrich) record.enrich = enrich;
  if (opts.movedFrom) {
    // same bytes give the same text, so privacy findings and their offsets stay valid
    record.pii = opts.movedFrom.pii;
    if (opts.movedFrom.injection) record.injection = opts.movedFrom.injection;
    if (opts.movedFrom.privacyScan) record.privacyScan = opts.movedFrom.privacyScan;
  }
  // 12. write
  const space = await ensureSpace(sizeBytes * 2);
  if (!space.ok) {
    await pauseForStorage(db, raw.source);
    throw new IngestError('storage-full', SOURCE_COPY.storageFull);
  }
  const movedVectors = opts.movedFrom ? await db.vectors.where('recordId').equals(opts.movedFrom.id).toArray() : [];
  try {
    await db.transaction('rw', [db.records, db.vectors, db.blobs, db.tombstones, db.consents], async () => {
      await db.vectors.where('recordId').equals(id).delete();
      await db.records.put(record);
      if (store && raw.blob) await db.blobs.put(thumb ? { id, blob: raw.blob, thumb } : { id, blob: raw.blob });
      await db.tombstones.delete(id);
      if (opts.movedFrom) {
        if (movedVectors.length > 0) {
          await db.vectors.bulkPut(movedVectors.map((v) => ({ ...v, id: id + v.id.slice(v.id.lastIndexOf('#')), recordId: id, recordVersion: record.version })));
        }
        const consent = await db.consents.get(opts.movedFrom.id);
        if (consent) await db.consents.put({ ...consent, recordId: id });
      }
    });
  } catch (e) {
    if (isQuotaError(e)) {
      await pauseForStorage(db, raw.source);
      throw new IngestError('storage-full', SOURCE_COPY.storageFull);
    }
    throw e;
  }
  // 13. after commit
  const rt = getRuntime(db);
  rt.vectors.removeRecord(id);
  if (movedVectors.length > 0) {
    rt.vectors.upsertRecord(id, movedVectors.map((v) => ({ ...v, id: id + v.id.slice(v.id.lastIndexOf('#')), recordId: id, recordVersion: record.version })));
  }
  applyRecordInMemory(db, record);
  rt.queue?.enqueue([id], { priority: opts.priority ?? 'normal' });
  return record;
}

/** Photo placeholder preview (caption pending), for callers that need the same wording. */
export { photoDateLabel };
