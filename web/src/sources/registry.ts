// Sources: start, connect, reauthorize, pause, rebuild, disconnect (20 section 14). 40 reads the `sources` rows
// with useLiveQuery; these functions keep them up to date.
import { liveQuery } from 'dexie';
import type { SourceKind } from '@sieve/shared';
import { GMAIL_TOKEN_SKEW_MS } from '../index/config';
import { checkIntegrity, removeRecords } from '../index/consistency';
import type { SieveDb, SourceRow } from '../index/db';
import { onIndexEvent } from '../index/events';
import { watchStorage } from '../index/ingest';
import { ready } from '../index/lifecycle';
import { becomeIndexer, broadcast, isLeader, onBroadcast } from '../index/locks';
import { peekQueue, startIngestQueue, stopIngestQueue, type IngestQueue, type PrivacyScanQueue } from '../index/queue/ingestQueue';
import { getRuntime } from '../index/runtime';
import { requestPersistence } from '../index/storage';
import { asDir } from './folder/fsTypes';
import { permissionOf, pickFolder } from './folder/connect';
import { scanFolder, setFolderPaused, startFolderTimers, stopFolderTimers } from './folder/scan';
import { GmailAuthError, getProfile } from './gmail/api';
import {
  adoptGmailToken, clearGmailToken, currentGmailToken, getGmailToken, isUsableGmailToken, preloadGis, rejectedGmailTokens,
  requestGmailToken, revokeGmailToken, watchGoogleSignOut,
} from './gmail/auth';
import { renewTargetDb, setRenewTarget } from './gmail/renew';
import { runGmailSync, setGmailPaused, startGmailTimers, stopGmailSync, syncAfterNewToken } from './gmail/sync';
import { clearStoredToken, loadStoredGmailToken, readStoredToken, storedTokenOf, writeStoredToken, type GmailRow } from './gmail/tokenStore';
import { SOURCE_COPY, SourceError } from './types';

const EMPTY_ROW = (kind: SourceKind): SourceRow => ({ kind, connected: false, progress: { done: 0, total: 0 }, paused: false });

/** Databases whose source jobs stopped with the Google session (stopSources); startSources clears it. */
const stoppedDbs = new Set<SieveDb>();

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
    if (e.type === 'gmail-auth-lost') void onGmailAuthLost(target).catch(() => undefined);
    if (e.type === 'gmail-forbidden') void target.sources.update('gmail', { errorCode: 'gmail-forbidden', error: SOURCE_COPY.gmailForbidden(e.reason) }).catch(() => undefined);
    if (e.type === 'gmail-rate-limited') void target.sources.update('gmail', { errorCode: 'quota', error: SOURCE_COPY.gmailQuota }).catch(() => undefined);
  });
}

/** Gmail answered 401: drop the refused token from the row, unless another tab already kept a new one there. */
async function onGmailAuthLost(db: SieveDb): Promise<void> {
  for (const value of rejectedGmailTokens()) await clearStoredToken(db, value);
  const renewed = await readStoredToken(db);
  if (renewed) adoptGmailToken(renewed);
  else await db.sources.update('gmail', { needsAuth: true });
}

/** Sign-in errors from an earlier click (the Google sign-in script did not load, a popup was blocked or closed). */
const CLICK_ERRORS: ReadonlySet<string> = new Set(['gis-load-failed', 'popup-blocked', 'popup-closed']);

/**
 * The Gmail row at app start. The token is kept on the row for its lifetime, shared by every tab, so the start never
 * asks to sign in: the first sync does, and only when the row has no usable token (20 section 15.1). A usable token
 * clears an old ask. A sign-in error from an earlier click does not outlive the page.
 */
export function gmailStartPatch(row: Pick<GmailRow, 'errorCode' | 'needsAuth' | 'accessToken'>, now = Date.now()): Partial<SourceRow> {
  const patch: Partial<SourceRow> = {};
  if (isUsableGmailToken(storedTokenOf(row), now) && (row.needsAuth || row.errorCode === 'auth-needed')) {
    patch.needsAuth = false;
    if (row.errorCode === 'auth-needed') Object.assign(patch, { error: undefined, errorCode: undefined });
  }
  if (row.errorCode && CLICK_ERRORS.has(row.errorCode)) Object.assign(patch, { error: undefined, errorCode: undefined });
  return patch;
}

/** What each tab last saw on the Gmail row: the stored token, and when it ends (for renewal inside clicks). */
interface RowWatch { seen: string | null; expiresAt: number | null; connected: boolean }
const rowWatches = new Map<SieveDb, RowWatch>();

/**
 * Every tab follows the Gmail row (Dexie live queries see other tabs' writes): a token another tab kept is held here
 * at once, and the indexer tab syncs with it without waiting for its timer; a token removed there (sign-out,
 * disconnect, a 401) is dropped here. The click renewal follows the row's connected state.
 */
