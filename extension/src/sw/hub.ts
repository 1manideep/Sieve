// Pure worker state (50 section 7.2): connections, the union of their lists, ownership, decisions in flight and
// resolved requests. In memory only; the hub holds no Port objects and touches no chrome.* API.
import { LADDER_STEPS } from '@sieve/shared';
import type { Decision, LadderStep } from '@sieve/shared';
import { APP_URL } from '../shared/env';
import type {
  ConnectionState,
  DecideRejection,
  InflightEntry,
  PanelState,
  Preview,
  ResolvedEntry,
  ResolvedOutcome,
} from '../shared/internal';

export const GRACE_MS = 2_000;
export const RESOLVED_KEEP_MS = 10 * 60_000;
export const RESOLVED_MAX = 20;
export const MAX_CONNECTIONS = 8;

export interface ConnInfo {
  id: string; // crypto.randomUUID()
  origin: string;
  tabId?: number;
  windowId?: number;
  homeBase: boolean;
  appVersion: string;
  ready: boolean; // true after a valid hello
  proposals: Preview[];
  pendingAt: number; // time of the last valid sieve/pending (0 if none)
  invalidCount: number;
}

/** On success, `textHash` is the hash of the text the person approved (approvals of a hashed preview only). */
export type DecideResult =
  | { ok: true; connId: string; decision: Decision; textHash?: string }
  | { ok: false; reason: DecideRejection };

interface Inflight extends InflightEntry {
  connId: string;
  aiName: string;
  question: string;
  textHash?: string; // what an approval was sent for; a new list with another hash means the page refused it
}

function aiNameOf(p: Preview): string {
  return p.requester.kind === 'outside' ? p.requester.aiName : 'Sieve';
}

export function isActionable(p: Preview): boolean {
  return p.outcome === 'ready' || p.outcome === 'needs-cloud-consent';
}

export class Hub {
  private readonly conns = new Map<string, ConnInfo>();
  private readonly inflight = new Map<string, Inflight>();
  private resolvedEntries: ResolvedEntry[] = [];
  private readonly startedAt: number;
  private readonly now: () => number;
  private everReady = false; // once a tab has connected, losing it means disconnected, not connecting

  constructor(now: () => number) {
    this.now = now;
    this.startedAt = now();
  }

  connCount(): number {
    return this.conns.size;
  }

  isReady(connId: string): boolean {
    return this.conns.get(connId)?.ready === true;
  }

  conn(connId: string): ConnInfo | undefined {
    return this.conns.get(connId);
  }

  addConn(c: Pick<ConnInfo, 'id' | 'origin' | 'tabId' | 'windowId'>): void {
    this.conns.set(c.id, {
      id: c.id,
      origin: c.origin,
      ...(c.tabId !== undefined ? { tabId: c.tabId } : {}),
      ...(c.windowId !== undefined ? { windowId: c.windowId } : {}),
      homeBase: false,
      appVersion: '',
      ready: false,
      proposals: [],
      pendingAt: 0,
      invalidCount: 0,
    });
  }

  hello(connId: string, homeBase: boolean, appVersion: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    c.homeBase = homeBase;
    c.appVersion = appVersion;
    c.ready = true;
    this.everReady = true;
  }

  /** Counts an invalid message on a connection; returns the new count. */
  invalid(connId: string): number {
    const c = this.conns.get(connId);
    if (!c) return 0;
    c.invalidCount += 1;
    return c.invalidCount;
  }

  /**
   * Replaces a connection's list. `changed`: approvals in flight to this page whose request is still listed with a
   * different text hash. The page refuses those (the text changed under the person), so they stop being in flight
   * and the panel can be asked to check the new text.
   */
  setPending(connId: string, proposals: Preview[]): { added: string[]; removed: string[]; changed: string[] } {
    const c = this.conns.get(connId);
    if (!c || !c.ready) return { added: [], removed: [], changed: [] };
    const before = this.unionIds();
    c.proposals = proposals;
    c.pendingAt = this.now();
    const changed: string[] = [];
    for (const entry of [...this.inflight.values()]) {
      if (entry.connId !== connId || entry.textHash === undefined) continue;
      const now = proposals.find((p) => p.requestId === entry.requestId);
      if (now && now.textHash !== entry.textHash) {
        this.inflight.delete(entry.requestId);
        changed.push(entry.requestId);
      }
    }
    return { ...this.diff(before), changed };
  }

