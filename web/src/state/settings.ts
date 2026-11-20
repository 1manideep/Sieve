// useSettings (40 section 9.2). Google-scoped. The listener and the writes load app/services/userDoc.ts with a dynamic
// import, so Firestore stays out of the first load (this store is reachable from /welcome through useSession).
import { create } from 'zustand';
import { DEFAULT_CATEGORY_RULES, type Category, type CategoryRule, type LadderStep, type Settings } from '@sieve/shared';
import { getDeviceId } from '@/app/deviceId';
import { SETTINGS_SAVE } from '@/copy/strings';
import { useToasts } from './toasts';

export const DEFAULT_SETTINGS: Settings = {
  categoryRules: { ...DEFAULT_CATEGORY_RULES },
  defaultStep: 'answer',
  cloudFallbackForOwnData: false,
  pushEnabled: false,
};
export const PLAYGROUND_SETTINGS: Settings = { ...DEFAULT_SETTINGS };   // fixed; no settings screen in the Playground

export const SAVED_MS = 2000;   // "Saved" shows for 2 s

export type SaveKey = 'defaultStep' | 'cloudFallbackForOwnData' | 'pushEnabled' | 'describePhotos' | `rule:${Category}`;
/** The Sources switch "Describe photos with Gemini Nano" (20 section 13.5). It is about this computer's own work, so
 * it is kept on this device for the account, not in users/{uid} (whose rules allow only the four shared settings). */
export const DESCRIBE_PHOTOS_KEY = (uid: string) => `sieve.describePhotos.${uid}`;
export interface SettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  settings: Settings;                                     // DEFAULT_SETTINGS until the first snapshot
  describePhotos: boolean;                                // default on; this device only
  saving: Partial<Record<SaveKey, 'saving' | 'saved' | 'queued' | 'error'>>;
  start(uid: string): () => void;                         // onSnapshot(doc(db, 'users', uid))
  setCategoryRule(category: Category, rule: CategoryRule): Promise<void>;
  setDefaultStep(step: LadderStep): Promise<void>;
  setCloudFallback(on: boolean): Promise<void>;
  setDescribePhotos(on: boolean): Promise<void>;
  /** Registers or removes push (10.6). 'dismissed': the person closed the prompt; leave the box off silently (13.8.7). */
  setPushEnabled(on: boolean): Promise<'ok' | 'unsupported' | 'denied' | 'dismissed' | 'error'>;
  reset(): void;
}

const initial = (): Pick<SettingsState, 'status' | 'settings' | 'describePhotos' | 'saving'> => ({
  status: 'idle',
  settings: { ...DEFAULT_SETTINGS, categoryRules: { ...DEFAULT_SETTINGS.categoryRules } },
  describePhotos: true,
  saving: {},
});

function readDescribePhotos(uid: string): boolean {
  try {
    return window.localStorage.getItem(DESCRIBE_PHOTOS_KEY(uid)) !== '0';
  } catch {
    return true;
  }
}