function watchGmailRow(db: SieveDb): void {
  if (db.sieveKind !== 'real' || rowWatches.has(db)) return;
  const watch: RowWatch = { seen: null, expiresAt: null, connected: false };
  rowWatches.set(db, watch);
  const sub = liveQuery(() => db.sources.get('gmail')).subscribe({
    next: (row) => onGmailRow(db, watch, row),
    error: () => undefined,   // the database is closing
  });
  // Signed out of Sieve (in any tab): Google is told to revoke the Gmail token, and this tab and the row forget it.
  const offSignOut = watchGoogleSignOut(() => void revokeGmailAccess(db).catch(() => undefined));
  getRuntime(db).stoppers.add(() => {
    sub.unsubscribe();
    offSignOut();
    rowWatches.delete(db);
    if (renewTargetDb() === db) setRenewTarget(null);
  });
}

function onGmailRow(db: SieveDb, watch: RowWatch, row: SourceRow | undefined): void {
  const stored = storedTokenOf(row);
  const usable = isUsableGmailToken(stored) ? stored : null;
  const before = watch.seen;
  watch.seen = usable?.value ?? null;
  if (usable) {
    watch.expiresAt = usable.expiresAt;
    const changed = adoptGmailToken(usable);
    if (changed && usable.value !== before && row?.connected && !row.paused && isLeader(db) && !stoppedDbs.has(db)) syncAfterNewToken(db);
  } else {
    if (before !== null) clearGmailToken(before);
    // Renewal inside a click is for a token that ran out by time; a refused, signed-out or removed token waits for Continue.
    const ranOut = watch.expiresAt !== null && Date.now() >= watch.expiresAt - GMAIL_TOKEN_SKEW_MS;
    if (!ranOut) watch.expiresAt = null;
  }
  if (row?.account) lastAccount.set(db, row.account);   // Continue's account hint in every tab, not only the indexer
  // Gmail connected in another tab: the indexer tab keeps it in sync from now on (the timers are idempotent);
  // disconnected in another tab: the indexer tab's job and timers stop.
  const wasConnected = watch.connected;
  watch.connected = !!row?.connected;
  if (row?.connected && isLeader(db) && !stoppedDbs.has(db)) startGmailTimers(db);
  else if (wasConnected && !row?.connected && isLeader(db)) void stopGmailSync(db);
  if (row?.connected) {
    setRenewTarget({
      db, account: lastAccount.get(db), expiresAt: watch.expiresAt,
      blocked: row.paused || row.errorCode === 'auth-needed', onToken: keepRenewedToken,
    });
  } else if (renewTargetDb() === db) {
    setRenewTarget(null);
  }
}

/** A token from a click elsewhere in the app: keep it on the row for every tab, and sync. */
async function keepRenewedToken(db: SieveDb): Promise<void> {
  const row = await db.sources.get('gmail');
  if (!row?.connected) return;
  const patch: Partial<SourceRow> = { needsAuth: false };
  if (row.errorCode && CLICK_ERRORS.has(row.errorCode)) Object.assign(patch, { error: undefined, errorCode: undefined });
  await writeStoredToken(db, currentGmailToken(), patch);
  void runGmailSync(db);
}

/** Sign-out or disconnect: forget the token in this tab and on the row. */
async function forgetGmailToken(db: SieveDb): Promise<void> {
  clearGmailToken();
  await clearStoredToken(db);
}

/** Offline, Google's revoke may never answer: sign-out and delete go on after this long. */
export const GMAIL_REVOKE_WAIT_MS = 2_000;

function within(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}

/**
 * Sign-out and Delete my account: revoke the Gmail token at Google (the one this tab holds, or the one on the row),
 * then forget it here and on the row. Waits GMAIL_REVOKE_WAIT_MS at most for Google; the row is cleared either way.
 */
export async function revokeGmailAccess(db: SieveDb): Promise<void> {
  if (db.sieveKind !== 'real') return;
  if (!getGmailToken()) await loadStoredGmailToken(db).catch(() => null);
  if (getGmailToken()) await within(revokeGmailToken(), GMAIL_REVOKE_WAIT_MS);
  await forgetGmailToken(db).catch(() => undefined);
}

/** What the indexer tab last applied from the rows (null before the first read). */
interface Followed { paused: boolean | null; folder: boolean | null }
const followed = new Map<SieveDb, Followed>();

/**
 * Pause lives on the rows, so every tab can press Pause or Resume: the indexer tab follows them here and applies them
 * to its own jobs and queue. The queue holds while every connected source is paused; Gmail and the folder follow
 * their own rows. A folder connected in another tab is scanned and rescanned from here.
 */
