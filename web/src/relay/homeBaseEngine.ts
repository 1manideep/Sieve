// The home base engine (40 section 11): one tab per account holds a Web Lock, announces presence, claims relay
// requests, prepares proposals on the device, mirrors them to the extension and writes the decision.
// All I/O comes in through EngineDeps, so the engine is tested with fakes (40 section 18).
import {
  LADDER_STEPS,
  stepPhrase,
  type Decision,
  type IndexRecord,
  type LadderStep,
  type Proposal,
  type Receipt,
  type Settings,
  type SourceKind,
  type StepOption,
} from '@sieve/shared';
import type { SieveDb } from '@/index';
import type { PipelineProgress, buildRelatedOptions, composeOutgoingText, finalizeDecision, prepareProposal } from '@/pipeline';
import type { BlockedEntry } from '@/app/services/blocked';
import { autoApprovable, autoCovers, autoWaits } from '@/state/autoApprove';
import type { DecideResult, ExtensionStatus, HomeBaseRole, HomeBaseState, PendingEntry } from '@/state/homeBase';
import type { ToastState } from '@/state/toasts';
import type { DeviceView, LiveStep, RelayRequestView } from '@/state/types';
import { DECIDE_ERRORS, HOME_BASE } from '@/copy/strings';
import { truncateGraphemes } from '@/robust/question';
import { AUTO_FLOOR_MS, AUTO_JITTER_MS, CLAIM_RETRY_MS, DONE_ENTRY_TTL_MS, HIDDEN_NOTICE_MS, PREPARE_TIMEOUT_MS } from './constants';
import { decisionDeadline, isPlaygroundRequest } from './deadline';
import { validateDecision, type DecisionInput, type DecideResultReason } from './decision';
import type { BridgeHandlers, ExtensionBridge } from './extensionBridge';
import type { FinishInput, InvalidRequest } from './requests';
import { MSG, unsupportedLine } from './messagesToAi';
import { pendingPreviews, preparingPreviews } from './preview';
import { resilientSnapshot, type ListenerState } from './resilient';
import { checkBeforeSend, type SendBlock } from './sendCheck';
import { errorLine, errorName } from '@/robust/errorLine';
import { expandMoved } from '@/robust/media';
import { questionWarnings } from '@/robust/questionWarnings';

type RequestsModule = typeof import('./requests');
type PresenceModule = typeof import('./presence');
type LockModule = typeof import('./homeBaseLock');
type DevicesModule = typeof import('@/app/services/devices');

export interface EngineDeps {
  /**
   * 'real' (default): the Google home base for the real index; it never serves Playground requests.
   * 'playground' (00 D1): the Playground page serves only Playground requests (allowedSources ['playground']) from the
   * Playground database with sample data, for anonymous owners too: no lock, presence, device doc, push, or
   * Firestore receipt (its receipts stay in the Playground database through saveLocalReceipt).
   */
  kind?: 'real' | 'playground';
  saveLocalReceipt?(receipt: Receipt): Promise<void>;
  dataClass?: 'own' | 'sample';
  uid: string;
  deviceId: string;
  db: SieveDb;                                         // openDb('real')
  getSettings(): Settings;
  getBlocked(): BlockedEntry[];
  /** Joins stored item refs to local record ids (01 section 11.8), fresh at the moment of use. */
  resolveItemRefs(refs: string[]): Promise<Record<string, string | null>>;
  getRecord(id: string): Promise<IndexRecord | undefined>;
  putConsent(recordId: string, at: number): Promise<void>;
  requests: Pick<RequestsModule, 'listenRequests' | 'claimRequest' | 'markAwaiting' | 'finishRequest' | 'listOpenRequests'>;
  presence: Pick<PresenceModule, 'startPresence'>;
  lock: Pick<LockModule, 'acquireHomeBaseLock' | 'locksSupported'>;
  devices: Pick<DevicesModule, 'setHomeBase' | 'clearHomeBase'>;
  makeBridge: (handlers: BridgeHandlers) => ExtensionBridge | null;   // null when VITE_EXTENSION_ID is unset
  pipeline: {
    prepareProposal: typeof prepareProposal;
    finalizeDecision: typeof finalizeDecision;
    buildRelatedOptions: typeof buildRelatedOptions;
    composeOutgoingText: typeof composeOutgoingText;
  };
  /**
   * A file sent as itself (relay/handoff.ts): `upload` puts the approved file in the person's place in Cloud Storage and
   * returns that place; `remove` takes it back; `stashed` is the original the proposal found, `drop` forgets it.
   * Absent (the Playground, tests): a request for a file ends with the sentence that it cannot be sent here.
   */
  files?: {
    upload(uid: string, requestId: string, blob: Blob, mime: string): Promise<string>;
    remove(path: string): Promise<void>;
    stashed(requestId: string): Blob | undefined;
    drop(requestId: string): void;
  };
  beginForeground(): () => void;                       // useIndexing
  /** Starts loading the reranker when this tab becomes the home base, so the first request is reranked too. */
  warmModels?(): void;
  /**
   * 70 R-PLAT-01: a request is held up because this tab is in the background. Tells the person outside the tab (a
   * system notification, when they allow them); the engine calls it at most once until the tab is shown again.
   */
  notifyHidden?(aiName: string): void;
  now(): number;                                       // server time when known (70 section 3.4)
  set(patch: Partial<HomeBaseState>): void;            // store setState
  toast: ToastState['push'];
  announce(text: string, p?: 'polite' | 'assertive'): void;
  navigate(to: string): void;
  currentPath?(): string;
  reauth?(): Promise<boolean>;
  hasBeenActive?(): boolean | undefined;               // navigator.userActivation?.hasBeenActive
  modelReady?(): Promise<boolean>;                     // the on-device model is already on this computer: starting it needs no click
  isHidden?(): boolean;
  online?(): boolean;
  onWake?(fn: () => void): () => void;
  onFirstInteraction?(fn: () => void): () => void;
  whenVisible?(fn: () => void): () => void;
  whenOnline?(fn: () => void): () => void;
  wasDiscarded?(): boolean;
  scheduleFrame?(fn: () => void): void;
  /** Auto-approve, testing mode (40 section 13.8.9): on, and not expired, for this connection on this computer. */
  autoApprove?(grantId: string): boolean;
  /** Marks (or unmarks) a receipt this computer approves automatically, for "Approved automatically" on /seen. */
  markAutoApproved?(receiptId: string, on: boolean): void;
  /** 0 to 1, for the jitter of the automatic-outcome floor (tests pass a fixed value). */
  random?(): number;
  /** Gmail access on this computer has run out (the Gmail notice, components/GmailAccess): the extension says so too. */
  gmailEnded?(): boolean;
}

