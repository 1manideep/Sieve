// Local notifications and the announced-id set (50 section 7.7). A request is announced once: by opening the popup
// when that works, else by a notification. A notification names the assistant only, never the question, the item
// or any outgoing text. chrome.storage.session key `announced` holds request ids only, so a restarted worker
// neither repeats a notification nor opens the popup again for a request the person already closed.
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
  /**
   * New actionable previews: announce the ones not announced before, once. Nothing shows while a panel is visible.
   * Otherwise `open` (one try for the whole batch) may open the popup; when it does not, each request still
   * waiting gets a notification. Calls run one after another, so requests that arrive together open one popup.
   */
  onAdded(previews: ProposalPreview[], how: AnnounceOptions): Promise<void>;
  clear(requestId: string): void;
  announced(): readonly string[];
}

export interface AnnounceOptions {
  /** True while a popup or side panel is showing: it already shows the new request. */
  panelVisible(): boolean;
  /** One try at opening the popup; true when it opened. Left out: notifications only. */
  open?: () => Promise<boolean>;
  /** Whether a request is still waiting once the popup try is over (it may have been answered meanwhile). */
  stillWaiting?: (requestId: string) => boolean;
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

  async function handleAdded(previews: ProposalPreview[], { panelVisible, open, stillWaiting }: AnnounceOptions): Promise<void> {
    const fresh: ProposalPreview[] = [];
    for (const p of previews) {
      if (announced.includes(p.requestId) || fresh.some((f) => f.requestId === p.requestId)) continue;
      fresh.push(p);
    }
    if (fresh.length === 0) return;
    // Saved before anything opens, so a worker restart mid-open does not open the popup for these again.
    announced = [...announced, ...fresh.map((p) => p.requestId)].slice(-ANNOUNCED_MAX);
    save();
    if (panelVisible()) return;
    if (open && (await open())) {
      log(`notify: popup opened for ${fresh.length} new`);
      return;
    }
    if (panelVisible()) return; // the person opened Sieve while the popup was tried
    for (const p of fresh) {
      if (stillWaiting && !stillWaiting(p.requestId)) continue;
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
  }

  let queue: Promise<void> = ready;

  return {
    ready,
    onAdded(previews, how) {
      const run = queue.then(() => handleAdded(previews, how));
      queue = run.catch(() => {});
      return run;
    },
    clear(requestId) {
      api.notifications.clear(notificationId(requestId)).catch(() => {});
    },
    announced: () => announced,
  };
}
