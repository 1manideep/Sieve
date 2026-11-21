// startGoogleSession / stopGoogleSession wiring (40 section 6.5), with every service and the engine mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = {
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
  onUserDoc: vi.fn(),
  onDevices: vi.fn(),
  onSettings: vi.fn(),
  onBlocked: vi.fn(),
  resync: vi.fn(),
  makeThisHomeBase: vi.fn(),
  stopBeingHomeBase: vi.fn(),
  useThisTab: vi.fn(),
  toggleRelated: vi.fn(),
  allowCloudFor: vi.fn(),
  decide: vi.fn(),
  dismissDone: vi.fn(),
  role: () => 'not-home-base' as const,
};
const createHomeBaseEngine = vi.fn(() => engine);
vi.mock('@/relay/homeBaseEngine', () => ({ createHomeBaseEngine }));
vi.mock('@/relay/extensionBridge', () => ({ createExtensionBridge: vi.fn() }));
vi.mock('@/relay/homeBaseLock', () => ({ acquireHomeBaseLock: vi.fn(), locksSupported: () => true }));
const clockStop = vi.fn();
vi.mock('@/relay/presence', () => ({ startPresence: vi.fn() }));
vi.mock('@/robust/clock', () => ({ startServerClock: () => clockStop, serverNow: () => 1 }));
vi.mock('@/app/services/database', () => ({ rtdb: () => ({}) }));
vi.mock('@/relay/requests', () => ({}));
vi.mock('@/relay/push', () => ({ stopPushSession: vi.fn(), resumePush: vi.fn() }));
vi.mock('@/pipeline', () => ({ prepareProposal: vi.fn(), finalizeDecision: vi.fn(), buildRelatedOptions: vi.fn(), composeOutgoingText: vi.fn() }));
const startSources = vi.fn(async () => undefined);
const stopSources = vi.fn(async () => undefined);
vi.mock('@/sources', () => ({ startSources, stopSources }));
vi.mock('@/index', () => ({ openDb: () => ({ name: 'sieve' }), getRecord: vi.fn() }));
const navigate = vi.fn();
vi.mock('@/app/router', () => ({ router: { navigate } }));

const ensureUserDoc = vi.fn(async () => ({ isNew: true }));
const userDocUnsub = vi.fn();
const listenUserDoc = vi.fn((_uid: string, next: (d: unknown) => void) => {
  next({ settings: {}, homeBaseDeviceId: 'devX' });
  return userDocUnsub;
});
vi.mock('@/app/services/userDoc', () => ({ ensureUserDoc, listenUserDoc, updateSetting: vi.fn() }));
const blockedUnsub = vi.fn();
vi.mock('@/app/services/blocked', () => ({
  listenBlocked: vi.fn((_u: string, next: (b: unknown[]) => void) => {
    next([]);
    return blockedUnsub;
  }),
  blockedFor: vi.fn(),
}));
vi.mock('@/app/services/devices', () => ({ listenDevices: vi.fn(() => () => undefined), setHomeBase: vi.fn(), clearHomeBase: vi.fn() }));
vi.mock('@/app/services/itemRefs', () => ({ resolveItemRefs: vi.fn() }));
vi.mock('@/app/services/grants', () => ({ listenGrants: vi.fn(() => () => undefined), grantState: vi.fn() }));

const { startGoogleSession, stopGoogleSession, currentSession } = await import('./googleSession');
const { getHomeBaseEngine } = await import('@/state/homeBase');
const { useIndexing } = await import('@/state/indexing');

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  vi.spyOn(useIndexing.getState(), 'start').mockReturnValue(() => undefined);
});

describe('Google session', () => {
  it('ensures the user doc, starts the listeners and the engine, and sends a new user to setup', async () => {
    await startGoogleSession({ uid: 'u1', isAnonymous: false });
    expect(ensureUserDoc).toHaveBeenCalledWith('u1');
    expect(createHomeBaseEngine).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1', deviceId: expect.any(String) }));
    expect(engine.start).toHaveBeenCalled();
    expect(engine.onUserDoc).toHaveBeenCalledWith({ homeBaseDeviceId: 'devX' });
    expect(engine.onBlocked).toHaveBeenCalledWith([]);
    expect(getHomeBaseEngine()).toBe(engine);
    expect(currentSession()?.uid).toBe('u1');
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup'));
    await vi.waitFor(() => expect(startSources).toHaveBeenCalled());
  });

  it('stop reverses start, and stops the source jobs of the real index (sign-out here or in another tab)', async () => {
    await stopGoogleSession();
    expect(stopSources).toHaveBeenCalledWith({ name: 'sieve' });
    expect(engine.stop).toHaveBeenCalled();
    expect(getHomeBaseEngine()).toBeNull();
    expect(userDocUnsub).toHaveBeenCalled();
    expect(blockedUnsub).toHaveBeenCalled();
    expect(currentSession()).toBeNull();
  });

  it('a returning user with setup done stays where they are; the Playground never redirects', async () => {
    ensureUserDoc.mockResolvedValueOnce({ isNew: false });
    window.localStorage.setItem('sieve.setupDone.u2', '1');
    await startGoogleSession({ uid: 'u2', isAnonymous: false });
    await stopGoogleSession();
    window.history.replaceState(null, '', '/playground');
    await startGoogleSession({ uid: 'u3', isAnonymous: false });
    await stopGoogleSession();
    expect(navigate).not.toHaveBeenCalledWith('/setup');
  });
});