function applyRows(db: SieveDb, rows: SourceRow[], seen: Followed): void {
  if (!isLeader(db)) return;
  const gmail = rows.find((r) => r.kind === 'gmail');
  const folder = rows.find((r) => r.kind === 'folder');
  setGmailPaused(db, !!gmail?.paused);
  setFolderPaused(db, !!folder?.paused);
  const live = rows.filter((r) => r.connected && r.kind !== 'playground');
  const paused = live.length > 0 && live.every((r) => r.paused);
  const was = seen.paused;
  seen.paused = paused;
  const folderConnected = !!(folder?.connected && folder.folderHandle);
  const folderWas = seen.folder;
  seen.folder = folderConnected;
  if (folderConnected) {
    startFolderTimers(db);
    if (folderWas === false && !folder?.paused) void scanFolder(db);
  } else if (folderWas) {
    stopFolderTimers(db);   // disconnected in another tab
  }
  // Paused for storage (in any tab, or before a reload): this tab checks the space again until there is room.
  if (rows.some((r) => r.pausedBy === 'storage')) watchStorage(db);
  if (paused === was) return;
  if (paused) {
    peekQueue(db)?.pause();
    return;
  }
  (peekQueue(db) ?? startIngestQueue(db)).resume();
  if (was !== true) return;   // the first read at start: startSources runs the jobs itself
  if (gmail?.connected && !gmail.paused) void runGmailSync(db);
  if (folder?.connected && !folder.paused) void scanFolder(db);
}

const unfollows = new Map<SieveDb, () => void>();

/** Leader: follow the sources rows (Pause and Resume from any tab, a folder connected elsewhere). Idempotent. */
function followRows(db: SieveDb): void {
  if (followed.has(db)) return;
  const seen: Followed = { paused: null, folder: null };
  followed.set(db, seen);
  const sub = liveQuery(() => db.sources.toArray()).subscribe({
    next: (rows) => applyRows(db, rows, seen),
    error: () => undefined,   // the database is closing
  });
  const stop = () => {
    sub.unsubscribe();
    if (followed.get(db) === seen) followed.delete(db);
    unfollows.delete(db);
    getRuntime(db).stoppers.delete(stop);
  };
  unfollows.set(db, stop);
  getRuntime(db).stoppers.add(stop);
}

/**
 * The Google session ended (sign-out here or in another tab, Delete my account): the Gmail sync, folder rescans and
 * the queue stop. The Gmail row watch stays, so the sign-out still revokes and forgets the token; startSources
 * starts everything again for the next session.
 */
export async function stopSources(db: SieveDb): Promise<void> {
  stoppedDbs.add(db);
  unfollows.get(db)?.();
  stopFolderTimers(db);
  await stopGmailSync(db);
  await stopIngestQueue(db);
}

