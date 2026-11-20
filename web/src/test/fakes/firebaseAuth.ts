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
export class GoogleAuthProvider {
  setCustomParameters(): void {}
}
export const signInWithPopup = vi.fn(async () => ({ user: currentUser }));
export const signInAnonymously = vi.fn(async () => ({ user: currentUser }));
export const signOut = vi.fn(async () => {
  currentUser = null;
});
