// Shared view types (40 section 9.0).
import type { GrantMeta, Receipt, RelayRequest, TraceKind, TraceStep, Where } from '@sieve/shared';

export type DbKind = 'real' | 'playground';
export interface RelayRequestView extends Omit<RelayRequest, 'createdAt' | 'claimedAt' | 'answeredAt' | 'collectedAt' | 'expireAt'> {
  id: string;
  createdAt: number; claimedAt?: number; answeredAt?: number; collectedAt?: number; expireAt: number;   // epoch ms
  questionRemoved?: { invisible: number; bidi: number; tagText: string[]; html: boolean };   // 70 R-IN-03, R-IN-04
}
export type ReceiptView = Receipt;          // createdAt converted to ms on read
export interface GrantView extends Omit<GrantMeta, 'createdAt' | 'expiresAt' | 'revokedAt' | 'lastUsedAt'> {
  id: string; createdAt: number; expiresAt: number; revokedAt?: number; lastUsedAt?: number;
  state: 'active' | 'expiring' | 'expired' | 'revoked';       // expiring: within 3 days
}
export interface DeviceView { id: string; label: string; isHomeBase: boolean; hasPush: boolean; updatedAt: number; isThisDevice: boolean }

/** One line of the live trace while a pipeline runs (from CR-3 onProgress). */
export interface LiveStep {
  id: string;
  kind: TraceKind;
  label: string;                // the pipeline's running label, e.g. "Reading 3 emails on this device…"
  where: Where;
  status: 'running' | 'done';
  startedAt: number;
  step?: TraceStep;             // set when done; its label replaces the running label
}
