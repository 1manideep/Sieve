// The Playground's own relay (00 D1, 30 section 16): the home base engine in 'playground' mode. It serves only
// Playground requests (allowedSources ['playground']) of this account, anonymous or Google, from the Playground
// database with sample data and PLAYGROUND_SETTINGS. No Web Lock, presence, device doc, push or Firestore receipt:
// the functions treat the Playground page as online, and its receipts stay in the Playground database. Its
// extension bridge is the Playground tab's own port, which the Playground screen hands in as `makeBridge`
// (relay/playgroundBridge.ts, 50 section 11), so the side panel shows its requests and the test request alike.
// The screen hands it in rather than this module importing it: the relay chunk stays free of the Playground's code.
import type { Receipt } from '@sieve/shared';
import { getDeviceId } from '@/app/deviceId';
import { getRecord, openDb } from '@/index';
import { announce } from '@/state/announcer';
import { useIndexing } from '@/state/indexing';
import { tables } from '@/state/localDb';
import { usePlaygroundRelay } from '@/state/playgroundRelay';
import { PLAYGROUND_SETTINGS } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { createHomeBaseEngine, type EngineDeps, type HomeBaseEngine } from './homeBaseEngine';
import { onFirstInteraction, onWake, whenVisible } from './lifecycle';
import * as requests from './requests';

export async function startPlaygroundRelay(uid: string, makeBridge: EngineDeps['makeBridge'] = () => null): Promise<{ engine: HomeBaseEngine; stop(): Promise<void> }> {
  const db = openDb('playground');
  const pipeline = await import('@/pipeline');
  const engine = createHomeBaseEngine({
    kind: 'playground',
    dataClass: 'sample',
    uid,
    deviceId: getDeviceId(),
    db,
    getSettings: () => PLAYGROUND_SETTINGS,
    getBlocked: () => [],
    resolveItemRefs: async (refs) => Object.fromEntries(refs.map((r) => [r, r])),
    getRecord: (id) => getRecord(db, id),
    putConsent: async (recordId, at) => {
      await tables(db).consents.put({ recordId, cloudAllowedAt: at });
    },
    saveLocalReceipt: async (receipt: Receipt) => {
      await tables(db).receipts.put(receipt);
    },
    requests,
    presence: { startPresence: () => ({ stop: async () => undefined }) },
    lock: { acquireHomeBaseLock: () => ({ cancel: () => undefined, steal: () => undefined }), locksSupported: () => true },
    devices: { setHomeBase: async () => undefined, clearHomeBase: async () => undefined },
    makeBridge,
    pipeline: {
      prepareProposal: pipeline.prepareProposal,
      finalizeDecision: pipeline.finalizeDecision,
      buildRelatedOptions: pipeline.buildRelatedOptions,
      composeOutgoingText: pipeline.composeOutgoingText,
    },
    beginForeground: () => useIndexing.getState().beginForeground(),
    now: Date.now,
    set: (patch) => usePlaygroundRelay.setState(patch),
    toast: (t) => useToasts.getState().push(t),
    announce,
    navigate: () => undefined,
    currentPath: () => (typeof window === 'undefined' ? '/playground' : window.location.pathname),
    hasBeenActive: () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive,
    isHidden: () => document.visibilityState === 'hidden',
    online: () => navigator.onLine,
    onWake: (fn) => onWake(() => fn()),
    onFirstInteraction,
    whenVisible,
  });
  engine.start();
  return { engine, stop: () => engine.stop() };
}
