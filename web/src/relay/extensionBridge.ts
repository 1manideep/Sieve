// The page side of the page-to-extension protocol (40 section 11.10, 50 section 6, 01 section 6).
// One long-lived port per tab, hello then hello-ack, the full pending list on every change and every 20 s,
// resolved after each decision, reconnect with backoff after a drop. The bridge never throws to its caller.
import {
  HOME_BASE_PORT_NAME,
  LADDER_STEPS,
  MESSAGE_VERSION,
  type ExtensionToPage,
  type PageToExtension,
  type PreparingPreview,
  type ProposalPreview,
} from '@sieve/shared';
import type { ExtensionStatus } from '@/state/homeBase';
import {
  EXTENSION_ACK_MS,
  EXTENSION_BACKOFF_AFTER_MS,
  EXTENSION_BACKOFF_MS,
  EXTENSION_KEEPALIVE_MS,
  EXTENSION_PROBE_MS,
  MAX_PREVIEWS,
} from './constants';
import { textHashOf, type DecisionInput } from './decision';

export interface BridgeHandlers {
  onDecision(input: DecisionInput): void;
  onOpenApp(requestId?: string): void;
  onStatus(s: ExtensionStatus): void;
  getPending(): ProposalPreview[];
  /** Sent with each list to an extension of 0.1.1 or later: the requests being prepared, and Gmail running out. */
  getExtras?(): { preparing?: PreparingPreview[]; gmail?: 'ended' };
  /** sieve/hello-ack arrived: the extension's version and its open-sieve shortcut ('' when unset). */
  onHello?(info: { extensionVersion: string; extensionShortcut: string }): void;
}

export interface ExtensionBridge {
  start(): void;
  stop(): void;
  sendPending(): void;                                   // posts getPending() when connected; no-op otherwise
  /** `message`: for 'error', the one line the app shows, so the extension can say why too. */
  sendResolved(requestId: string, outcome: 'approved' | 'declined' | 'expired' | 'error', message?: string): void;
}

/** The parts of chrome.runtime the bridge uses (injectable for tests). */
export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}
export interface RuntimeLike {
  connect(extensionId: string, info: { name: string }): PortLike;
  lastError?: { message?: string } | undefined;
}
export interface Ticker { stop(): void }

export interface BridgeEnv {
  runtime?: () => RuntimeLike | undefined;
  makeTicker?: (onTick: () => void) => Ticker;
  homeBase?: () => boolean;                             // hello.homeBase: true only for the registered home base tab
  onFocus?: (fn: () => void) => () => void;
}

const EXT_TYPES = ['sieve/hello-ack', 'sieve/decision', 'sieve/open-app'] as const;

