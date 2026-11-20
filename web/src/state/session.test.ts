// ensureAnonymous (40 section 6.2): a direct /playground load has no route loader, so it starts the auth listener
// itself, then signs in anonymously only when the listener reported no user. One module instance; the tests run in
// order and drive the auth state through the callback the listener registered, as the SDK would.
import { describe, expect, it, vi } from 'vitest';
import type { FakeUser } from '@/test/fakes/firebaseAuth';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
const startGoogleSession = vi.fn(async () => undefined);
vi.mock('@/app/googleSession', () => ({ startGoogleSession, stopGoogleSession: vi.fn(async () => undefined) }));

const auth = await import('@/test/fakes/firebaseAuth');
const { useSession, whenSessionSettled } = await import('./session');

const anon: FakeUser = { uid: 'anon-7', email: null, displayName: null, photoURL: null, isAnonymous: true };
const mani: FakeUser = { uid: 'uid-mani', email: 'mani@example.com', displayName: 'Mani', photoURL: null, isAnonymous: false };

/** The callback the session registered with onAuthStateChanged, captured by the first test. */
let listener: ((user: FakeUser | null) => void) | undefined;

/** What the SDK does after a sign-in or sign-out: the listener hears the new user. */
function report(user: FakeUser | null): void {
  auth.setFakeAuthUser(user);
  listener?.(user);
}

const signIns = () => auth.signInAnonymously.mock.calls.length;

describe('ensureAnonymous', () => {
  it('starts the auth listener, then signs in anonymously when there is no user', async () => {
    auth.setFakeAuthUser(null);
    expect(useSession.getState().status).toBe('loading');
    auth.signInAnonymously.mockImplementationOnce(async () => {
      report(anon);
      return { user: anon };
    });
    const listeners = auth.onAuthStateChanged.mock.calls.length;
    const promise = useSession.getState().ensureAnonymous();
    expect(auth.onAuthStateChanged.mock.calls.length).toBe(listeners + 1);
    listener = auth.onAuthStateChanged.mock.calls[listeners]?.[1];
    await promise;
    expect(signIns()).toBe(1);
    expect(useSession.getState()).toMatchObject({ status: 'ready', kind: 'anonymous', user: { uid: 'anon-7', isAnonymous: true } });
  });

  it('does nothing while a user is signed in, and never starts a second listener', async () => {
    const before = signIns();
    const listeners = auth.onAuthStateChanged.mock.calls.length;
    await useSession.getState().ensureAnonymous();
    expect(signIns()).toBe(before);
    expect(auth.onAuthStateChanged.mock.calls.length).toBe(listeners);
  });

  it('never throws: a failed sign-in leaves the Playground usable without a user', async () => {
    report(null);
    expect(useSession.getState()).toMatchObject({ kind: 'none', user: null });
    const before = signIns();
    auth.signInAnonymously.mockRejectedValueOnce(new Error('auth/operation-not-allowed'));
    await expect(useSession.getState().ensureAnonymous()).resolves.toBeUndefined();
    expect(signIns()).toBe(before + 1);
    expect(useSession.getState()).toMatchObject({ status: 'ready', kind: 'none', user: null });
  });

  it('keeps a Google user and leaves the Google session to the listener', async () => {
    report(mani);
    await whenSessionSettled();
    expect(startGoogleSession).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-mani', isAnonymous: false }));
    const before = signIns();
    await useSession.getState().ensureAnonymous();
    expect(signIns()).toBe(before);
    expect(useSession.getState()).toMatchObject({ kind: 'google', user: { uid: 'uid-mani', isAnonymous: false } });
  });
});
