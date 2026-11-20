// Sources: start, connect, reauthorize, pause, rebuild, disconnect (20 section 14). 40 reads the `sources` rows
// with useLiveQuery; these functions keep them up to date.
import type { SourceKind } from '@sieve/shared';
import { checkIntegrity, removeRecords } from '../index/consistency';
import type { SieveDb, SourceRow } from '../index/db';
import { onIndexEvent } from '../index/events';
import { ready } from '../index/lifecycle';
import { becomeIndexer, isLeader } from '../index/locks';
import { startIngestQueue, type IngestQueue, type PrivacyScanQueue } from '../index/queue/ingestQueue';
import { getRuntime } from '../index/runtime';
import { requestPersistence } from '../index/storage';
import { asDir } from './folder/fsTypes';
import { permissionOf, pickFolder } from './folder/connect';
import { scanFolder, setFolderPaused, startFolderTimers, stopFolderTimers } from './folder/scan';
import { getProfile } from './gmail/api';
import { clearGmailToken, getGmailToken, preloadGis, requestGmailToken, revokeGmailToken } from './gmail/auth';
import { runGmailSync, setGmailPaused, startGmailTimers, stopGmailSync } from './gmail/sync';
import { SOURCE_COPY, SourceError } from './types';

const EMPTY_ROW = (kind: SourceKind): SourceRow => ({ kind, connected: false, progress: { done: 0, total: 0 }, paused: false });

/** The Gmail account per database, kept in memory for login_hint (a database read would lose the click). */
const lastAccount = new Map<SieveDb, string>();

/** The database whose Gmail row REST errors update (one Gmail account per page, on the real database). */
let gmailDb: SieveDb | null = null;
let gmailEventsWired = false;
function wireGmailEvents(db: SieveDb): void {
  gmailDb = db;
  if (gmailEventsWired) return;
  gmailEventsWired = true;
  onIndexEvent((e) => {
    const target = gmailDb;
    if (!target) return;
    if (e.type === 'gmail-auth-lost') void target.sources.update('gmail', { needsAuth: true }).catch(() => undefined);
    if (e.type === 'gmail-forbidden') void target.sources.update('gmail', { errorCode: 'gmail-forbidden', error: SOURCE_COPY.gmailForbidden(e.reason) }).catch(() => undefined);
    if (e.type === 'gmail-rate-limited') void target.sources.update('gmail', { errorCode: 'quota', error: SOURCE_COPY.gmailQuota }).catch(() => undefined);
  });
}

/** Leader: the ingest queue (which runs the privacy lane) for any database; source jobs only for the real one. */
export async function startBackground(db: SieveDb): Promise<IngestQueue | null> {
  await ready(db);
  let queue: IngestQueue | null = null;
  await becomeIndexer(
    db,
    () => {
      queue = startIngestQueue(db);
    },
    () => undefined,
  );
  return queue;
}

/** App start for the real database (20 section 14.1). */
export async function startSources(db: SieveDb): Promise<void> {
  await ready(db);
  wireGmailEvents(db);
  await becomeIndexer(
    db,
    () => {
      startIngestQueue(db);
      void (async () => {
        const rows = await db.sources.toArray();
        const gmail = rows.find((r) => r.kind === 'gmail');
        if (gmail?.account) lastAccount.set(db, gmail.account);
        if (gmail?.connected) {
          if (!getGmailToken()) await db.sources.update('gmail', { needsAuth: true });
          else void runGmailSync(db);
          startGmailTimers(db);
        }
        const folder = rows.find((r) => r.kind === 'folder');
        if (folder?.connected && folder.folderHandle) {
          const perm = await permissionOf(asDir(folder.folderHandle));
          if (perm === 'granted') void scanFolder(db);
          else await db.sources.update('folder', { errorCode: 'permission-needed', error: SOURCE_COPY.folderPermission(folder.folderName ?? 'the folder'), needsAuth: true });
          startFolderTimers(db);
        }
        if (db.sieveKind === 'real' && rows.some((r) => r.connected && r.kind !== 'playground')) void requestPersistence();
      })();
    },
    () => undefined,
  );
}

function errorOf(e: unknown): { error: string; errorCode: SourceRow['errorCode'] } {
  if (e instanceof SourceError) return { error: e.message, errorCode: e.code };
  return { error: SOURCE_COPY.signInFailed, errorCode: 'unknown' };
}

