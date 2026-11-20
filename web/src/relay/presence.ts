// Home base presence in the Realtime Database (40 section 11.4, 01 section 4, 30 section 15.2).
// /presence/{uid}/{deviceId} = { state, isHomeBase, lastChanged }. The onDisconnect is registered before going
// online, and re-registered on every reconnect through .info/connected. Runs only while the role is 'active'.
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { rtdb } from '@/app/services/database';

export function startPresence(uid: string, deviceId: string, onState: (s: 'online' | 'offline') => void): { stop(): Promise<void> } {
  const db = rtdb();
  const me = ref(db, `presence/${uid}/${deviceId}`);
  let stopped = false;
  const off = onValue(ref(db, '.info/connected'), (snap) => {
    if (stopped) return;
    if (snap.val() !== true) {
      onState('offline');
      return;
    }
    void (async () => {
      try {
        await onDisconnect(me).set({ state: 'offline', isHomeBase: true, lastChanged: serverTimestamp() });
        if (stopped) return;
        await set(me, { state: 'online', isHomeBase: true, lastChanged: serverTimestamp() });
        if (!stopped) onState('online');
      } catch (error) {
        console.error('presence', (error as { code?: string }).code ?? 'failed');
        if (!stopped) onState('offline');
      }
    })();
  });
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      off();
      try {
        await onDisconnect(me).cancel();
        await set(me, { state: 'offline', isHomeBase: false, lastChanged: serverTimestamp() });
      } catch {
        // Offline or signed out: the server-side onDisconnect (if any) still marks this device offline.
      }
    },
  };
}

/** Delete my account (40 section 10.7): this device's presence node goes away. */
export async function removePresence(uid: string, deviceId: string): Promise<void> {
  await remove(ref(rtdb(), `presence/${uid}/${deviceId}`));
}

// Google's clock (70 section 3.4) lives in robust/clock.ts; app/googleSession.ts starts it next to the presence.