  resolved(connId: string, requestId: string, outcome: 'approved' | 'declined' | 'expired' | 'error'): { removed: string[] } {
    if (!this.conns.get(connId)?.ready) return { removed: [] };
    const before = this.unionIds();
    const preview = this.find(requestId);
    const sent = this.inflight.get(requestId);
    this.inflight.delete(requestId);
    // The request is no longer waiting: drop it from every list now, before the page's next sieve/pending.
    for (const c of this.conns.values()) c.proposals = c.proposals.filter((p) => p.requestId !== requestId);
    const aiName = preview ? aiNameOf(preview) : sent?.aiName;
    const question = preview ? preview.question : sent?.question;
    if (aiName !== undefined && question !== undefined) {
      // Decided here only when this extension sent the decision that matches the outcome.
      const decidedHere = sent !== undefined && (outcome === 'approved' ? sent.approved : outcome === 'declined' && !sent.approved);
      this.addResolved({
        requestId,
        outcome,
        ...(decidedHere && sent?.step ? { step: sent.step } : {}),
        decidedHere,
        aiName,
        question,
        at: this.now(),
      });
    }
    return { removed: this.diff(before).removed };
  }

  removeConn(connId: string): { lost: string[]; removed: string[] } {
    if (!this.conns.has(connId)) return { lost: [], removed: [] };
    const before = this.unionIds();
    this.conns.delete(connId);
    const lost: string[] = [];
    for (const entry of [...this.inflight.values()]) {
      if (entry.connId !== connId) continue;
      this.inflight.delete(entry.requestId);
      lost.push(entry.requestId);
      this.addResolved({
        requestId: entry.requestId,
        outcome: 'lost',
        ...(entry.step ? { step: entry.step } : {}),
        decidedHere: true,
        aiName: entry.aiName,
        question: entry.question,
        at: this.now(),
      });
    }
    return { lost, removed: this.diff(before).removed };
  }

  /** `textHash`: the hash of the preview the panel showed. An approval of a hashed preview must carry the same one. */
  decide(requestId: string, approved: boolean, step?: LadderStep, textHash?: string): DecideResult {
    const preview = this.find(requestId);
    if (!preview) return { ok: false, reason: 'unknown-request' };
    const owner = this.owner(requestId);
    if (!owner) return { ok: false, reason: 'no-owner' };
    const sent = this.inflight.get(requestId);
    if (sent && !sent.slow) return { ok: false, reason: 'already-sent' };
    if (approved) {
      if (preview.outcome !== 'ready') return { ok: false, reason: 'not-ready' };
      if (preview.textHash !== undefined && textHash !== preview.textHash) return { ok: false, reason: 'changed' };
      if (!step) return { ok: false, reason: 'step-unavailable' };
      const option = preview.options.find((o) => o.step === step);
      if (!option || !option.available) return { ok: false, reason: 'step-unavailable' };
      if (LADDER_STEPS.indexOf(step) > LADDER_STEPS.indexOf(preview.maxStep)) return { ok: false, reason: 'step-unavailable' };
    }
    const at = this.now();
    // 50 section 9: itemIds is always []; step is omitted, not undefined, on a deny.
    const decision: Decision = approved && step
      ? { requestId, approved: true, step, itemIds: [], decidedBy: 'extension', decidedAt: at }
      : { requestId, approved: false, itemIds: [], decidedBy: 'extension', decidedAt: at };
    const sentHash = decision.approved ? preview.textHash : undefined;
    this.inflight.set(requestId, {
      requestId,
      approved: decision.approved,
      ...(decision.step ? { step: decision.step } : {}),
      sentAt: at,
      slow: false,
      connId: owner.id,
      aiName: aiNameOf(preview),
      question: preview.question,
      ...(sentHash !== undefined ? { textHash: sentHash } : {}),
    });
    return { ok: true, connId: owner.id, decision, ...(sentHash !== undefined ? { textHash: sentHash } : {}) };
  }

