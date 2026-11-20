// Which surface this page is showing in. The same page is the toolbar popup (manifest action.default_popup) and
// the side panel (side_panel.default_path). Chrome lists a popup among chrome.extension.getViews({ type: 'popup' })
// from its first script, so the page checks whether its own window is one of them; anything else (the side panel,
// or the page opened in a tab) is 'panel'. `?surface=popup` or `?surface=panel` forces one, for previews and e2e.
import { SURFACES } from '../shared/internal';
import type { Surface } from '../shared/internal';

export interface SurfaceProbe {
  /** location.search */
  search: string;
  /** chrome.extension.getViews({ type: 'popup' }) */
  popupViews(): readonly unknown[];
  /** the page's own window */
  self: unknown;
}

function browserProbe(): SurfaceProbe {
  return {
    search: typeof location === 'undefined' ? '' : location.search,
    popupViews: () => chrome.extension.getViews({ type: 'popup' }),
    self: typeof window === 'undefined' ? undefined : window,
  };
}

export function detectSurface(probe: SurfaceProbe = browserProbe()): Surface {
  const forced = new URLSearchParams(probe.search).get('surface');
  if ((SURFACES as readonly string[]).includes(forced ?? '')) return forced as Surface;
  try {
    return probe.popupViews().includes(probe.self) ? 'popup' : 'panel';
  } catch {
    return 'panel'; // no chrome.extension here: not an extension popup
  }
}