/** Inside a click handler: the Google popup must open within the click's user activation. */
export async function connectGmail(db: SieveDb): Promise<void> {
  const tokenP = requestGmailToken({ prompt: 'select_account' });   // first, synchronously in the click
  tokenP.catch(() => undefined);
  wireGmailEvents(db);
  const before = (await db.sources.get('gmail')) ?? EMPTY_ROW('gmail');
  await db.sources.put({ ...before, phase: 'listing', error: undefined, errorCode: undefined });
  try {
    await tokenP;
    const profile = await getProfile('interactive');
    lastAccount.set(db, profile.emailAddress);
    await db.sources.put({
      kind: 'gmail', connected: true, account: profile.emailAddress, cursor: profile.historyId,
      progress: { done: 0, total: 0 }, paused: false, needsAuth: false, phase: 'listing',
    });
  } catch (e) {
    await db.sources.put({ ...before, ...errorOf(e) });
    return;
  }
  void requestPersistence();
  await startSources(db);
  if (isLeader(db)) {
    void runGmailSync(db, 'backfill');
    startGmailTimers(db);
  }
}

/** Inside a click handler (showDirectoryPicker). */
export async function connectFolder(db: SieveDb): Promise<void> {
  await ready(db);
  const handle = await pickFolder(db);
  if (!handle) return;
  await startSources(db);
  if (isLeader(db)) {
    void scanFolder(db);
    startFolderTimers(db);
  }
}

/** Inside a click handler. Gmail: a new token for the same account; folder: the permission prompt. */
export async function reauthorize(db: SieveDb, kind: 'gmail' | 'folder'): Promise<void> {
  if (kind === 'gmail') {
    // the account hint is read from memory so the popup still opens inside the click
    const tokenP = requestGmailToken({ prompt: '', loginHint: lastAccount.get(db) });
    try {
      await tokenP;
      await db.sources.update('gmail', { needsAuth: false, error: undefined, errorCode: undefined });
      void runGmailSync(db);
      startGmailTimers(db);
    } catch (e) {
      await db.sources.update('gmail', errorOf(e));
    }
    return;
  }
  const row = await db.sources.get(kind);
  if (!row?.folderHandle) return connectFolder(db);
  const handle = asDir(row.folderHandle);
  let perm: string;
  try {
    perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'granted';
  } catch {
    perm = 'denied';
  }
  if (perm === 'granted') {
    await db.sources.update('folder', { needsAuth: false, error: undefined, errorCode: undefined });
    await scanFolder(db);
    startFolderTimers(db);
  } else {
    await db.sources.update('folder', { errorCode: 'permission-needed', error: SOURCE_COPY.folderPickAgain, needsAuth: true });
  }
}

export async function disconnectSource(db: SieveDb, kind: SourceKind): Promise<void> {
  await ready(db);
  if (kind === 'gmail') await stopGmailSync(db);
  if (kind === 'folder') stopFolderTimers(db);
  const ids = (await db.records.where('source').equals(kind).primaryKeys()) as string[];
  await removeRecords(db, ids, 'disconnected');
  getRuntime(db).syncProgress.delete(kind);
  if (kind === 'gmail') {
    if (getGmailToken()) await revokeGmailToken();
    clearGmailToken();
  }
  if (kind === 'playground') return;
  await db.sources.put(EMPTY_ROW(kind));
}

/** Pauses every source job and the queue (with its privacy lane); questions keep working (20 section 14.2). */
export async function setIndexingPaused(db: SieveDb, paused: boolean): Promise<void> {
  const rows = await db.sources.toArray();
  for (const r of rows) await db.sources.update(r.kind, { paused });
  setGmailPaused(db, paused);
  setFolderPaused(db, paused);
  const q = getRuntime(db).queue;
  if (paused) q?.pause();
  else {
    const queue = startIngestQueue(db);
    queue.resume();
    if (rows.some((r) => r.kind === 'gmail' && r.connected)) void runGmailSync(db);
    if (rows.some((r) => r.kind === 'folder' && r.connected)) void scanFolder(db);
  }
}

/** Rebuild the keyword index, reload vectors, integrity check, Gmail reconciliation, re-label code labels (20 section 14.3). */
export async function rebuildIndex(db: SieveDb): Promise<void> {
  await ready(db);
  const rows = await db.sources.toArray();
  for (const r of rows) if (r.connected) await db.sources.update(r.kind, { phase: 'rebuilding' });
  const rt = getRuntime(db);
  await rt.keyword.rebuild();
  await checkIntegrity(db);
  const queue = startIngestQueue(db);
  const coded: string[] = [];
  await db.records.each((r) => {
    if (r.categoryBy === 'code' || r.categoryBy === 'rule') coded.push(r.id);
  });
  queue.enqueue(coded);
  for (const r of rows) if (r.connected) await db.sources.update(r.kind, { phase: 'idle' });
  if (rows.some((r) => r.kind === 'gmail' && r.connected) && getGmailToken()) void runGmailSync(db, 'reconcile');
}

export async function syncNow(db: SieveDb, kind: 'gmail' | 'folder'): Promise<void> {
  if (kind === 'gmail') return runGmailSync(db);
  return scanFolder(db);
}

export function getQueue(db: SieveDb): IngestQueue {
  return startIngestQueue(db);
}

export function getPrivacyQueue(db: SieveDb): PrivacyScanQueue {
  return startIngestQueue(db).privacy;
}

export { preloadGis };
