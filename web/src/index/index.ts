// The local index (docs/spec/20-index-and-sources.md): public exports. Contract names (01 section 9) first.

// 01 section 9
export { SieveDb, openDb } from './db';
export { search, duplicatesOf, hardFilterOf, kindFits, knownOrgsOf, knownSendersOf, passesFilter } from './search';
export type { SearchReport, SearchOptions, HardFilter } from './search';
export { asksCount, asksLatest, asksSeveral, asksState, identifierTerms, isRoleCue, senderCue, senderMatches, senderTokens, sourceCue } from './cues';
export { parseQuestion } from './parseQuestion';
export type { ParsedQuestion } from './parseQuestion';
export { getRecord, ingest, ingestInternal, IngestError } from './ingest';
export type { RawItem, IngestOptions } from './ingest';
export { relatedFor } from './related';
export { removeRecord, removeRecords, verifyFresh, writeIfCurrent, patchRecord, checkIntegrity, pruneTombstones, emailContentHash, nextVersion, sha256Hex } from './consistency';
export type { IntegrityReport, FreshResult, UnverifiedReason } from './consistency';

// 20 section 4: database lifecycle, storage, tabs
export { clockFor, dataClassOf, openDbNamed, SCHEMA_V1 } from './db';
export type { BlobRow, SearchRow, TombstoneRow, VectorRow, ConsentRow, SourceRow, RemoveReason, SourceInventory, IndexingStage } from './db';
export { ready, wipeDb, closeDb, whenVocabReady } from './lifecycle';
export { requestPersistence, getStorageStatus, ensureSpace, isQuotaError } from './storage';
export type { StorageStatus } from './storage';
export { becomeIndexer, broadcast, isLeader } from './locks';
export type { IndexBroadcast } from './locks';
export { onIndexEvent } from './events';
export type { IndexEvent } from './events';

// 20 sections 7 to 10: chunks, vectors, keywords, question parsing, reasons
export { chunkText, embedTexts } from './chunk';
export type { Chunk, EmbedPlan } from './chunk';
export { getVectorIndex, vectorToBase64, vectorFromBase64 } from './vectorIndex';
export type { ChunkHit, VectorIndex } from './vectorIndex';
export { MINISEARCH_OPTIONS, KEYWORD_SEARCH, toIndexDoc } from './keywordIndex';
export type { IndexDoc } from './keywordIndex';
export { tokenize, processTerm, sStem, STOP_WORDS } from './tokenize';
export { parseDates, mentionedDays, dayFirst } from './dates';
export type { DateHint } from './dates';
export { preloadDictionary, dictionaryReady, isEnglishWord, dictionaryCandidates, loadDictionaryText } from './dictionary';
export { osaDistance, correctQuery } from './typos';
export { relativeWhen, reasonFor } from './reasons';
export { buildPreview } from './preview';
export { graphemes, cutGraphemes, emojiNames, withEmojiNames } from './text';

// 20 sections 12 and 13: consent and the one background queue (01 section 11.1)
export { grantCloudConsent, revokeCloudConsent, hasCloudConsent } from './consent';
export { startIngestQueue, stopIngestQueue, peekQueue, setQueueConditions, flushUrgentEmbeds } from './queue/ingestQueue';
export type { IngestQueue, QueueProgress, PrivacyScanQueue, ScanQueueStatus, QueueConditions } from './queue/ingestQueue';

// 20 section 22.3: photos for sharing and captions
export { getPhotoBlob, getThumbnailUrl } from '../sources/photos/image';

export { PLAYGROUND_NOW, SEARCH_FINGERPRINT, DB_VERSION } from './config';

// 20 section 18: the Playground device (40 CR-4 calls these through this barrel)
export { seedPlayground, resetPlayground, buildSeedBundle, SEED_VERSION, PLAYGROUND_SEED_COUNT } from '../playground/seed';
export type { BuildProgress } from '../playground/seed';