let currentUid: string | undefined;
const savedTimers = new Map<SaveKey, ReturnType<typeof setTimeout>>();

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export const useSettings = create<SettingsState>()((set, get) => {
  const mark = (key: SaveKey, value: 'saving' | 'saved' | 'queued' | 'error' | undefined) => {
    clearTimeout(savedTimers.get(key));
    savedTimers.delete(key);
    set((s) => {
      const saving = { ...s.saving };
      if (value === undefined) delete saving[key];
      else saving[key] = value;
      return { saving };
    });
    if (value === 'saved') {
      savedTimers.set(key, setTimeout(() => {
        if (get().saving[key] === 'saved') mark(key, undefined);
      }, SAVED_MS));
    }
  };

  /** Optimistic write: update now, show saving (or queued offline), write the dot path, revert on failure. */
  async function write(key: SaveKey, path: `settings.${string}`, value: unknown, apply: (s: Settings) => Settings): Promise<void> {
    const uid = currentUid;
    if (!uid) return;
    const previous = get().settings;
    set({ settings: apply(previous) });
    mark(key, isOnline() ? 'saving' : 'queued');
    const onOnline = () => {
      if (get().saving[key] === 'queued') mark(key, 'saving');
    };
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline, { once: true });
    try {
      const { updateSetting } = await import('@/app/services/userDoc');
      await updateSetting(uid, path, value);
      if (currentUid === uid) mark(key, 'saved');
    } catch (error) {
      console.error('setting not saved', (error as { code?: string }).code ?? '');
      if (currentUid !== uid) return;
      set((s) => ({ settings: revert(s.settings, previous, key) }));
      mark(key, 'error');
      useToasts.getState().push({ tone: 'error', title: SETTINGS_SAVE.failed });
    } finally {
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    }
  }

  return {
    ...initial(),

    start(uid) {
      currentUid = uid;
      set({ status: 'loading', describePhotos: readDescribePhotos(uid) });
      let stop: (() => void) | null = null;
      let cancelled = false;
      void Promise.all([import('@/app/services/userDoc'), import('@/relay/resilient')])
        .then(([{ listenUserDoc }, { resilientSnapshot }]) => {
          if (cancelled) return;
          stop = resilientSnapshot('settings', (next, onError) =>
            listenUserDoc(
              uid,
              (d) => {
                next();
                if (currentUid !== uid) return;
                set({ status: 'ready', settings: d?.settings ?? initial().settings });
              },
              (e) => {
                if (get().status !== 'ready') set({ status: 'error' });
                onError(e);
              },
            ),
          );
        })
        .catch((error: unknown) => {
          console.error('settings listener', error);
          if (!cancelled) set({ status: 'error' });
        });
      return () => {
        cancelled = true;
        stop?.();
      };
    },

    setCategoryRule: (category, rule) =>
      write(`rule:${category}`, `settings.categoryRules.${category}`, rule, (s) => ({
        ...s,
        categoryRules: { ...s.categoryRules, [category]: rule },
      })),

    setDefaultStep: (step) => write('defaultStep', 'settings.defaultStep', step, (s) => ({ ...s, defaultStep: step })),

    setCloudFallback: (on) =>
      write('cloudFallbackForOwnData', 'settings.cloudFallbackForOwnData', on, (s) => ({ ...s, cloudFallbackForOwnData: on })),

    async setDescribePhotos(on) {
      set({ describePhotos: on });
      const uid = currentUid;
      if (!uid) return;
      try {
        window.localStorage.setItem(DESCRIBE_PHOTOS_KEY(uid), on ? '1' : '0');
        mark('describePhotos', 'saved');
      } catch {
        mark('describePhotos', 'error');
      }
    },

    async setPushEnabled(on) {
      const uid = currentUid;
      if (!uid) return 'error';
      // The permission prompt starts first, inside the click handler, before any await (40 section 10.6).
      const permission =
        on && typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function'
          ? Notification.requestPermission()
          : undefined;
      if (on && !permission) return 'unsupported';
      const previous = get().settings.pushEnabled;
      set((s) => ({ settings: { ...s.settings, pushEnabled: on } }));
      mark('pushEnabled', isOnline() ? 'saving' : 'queued');
      try {
        const push = await import('@/relay/push');
        if (on) {
          const result = await push.enablePush(uid, getDeviceId(), permission);
          if (result !== 'ok') {
            set((s) => ({ settings: { ...s.settings, pushEnabled: previous } }));
            mark('pushEnabled', result === 'error' ? 'error' : undefined);
            return result;
          }
        } else {
          await push.disablePush(uid, getDeviceId());
        }
        mark('pushEnabled', 'saved');
        return 'ok';
      } catch (error) {
        console.error('push setting', (error as { code?: string }).code ?? '');
        set((s) => ({ settings: { ...s.settings, pushEnabled: previous } }));
        mark('pushEnabled', 'error');
        return 'error';
      }
    },

    reset() {
      currentUid = undefined;
      for (const t of savedTimers.values()) clearTimeout(t);
      savedTimers.clear();
      set(initial());
    },
  };
});

function revert(current: Settings, previous: Settings, key: SaveKey): Settings {
  if (key.startsWith('rule:')) {
    const c = key.slice(5) as Category;
    return { ...current, categoryRules: { ...current.categoryRules, [c]: previous.categoryRules[c] } };
  }
  const k = key as 'defaultStep' | 'cloudFallbackForOwnData' | 'pushEnabled';
  return { ...current, [k]: previous[k] };
}

/** The uid the store writes for (test seam and the Google session). */
export function settingsUid(): string | undefined {
  return currentUid;
}