export interface HomeBaseEngine {
  start(): void;                                       // begins the requests listener; role is computed from the user doc
  stop(): Promise<void>;
  onUserDoc(d: { homeBaseDeviceId?: string } | null): void;
  onDevices(d: DeviceView[]): void;
  onSettings(s: Settings): void;                       // 70 R-RLY-10: a rule became 'never'
  onBlocked(list: BlockedEntry[]): void;               // 70 R-RLY-10: a new block
  resync(): Promise<void>;                             // 70 R-PLAT-04
  makeThisHomeBase(label: string): Promise<void>;
  stopBeingHomeBase(): Promise<void>;
  useThisTab(): Promise<void>;
  toggleRelated(requestId: string, recordId: string): Promise<void>;
  allowCloudFor(requestId: string, recordId: string): Promise<void>;
  decide(input: DecisionInput): Promise<DecideResult>;
  dismissDone(requestId: string): void;
  stopPreparing(requestId: string): Promise<void>;
  /** Sends the extension the current lists again (the Gmail state changed). */
  refreshExtension(): void;
  role(): HomeBaseRole;
}

type AbortReason = 'expired' | 'timeout' | 'stopped' | 'ended' | 'reprepare' | 'person';

interface Runtime {
  ctl?: AbortController;
  waiting?: 'click' | 'visible';
  hiddenRetried?: boolean;
  doneTimer?: ReturnType<typeof setTimeout>;
  frameText?: string;
  frameScheduled?: boolean;
}

const stepIndex = (s: LadderStep) => LADDER_STEPS.indexOf(s);

function isOfflineLike(error: unknown, online: boolean): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'unavailable' || code === 'deadline-exceeded' || !online;
}

function decisionErrorOf(error: unknown): { code: string; message: string } | null {
  const e = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  return e && e.name === 'DecisionError' && typeof e.code === 'string' && typeof e.message === 'string'
    ? { code: e.code, message: e.message }
    : null;
}

function reasonForDecisionCode(code: string): DecideResultReason {
  if (code === 'expired') return 'expired';
  if (code === 'too-long') return 'too-long';
  if (code === 'wrong-request' || code === 'not-ready') return 'not-pending';
  return 'invalid-step';
}

function reasonForSendBlock(code: SendBlock): DecideResultReason {
  if (code === 'too-long' || code === 'empty') return 'too-long';
  if (code === 'text-mismatch' || code === 'missing-item' || code === 'not-clean' || code === 'unmasked-number') return 'error';
  return 'invalid-step';
}

function sourceOf(recordId: string): SourceKind | undefined {
  const s = recordId.split(':')[0];
  return s === 'gmail' || s === 'folder' || s === 'upload' || s === 'playground' ? s : undefined;
}

