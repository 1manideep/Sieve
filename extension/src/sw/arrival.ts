// Opens the toolbar popup when a new request arrives (50 section 7.7). Chrome 127+ only (chrome.action.openPopup), in
// the last focused normal window, and only while that window has focus: a popup in a Chrome the person is not
// looking at would hide the notification they need. It never opens the side panel, because Chrome accepts
// sidePanel.open() only inside a user gesture. Any failure (setting off, no openPopup, no focused window, Chrome
// refuses, a popup already open) returns false, and the caller falls back to the notification.
import { readSettings } from '../shared/settings';

/** After a popup opened and before it says hello, a new arrival counts as shown for at most this long: the popup is
 *  still coming up and will list it. Its hello ends the wait; from then on its port says whether it is showing. */
export const ARRIVAL_SETTLE_MS = 2_000;

type ArrivalApi = Pick<typeof chrome, 'action' | 'windows' | 'storage'>;

export interface ArrivalOpener {
  /** One try at opening the popup for requests that just arrived; true when it opened (or had just opened). */
  open(): Promise<boolean>;
  /** A popup said hello: stop counting new arrivals as shown (a popup closed right away no longer hides them). */
  popupConnected(): void;
}

/** chrome.action.openPopup, when this Chrome has it (127+). */
export function canOpenPopup(api: Pick<typeof chrome, 'action'>): boolean {
  return typeof (api.action as Partial<typeof chrome.action>).openPopup === 'function';
}

export function createArrivalOpener(api: ArrivalApi, now: () => number): ArrivalOpener {
  let openedAt = Number.NEGATIVE_INFINITY;
  return {
    async open() {
      if (!canOpenPopup(api)) return false;
      if (now() - openedAt < ARRIVAL_SETTLE_MS) return true;
      const { openOnArrival } = await readSettings(api.storage.local);
      if (!openOnArrival) return false;
      try {
        const win = await api.windows.getLastFocused({ windowTypes: ['normal'] });
        if (win.id === undefined || !win.focused) return false;
        await api.action.openPopup({ windowId: win.id });
        openedAt = now();
        return true;
      } catch {
        return false;
      }
    },
    popupConnected() {
      openedAt = Number.NEGATIVE_INFINITY;
    },
  };
}