/** Every tab: Rebuild pressed in a follower is run by the indexer tab. */
const rebuildListeners = new Set<SieveDb>();
function listenForRebuild(db: SieveDb): void {
  if (rebuildListeners.has(db)) return;
  rebuildListeners.add(db);
  const off = onBroadcast(db, (msg) => {
    if (msg.type === 'rebuild-requested' && isLeader(db)) void rebuildIndex(db).catch(() => undefined);
  });
  getRuntime(db).stoppers.add(() => {
    off();
    rebuildListeners.delete(db);
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
  stoppedDbs.delete(db);
  await ready(db);
  wireGmailEvents(db);
  if (db.sieveKind === 'real') {
    // Every tab holds the token on this computer, so questions in any tab can search Gmail.
    await loadStoredGmailToken(db).catch(() => null);
    watchGmailRow(db);
  }
  listenForRebuild(db);
  await becomeIndexer(
    db,
    () => {
      startIngestQueue(db);
      followRows(db);
      void (async () => {
        const rows = await db.sources.toArray();
        const gmail = rows.find((r) => r.kind === 'gmail');
        if (gmail?.account) lastAccount.set(db, gmail.account);
        if (gmail?.connected) {
          const patch = gmailStartPatch(gmail);
          if (Object.keys(patch).length > 0) await db.sources.update('gmail', patch);
          void runGmailSync(db);   // reads the stored token; asks for Continue only when there is none
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

/** Google refused read-only Gmail access after Continue: the one Gmail ask in the warning tone. */
const GMAIL_REFUSED: Partial<SourceRow> = { needsAuth: true, errorCode: 'auth-needed', error: SOURCE_COPY.gmailAccessRefused };

function errorOf(e: unknown): { error: string; errorCode: SourceRow['errorCode'] } {
  if (e instanceof SourceError) return { error: e.message, errorCode: e.code };
  return { error: SOURCE_COPY.signInFailed, errorCode: 'unknown' };
}

/** Inside a click handler: the Google popup must open within the click's user activation. */
export async function connectGmail(db: SieveDb): Promise<void> {
  const tokenP = requestGmailToken({ prompt: 'select_account' });   // first, synchronously in the click
  tokenP.catch(() => undefined);
  wireGmailEvents(db);
  const { accessToken: _old, ...before } = ((await db.sources.get('gmail')) ?? EMPTY_ROW('gmail')) as GmailRow;
  await db.sources.put({ ...before, phase: 'listing', error: undefined, errorCode: undefined });
  try {
    await tokenP;
    const profile = await getProfile('interactive');
    lastAccount.set(db, profile.emailAddress);
    const accessToken = db.sieveKind === 'real' ? currentGmailToken() ?? undefined : undefined;
    const row: GmailRow = {
      kind: 'gmail', connected: true, account: profile.emailAddress, cursor: profile.historyId,
      progress: { done: 0, total: 0 }, paused: false, needsAuth: false, phase: 'listing', ...(accessToken ? { accessToken } : {}),
    };
    await db.sources.put(row);
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

/**
 * Inside a click handler. Gmail: a new token for the same account (Google Identity Services, or the Firebase popup
 * when the script is not there; either opens inside the click); folder: the permission prompt.
 */
export async function reauthorize(db: SieveDb, kind: 'gmail' | 'folder'): Promise<void> {
  if (kind === 'gmail') {
    // the account hint is read from memory so the popup still opens inside the click
    const tokenP = requestGmailToken({ prompt: '', loginHint: lastAccount.get(db) });
    try {
      await tokenP;
    } catch (e) {
      // A token without read-only Gmail is a scope problem: the card's warning, with Continue (not Connect) again.
      const scope = e instanceof SourceError && e.code === 'scope-denied';
      await db.sources.update('gmail', scope ? GMAIL_REFUSED : errorOf(e));
      return;
    }
    wireGmailEvents(db);
    // Kept on the row for every tab of this account, for the token's lifetime (20 section 15.1).
    const kept = currentGmailToken();
    await writeStoredToken(db, kept, { needsAuth: false, error: undefined, errorCode: undefined });
    // A fresh token that Gmail still answers 401 to is not an expiry: say so with the warning.
    try {
      await getProfile('interactive');
    } catch (e) {
      if (e instanceof GmailAuthError) {
        if (kept) await clearStoredToken(db, kept.value);
        await db.sources.update('gmail', GMAIL_REFUSED);
        return;
      }
      // anything else (offline, quota) is the sync's to report
    }
    void runGmailSync(db);
    startGmailTimers(db);
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
    await loadStoredGmailToken(db).catch(() => null);   // this tab may not have held it yet
    if (getGmailToken()) await revokeGmailToken();
    await forgetGmailToken(db);
  }
  if (kind === 'playground') return;
  await db.sources.put(EMPTY_ROW(kind));
}

/**
 * Pauses every source job and the queue (with its privacy lane); questions keep working (20 section 14.2). Any tab
 * may call it: it writes the rows, and the indexer tab applies them (here at once, or through followRows).
 * Resume also clears a pause for storage and its error: if the space is still short, the next write pauses again.
 */
export async function setIndexingPaused(db: SieveDb, paused: boolean): Promise<void> {
  const rows = await db.sources.toArray();
  for (const r of rows) {
    const patch: Partial<SourceRow> = paused ? { paused: true, pausedBy: 'person' } : { paused: false, pausedBy: undefined };
    if (!paused && r.errorCode === 'storage-full') Object.assign(patch, { error: undefined, errorCode: undefined });
    await db.sources.update(r.kind, patch);
  }
  const seen = followed.get(db);
  if (seen && isLeader(db)) applyRows(db, await db.sources.toArray(), seen);
}

/** Rebuild the keyword index, reload vectors, integrity check, Gmail reconciliation, re-label code labels (20 section 14.3). */
export async function rebuildIndex(db: SieveDb): Promise<void> {
  await ready(db);
  const rt = getRuntime(db);
  if (!isLeader(db)) {
    // A follower rebuilds its own keyword index in memory; the indexer tab runs the rest with its queue.
    await rt.keyword.rebuild();
    broadcast(db, { type: 'rebuild-requested' });
    return;
  }
  const rows = await db.sources.toArray();
  for (const r of rows) if (r.connected) await db.sources.update(r.kind, { phase: 'rebuilding' });
  await rt.keyword.rebuild();
  await checkIntegrity(db);
  const queue = startIngestQueue(db);
  const coded: string[] = [];
  await db.records.each((r) => {
    if (r.categoryBy === 'code' || r.categoryBy === 'rule') coded.push(r.id);
  });
  queue.enqueue(coded);
  for (const r of rows) if (r.connected) await db.sources.update(r.kind, { phase: 'idle' });
  if (rows.some((r) => r.kind === 'gmail' && r.connected) && (await loadStoredGmailToken(db).catch(() => null))) void runGmailSync(db, 'reconcile');
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
