// Push: "A request is waiting" (40 section 10.6, 01 section 11.5).
// Push target decision: the Firebase Installation ID (FID). firebase 13.3.0 marks getToken/deleteToken deprecated in
// favour of register() + onRegistered() (FID), and firebase-admin 7.8.0 (functions) sends with
// MulticastMessage(fids=[...]) while `tokens` is deprecated. The FID is stored in devices/{deviceId}.fcmToken.
import {
  getMessaging,
  isSupported,
  onMessage,
  onRegistered,
  onUnregistered,
  register,
  unregister,
  type Messaging,
} from 'firebase/messaging';
import { getFirebaseApp } from '@/app/firebase';
import { requireEnv } from '@/app/env';
import { setDevicePush } from '@/app/services/devices';
import { updateSetting } from '@/app/services/userDoc';

export const SW_URL = '/firebase-messaging-sw.js';
export const SW_SCOPE = '/firebase-cloud-messaging-push-scope';

let messaging: Messaging | undefined;
let subscribed: { uid: string; deviceId: string; stop: () => void } | undefined;

function messagingInstance(): Messaging {
  messaging ??= getMessaging(getFirebaseApp());
  return messaging;
}

/** Keeps the FID in Firestore for the session: a new FID (or a pushsubscriptionchange) is written as it arrives. */
function subscribe(m: Messaging, uid: string, deviceId: string): void {
  if (subscribed && subscribed.uid === uid && subscribed.deviceId === deviceId) return;
  subscribed?.stop();
  const offRegistered = onRegistered(m, (fid) => {
    void setDevicePush(uid, deviceId, fid).catch((e: unknown) => console.error('push target', (e as { code?: string }).code ?? 'failed'));
  });
  const offUnregistered = onUnregistered(m, () => {
    void setDevicePush(uid, deviceId, null).catch(() => undefined);
  });
  // In-focus pages show nothing extra: the Firestore listener already shows the request.
  const offMessage = onMessage(m, () => undefined);
  subscribed = {
    uid,
    deviceId,
    stop: () => {
      offRegistered();
      offUnregistered();
      offMessage();
    },
  };
}

export async function pushSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

async function registerWorkerAndFid(uid: string, deviceId: string): Promise<void> {
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  const m = messagingInstance();
  subscribe(m, uid, deviceId);
  await register(m, { vapidKey: requireEnv('fcmVapidKey'), serviceWorkerRegistration: reg });
}

/**
 * Called from the Settings checkbox click. The permission prompt must come first, before any other await, so the
 * caller may pass the promise it started inside the click handler.
 */
export async function enablePush(
  uid: string,
  deviceId: string,
  permission?: Promise<NotificationPermission>,
): Promise<'ok' | 'unsupported' | 'denied' | 'dismissed' | 'error'> {
  let perm: NotificationPermission;
  try {
    perm = await (permission ?? Notification.requestPermission());
  } catch {
    return 'unsupported';
  }
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'dismissed';
  if (!(await pushSupported())) return 'unsupported';
  try {
    await registerWorkerAndFid(uid, deviceId);
    await updateSetting(uid, 'settings.pushEnabled', true);
    return 'ok';
  } catch (error) {
    console.error('enable push', (error as { code?: string; name?: string }).code ?? (error as { name?: string }).name ?? 'failed');
    return 'error';
  }
}

export async function disablePush(uid: string, deviceId: string): Promise<void> {
  try {
    if (await pushSupported()) await unregister(messagingInstance());
  } finally {
    subscribed?.stop();
    subscribed = undefined;
    await setDevicePush(uid, deviceId, null);
    await updateSetting(uid, 'settings.pushEnabled', false);
  }
}

/** Silent: when the session starts with pushEnabled and permission 'granted', repeat the registration. */
export async function resumePush(uid: string, deviceId: string): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!(await pushSupported())) return;
  try {
    await registerWorkerAndFid(uid, deviceId);
  } catch (error) {
    console.error('resume push', (error as { code?: string; name?: string }).code ?? 'failed');
  }
}

/** Sign out: stop writing FIDs for this account (the registration itself stays with the browser). */
export function stopPushSession(): void {
  subscribed?.stop();
  subscribed = undefined;
}
