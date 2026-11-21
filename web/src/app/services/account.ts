// Delete my account (40 section 10.7, 30 section 13.2). The order keeps a cancelled sign-in from wiping the index for
// nothing. The account itself is deleted by 30's `deleteAccount` callable, which first revokes every connector link
// (connectors are keyed by link hash, so the Delete User Data extension cannot find them) and needs a sign-in within
// the last 5 minutes; a 'failed-precondition' answer re-authenticates with a popup and retries once.
import { GoogleAuthProvider, reauthenticateWithPopup, signOut } from 'firebase/auth';
import { getAuthInstance } from '@/app/firebase';
import { getDeviceId } from '@/app/deviceId';
import { ACCOUNT_DELETE, SHELL } from '@/copy/strings';
import { AUTO_APPROVE_KEY, AUTO_APPROVED_KEY } from '@/state/autoApprove';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { SessionUser } from '@/state/session';
import { deleteAccountCallable, type CallableError } from './callables';
import { forgetLocalSalt } from './itemRefs';

export type DeleteStep = 'stopping' | 'push' | 'account' | 'device' | 'done';

const CANCELLED_CODES = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];

function navigate(to: string): void {
  void import('@/app/router').then(({ router }) => router.navigate(to)).catch(() => undefined);
}

function removeLocalKeys(uid: string): void {
  for (const key of ['sieve.realDbOwner', `sieve.setupDone.${uid}`, AUTO_APPROVE_KEY(uid), AUTO_APPROVED_KEY(uid)]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // nothing kept
    }
  }
}

async function deleteRealIndex(): Promise<void> {
  const index = (await import('@/index')) as typeof import('@/index') & { wipeDb?: (kind: 'real' | 'playground') => Promise<void> };
  if (typeof index.wipeDb === 'function') await index.wipeDb('real');
  else await (index.openDb('real') as unknown as { delete(): Promise<void> }).delete();
}

/** Google is told to revoke the Gmail token (bounded offline), before the index that holds it is deleted. */
async function revokeGmail(): Promise<void> {
  try {
    const [sources, index] = await Promise.all([import('@/sources'), import('@/index')]);
    await sources.revokeGmailAccess(index.openDb('real'));
  } catch {
    // the token still runs out within the hour, and the index that held it is deleted next
  }
}

export async function deleteAccount(onStep: (s: DeleteStep) => void): Promise<'ok' | 'cancelled' | 'error'> {
  const auth = getAuthInstance();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return 'error';
  const uid = user.uid;
  const deviceId = getDeviceId();
  const session = await import('@/app/googleSession');
  const sessionUser: SessionUser = {
    uid,
    isAnonymous: false,
    ...(user.email ? { email: user.email } : {}),
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.photoURL ? { photoURL: user.photoURL } : {}),
  };

  // 1. Stop the home base and this device's presence.
  onStep('stopping');
  await session.stopGoogleSession();
  try {
    const { removePresence } = await import('@/relay/presence');
    await removePresence(uid, deviceId);
  } catch {
    // offline: the server removes presence/{uid} with the account
  }

  // 2. Push.
  onStep('push');
  if (useSettings.getState().settings.pushEnabled) {
    try {
      const { disablePush } = await import('@/relay/push');
      await disablePush(uid, deviceId);
    } catch {
      // errors ignored (40 section 10.7)
    }
  }

  // 3. The account (server side).
  onStep('account');
  try {
    try {
      await deleteAccountCallable();
    } catch (error) {
      if ((error as CallableError).code !== 'failed-precondition') throw error;
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await reauthenticateWithPopup(user, provider);
      await user.getIdToken(true);
      await deleteAccountCallable();
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    await session.startGoogleSession(sessionUser).catch(() => undefined);
    if (typeof code === 'string' && CANCELLED_CODES.includes(code)) {
      useToasts.getState().push({ tone: 'info', title: ACCOUNT_DELETE.cancelled });
      return 'cancelled';
    }
    console.error('delete account', typeof code === 'string' ? code : 'failed');
    useToasts.getState().push({ tone: 'error', title: ACCOUNT_DELETE.failed });
    return 'error';
  }

  // 4. This device: the real index, its owner and setup keys, and the local salt for item refs.
  onStep('device');
  await revokeGmail();
  try {
    await deleteRealIndex();
  } catch (error) {
    // Another tab keeps the index open: the delete finishes once it is closed.
    if ((error as { name?: unknown } | null)?.name === 'DbBlockedError') useToasts.getState().push({ tone: 'error', title: SHELL.deleteIndexBlocked });
    else console.error('delete index', error);
  }
  removeLocalKeys(uid);
  await forgetLocalSalt(uid).catch(() => undefined);
  await signOut(auth).catch(() => undefined);

  // 5. Done.
  onStep('done');
  navigate('/');
  useToasts.getState().push({ tone: 'success', title: ACCOUNT_DELETE.done });
  return 'ok';
}
