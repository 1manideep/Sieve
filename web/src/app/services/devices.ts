// users/{uid}/devices/{deviceId} (40 section 10.2, 30 section 13.4): { label, fcmToken?, isHomeBase, updatedAt }.
// The rules want label, isHomeBase and updatedAt (= request.time) in every write, so each write carries all three.
import {
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { defaultDeviceLabel, getDeviceId } from '@/app/deviceId';
import type { DeviceView } from '@/state/types';
import { firestore, millis } from './firestore';

function deviceRef(uid: string, deviceId: string) {
  return doc(firestore(), 'users', uid, 'devices', deviceId);
}

export function toDeviceView(id: string, data: DocumentData, thisDeviceId: string = getDeviceId()): DeviceView {
  return {
    id,
    label: typeof data.label === 'string' && data.label ? data.label : defaultDeviceLabel(),
    isHomeBase: data.isHomeBase === true,
    hasPush: typeof data.fcmToken === 'string' && data.fcmToken.length > 0,
    updatedAt: millis(data.updatedAt) ?? 0,
    isThisDevice: id === thisDeviceId,
  };
}

/** This device first, then the home base, then the most recently updated. */
function sortDevices(list: DeviceView[]): DeviceView[] {
  return [...list].sort(
    (a, b) =>
      Number(b.isThisDevice) - Number(a.isThisDevice) ||
      Number(b.isHomeBase) - Number(a.isHomeBase) ||
      b.updatedAt - a.updatedAt,
  );
}

export function listenDevices(
  uid: string,
  next: (d: DeviceView[]) => void,
  onError: (e: FirestoreError) => void = (e) => console.error('devices listener', e.code),
): Unsubscribe {
  return onSnapshot(
    collection(firestore(), 'users', uid, 'devices'),
    (snap) => next(sortDevices(snap.docs.map((d) => toDeviceView(d.id, d.data({ serverTimestamps: 'estimate' }))))),
    onError,
  );
}

/** One transaction: the previous home base device stops being it, this device becomes it, the user doc points here. */
export async function setHomeBase(uid: string, deviceId: string, label: string): Promise<void> {
  const db = firestore();
  const userRef = doc(db, 'users', uid);
  const mine = deviceRef(uid, deviceId);
  await runTransaction(db, async (tx) => {
    const user = await tx.get(userRef);
    const previousId = user.exists() ? (user.data().homeBaseDeviceId as unknown) : undefined;
    const previous =
      typeof previousId === 'string' && previousId && previousId !== deviceId ? deviceRef(uid, previousId) : undefined;
    const previousSnap = previous ? await tx.get(previous) : undefined;
    if (previous && previousSnap?.exists()) {
      const p = previousSnap.data();
      tx.set(previous, {
        label: typeof p.label === 'string' && p.label ? p.label : defaultDeviceLabel(),
        isHomeBase: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    tx.set(mine, { label, isHomeBase: true, updatedAt: serverTimestamp() }, { merge: true });
    if (user.exists()) tx.update(userRef, { homeBaseDeviceId: deviceId });
    else tx.set(userRef, { homeBaseDeviceId: deviceId }, { merge: true });
  });
}

/** One transaction: the user doc forgets this device as home base (only if it points here); the device row says so. */
export async function clearHomeBase(uid: string, deviceId: string): Promise<void> {
  const db = firestore();
  const userRef = doc(db, 'users', uid);
  const mine = deviceRef(uid, deviceId);
  await runTransaction(db, async (tx) => {
    const user = await tx.get(userRef);
    const device = await tx.get(mine);
    if (user.exists() && user.data().homeBaseDeviceId === deviceId) tx.update(userRef, { homeBaseDeviceId: deleteField() });
    if (device.exists()) {
      const d = device.data();
      tx.set(mine, {
        label: typeof d.label === 'string' && d.label ? d.label : defaultDeviceLabel(),
        isHomeBase: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  });
}

/** Writes (or removes) the push target of this device. `token` is the FID from onRegistered (01 section 11.5). */
export async function setDevicePush(uid: string, deviceId: string, token: string | null): Promise<void> {
  const ref = deviceRef(uid, deviceId);
  const snap = await getDoc(ref);
  if (!snap.exists() && token === null) return;
  const existing = snap.exists() ? snap.data() : {};
  await setDoc(ref, {
    fcmToken: token ?? deleteField(),
    updatedAt: serverTimestamp(),
    label: typeof existing.label === 'string' && existing.label ? existing.label : defaultDeviceLabel(),
    isHomeBase: existing.isHomeBase === true,
  }, { merge: true });
}
