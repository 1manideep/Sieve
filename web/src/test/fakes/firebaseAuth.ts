// Fake `firebase/auth` for component tests: vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth')).
import { vi } from 'vitest';

export interface FakeUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
}

let currentUser: FakeUser | null = null;
const fakeAuth = {
  get currentUser() {
    return currentUser;
  },
};

/** Sets the user the next onAuthStateChanged callback reports. */
export function setFakeAuthUser(user: FakeUser | null): void {
  currentUser = user;
}

export const googleUser: FakeUser = {
  uid: 'uid-mani',
  email: 'mani@example.com',
  displayName: 'Mani',
  photoURL: null,
  isAnonymous: false,
};

export const getAuth = vi.fn(() => fakeAuth);
export const connectAuthEmulator = vi.fn();
export const onAuthStateChanged = vi.fn((_auth: unknown, callback: (user: FakeUser | null) => void) => {
  queueMicrotask(() => callback(currentUser));
  return () => undefined;
});
/** The access token the fake popup's credential carries (the Gmail fallback reads it). */
export const FAKE_POPUP_ACCESS_TOKEN = 'ya29.fake-firebase-popup-token';

export class GoogleAuthProvider {
  scopes: string[] = [];
  customParameters: Record<string, string> = {};
  addScope(scope: string): this {
    this.scopes.push(scope);
    return this;
  }
  setCustomParameters(params: Record<string, string> = {}): this {
    this.customParameters = params;
    return this;
  }
  /** Reads the credential the fake popups put on their result. */
  static credentialFromResult(result: { credential?: { accessToken?: string } | null } | null): { accessToken?: string } | null {
    return result?.credential ?? null;
  }
}
export const signInWithPopup = vi.fn(async () => ({ user: currentUser }));
export const reauthenticateWithPopup = vi.fn(async (user: FakeUser | null, _provider?: GoogleAuthProvider) => ({
  user,
  credential: { accessToken: FAKE_POPUP_ACCESS_TOKEN },
}));
export const signInAnonymously = vi.fn(async () => ({ user: currentUser }));
export const signOut = vi.fn(async () => {
  currentUser = null;
});
