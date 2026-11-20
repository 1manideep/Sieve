// useSession (40 section 9.1, auth per section 6). Global store.
// The auth listener, whenAuthReady, Google and anonymous sign-in, sign-out, the index owner check (6.4) and the
// Google session (6.5): app/googleSession.ts is loaded with a dynamic import only once a Google user passes the check.
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { create } from 'zustand';
import { getAuthInstance } from '@/app/firebase';
import { getDeviceId } from '@/app/deviceId';
import { AUTH_ERRORS } from '@/copy/strings';
import { useAskReal } from './ask';
import { useGrants } from './grants';
import { useHomeBase } from './homeBase';
import { useReceipts } from './receipts';
import { useRecords } from './records';
import { useSettings } from './settings';
import { useToasts } from './toasts';

export interface SessionUser { uid: string; email?: string; displayName?: string; photoURL?: string; isAnonymous: boolean }
export interface SessionState {
  status: 'loading' | 'ready';
  kind: 'none' | 'anonymous' | 'google';
  user: SessionUser | null;
  deviceId: string;
  ownerConflict: boolean;                     // 6.4
  signingIn: boolean;
  signInWithGoogle(): Promise<'ok' | 'cancelled' | 'error'>;
  ensureAnonymous(): Promise<void>;           // starts the auth listener; signs in anonymously only when kind === 'none'; swallows errors
  signOut(): Promise<void>;
  resolveOwnerConflict(choice: 'clear' | 'sign-out'): Promise<void>;
}

function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    email: user.email ?? undefined,
    displayName: user.displayName ?? undefined,
    photoURL: user.photoURL ?? undefined,
    isAnonymous: user.isAnonymous,
  };
}

function kindOf(user: User | null): SessionState['kind'] {
  if (!user) return 'none';
  return user.isAnonymous ? 'anonymous' : 'google';
}

/** localStorage key holding the uid that built the real index (40 section 6.4). */
export const REAL_DB_OWNER_KEY = 'sieve.realDbOwner';

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(REAL_DB_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(uid: string): void {
  try {
    window.localStorage.setItem(REAL_DB_OWNER_KEY, uid);
  } catch {
    // This browser keeps nothing; the check simply passes next time too.
  }
}

/** 'ok' when the real index belongs to this uid (claiming it when nobody owns it yet). */
export function checkIndexOwner(uid: string): 'ok' | 'conflict' {
  const owner = readOwner();
  if (owner === null || owner === '') {
    writeOwner(uid);
    return 'ok';
  }
  return owner === uid ? 'ok' : 'conflict';
}

type GoogleSessionModule = typeof import('@/app/googleSession');
let sessionUid: string | null = null;
let chain: Promise<void> = Promise.resolve();

/** Start and stop run one after another, never interleaved (sign-in, sign-out and account switches). */
function enqueue(step: () => Promise<void>): Promise<void> {
  chain = chain.then(step).catch((error: unknown) => {
    console.error('Google session', error);
  });
  return chain;
}

function startSession(user: SessionUser): Promise<void> {
  return enqueue(async () => {
    if (sessionUid === user.uid) return;
    const m: GoogleSessionModule = await import('@/app/googleSession');
    sessionUid = user.uid;
    await m.startGoogleSession(user);
  });
}

function stopSession(): Promise<void> {
  return enqueue(async () => {
    if (sessionUid === null) return;
    sessionUid = null;
    const m: GoogleSessionModule = await import('@/app/googleSession');
    await m.stopGoogleSession();
  });
}

/** Test seam: wait for the session start or stop in flight. */
export function whenSessionSettled(): Promise<void> {
  return chain;
}

/** Google-scoped stores are cleared when the Google session ends (40 section 9). */
function resetGoogleScopedStores(): void {
  useSettings.getState().reset();
  useHomeBase.getState().reset();
  useReceipts.getState().reset();
  useGrants.getState().reset();
  useAskReal.getState().reset();
  useRecords.getState().clear();
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'loading',
  kind: 'none',
  user: null,
  deviceId: getDeviceId(),
  ownerConflict: false,
  signingIn: false,

  async signInWithGoogle() {
    set({ signingIn: true });
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(getAuthInstance(), provider);
      return 'ok';
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancelled';
      const { push } = useToasts.getState();
      if (code === 'auth/popup-blocked') push({ tone: 'error', title: AUTH_ERRORS.popupBlocked });
      else if (code === 'auth/network-request-failed') push({ tone: 'error', title: AUTH_ERRORS.network });
      else {
        push({ tone: 'error', title: AUTH_ERRORS.other });
        console.error(typeof code === 'string' ? code : 'sign-in failed');
      }
      return 'error';
    } finally {
      set({ signingIn: false });
    }
  },

  async ensureAnonymous() {
    try {
      // The auth listener first: a direct /playground load has no route loader to start it, and a persisted user
      // (Google or anonymous) is only known once the first callback has run. From then on `user` is populated.
      await whenAuthReady();
      if (get().kind !== 'none') return;
      const auth = getAuthInstance();
      if (auth.currentUser === null) await signInAnonymously(auth);
    } catch {
      // Non-blocking: the Playground works without a user (40 section 6.2).
    }
  },

  async signOut() {
    // The home base and every listener stop first (presence goes offline while still signed in), then the auth
    // listener resets the Google-scoped stores.
    await stopSession();
    await firebaseSignOut(getAuthInstance());
  },

  async resolveOwnerConflict(choice) {
    const user = get().user;
    if (choice === 'sign-out' || !user || get().kind !== 'google') {
      set({ ownerConflict: false });
      await get().signOut();
      return;
    }
    // "Clear it and continue": delete the real index, reopen it, claim it for this account, start the session.
    const index = (await import('@/index')) as typeof import('@/index') & { wipeDb?: (kind: 'real' | 'playground') => Promise<void> };
    if (typeof index.wipeDb === 'function') await index.wipeDb('real');
    else await (index.openDb('real') as unknown as { delete(): Promise<void> }).delete();
    index.openDb('real');
    writeOwner(user.uid);
    set({ ownerConflict: false });
    await startSession(user);
  },
}));

let authReady: Promise<void> | undefined;

/**
 * Resolves after the first onAuthStateChanged callback. Starts the auth listener on first use, so route loaders
 * (which run before the shell mounts) can await it.
 */
export function whenAuthReady(): Promise<void> {
  authReady ??= new Promise<void>((resolve) => {
    onAuthStateChanged(getAuthInstance(), (user) => {
      const before = useSession.getState();
      const kind = kindOf(user);
      const next = user ? toSessionUser(user) : null;
      const leaving = before.kind === 'google' && (kind !== 'google' || before.user?.uid !== next?.uid);
      useSession.setState({ status: 'ready', kind, user: next, ...(kind !== 'google' ? { ownerConflict: false } : {}) });
      if (leaving) {
        // Leaving google awaits stopGoogleSession() first; then the Google-scoped stores are cleared.
        void stopSession().then(resetGoogleScopedStores);
      }
      if (kind === 'google' && next && (leaving || before.kind !== 'google')) {
        if (checkIndexOwner(next.uid) === 'conflict') {
          // Nothing reads the real index and the session does not start until the check passes (6.4).
          useSession.setState({ ownerConflict: true });
        } else {
          useSession.setState({ ownerConflict: false });
          void startSession(next);
        }
      }
      resolve();
    });
  });
  return authReady;
}
