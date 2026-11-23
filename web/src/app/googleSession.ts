// The Google session (40 section 6.5). Loaded with a dynamic import when the session kind becomes 'google' and the
// index owner check passes (state/session.ts). It is the only way into Firestore, the Realtime Database and the home
// base engine, so none of them is in the first load (40 section 17.2). stopGoogleSession undoes start in reverse.
import { getAuthInstance } from '@/app/firebase';
import { getDeviceId } from '@/app/deviceId';
import { env } from '@/app/env';
import { blockedFor, listenBlocked, type BlockedEntry } from '@/app/services/blocked';
import * as devices from '@/app/services/devices';
import { resolveItemRefs } from '@/app/services/itemRefs';
import { ensureUserDoc, listenUserDoc } from '@/app/services/userDoc';
import { createExtensionBridge } from '@/relay/extensionBridge';
import type { HandoffDeps } from '@/relay/handoff';
import { createHomeBaseEngine, type EngineDeps, type HomeBaseEngine } from '@/relay/homeBaseEngine';
import * as lock from '@/relay/homeBaseLock';
import { showInFrontNotice } from '@/relay/inFrontNotice';
import { onFirstInteraction, onWake, wasDiscarded, whenVisible } from '@/relay/lifecycle';
import * as requests from '@/relay/requests';
import { resilientSnapshot } from '@/relay/resilient';
import { testRequests } from '@/relay/testRequest';
import { announce } from '@/state/announcer';
import { autoApproveOn, markAutoApproved, useAutoApprove } from '@/state/autoApprove';
import { attachHomeBaseEngine, useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
import { tables } from '@/state/localDb';
import { useGrants } from '@/state/grants';
import type { SieveDb } from '@/index';
import { dropFile, stashedFile } from '@/pipeline/fileStash';
import type { SessionUser } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';


/** What an upload of an approved file needs (relay/handoff.ts): the project's bucket and this person's sign-in. */
function handoffDeps(): HandoffDeps {
  return {
    bucket: `${env.firebase.projectId}.firebasestorage.app`,
    idToken: async () => {
      const user = getAuthInstance().currentUser;
      if (!user) throw new Error('signed out');
      return user.getIdToken();
    },
    appCheckToken: async () => {
      const [{ getToken }, ai] = await Promise.all([import('firebase/app-check'), import('@/ai')]);
      return (await getToken(ai.getAppCheckInstance(), false)).token;
    },
  };
}

export const SETUP_DONE_KEY = (uid: string) => `sieve.setupDone.${uid}`;

interface Running {
  uid: string;
  engine: HomeBaseEngine;
  stops: (() => void)[];        // run in reverse order
  db: SieveDb;                  // the real index, whose source jobs stop with the session
}

let running: Running | null = null;
let blocked: BlockedEntry[] = [];

function navigate(to: string): void {
  void import('@/app/router')
    .then(({ router }) => router.navigate(to))
    .catch((error: unknown) => console.error('navigate', error));
}

function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

function setupDone(uid: string): boolean {
  try {
    return window.localStorage.getItem(SETUP_DONE_KEY(uid)) === '1';
  } catch {
    return false;
  }
}

async function reauth(): Promise<boolean> {
  try {
    const user = getAuthInstance().currentUser;
    if (!user) return false;
    await user.getIdToken(true);
    return true;
  } catch {
    return false;
  }
}

export async function startGoogleSession(user: SessionUser): Promise<void> {
  if (running?.uid === user.uid) return;
  if (running) await stopGoogleSession();
  const uid = user.uid;
  const deviceId = getDeviceId();
  const stops: (() => void)[] = [];
  // The index loads with a dynamic import: its code is not part of the sign-in bundle (40 section 17.1).
  const { getRecord, openDb } = await import('@/index');
  const db = openDb('real');

  // 1. The user doc exists with every setting.
  let isNew = false;
  try {
    ({ isNew } = await ensureUserDoc(uid));
  } catch (error) {
    console.error('user doc', (error as { code?: string }).code ?? '');
  }

  // 2. Listeners: settings, grants, blocked items, devices, and the user doc for the home base choice.
  stops.push(useSettings.getState().start(uid));
  stops.push(useGrants.getState().start(uid));
  stops.push(useAutoApprove.getState().start(uid));
  stops.push(useIndexing.getState().start(db));

  // The Realtime Database loads only when this tab becomes the active home base (presence), so a tab that is not the
  // home base never downloads it. Google's clock (robust/clock, 70 section 3.4: the RTDB offset, trusted for a skew
  // of a minute or more, with clockSkewMs and subscribeSkew for the R-PLAT-14 banner) starts with it, through the same
  // dynamic import so firebase/database stays out of the sign-in graph; until then Date.now() is used.
  let clock: { now(): number; stop(): void } | null = null;
  stops.push(() => clock?.stop());
  const presence: EngineDeps['presence'] = {
    startPresence(uidArg, deviceIdArg, onState) {
      let handle: { stop(): Promise<void> } | null = null;
      let stopped = false;
      const ready = Promise.all([import('@/relay/presence'), import('@/robust/clock'), import('@/app/services/database')])
        .then(([p, c, d]) => {
          if (stopped) return;
          clock ??= { now: c.serverNow, stop: c.startServerClock(d.rtdb()) };
          handle = p.startPresence(uidArg, deviceIdArg, onState);
        })
        .catch((error: unknown) => {
          console.error('presence', error);
          onState('offline');
        });
      return {
        async stop() {
          stopped = true;
          await ready;
          await handle?.stop();
        },
      };
    },
  };

  const pipeline = await import('@/pipeline');
  const engine = createHomeBaseEngine({
    uid,
    deviceId,
    db,
    getSettings: () => useSettings.getState().settings,
    getBlocked: () => blocked,
    resolveItemRefs: (refs) => resolveItemRefs(uid, db, refs),
    getRecord: (id) => getRecord(db, id),
    putConsent: async (recordId, at) => {
      await tables(db).consents.put({ recordId, cloudAllowedAt: at });
    },
    requests,
    presence,
    lock,
    devices,
    makeBridge: testRequests.wrapMakeBridge((handlers) =>
      env.extensionId
        ? createExtensionBridge(env.extensionId, __APP_VERSION__, handlers, { homeBase: () => engine.role() === 'active' })
        : null),
    files: {
      // loaded when a file is sent, not with the session
      upload: async (owner, requestId, blob, mime) => (await import('@/relay/handoff')).uploadHandoff(owner, requestId, blob, mime, handoffDeps()),
      remove: async (path) => (await import('@/relay/handoff')).removeHandoff(path, handoffDeps()),
      stashed: stashedFile,
      drop: dropFile,
    },
    pipeline: {
      prepareProposal: pipeline.prepareProposal,
      finalizeDecision: pipeline.finalizeDecision,
      buildRelatedOptions: pipeline.buildRelatedOptions,
      composeOutgoingText: pipeline.composeOutgoingText,
    },
    beginForeground: () => useIndexing.getState().beginForeground(),
    warmModels: () => void import('@/index/rerank').then((m) => m.warmupRerank(), () => undefined),
    notifyHidden: (aiName) => showInFrontNotice(aiName, useSettings.getState().settings.pushEnabled),
    now: () => (clock ? clock.now() : Date.now()),
    set: (patch) => useHomeBase.setState(patch),
    toast: (t) => useToasts.getState().push(t),
    announce,
    navigate,
    currentPath,
    reauth,
    hasBeenActive: () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive,
    // a lazy import: the model's code stays out of what loads right after sign-in
    modelReady: async () => (await (await import('@/ai/device/availability')).getNanoAvailability()).text === 'available',
    isHidden: () => document.visibilityState === 'hidden',
    online: () => navigator.onLine,
    onWake: (fn) => onWake(() => fn()),
    onFirstInteraction,
    whenVisible,
    whenOnline: (fn) => {
      const h = () => fn();
      window.addEventListener('online', h, { once: true });
      return () => window.removeEventListener('online', h);
    },
    wasDiscarded,
    autoApprove: (grantId) => autoApproveOn(uid, grantId),
    gmailEnded: () => useHomeBase.getState().gmailEnded,
    markAutoApproved: (receiptId, on) => markAutoApproved(uid, receiptId, on),
  });
  attachHomeBaseEngine(engine);
  running = { uid, engine, stops, db };

  stops.push(
    resilientSnapshot(
      'blocked',
      (next, onError) =>
        listenBlocked(
          uid,
          (list) => {
            next();
            blocked = list;
            engine.onBlocked(list);
          },
          onError,
        ),
      { reauth },
    ),
  );
  stops.push(
    resilientSnapshot(
      'devices',
      (next, onError) =>
        devices.listenDevices(
          uid,
          (list) => {
            next();
            engine.onDevices(list);
          },
          onError,
        ),
      { reauth },
    ),
  );
  stops.push(
    resilientSnapshot(
      'home base choice',
      (next, onError) =>
        listenUserDoc(
          uid,
          (d) => {
            next();
            engine.onUserDoc(d ? { ...(d.homeBaseDeviceId ? { homeBaseDeviceId: d.homeBaseDeviceId } : {}) } : null);
          },
          onError,
        ),
      { reauth },
    ),
  );

  // Rules that become 'never' re-prepare affected requests (70 R-RLY-10); the first settings snapshot may resume push.
  let pushChecked = false;
  const offSettings = useSettings.subscribe((s, prev) => {
    if (s.settings !== prev.settings && s.status === 'ready') engine.onSettings(s.settings);
    if (!pushChecked && s.status === 'ready') {
      pushChecked = true;
      engine.onSettings(s.settings);
      if (s.settings.pushEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        void import('@/relay/push').then((p) => p.resumePush(uid, deviceId)).catch(() => undefined);
      }
    }
  });
  stops.push(offSettings);

  // The notification click (service worker) asks an open tab to show Requests.
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel('sieve');
    channel.onmessage = (ev: MessageEvent) => {
      if ((ev.data as { type?: unknown } | null)?.type === 'open-requests') navigate('/requests');
    };
    stops.push(() => channel.close());
  }

  // 3. The home base engine decides its own role from the user doc.
  engine.start();

  // The local sources (Gmail sync, folder rescans, the ingest queue) run for the real index of this account.
  void import('@/sources')
    .then((m) => m.startSources(db))
    .catch((error: unknown) => console.error('sources', error));

  // 4. First run: setup, unless the person is in the Playground or preparing the model.
  const path = currentPath();
  if ((isNew || !setupDone(uid)) && path !== '/playground' && path !== '/prepare' && path !== '/setup') navigate('/setup');
}

export async function stopGoogleSession(): Promise<void> {
  testRequests.reset();
  const r = running;
  if (!r) return;
  running = null;
  blocked = [];
  try {
    await r.engine.stop();
  } catch (error) {
    console.error('stop home base', error);
  }
  attachHomeBaseEngine(null);
  for (const stop of [...r.stops].reverse()) {
    try {
      stop();
    } catch (error) {
      console.error('stop listener', error);
    }
  }
  try {
    const push = await import('@/relay/push');
    push.stopPushSession();
  } catch {
    // push never loaded
  }
  // The Gmail sync, folder rescans and the queue stop with the session (also when another tab signed out).
  try {
    const sources = await import('@/sources');
    await sources.stopSources(r.db);
  } catch (error) {
    console.error('stop sources', error);
  }
}

/** The running engine, for Delete my account (stop it, and restart it when deletion is cancelled). */
export function currentSession(): { uid: string; engine: HomeBaseEngine } | null {
  return running ? { uid: running.uid, engine: running.engine } : null;
}

/** Re-exported for screens that list blocked items per AI. */
export { blockedFor };