export function createHomeBaseEngine(deps: EngineDeps): HomeBaseEngine {
  const { uid, deviceId } = deps;
  const playground = deps.kind === 'playground';
  const dataClass = deps.dataClass ?? (playground ? 'sample' : 'own');
  /** This engine serves only its own kind of request. */
  const mine = (r: { allowedSources: readonly string[] }) => isPlaygroundRequest(r) === playground;
  const online = () => deps.online?.() ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  const scheduleFrame =
    deps.scheduleFrame ??
    ((fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16)));
  const compose = (parts: StepOption[]) => deps.pipeline.composeOutgoingText(parts);

  let started = false;
  let stopped = false;
  let role: HomeBaseRole = 'signed-out';
  let errorReason: string | undefined;
  let homeBaseDeviceId: string | undefined;
  let userDocSeen = false;
  let devices: DeviceView[] = [];
  let presence: 'unknown' | 'online' | 'offline' = 'unknown';
  let extension: ExtensionStatus = 'off';
  let listener: ListenerState = 'live';
  let recent: RelayRequestView[] = [];
  let waitingForClick = false;
  let extensionShortcut: string | undefined;
  let lastSettings: Settings | undefined;
  let hiddenNoticed = false;   // the person was told this tab holds requests up; told again only after it is shown

  const entries = new Map<string, PendingEntry>();
  const runtime = new Map<string, Runtime>();
  const invalidHandled = new Set<string>();
  const stoppedByPerson = new Set<string>();   // Stop on a preparing card: never prepared again by this tab
  const autoDeciding = new Set<string>();     // approved by auto-approve (40 section 13.8.9), while decide() runs

  let unlisten: (() => void) | null = null;
  let offWake: (() => void) | null = null;
  let offClick: (() => void) | null = null;
  let lockHandle: { cancel(): void; steal(): void } | null = null;
  let presenceHandle: { stop(): Promise<void> } | null = null;
  let bridge: ExtensionBridge | null = null;
  let bridgeUnavailable = false;
  let pumping = false;

  const rt = (id: string): Runtime => {
    let r = runtime.get(id);
    if (!r) {
      r = {};
      runtime.set(id, r);
    }
    return r;
  };

  // ---------- publishing to the store ----------

  function ordered(): PendingEntry[] {
    return [...entries.values()].sort((a, b) => a.request.createdAt - b.request.createdAt);
  }

  function publish(): void {
    if (stopped) return;   // after stop the Google session resets the store; late callbacks must not refill it
    const list = ordered();
    const awaiting = list.filter((e) => e.phase === 'awaiting-person');
    deps.set({
      role,
      homeBaseDeviceId,
      homeBaseLabel: homeBaseDeviceId ? devices.find((d) => d.id === homeBaseDeviceId)?.label : undefined,
      presence,
      extension,
      entries: Object.fromEntries(list.map((e) => [e.requestId, e])),
      order: list.map((e) => e.requestId),
      recent,
      awaitingCount: awaiting.length,
      waitingForClick: waitingForClick && list.some((e) => e.phase === 'preparing'),
      devices,
      listener,
      errorReason,
      extensionShortcut,
    });
  }

  function update(id: string, patch: Partial<PendingEntry>): PendingEntry | undefined {
    const e = entries.get(id);
    if (!e) return undefined;
    const next = { ...e, ...patch };
    entries.set(id, next);
    return next;
  }

  function createEntry(request: RelayRequestView, phase: PendingEntry['phase']): PendingEntry {
    const e: PendingEntry = {
      requestId: request.id,
      request,
      phase,
      liveSteps: [],
      answerPreview: '',
      relatedSelected: [],
      relatedOptions: {},
      relatedLoading: [],
      lastPreviewItemIds: [],
    };
    entries.set(request.id, e);
    return e;
  }

  function removeEntry(id: string): void {
    const r = runtime.get(id);
    if (r?.doneTimer) clearTimeout(r.doneTimer);
    r?.ctl?.abort('ended' satisfies AbortReason);
    runtime.delete(id);
    entries.delete(id);
    deps.files?.drop(id);
  }

  function abortEntry(id: string, reason: AbortReason): void {
    runtime.get(id)?.ctl?.abort(reason);
  }

  function finishEntry(id: string, result: NonNullable<PendingEntry['result']>): void {
    update(id, { phase: 'done', result, error: undefined });
    const r = rt(id);
    if (r.doneTimer) clearTimeout(r.doneTimer);
    r.doneTimer = setTimeout(() => {
      if (entries.get(id)?.phase === 'done') {
        removeEntry(id);
        publish();
        ensureBridge();
      }
    }, DONE_ENTRY_TTL_MS);
  }

  // ---------- the extension ----------

  const handlers: BridgeHandlers & { isHomeBase(): boolean } = {
    onDecision: (input) => {
      void engine.decide(input);
    },
    onOpenApp: (requestId) => deps.navigate(requestId ? `/requests?id=${encodeURIComponent(requestId)}` : '/requests'),
    onStatus: (s) => {
      extension = s;
      publish();
    },
    getPending: () => {
      const { previews, ids } = pendingPreviews(
        ordered().filter((e) => !autoDeciding.has(e.requestId)),
        (e) => (deps.autoApprove?.(e.request.requester.grantId) && e.proposal ? autoWaits(e.request, e.proposal, e.error !== undefined) : undefined),
      );
      for (const [id, itemIds] of Object.entries(ids)) {
        const e = entries.get(id);
        if (e && e.lastPreviewItemIds.join('\n') !== itemIds.join('\n')) update(id, { lastPreviewItemIds: itemIds });
      }
      return previews;
    },
    getExtras: () => ({
      preparing: preparingPreviews(ordered(), deps.now(), (e) => ({
        ...(autoCovers(e.request) && deps.autoApprove?.(e.request.requester.grantId) ? { auto: true as const } : {}),
        ...(runtime.get(e.requestId)?.waiting === 'click' ? { wait: 'click' as const } : deps.isHidden?.() ? { wait: 'hidden' as const } : {}),
      })),
      ...(deps.gmailEnded?.() ? { gmail: 'ended' as const } : {}),
    }),
    isHomeBase: () => role === 'active',
    onHello: (info) => {
      extensionShortcut = info.extensionShortcut;
      publish();
    },
  };

  function ensureBridge(): void {
    if (stopped) return;
    const want = role === 'active' || entries.size > 0;
    if (want && !bridge && !bridgeUnavailable) {
      bridge = deps.makeBridge(handlers);
      if (!bridge) {
        bridgeUnavailable = true;
        extension = 'off';
        return;
      }
      bridge.start();
    } else if (!want && bridge) {
      bridge.stop();
      bridge = null;
      extension = 'idle';
    }
  }

  function sendPending(): void {
    bridge?.sendPending();
  }

  // ---------- roles, lock and presence ----------

  function startPresence(): void {
    if (presenceHandle) return;
    presenceHandle = deps.presence.startPresence(uid, deviceId, (s) => {
      presence = s;
      publish();
    });
  }

  async function stopPresence(): Promise<void> {
    const h = presenceHandle;
    presenceHandle = null;
    presence = 'unknown';
    await h?.stop();
  }

  /** Stop the work started under the lock: presence, and every entry not waiting for the person. */
  function stopActiveWork(): void {
    void stopPresence();
    for (const e of [...entries.values()]) {
      if (e.phase === 'claiming' || e.phase === 'preparing') {
        abortEntry(e.requestId, 'stopped');
        removeEntry(e.requestId);
      }
    }
  }

  function restartBridge(): void {
    if (bridge) {
      bridge.stop();
      bridge.start();
    }
  }

  const lockHandlers = {
    onAcquired: () => {
      if (stopped) return;
      role = 'active';
      errorReason = undefined;
      startPresence();
      deps.warmModels?.();
      ensureBridge();
      restartBridge();   // hello again, now with homeBase: true
      processSnapshot(recent);
      publish();
    },
    onLost: () => {
      if (stopped) return;
      const wasActive = role === 'active';
      role = 'standby';
      stopActiveWork();
      if (wasActive) deps.toast({ tone: 'info', title: HOME_BASE.anotherTab });
      ensureBridge();
      restartBridge();
      publish();
    },
    onWaiting: () => {
      if (stopped || role === 'active') return;
      role = 'standby';
      publish();
    },
  };

  function applyRole(): void {
    if (stopped || !userDocSeen) return;
    if (homeBaseDeviceId === deviceId) {
      if (!lockHandle) {
        if (!deps.lock.locksSupported()) {
          role = 'error';
          errorReason = HOME_BASE.errorNoLocks;
          publish();
          return;
        }
        role = 'starting';
        publish();
        lockHandle = deps.lock.acquireHomeBaseLock(uid, lockHandlers);
      }
      return;
    }
    const next: HomeBaseRole = homeBaseDeviceId ? 'other-device' : 'not-home-base';
    if (lockHandle) {
      lockHandle.cancel();
      lockHandle = null;
    }
    const wasHomeBase = role === 'active' || role === 'standby' || role === 'starting';
    if (wasHomeBase) stopActiveWork();
    const changed = role !== next;
    role = next;
    ensureBridge();
    if (changed && wasHomeBase) restartBridge();   // hello again with homeBase: false (user doc snapshots repeat often)
    publish();
  }

  // ---------- offline retries ----------

  function waitOnline(): Promise<void> {
    if (online()) return Promise.resolve();
    return new Promise((resolve) => {
      if (deps.whenOnline) {
        deps.whenOnline(resolve);
        return;
      }
      const on = () => {
        window.removeEventListener('online', on);
        resolve();
      };
      window.addEventListener('online', on);
    });
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  /** 40 section 11.6: an automatic outcome leaves AUTO_FLOOR_MS after arrival at the soonest, plus random jitter. */
  const floor = async (from: number) => {
    const ms = from + AUTO_FLOOR_MS + (deps.random ?? Math.random)() * AUTO_JITTER_MS - deps.now();
    if (ms > 0) await sleep(ms);
  };

  /** Offline transactions are retried on the online event, then after 2, 5 and 10 s (40 section 11.5). */
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isOfflineLike(error, online())) throw error;
    }
    await waitOnline();
    for (const ms of [0, ...CLAIM_RETRY_MS]) {
      if (stopped) throw new Error('stopped');
      if (ms > 0) await sleep(ms);
      try {
        return await fn();
      } catch (error) {
        if (!isOfflineLike(error, online())) throw error;
      }
    }
    throw new Error('offline');
  }

  // ---------- the snapshot ----------

  function processSnapshot(list: RelayRequestView[]): void {
    const byId = new Map(list.map((r) => [r.id, r]));
    // An entry whose doc left the snapshot (TTL delete) is removed.
    for (const e of [...entries.values()]) {
      if (!byId.has(e.requestId) && e.phase !== 'deciding') removeEntry(e.requestId);
    }
    for (const r of [...list].sort((a, b) => a.createdAt - b.createdAt)) handleDoc(r);
    publish();
    ensureBridge();
    void pump();
  }

  function handleDoc(r: RelayRequestView): void {
    const e = entries.get(r.id);
    if (!e) {
      if (role !== 'active' || !mine(r) || stoppedByPerson.has(r.id)) return;
      if (r.status === 'queued') {
        createEntry(r, 'claiming');
        void claim(r.id);
      } else if ((r.status === 'claimed' || r.status === 'awaiting-person') && r.claimedBy === deviceId && deps.now() < decisionDeadline(r)) {
        createEntry(r, 'preparing');   // the tab was reloaded: prepare again
      }
      return;
    }
    const before = e.request;
    update(r.id, { request: r });
    if (r.status === 'queued' || r.status === 'claimed' || r.status === 'awaiting-person') {
      if (scopeChanged(before, r)) onScopeChanged(r.id);
      return;
    }
    // Terminal while nobody here is writing it.
    if (e.phase === 'deciding' || e.result) return;
    abortEntry(r.id, 'ended');
    bridge?.sendResolved(r.id, 'expired');
    if (r.status === 'expired' || r.status === 'revoked') {
      finishEntry(r.id, { kind: 'ended', status: r.status });
      const aiName = r.requester.aiName;
      if (r.status === 'expired') deps.toast({ tone: 'warning', title: HOME_BASE.expiredToast(aiName) });
      else deps.toast({ tone: 'info', title: HOME_BASE.revokedToast(aiName) });
    } else {
      removeEntry(r.id);   // finished elsewhere (another tab of this computer)
    }
    sendPending();
  }

  function scopeChanged(a: RelayRequestView, b: RelayRequestView): boolean {
    return (
      a.maxStep !== b.maxStep ||
      a.allowedCategories.join(',') !== b.allowedCategories.join(',') ||
      a.allowedSources.join(',') !== b.allowedSources.join(',')
    );
  }

  /** 70 R-RLY-09: the grant was narrowed while the request waits. */
  function onScopeChanged(id: string): void {
    const e = entries.get(id);
    if (!e) return;
    if (e.phase === 'preparing') {
      reprepare(id);
      return;
    }
    const p = e.proposal;
    if (e.phase !== 'awaiting-person' || !p) return;
    const r = e.request;
    const item = p.item;
    const source = item ? sourceOf(item.recordId) : undefined;
    if (item && (!r.allowedCategories.includes(item.category) || (source && !r.allowedSources.includes(source)))) {
      reprepare(id);
      return;
    }
    if (stepIndex(r.maxStep) < stepIndex(p.maxStep)) {
      const reason = HOME_BASE.mayOnlyReceive(r.requester.aiName, r.maxStep);
      const options = p.options.map((o) =>
        stepIndex(o.step) > stepIndex(r.maxStep) ? { ...o, available: false, unavailableReason: reason } : o,
      );
      update(id, { proposal: { ...p, maxStep: r.maxStep, options } });
      sendPending();
    }
  }

  function onInvalid(bad: InvalidRequest[]): void {
    if (role !== 'active' || playground) return;
    for (const b of bad) {
      if (b.status !== 'queued' || invalidHandled.has(b.id)) continue;
      invalidHandled.add(b.id);
      const seen = deps.now();
      void (async () => {
        try {
          const c = await withRetry(() => deps.requests.claimRequest(uid, b.id, deviceId));
          if (c !== 'claimed') return;
          await floor(seen);   // a request that fails at once waits like every other automatic outcome
          await withRetry(() => deps.requests.finishRequest(uid, b.id, deviceId, { status: 'error', message: b.reason === 'no-readable-words' ? MSG.noReadableWords : MSG.badRequest }));
        } catch (error) {
          console.error('malformed request', b.id, (error as { code?: string }).code ?? '');
        }
      })();
    }
  }

  // ---------- claiming and preparing ----------

  async function claim(id: string): Promise<void> {
    let result: 'claimed' | 'taken' | 'gone';
    try {
      result = await withRetry(() => deps.requests.claimRequest(uid, id, deviceId));
    } catch (error) {
      console.error('claim', id, (error as { code?: string }).code ?? '');
      removeEntry(id);
      publish();
      return;
    }
    if (stopped || !entries.has(id)) return;
    if (result !== 'claimed') {
      removeEntry(id);
      publish();
      ensureBridge();
      return;
    }
    update(id, { phase: 'preparing' });
    publish();
    sendPending();
    void pump();
  }

  function clickStep(id: string): LiveStep {
    return { id: `${id}:wait-click`, kind: 'select', label: HOME_BASE.waitingForClick, where: 'device', status: 'running', startedAt: deps.now() };
  }

  function nextToPrepare(): PendingEntry | undefined {
    return ordered().find((e) => e.phase === 'preparing' && !runtime.get(e.requestId)?.ctl && !runtime.get(e.requestId)?.waiting);
  }

  /** Entries are prepared one at a time, oldest first (40 section 11.6). */
  async function pump(): Promise<void> {
    if (pumping || stopped) return;
    pumping = true;
    try {
      for (let e = nextToPrepare(); e && !stopped; e = nextToPrepare()) {
        // Activation gate: Chrome lets the on-device model download only after a click in this tab. A model that is
        // already on this computer starts without one, so a reload (the person's, or the automatic one after an
        // update) does not leave requests waiting for a click nobody knows to make.
        let gated = deps.hasBeenActive?.() === false;
        if (gated) {
          let ready = false;
          try {
            ready = (await deps.modelReady?.()) === true;
          } catch {
            ready = false;
          }
          if (stopped) break;
          if (nextToPrepare() !== e) continue;
          gated = !ready && deps.hasBeenActive?.() === false;
        }
        if (gated) {
          waitingForClick = true;
          for (const w of ordered().filter((x) => x.phase === 'preparing' && !runtime.get(x.requestId)?.ctl)) {
            rt(w.requestId).waiting = 'click';
            update(w.requestId, { liveSteps: [clickStep(w.requestId)] });
          }
          publish();
          sendPending();
          // nobody sees "click in this tab" in a background tab: tell the person outside it (70 R-PLAT-01)
          if (deps.isHidden?.()) noticeHidden(e.request.requester.aiName);
          if (!offClick) {
            const subscribe = deps.onFirstInteraction ?? ((fn: () => void) => {
              const h = () => fn();
              window.addEventListener('pointerdown', h, { capture: true, once: true });
              window.addEventListener('keydown', h, { capture: true, once: true });
              return () => {
                window.removeEventListener('pointerdown', h, true);
                window.removeEventListener('keydown', h, true);
              };
            });
            offClick = subscribe(() => {
              offClick = null;
              waitingForClick = false;
              for (const [id, r] of runtime) {
                if (r.waiting === 'click') {
                  r.waiting = undefined;
                  update(id, { liveSteps: [] });
                }
              }
              publish();
              void pump();
            });
          }
          return;
        }
        await prepare(e.requestId);
      }
    } finally {
      pumping = false;
    }
  }

  async function blockedIds(grantId: string): Promise<string[]> {
    const list = deps.getBlocked().filter((b) => b.grantId === grantId || b.grantId === '*');
    if (list.length === 0) return [];
    try {
      const map = await deps.resolveItemRefs(list.map((b) => b.recordRef));
      const ids = new Set<string>();
      for (const b of list) {
        const id = map[b.recordRef] ?? b.recordId;
        if (id) ids.add(id);
      }
      return await expandMoved(deps.db, [...ids]);   // 70 R-IDX-06: a block follows the file when it moves
    } catch {
      return [...new Set(list.map((b) => b.recordId))];
    }
  }

  function applyProgress(id: string, ev: PipelineProgress): void {
    const e = entries.get(id);
    if (!e || e.phase !== 'preparing') return;
    if (ev.type === 'step-start') {
      const step: LiveStep = { id: ev.id, kind: ev.kind, label: ev.label, where: ev.where, status: 'running', startedAt: deps.now() };
      update(id, { liveSteps: [...e.liveSteps.filter((s) => s.id !== ev.id), step] });
      publish();
      sendPending();
    } else if (ev.type === 'step-end') {
      const found = e.liveSteps.some((s) => s.id === ev.id);
      const liveSteps = found
        ? e.liveSteps.map((s) => (s.id === ev.id ? { ...s, status: 'done' as const, label: ev.step.label, where: ev.step.where, step: ev.step } : s))
        : [...e.liveSteps, { id: ev.id, kind: ev.step.kind, label: ev.step.label, where: ev.step.where, status: 'done' as const, startedAt: ev.step.at, step: ev.step }];
      update(id, { liveSteps });
      publish();
      sendPending();
    } else {
      const r = rt(id);
      r.frameText = ev.text;
      if (!r.frameScheduled) {
        r.frameScheduled = true;
        scheduleFrame(() => {
          r.frameScheduled = false;
          if (entries.get(id)?.phase === 'preparing' && r.frameText !== undefined) {
            update(id, { answerPreview: r.frameText });
            publish();
          }
        });
      }
    }
  }

  /** 70 R-PLAT-01: once per spell in the background, tell the person outside the tab that it holds a request up. */
  function noticeHidden(aiName: string): void {
    if (hiddenNoticed || !deps.notifyHidden) return;
    hiddenNoticed = true;
    deps.whenVisible?.(() => (hiddenNoticed = false));
    try {
      deps.notifyHidden(aiName);
    } catch {
      // best effort: the card on the Requests screen says why the request waits
    }
  }

  /**
   * One console line when a preparation hits PREPARE_TIMEOUT_MS, as evidence of where background tabs stall: hidden
   * at the start and at the end, and each live step's kind, place, state and time. Never a label or any content.
   */
  function logTimeout(e: PendingEntry | undefined, hiddenAtStart: boolean, startedAt: number): void {
    const t = deps.now();
    const steps = (e?.liveSteps ?? []).map((s) => `${s.kind} ${s.where} ${s.status} ${s.status === 'done' && s.step ? s.step.ms : t - s.startedAt} ms`);
    console.warn('Sieve: preparing a request timed out.', `hidden at start ${hiddenAtStart}, at end ${deps.isHidden?.() === true}, ${t - startedAt} ms; steps: ${steps.join(', ') || 'none'}`);
  }

  async function prepare(id: string): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return;
    const req = entry.request;
    const aiName = req.requester.aiName;
    const r = rt(id);
    const ctl = new AbortController();
    r.ctl = ctl;
    update(id, { phase: 'preparing', liveSteps: [], answerPreview: '', proposal: undefined, error: undefined });
    publish();
    const end = deps.beginForeground();
    const startedAt = deps.now();
    const hiddenAtStart = deps.isHidden?.() === true;
    const expiry = setTimeout(() => ctl.abort('expired' satisfies AbortReason), Math.max(0, decisionDeadline(req) - deps.now()));
    const timeout = setTimeout(() => ctl.abort('timeout' satisfies AbortReason), PREPARE_TIMEOUT_MS);
    // Started in a background tab and still preparing after HIDDEN_NOTICE_MS: say so well before the timeout parks it.
    const notice = hiddenAtStart
      ? setTimeout(() => {
          if (deps.isHidden?.() && r.ctl === ctl && !ctl.signal.aborted) noticeHidden(aiName);
        }, HIDDEN_NOTICE_MS)
      : undefined;
    let proposal: Proposal | undefined;
    let failed = false;
    let thrown = '';
    try {
      const blockedRecordIds = await blockedIds(req.requester.grantId);
      proposal = await deps.pipeline.prepareProposal({
        db: deps.db,
        requestId: req.id,
        question: req.question,
        requester: req.requester,
        requestedStep: req.requestedStep,
        maxStep: req.maxStep,
        allowedCategories: req.allowedCategories,
        allowedSources: req.allowedSources,
        ...(req.hints ? { hints: req.hints } : {}),
        ...(req.wantFile && deps.files ? { wantFile: true } : {}),
        settings: deps.getSettings(),
        dataClass,
        signal: ctl.signal,
        onProgress: (ev) => applyProgress(id, ev),
        blockedRecordIds,
        now: deps.now(),
      });
    } catch (error) {
      failed = true;
      thrown = errorName(error);
      // A stop or an expiry is expected; any other throw is logged, since nothing else would show it in production.
      if (!ctl.signal.aborted) console.error('Sieve: the home base could not prepare a request.', errorLine(error));
    } finally {
      end();
      clearTimeout(expiry);
      clearTimeout(timeout);
      clearTimeout(notice);
      if (r.ctl === ctl) r.ctl = undefined;
    }
    if (stopped || !entries.has(id)) return;
    const reason = ctl.signal.aborted ? (ctl.signal.reason as AbortReason) : undefined;
    if (reason === 'timeout') logTimeout(entries.get(id), hiddenAtStart, startedAt);
    if (reason === 'expired') {
      removeEntry(id);   // functions mark it expired
      publish();
      sendPending();
      return;
    }
    if (reason === 'stopped' || reason === 'ended' || reason === 'person') return;
    if (reason === 'reprepare') {
      update(id, { phase: 'preparing', liveSteps: [], answerPreview: '', proposal: undefined });
      publish();
      return;
    }
    if (reason === 'timeout' && deps.isHidden?.() && !r.hiddenRetried) {
      // 70 R-PLAT-01: Chrome may slow the on-device model in a background tab. Retry once when visible.
      r.hiddenRetried = true;
      r.waiting = 'visible';
      update(id, {
        liveSteps: [{ id: `${id}:hidden`, kind: 'select', label: HOME_BASE.waitingHidden, where: 'device', status: 'running', startedAt: deps.now() }],
      });
      publish();
      sendPending();
      noticeHidden(aiName);
      const resume = () => {
        r.waiting = undefined;
        if (entries.has(id) && deps.now() < decisionDeadline(entries.get(id)!.request)) void pump();
      };
      if (deps.whenVisible) deps.whenVisible(resume);
      else setTimeout(resume, 0);
      return;
    }
    if (failed || reason === 'timeout' || !proposal) {
      deps.toast({ tone: 'error', title: HOME_BASE.prepareFailed(aiName) });
      const code = reason === 'timeout' ? 'timeout' : failed ? `threw-${thrown}` : 'no-proposal';
      await finishAuto(id, { status: 'error', message: MSG.errorWith(code) }, 'error');
      return;
    }
    if (req.questionRemoved) {
      // 70 R-IN-03, R-IN-04: what was hidden in the question is shown on the card, before every other warning
      const extra = questionWarnings(req.questionRemoved);
      if (extra.length > 0) proposal = { ...proposal, warnings: [...extra, ...proposal.warnings] };
    }
    // A card with nothing to approve would only end as "declined" (T08): it ends here, like no match. Declined is
    // only ever the person's own choice. (The consent card has its own action.)
    if (proposal.outcome === 'ready' && !proposal.options.some((o) => o.available && o.text.trim())) {
      // the reason line of the answer step is fixed copy, never content: its first words name what withheld the answer
      const reason = (proposal.options[0]?.unavailableReason ?? '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).slice(0, 5).join('-');
      proposal = { ...proposal, outcome: 'no-match', reasonCode: `answer-withheld-${reason || 'unknown'}` };
    }
    // Testing mode (auto-approve on for this connection): the result says which step shared nothing.
    const testing = !playground && deps.autoApprove?.(req.requester.grantId) === true;
    const said = (line: string): string => (testing ? MSG.withReason(line, proposal?.reasonCode) : line);
    switch (proposal.outcome) {
      case 'ready':
      case 'needs-cloud-consent':
        await presentProposal(id, proposal);
        return;
      case 'blocked-never': {
        let receipt: Receipt | undefined;
        try {
          const decision: Decision = {
            requestId: req.id,
            approved: false,
            itemIds: proposal.item ? [proposal.item.recordId] : [],
            decidedBy: 'app',
            decidedAt: deps.now(),
          };
          receipt = (await deps.pipeline.finalizeDecision(proposal, decision, { db: deps.db })).receipt;
        } catch {
          receipt = undefined;
        }
        if (!receipt) {
          await finishAuto(id, { status: 'error', message: MSG.errorWith('receipt') }, 'error');
          return;
        }
        deps.toast({ tone: 'info', title: HOME_BASE.blockedToast(aiName) });
        await finishAuto(
          id,
          // in testing mode a held item's line carries its step code too; before, the missing code itself told it apart
          { status: 'blocked', message: said(MSG.blocked), ...(playground ? {} : { receipt: { ...receipt, id: req.id } }) },
          'blocked',
          proposal,
          playground ? { ...receipt, id: req.id } : undefined,
        );
        return;
      }
      case 'no-match':
        await finishAuto(id, { status: 'no-match', message: said(MSG.noMatch) }, 'no-match', proposal);
        return;
      case 'unsupported':
        // the line of the outcome (a count, or one fact at a time), never content
        await finishAuto(id, { status: 'unsupported', message: said(unsupportedLine(proposal.options[0]?.unavailableReason)) }, 'no-match', proposal);
        return;
      case 'model-unavailable':
        deps.toast({ tone: 'warning', title: HOME_BASE.modelUnavailableToast(aiName) });
        await finishAuto(id, { status: 'error', message: MSG.modelUnavailable }, 'error', proposal);
        return;
      default:
        deps.toast({ tone: 'error', title: HOME_BASE.prepareFailed(aiName) });
        await finishAuto(id, { status: 'error', message: proposal.errorCode === 'mail-not-current' ? MSG.mailNotCurrent : MSG.errorWith(proposal.errorCode ?? 'unknown') }, 'error', proposal);
    }
  }

  async function presentProposal(id: string, proposal: Proposal): Promise<void> {
    let marked: 'ok' | 'gone' | 'offline';
    try {
      marked = await withRetry(() => deps.requests.markAwaiting(uid, id, deviceId));
    } catch {
      marked = 'offline';   // still offline: show it; decide() moves the doc to awaiting-person before sending
    }
    if (stopped || !entries.has(id)) return;
    if (marked === 'gone') {
      removeEntry(id);
      publish();
      ensureBridge();
      return;
    }
    const e = update(id, { phase: 'awaiting-person', proposal, answerPreview: '', relatedSelected: [], relatedOptions: {}, relatedLoading: [] });
    if (e && marked === 'ok' && autoApprovable(e.request, proposal) && deps.autoApprove?.(e.request.requester.grantId)) {
      // 40 section 13.8.9: nothing waits, so no toast and no preview for the extension. The doc is awaiting-person now,
      // even if the snapshot that says so has not arrived yet.
      const s = e.request.status;
      if (s === 'queued' || s === 'claimed') update(id, { request: { ...e.request, status: 'awaiting-person' } });
      autoDeciding.add(id);
      const r = await engine.decide({ requestId: id, approved: true, step: 'answer', decidedBy: 'app' });
      autoDeciding.delete(id);
      if (r.ok) return;
      deps.markAutoApproved?.(id, false);
      if (entries.get(id)?.phase !== 'awaiting-person') return;
      // Any other failure: it waits for the person as today, and the card says why.
    }
    publish();
    ensureBridge();
    sendPending();
    if (!e) return;
    const aiName = e.request.requester.aiName;
    // 70 R-UI-08: the question in announcements is cut at 120 units on a grapheme boundary, with an ellipsis
    const q = e.request.question.replace(/\s+/g, ' ');
    const shown = truncateGraphemes(q, 120);
    deps.announce(HOME_BASE.newRequestAnnounce(aiName, shown.length < q.length ? `${shown}…` : shown), 'polite');
    if (!playground && (deps.currentPath?.() ?? '') !== '/requests') {
      deps.toast({
        tone: 'info',
        title: HOME_BASE.newRequestToast(aiName),
        body: e.request.question,
        action: { label: HOME_BASE.review, run: () => deps.navigate(`/requests?id=${encodeURIComponent(id)}`) },
      });
    }
  }

  async function finishAuto(
    id: string,
    f: FinishInput,
    status: 'blocked' | 'no-match' | 'error',
    proposal?: Proposal,
    localReceipt?: Receipt,
  ): Promise<void> {
    update(id, { phase: 'deciding', ...(proposal ? { proposal } : {}) });
    publish();
    sendPending();
    // The same floor for every automatic outcome, so timing never tells a block from a miss (Nov 21).
    await floor(entries.get(id)?.request.createdAt ?? deps.now());
    if (stopped || !entries.has(id)) return;
    let r: 'ok' | 'gone';
    try {
      r = await withRetry(() => deps.requests.finishRequest(uid, id, deviceId, f));
    } catch (error) {
      console.error('finish', id, (error as { code?: string }).code ?? '');
      removeEntry(id);   // the doc stays claimed; a resync or reload prepares it again
      publish();
      ensureBridge();
      return;
    }
    if (r === 'ok' && localReceipt) await saveLocal(localReceipt);
    if (!entries.has(id)) return;
    if (r === 'gone') removeEntry(id);
    else finishEntry(id, { kind: 'auto', status });
    publish();
    ensureBridge();
  }

  async function saveLocal(receipt: Receipt): Promise<void> {
    try {
      await deps.saveLocalReceipt?.(receipt);
    } catch (error) {
      console.error('local receipt', (error as { name?: string }).name ?? '');
    }
  }

  function reprepare(id: string): void {
    const e = entries.get(id);
    if (!e || e.phase === 'deciding' || e.phase === 'done' || e.phase === 'claiming') return;
    const r = rt(id);
    if (r.ctl) {
      r.ctl.abort('reprepare' satisfies AbortReason);
    } else {
      r.waiting = undefined;
      update(id, { phase: 'preparing', liveSteps: [], answerPreview: '', proposal: undefined, relatedSelected: [], relatedOptions: {}, relatedLoading: [] });
    }
    publish();
    sendPending();
    void pump();
  }

  /** Ends an entry because its request can no longer be answered. */
  function endExpired(id: string): void {
    finishEntry(id, { kind: 'ended', status: 'expired' });
    bridge?.sendResolved(id, 'expired');
    sendPending();
    publish();
  }

  async function onBlockedChanged(list: BlockedEntry[]): Promise<void> {
    for (const e of ordered()) {
      const item = e.proposal?.item;
      if (e.phase !== 'awaiting-person' || !item) continue;
      const grantId = e.request.requester.grantId;
      if (!list.some((b) => b.grantId === grantId || b.grantId === '*')) continue;
      const ids = await blockedIds(grantId);
      if (ids.includes(item.recordId)) reprepare(e.requestId);
    }
  }

  // ---------- the engine ----------

  const engine: HomeBaseEngine = {
    start() {
      if (started) return;
      started = true;
      if (playground) {
        role = 'active';
        userDocSeen = true;
      } else if (!userDocSeen) {
        role = 'starting';
      }
      publish();
      unlisten = resilientSnapshot(
        'requests',
        (next, onError) =>
          deps.requests.listenRequests(
            uid,
            (list) => {
              next();
              const own = list.filter(mine);
              recent = own;
              processSnapshot(own);
            },
            onError,
            onInvalid,
          ),
        {
          onState: (s) => {
            listener = s;
            publish();
          },
          ...(deps.reauth ? { reauth: deps.reauth } : {}),
        },
      );
      offWake = deps.onWake?.(() => void engine.resync()) ?? null;
      if (deps.wasDiscarded?.()) deps.toast({ tone: 'info', title: HOME_BASE.discardedToast, timeoutMs: 15_000 });
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      unlisten?.();
      unlisten = null;
      offWake?.();
      offClick?.();
      lockHandle?.cancel();
      lockHandle = null;
      for (const id of [...entries.keys()]) {
        abortEntry(id, 'stopped');
        removeEntry(id);
      }
      bridge?.stop();
      bridge = null;
      await stopPresence();
    },

    onUserDoc(d) {
      if (playground) return;
      userDocSeen = true;
      homeBaseDeviceId = d?.homeBaseDeviceId;
      applyRole();
      publish();
    },

    onDevices(list) {
      devices = list;
      publish();
    },

    onSettings(s) {
      const before = lastSettings;
      lastSettings = s;
      if (!before) return;
      for (const e of ordered()) {
        const item = e.proposal?.item;
        if (e.phase !== 'awaiting-person' || !item) continue;
        if (s.categoryRules[item.category] === 'never' && before.categoryRules[item.category] !== 'never') reprepare(e.requestId);
      }
    },

    onBlocked(list) {
      void onBlockedChanged(list);
    },

    async resync() {
      if (stopped || role !== 'active') return;
      try {
        const { ok, bad } = await deps.requests.listOpenRequests(uid);
        onInvalid(bad);
        for (const r of ok.sort((a, b) => a.createdAt - b.createdAt)) handleDoc(r);
      } catch (error) {
        console.error('resync', (error as { code?: string }).code ?? '');
      }
      const now = deps.now();
      for (const e of ordered()) {
        if (e.phase === 'awaiting-person' && !(now < decisionDeadline(e.request))) {
          deps.toast({ tone: 'warning', title: HOME_BASE.expiredToast(e.request.requester.aiName) });
          endExpired(e.requestId);
        }
      }
      sendPending();
      publish();
      ensureBridge();
      void pump();
    },

    async makeThisHomeBase(label) {
      try {
        await deps.devices.setHomeBase(uid, deviceId, label.trim().slice(0, 40));
      } catch (error) {
        console.error('set home base', (error as { code?: string }).code ?? '');
        deps.toast({ tone: 'error', title: HOME_BASE.makeFailed });
      }
    },

    async stopBeingHomeBase() {
      if (lockHandle) {
        lockHandle.cancel();
        lockHandle = null;
      }
      stopActiveWork();
      role = 'not-home-base';
      ensureBridge();
      publish();
      try {
        await deps.devices.clearHomeBase(uid, deviceId);
      } catch (error) {
        console.error('clear home base', (error as { code?: string }).code ?? '');
        deps.toast({ tone: 'error', title: HOME_BASE.stopFailed });
      }
    },

    async useThisTab() {
      lockHandle?.steal();
    },

    async toggleRelated(requestId, recordId) {
      const e = entries.get(requestId);
      if (!e || e.phase !== 'awaiting-person' || !e.proposal) return;
      if (e.relatedSelected.includes(recordId)) {
        update(requestId, { relatedSelected: e.relatedSelected.filter((x) => x !== recordId) });
        publish();
        sendPending();
        return;
      }
      update(requestId, { relatedSelected: [...e.relatedSelected, recordId], error: undefined });
      if (!e.relatedOptions[recordId]) {
        update(requestId, { relatedLoading: [...e.relatedLoading, recordId] });
        publish();
        try {
          const options = await deps.pipeline.buildRelatedOptions({ db: deps.db, proposal: e.proposal, recordId, dataClass });
          const cur = entries.get(requestId);
          if (cur) update(requestId, { relatedOptions: { ...cur.relatedOptions, [recordId]: options } });
        } catch {
          const cur = entries.get(requestId);
          if (cur) update(requestId, { relatedSelected: cur.relatedSelected.filter((x) => x !== recordId), error: HOME_BASE.relatedFailed });
        } finally {
          const cur = entries.get(requestId);
          if (cur) update(requestId, { relatedLoading: cur.relatedLoading.filter((x) => x !== recordId) });
        }
      }
      publish();
      sendPending();
    },

    async allowCloudFor(requestId, recordId) {
      const e = entries.get(requestId);
      if (!e) return;
      await deps.putConsent(recordId, deps.now());
      reprepare(requestId);
    },

    async decide(input) {
      const id = input.requestId;
      const e = entries.get(id);
      const v = validateDecision(e, input, deps.now(), compose);
      const fromExtension = input.decidedBy === 'extension';
      if (!v.ok) {
        if (fromExtension) {
          if (v.reason !== 'not-pending') bridge?.sendResolved(id, 'error');
          sendPending();
        }
        return v;
      }
      // 70 R-RLY-03: 'deciding' is set before the first await, so a second decision gets 'not-pending'.
      update(id, { phase: 'deciding', error: undefined });
      publish();
      const entry = e as PendingEntry;
      const proposal = entry.proposal as Proposal;
      const aiName = entry.request.requester.aiName;

      const back = (message: string, reason: DecideResultReason): DecideResult => {
        if (entries.has(id)) update(id, { phase: 'awaiting-person', error: message });
        publish();
        if (fromExtension) bridge?.sendResolved(id, 'error', message);
        sendPending();
        return { ok: false, reason, message };
      };
      const ended = (message: string, reason: DecideResultReason): DecideResult => {
        if (entries.has(id)) endExpired(id);
        return { ok: false, reason, message };
      };

      try {
        const relatedOptions: Record<string, StepOption[]> = {};
        for (const rid of v.decision.itemIds.slice(1)) {
          const opts = entry.relatedOptions[rid];
          if (opts) relatedOptions[rid] = opts;
        }
        const { payload, receipt, file: offered } = await deps.pipeline.finalizeDecision(proposal, v.decision, { relatedOptions, db: deps.db });
        if (input.approved) {
          if (!payload || payload.text !== v.text) {
            console.error('payload mismatch', id);
            deps.toast({ tone: 'error', title: DECIDE_ERRORS.mismatch });
            return back(DECIDE_ERRORS.mismatch, 'error');
          }
          const latest = entries.get(id)?.request ?? entry.request;
          const guard = await checkBeforeSend({
            step: v.decision.step as LadderStep,
            approvedText: v.text,
            payloadText: payload.text,
            itemIds: v.decision.itemIds,
            question: entry.request.question,
            requester: entry.request.requester,
            settings: deps.getSettings(),
            blockedRecordIds: await blockedIds(entry.request.requester.grantId),
            request: {
              status: latest.status,
              maxStep: latest.maxStep,
              allowedCategories: latest.allowedCategories,
              allowedSources: latest.allowedSources,
              deadline: decisionDeadline(latest),
            },
            now: deps.now(),
            getRecord: deps.getRecord,
          });
          if (!guard.ok) {
            if (guard.code === 'request-closed') return ended(guard.message, 'not-pending');
            if (guard.code === 'expired') return ended(guard.message, 'expired');
            return back(guard.message, reasonForSendBlock(guard.code));
          }
        }
        // markAwaiting may have failed while offline; the rules answer only from awaiting-person.
        if ((entries.get(id)?.request.status ?? entry.request.status) === 'claimed') {
          const m = await deps.requests.markAwaiting(uid, id, deviceId);
          if (m === 'gone') return ended(DECIDE_ERRORS.expired, 'expired');
        }
        // The file itself: uploaded only now, after the approval and every check, to this person's own place for this
        // request. Its place rides in the payload; the relay turns it into a link when the assistant collects.
        let uploaded: string | undefined;
        if (input.approved && offered && payload) {
          const blob = deps.files?.stashed(id);
          if (!deps.files || !blob) return back(DECIDE_ERRORS.fileGone, 'error');
          try {
            uploaded = await deps.files.upload(uid, id, blob, offered.mime);
          } catch (e) {
            if ((e as { name?: string }).name !== 'HandoffError') console.error('file upload', id, (e as { name?: string }).name ?? '');
            return back(DECIDE_ERRORS.fileUpload, 'offline');
          }
          payload.file = { ...offered, path: uploaded };
        }
        const withId = { ...receipt, id };
        const firestoreReceipt = playground ? {} : { receipt: withId };
        // Testing mode: the answer carries which candidate it came from, so a test round can tell a wrong pick from a
        // wrong reading without asking the person (Nov 23, 2026). A code only, never content.
        const testing = !playground && deps.autoApprove?.(entry.request.requester.grantId) === true;
        const picked = testing && proposal.pickCode ? { message: MSG.picked(proposal.pickCode) } : {};
        const finish: FinishInput = input.approved
          ? { status: 'answered', response: payload!, ...firestoreReceipt, ...picked }
          : { status: 'declined', message: MSG.declined, ...firestoreReceipt };
        // Marked before the receipt is written, so What has AI seen? never shows it as approved by the person.
        if (input.approved && autoDeciding.has(id)) deps.markAutoApproved?.(id, true);
        let r: 'ok' | 'gone';
        try {
          r = await deps.requests.finishRequest(uid, id, deviceId, finish);
        } catch (e) {
          if (uploaded) void deps.files?.remove(uploaded);   // the answer was not written: the file does not stay
          throw e;
        }
        if (r === 'gone') {
          if (uploaded) void deps.files?.remove(uploaded);
          return ended(DECIDE_ERRORS.expired, 'expired');
        }
        if (playground) await saveLocal(withId);

        const step = v.decision.step;
        const itemCount = v.decision.itemIds.length;
        finishEntry(id, input.approved && step
          ? { kind: 'sent', step, itemCount, by: input.decidedBy }
          : { kind: 'declined', by: input.decidedBy });
        bridge?.sendResolved(id, input.approved ? 'approved' : 'declined');
        sendPending();
        publish();
        if (input.approved && step) {
          const phrase = stepPhrase(step, proposal.item?.kind, itemCount);
          deps.announce(HOME_BASE.sentAnnounce(phrase, aiName), 'polite');
          if (fromExtension) deps.toast({ tone: 'success', title: HOME_BASE.approvedInExtension(phrase, aiName) });
        } else {
          deps.announce(HOME_BASE.deniedAnnounce(aiName), 'polite');
          if (fromExtension) deps.toast({ tone: 'info', title: HOME_BASE.deniedInExtension });
        }
        return { ok: true };
      } catch (error) {
        const de = decisionErrorOf(error);
        if (de) {
          if (de.code === 'expired') return ended(de.message, 'expired');
          return back(de.message, reasonForDecisionCode(de.code));
        }
        console.error('decide', id, (error as { code?: string }).code ?? '');
        return back(DECIDE_ERRORS.offline, 'offline');
      }
    },

    async stopPreparing(requestId) {
      const e = entries.get(requestId);
      if (!e || (e.phase !== 'preparing' && e.phase !== 'claiming')) return;
      // The request stays claimed; this tab does not prepare it again (functions expire it, or another tab after 120 s).
      stoppedByPerson.add(requestId);
      abortEntry(requestId, 'person');
      removeEntry(requestId);
      publish();
      sendPending();
      ensureBridge();
      deps.announce(HOME_BASE.stoppedPreparing, 'polite');
    },

    dismissDone(requestId) {
      if (entries.get(requestId)?.phase !== 'done') return;
      removeEntry(requestId);
      publish();
      ensureBridge();
    },

    refreshExtension: sendPending,

    role: () => role,
  };

  return engine;
}
