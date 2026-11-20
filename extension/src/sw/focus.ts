// Open or focus the Sieve tab (50 section 7.9). None of these calls needs the `tabs` permission; the extension
// never reads tab URLs. It opens nothing but APP_URL and focuses only a connected Sieve tab. With no tab to focus,
// it opens the Requests screen for a request and the signed-in home (Ask) for anything else ("Open Sieve").
import { MESSAGE_VERSION } from '@sieve/shared';
import type { ExtensionToPage } from '@sieve/shared';
import { APP_URL, HOME_PATH, REQUESTS_PATH } from '../shared/env';
import type { Hub } from './hub';

type FocusApi = Pick<typeof chrome, 'tabs' | 'windows'>;

export async function openApp(
  api: FocusApi,
  hub: Hub,
  postTo: (connId: string, msg: ExtensionToPage) => void,
  requestId?: string,
): Promise<void> {
  const conn = (requestId && hub.owner(requestId)) || hub.homeBaseConn();
  if (conn?.tabId !== undefined) {
    try {
      await api.tabs.update(conn.tabId, { active: true });
      if (conn.windowId !== undefined) await api.windows.update(conn.windowId, { focused: true });
      postTo(conn.id, { type: 'sieve/open-app', version: MESSAGE_VERSION, ...(requestId ? { requestId } : {}) });
      return;
    } catch {
      // The tab went away between the lookup and the call: open the app instead.
    }
  }
  await api.tabs.create({ url: `${APP_URL}${requestId ? REQUESTS_PATH : HOME_PATH}` });
}
