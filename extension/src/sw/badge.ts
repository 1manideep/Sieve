// Badge text and tooltip from the hub (50 section 7.6). Global badge, red with white text.
import type { PanelState } from '../shared/internal';

export const BADGE_COLOR = '#B91C1C';
export const BADGE_TEXT_COLOR = '#FFFFFF';

export function badgeFor(state: Pick<PanelState, 'connection'>, actionable: number): { text: string; title: string } {
  if (state.connection === 'disconnected' || state.connection === 'connecting') {
    return { text: '', title: 'Sieve: open Sieve in a tab to receive requests' };
  }
  if (actionable <= 0) return { text: '', title: 'Sieve: no requests waiting' };
  if (actionable === 1) return { text: '1', title: 'Sieve: 1 request waiting' };
  if (actionable <= 99) return { text: String(actionable), title: `Sieve: ${actionable} requests waiting` };
  return { text: '99+', title: 'Sieve: 99+ requests waiting' };
}
