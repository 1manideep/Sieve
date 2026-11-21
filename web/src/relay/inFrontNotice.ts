// The notice for a request held up because the home base tab is in the background (70 R-PLAT-01): one system
// notification, only when the person turned notifications on in Settings and the browser already allows them. It never
// asks for permission. One tag, so several held requests show as one. It is the page's own notification, not the
// service worker's: a click brings this tab (the home base) to the front, where the worker would pick any Sieve tab.
import { HOME_BASE } from '@/copy/strings';
import { whenVisible } from './lifecycle';

export const IN_FRONT_TAG = 'sieve-in-front';

export function showInFrontNotice(aiName: string, notificationsOn: boolean): void {
  if (!notificationsOn || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(HOME_BASE.inFrontTitle, { body: HOME_BASE.inFrontBody(aiName), tag: IN_FRONT_TAG, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    whenVisible(() => n.close());   // the tab is in front again: the notice has done its job
  } catch {
    // a browser that shows notifications only from a service worker: no notice, the card still says why it waits
  }
}