  /** Called 15 s after a decision that got no sieve/resolved; the panel re-enables its buttons. */
  markSlow(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (entry) entry.slow = true;
  }

  isInflight(requestId: string): boolean {
    return this.inflight.has(requestId);
  }

  dismiss(requestId: string): void {
    this.resolvedEntries = this.resolvedEntries.filter((r) => r.requestId !== requestId);
  }

  owner(requestId: string): ConnInfo | undefined {
    for (const c of this.orderedReady()) {
      if (c.proposals.some((p) => p.requestId === requestId)) return c;
    }
    return undefined;
  }

  /** First ready connection with homeBase true, else the first ready connection. */
  homeBaseConn(): ConnInfo | undefined {
    const ready = [...this.conns.values()].filter((c) => c.ready);
    return ready.find((c) => c.homeBase) ?? ready[0];
  }

  union(): Preview[] {
    const seen = new Set<string>();
    const out: Preview[] = [];
    for (const c of this.orderedReady()) {
      for (const p of c.proposals) {
        if (seen.has(p.requestId)) continue;
        seen.add(p.requestId);
        out.push(p);
      }
    }
    return out;
  }

  find(requestId: string): Preview | undefined {
    return this.union().find((p) => p.requestId === requestId);
  }

  actionableCount(): number {
    return this.union().filter((p) => isActionable(p) && !this.inflight.has(p.requestId)).length;
  }

  connection(): ConnectionState {
    const ready = [...this.conns.values()].filter((c) => c.ready);
    if (ready.some((c) => c.homeBase)) return 'connected';
    if (ready.length > 0) return 'not-home-base';
    return !this.everReady && this.now() - this.startedAt < GRACE_MS ? 'connecting' : 'disconnected';
  }

  view(): PanelState {
    this.prune();
    return {
      connection: this.connection(),
      appUrl: APP_URL,
      proposals: this.union(),
      inflight: [...this.inflight.values()].map(({ requestId, approved, step, sentAt, slow }) => ({
        requestId,
        approved,
        ...(step ? { step } : {}),
        sentAt,
        slow,
      })),
      resolved: [...this.resolvedEntries],
    };
  }

  /** Drops resolved entries older than 10 minutes and keeps at most 20; forgets decisions in flight for 10 minutes. */
  prune(): void {
    const cutoff = this.now() - RESOLVED_KEEP_MS;
    this.resolvedEntries = this.resolvedEntries.filter((r) => r.at >= cutoff).slice(0, RESOLVED_MAX);
    for (const [id, entry] of this.inflight) if (entry.sentAt < cutoff) this.inflight.delete(id);
  }

  private addResolved(entry: ResolvedEntry & { outcome: ResolvedOutcome }): void {
    this.resolvedEntries = [entry, ...this.resolvedEntries.filter((r) => r.requestId !== entry.requestId)];
    this.prune();
  }

  /** Ready connections: home base first, then the newest sieve/pending first. */
  private orderedReady(): ConnInfo[] {
    return [...this.conns.values()]
      .filter((c) => c.ready)
      .sort((a, b) => Number(b.homeBase) - Number(a.homeBase) || b.pendingAt - a.pendingAt);
  }

  private unionIds(): Set<string> {
    return new Set(this.union().map((p) => p.requestId));
  }

  private diff(before: Set<string>): { added: string[]; removed: string[] } {
    const after = this.unionIds();
    return {
      added: [...after].filter((id) => !before.has(id)),
      removed: [...before].filter((id) => !after.has(id)),
    };
  }
}