// Extension 0.1.0 dropped the whole sieve/pending list over one value it did not know, and its builds differ
// ('unsupported' came late), so a 0.1.0 extension gets only the values every 0.1.0 build knows. 0.1.1 and later
// leave out what they do not know themselves, so they get the list as it is.
const V010 = {
  warnings: ['ask-first', 'injection', 'hidden-text-removed', 'pii-redacted', 'pii-check-limited', 'cloud-fallback', 'sample-data-cloud', 'unverified-answer', 'source-unchecked'],
  outcomes: ['ready', 'blocked-never', 'no-match', 'needs-cloud-consent', 'model-unavailable', 'error'],
  rules: ['approve', 'ask-first', 'never'],
  kinds: ['email', 'document', 'photo', 'note'],
  categories: ['Home', 'Work', 'Money', 'Health', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos'],
} as const;
const has = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** True for 0.1.0 and anything that does not read as a version 0.1.1 or later. */
export function isOldExtension(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return true;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return major === 0 && (minor === 0 || (minor === 1 && patch < 1));
}

/** The previews as sent: each with the hash of its option texts (textHashOf); trimmed to 0.1.0's values for 0.1.0. */
export function previewsFor(list: ProposalPreview[], extensionVersion: string): (ProposalPreview & { textHash: string })[] {
  const old = isOldExtension(extensionVersion);
  const out: (ProposalPreview & { textHash: string })[] = [];
  for (const p of list) {
    const preview = { ...p, textHash: textHashOf(p.options) };
    if (!old) {
      out.push(preview);
      continue;
    }
    if (!has(V010.outcomes, p.outcome) || !has(V010.rules, p.rule)) continue;
    if (p.item && (!has(V010.kinds, p.item.kind) || !has(V010.categories, p.item.category))) continue;
    out.push({ ...preview, warnings: (p.warnings ?? []).filter((w) => has(V010.warnings, w.kind)) });
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Version 1, a known type, and for decisions every field of the right shape with decidedBy 'extension'. */
export function isExtensionToPage(m: unknown): m is ExtensionToPage {
  if (!isPlainObject(m) || m.version !== MESSAGE_VERSION || !(EXT_TYPES as readonly unknown[]).includes(m.type)) return false;
  switch (m.type) {
    case 'sieve/hello-ack':
      return typeof m.extensionVersion === 'string' && (m.shortcut === undefined || typeof m.shortcut === 'string');
    case 'sieve/open-app':
      return m.requestId === undefined || typeof m.requestId === 'string';
    case 'sieve/decision': {
      const d = m.decision;
      if (!isPlainObject(d)) return false;
      return (
        typeof d.requestId === 'string' &&
        d.requestId.length > 0 &&
        typeof d.approved === 'boolean' &&
        (d.step === undefined || (LADDER_STEPS as readonly unknown[]).includes(d.step)) &&
        Array.isArray(d.itemIds) &&
        d.itemIds.every((x) => typeof x === 'string') &&
        d.decidedBy === 'extension' &&
        typeof d.decidedAt === 'number' &&
        Number.isFinite(d.decidedAt) &&
        (m.textHash === undefined || typeof m.textHash === 'string')
      );
    }
    default:
      return false;
  }
}

function defaultRuntime(): RuntimeLike | undefined {
  const rt = (globalThis as { chrome?: { runtime?: Partial<RuntimeLike> } }).chrome?.runtime;
  return rt && typeof rt.connect === 'function' ? (rt as RuntimeLike) : undefined;
}

/** 50 section 6.5: the tick comes from a module worker; a plain interval when a worker cannot be made. */
function defaultTicker(onTick: () => void): Ticker {
  try {
    if (typeof Worker === 'function') {
      const worker = new Worker(new URL('./keepalive.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = () => onTick();
      return { stop: () => worker.terminate() };
    }
  } catch {
    // fall through to the main-thread timer
  }
  const handle = setInterval(onTick, EXTENSION_KEEPALIVE_MS);
  return { stop: () => clearInterval(handle) };
}

function defaultFocus(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('focus', fn);
  return () => window.removeEventListener('focus', fn);
}

export function createExtensionBridge(extensionId: string, appVersion: string, h: BridgeHandlers, env: BridgeEnv = {}): ExtensionBridge {
  const runtime = env.runtime ?? defaultRuntime;
  const makeTicker = env.makeTicker ?? defaultTicker;
  const homeBase = env.homeBase ?? (() => true);
  const onFocus = env.onFocus ?? defaultFocus;

  let started = false;
  let status: ExtensionStatus = 'idle';
  let port: PortLike | null = null;
  let acked = false;
  let extensionVersion = '';
  let everConnected = false;
  let attempt = 0;
  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let ticker: Ticker | null = null;
  let offFocus: (() => void) | null = null;

  const setStatus = (s: ExtensionStatus) => {
    if (s === status) return;
    status = s;
    try {
      h.onStatus(s);
    } catch (error) {
      console.error('bridge status handler', error);
    }
  };

  const post = (message: PageToExtension) => {
    if (!port) return;
    try {
      port.postMessage(message);
    } catch {
      // The port died under us; onDisconnect follows.
    }
  };

  const clearTimers = () => {
    clearTimeout(ackTimer);
    clearTimeout(retryTimer);
    ackTimer = undefined;
    retryTimer = undefined;
  };

  const stopTicker = () => {
    ticker?.stop();
    ticker = null;
  };

  const dropPort = () => {
    const p = port;
    port = null;
    acked = false;
    stopTicker();
    clearTimeout(ackTimer);
    ackTimer = undefined;
    if (p) {
      try {
        p.disconnect();
      } catch {
        // already gone
      }
    }
  };

  /** Not installed: probe again every minute and on window focus. */
  const probeLater = () => {
    setStatus('not-installed');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, EXTENSION_PROBE_MS);
    if (!offFocus) offFocus = onFocus(() => {
      if (started && !port && status === 'not-installed') {
        clearTimeout(retryTimer);
        connect();
      }
    });
  };

  /** After a drop: reconnect at once, then 2, 5, 10, 30 s, then every 60 s. */
  const reconnectLater = () => {
    setStatus('reconnecting');
    const delay = attempt < EXTENSION_BACKOFF_MS.length ? EXTENSION_BACKOFF_MS[attempt] : EXTENSION_BACKOFF_AFTER_MS;
    attempt += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  };

  const failed = () => {
    dropPort();
    if (!started) return;
    if (everConnected) reconnectLater();
    else probeLater();
  };

  function onMessage(this: PortLike, message: unknown): void {
    if (this !== port) return;
    if (!isExtensionToPage(message)) {
      if (import.meta.env.DEV) console.debug('ignored extension message');
      return;
    }
    if (message.type === 'sieve/hello-ack') {
      if (acked) return;
      clearTimeout(ackTimer);
      ackTimer = undefined;
      acked = true;
      extensionVersion = message.extensionVersion;
      everConnected = true;
      attempt = 0;
      setStatus('connected');
      try {
        h.onHello?.({ extensionVersion: message.extensionVersion, extensionShortcut: message.shortcut ?? '' });
      } catch (error) {
        console.error('bridge hello handler', error);
      }
      sendPending();
      stopTicker();
      ticker = makeTicker(() => {
        if (acked) sendPending();
      });
      return;
    }
    if (!acked) return;
    if (message.type === 'sieve/decision') {
      const d = message.decision;
      const textHash = (message as { textHash?: string }).textHash;
      try {
        h.onDecision({
          requestId: d.requestId,
          approved: d.approved,
          ...(d.step ? { step: d.step } : {}),
          decidedBy: 'extension',
          ...(textHash !== undefined ? { textHash } : {}),
        });
      } catch (error) {
        console.error('bridge decision handler', error);
      }
      return;
    }
    try {
      h.onOpenApp(message.requestId);
    } catch (error) {
      console.error('bridge open handler', error);
    }
  }

  function connect(): void {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!started || port) return;
    const rt = runtime();
    if (!rt) {
      probeLater();
      return;
    }
    let p: PortLike;
    try {
      p = rt.connect(extensionId, { name: HOME_BASE_PORT_NAME });
    } catch {
      if (everConnected) reconnectLater();
      else probeLater();
      return;
    }
    port = p;
    acked = false;
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    p.onMessage.addListener(onMessage.bind(p));
    p.onDisconnect.addListener(() => {
      // Read lastError so Chrome does not log "Unchecked runtime.lastError" (50 section 6.5).
      void rt.lastError;
      if (p !== port) return;   // a second onDisconnect, or an old port: harmless
      failed();
    });
    post({ type: 'sieve/hello', version: MESSAGE_VERSION, homeBase: homeBase(), appVersion });
    ackTimer = setTimeout(() => {
      if (p === port && !acked) failed();
    }, EXTENSION_ACK_MS);
  }

  function sendPending(): void {
    if (!acked || !port) return;
    let proposals: ProposalPreview[];
    let extras: ReturnType<NonNullable<BridgeHandlers['getExtras']>> | undefined;
    try {
      proposals = previewsFor(h.getPending().slice(0, MAX_PREVIEWS), extensionVersion);
      // 0.1.0 is sent only what it knows (previewsFor); newer builds leave out what they do not know
      extras = isOldExtension(extensionVersion) ? undefined : h.getExtras?.();
    } catch (error) {
      console.error('bridge pending', error);
      return;
    }
    post({ type: 'sieve/pending', version: MESSAGE_VERSION, proposals, ...extras });
  }

  return {
    start() {
      if (started) return;
      started = true;
      everConnected = false;
      attempt = 0;
      connect();
    },
    stop() {
      if (!started) return;
      started = false;
      clearTimers();
      offFocus?.();
      offFocus = null;
      dropPort();
      setStatus('idle');
    },
    sendPending,
    sendResolved(requestId, outcome, message) {
      if (!acked || !port) return;
      post({ type: 'sieve/resolved', version: MESSAGE_VERSION, requestId, outcome, ...(message && !isOldExtension(extensionVersion) ? { message } : {}) });
    },
  };
}
