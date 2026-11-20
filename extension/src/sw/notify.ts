// Local notifications and the announced-id set (50 section 7.7). A notification names the assistant only, never
// the question, the item or any outgoing text. chrome.storage.session key `announced` (request ids only) is the
// only value the extension ever stores.
import type { ProposalPreview } from '@sieve/shared';
import { isRequestId } from '../shared/validate';

export const ANNOUNCED_KEY = 'announced';
export const ANNOUNCED_MAX = 200;
export const NOTIFICATION_PREFIX = 'sieve-req-';
export const NOTIFICATION_TITLE = 'A request is waiting';
export const AI_NAME_MAX = 40;

export function notificationId(requestId: string): string {
  return `${NOTIFICATION_PREFIX}${requestId}`;
}

export function requestIdOfNotification(id: string): string | null {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return null;
  const requestId = id.slice(NOTIFICATION_PREFIX.length);
  return isRequestId(requestId) ? requestId : null;
}

/** Cuts to at most `max` UTF-16 units without leaving half of a surrogate pair. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

export function notificationMessage(aiName: string): string {
  return `${cut(aiName, AI_NAME_MAX)} is asking for something. Review it in Sieve.`;
}

export interface Notifier {
  /** Resolves once the announced set has been read back from storage.session. */
  readonly ready: Promise<void>;
  /** New actionable previews: announce each one not announced before; notify only when no panel is visible. */
  onAdded(previews: ProposalPreview[], panelVisible: () => boolean): Promise<void>;
  clear(requestId: string): void;
  announced(): readonly string[];
}

type NotifyApi = Pick<typeof chrome, 'notifications' | 'storage'>;

export function createNotifier(api: NotifyApi, log: (msg: string) => void = () => {}): Notifier {
  let announced: string[] = [];
  const ready = api.storage.session
    .get(ANNOUNCED_KEY)
    .then((items) => {
      const stored: unknown = items?.[ANNOUNCED_KEY];
      if (Array.isArray(stored)) {
        const fromStorage = stored.filter((id): id is string => isRequestId(id));
        // Ids announced while the read was in flight stay, newest last.
        announced = [...fromStorage.filter((id) => !announced.includes(id)), ...announced].slice(-ANNOUNCED_MAX);
      }
    })
    .catch(() => {
      log('notify: storage.session read failed');
    });

  function save(): void {
    api.storage.session.set({ [ANNOUNCED_KEY]: announced }).catch(() => {
      log('notify: storage.session write failed');
    });
  }

  return {
    ready,
    async onAdded(previews, panelVisible) {
      await ready;
      let changed = false;
      for (const p of previews) {
        if (announced.includes(p.requestId)) continue;
        announced = [...announced, p.requestId].slice(-ANNOUNCED_MAX);
        changed = true;
        if (panelVisible()) continue;
        const aiName = p.requester.kind === 'outside' ? p.requester.aiName : 'Sieve';
        api.notifications
          .create(notificationId(p.requestId), {
            type: 'basic',
            iconUrl: 'icons/icon-128.png',
            title: NOTIFICATION_TITLE,
            message: notificationMessage(aiName),
            priority: 0,
            requireInteraction: false,
          })
          .catch(() => {
            log('notify: create failed');
          });
      }
      if (changed) save();
    },
    clear(requestId) {
      api.notifications.clear(notificationId(requestId)).catch(() => {});
    },
    announced: () => announced,
  };
}
