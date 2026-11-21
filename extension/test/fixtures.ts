// Unit-test fixtures: the persona previews (e2e/previews.ts), message builders and panel states.
import { MESSAGE_VERSION } from '@sieve/shared';
import type { ProposalPreview } from '@sieve/shared';
import type { PanelState, Preview, ResolvedEntry } from '../src/shared/internal';
import { DEPOSIT, LEASE, STATEMENT, option, variant } from '../e2e/previews';

export { DEPOSIT, LEASE, STATEMENT, option, variant };
export {
  DEPOSIT_ANSWER,
  DEPOSIT_EXCERPT,
  DEPOSIT_FULL,
  LEASE_ANSWER,
  LEASE_EXCERPT,
  STATEMENT_ANSWER,
} from '../e2e/previews';

export const hello = (homeBase = true, appVersion = '0.1.0') => ({
  type: 'sieve/hello',
  version: MESSAGE_VERSION,
  homeBase,
  appVersion,
});

/** A sieve/pending message; previews may carry the page's text hash (0.1.1). */
export const pending = (proposals: Preview[]) => ({ type: 'sieve/pending', version: MESSAGE_VERSION, proposals });

export const resolved = (requestId: string, outcome: 'approved' | 'declined' | 'expired' | 'error') => ({
  type: 'sieve/resolved',
  version: MESSAGE_VERSION,
  requestId,
  outcome,
});

/** A preview with a fresh id. */
export function withId(base: ProposalPreview, requestId: string, changes: Partial<ProposalPreview> = {}): ProposalPreview {
  return variant(base, { requestId, ...changes });
}

export function panelState(changes: Partial<PanelState> = {}): PanelState {
  return {
    connection: 'connected',
    appUrl: 'http://localhost:5173',
    proposals: [],
    inflight: [],
    resolved: [],
    ...changes,
  };
}

export function resolvedEntry(changes: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    requestId: DEPOSIT.requestId,
    outcome: 'approved',
    step: 'excerpt',
    decidedHere: true,
    aiName: 'Test assistant',
    question: DEPOSIT.question,
    at: 1,
    ...changes,
  };
}
