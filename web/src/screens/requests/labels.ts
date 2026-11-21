// Labels for a request's state (40 section 13.5): the tag of a live entry's phase and the one-line status of a
// history row. Shared by the list, the approval card and the history detail.
import type { TagProps } from '@/components/Tag/Tag';
import { REQUESTS, fillText } from '@/copy/screens-controls';
import type { PendingEntry } from '@/state/homeBase';
import type { RelayRequestView } from '@/state/types';

export interface PhaseTag { label: string; tone: TagProps['tone'] }

export function phaseTag(entry: PendingEntry): PhaseTag {
  switch (entry.phase) {
    case 'claiming':
    case 'preparing':
      return { label: REQUESTS.phasePreparing, tone: 'muted' };
    case 'awaiting-person':
    case 'deciding':
      return { label: REQUESTS.phaseWaiting, tone: 'warn' };
    case 'done': {
      const r = entry.result;
      if (!r) return { label: REQUESTS.phaseWaiting, tone: 'warn' };
      if (r.kind === 'sent') return { label: REQUESTS.phaseSent, tone: 'device' };
      if (r.kind === 'declined') return { label: REQUESTS.phaseDeclined, tone: 'muted' };
      if (r.kind === 'ended') return { label: r.status === 'expired' ? REQUESTS.phaseExpired : REQUESTS.phaseCancelled, tone: 'muted' };
      if (r.status === 'blocked') return { label: REQUESTS.phaseBlocked, tone: 'never' };
      if (r.status === 'no-match') return { label: REQUESTS.phaseNoMatch, tone: 'muted' };
      return { label: REQUESTS.phaseError, tone: 'warn' };
    }
  }
}

export function statusLabel(request: RelayRequestView): string {
  return fillText(REQUESTS.status[request.status], { aiName: request.requester.aiName });
}
