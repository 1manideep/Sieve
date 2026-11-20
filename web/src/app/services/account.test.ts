// Delete my account (40 section 10.7, AT-30): the order of the steps, the re-authentication and the cancelled path.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_DELETE } from '@/copy/strings';

const order: string[] = [];
const user = { uid: 'u1', isAnonymous: false, email: 'm@example.com', getIdToken: vi.fn(async () => 't') };
vi.mock('@/app/firebase', () => ({ getAuthInstance: () => ({ currentUser: user }) }));
const reauthenticateWithPopup = vi.fn(async () => {
  order.push('reauth');
});
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  reauthenticateWithPopup,
  signOut: vi.fn(async () => {
    order.push('signOut');
  }),
}));
vi.mock('@/app/googleSession', () => ({
  stopGoogleSession: vi.fn(async () => {
    order.push('stop');
  }),
  startGoogleSession: vi.fn(async () => {
    order.push('restart');
  }),
}));
vi.mock('@/relay/presence', () => ({ removePresence: vi.fn(async () => void order.push('presence')) }));
vi.mock('@/relay/push', () => ({ disablePush: vi.fn(async () => void order.push('push')) }));
const deleteAccountCallable = vi.fn(async () => {
  order.push('deleteAccount');
  return { deleted: true as const };
});
vi.mock('./callables', () => ({ deleteAccountCallable }));
vi.mock('./itemRefs', () => ({ forgetLocalSalt: vi.fn(async () => void order.push('salt')) }));
vi.mock('@/index', () => ({ wipeDb: vi.fn(async () => void order.push('wipe')), openDb: vi.fn() }));
const navigate = vi.fn();
vi.mock('@/app/router', () => ({ router: { navigate } }));

const { deleteAccount } = await import('./account');
const { useSettings } = await import('@/state/settings');
const { useToasts } = await import('@/state/toasts');

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  useToasts.setState({ toasts: [] });
  useSettings.setState((s) => ({ settings: { ...s.settings, pushEnabled: true } }));
  window.localStorage.setItem('sieve.realDbOwner', 'u1');
  window.localStorage.setItem('sieve.setupDone.u1', '1');
});

describe('deleteAccount', () => {
  it('stops the home base, unregisters push, deletes the account, then clears this device', async () => {
    const steps: string[] = [];
    expect(await deleteAccount((s) => steps.push(s))).toBe('ok');
    expect(steps).toEqual(['stopping', 'push', 'account', 'device', 'done']);
    expect(order).toEqual(['stop', 'presence', 'push', 'deleteAccount', 'wipe', 'salt', 'signOut']);
    expect(window.localStorage.getItem('sieve.realDbOwner')).toBeNull();
    expect(window.localStorage.getItem('sieve.setupDone.u1')).toBeNull();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/welcome'));
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ tone: 'success', title: ACCOUNT_DELETE.done });
  });

  it('a stale sign-in re-authenticates once and retries', async () => {
    deleteAccountCallable.mockRejectedValueOnce(Object.assign(new Error('Sign in again, then delete your account.'), { code: 'failed-precondition' }));
    expect(await deleteAccount(() => undefined)).toBe('ok');
    expect(deleteAccountCallable).toHaveBeenCalledTimes(2);
    expect(order.indexOf('reauth')).toBeLessThan(order.indexOf('deleteAccount'));
  });

  it('a closed sign-in popup cancels: nothing local is wiped and the home base restarts', async () => {
    deleteAccountCallable.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'failed-precondition' }));
    reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
    expect(await deleteAccount(() => undefined)).toBe('cancelled');
    expect(order).not.toContain('wipe');
    expect(order).toContain('restart');
    expect(window.localStorage.getItem('sieve.realDbOwner')).toBe('u1');
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ title: ACCOUNT_DELETE.cancelled });
  });
});
