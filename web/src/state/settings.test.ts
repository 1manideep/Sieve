import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_SAVE } from '@/copy/strings';

type Next = (d: { settings: unknown; homeBaseDeviceId?: string } | null) => void;
let snapshot: Next | undefined;
const updateSetting = vi.fn(async (_uid: string, _path: string, _value: unknown) => undefined);
const listenUserDoc = vi.fn((_uid: string, next: Next) => {
  snapshot = next;
  return () => undefined;
});
vi.mock('@/app/services/userDoc', () => ({ updateSetting, listenUserDoc }));

const enablePush = vi.fn(async () => 'ok' as const);
const disablePush = vi.fn(async () => undefined);
vi.mock('@/relay/push', () => ({ enablePush, disablePush }));

const { useSettings, DEFAULT_SETTINGS, SAVED_MS } = await import('./settings');
const { useToasts } = await import('./toasts');

async function started() {
  useSettings.getState().reset();
  useSettings.getState().start('u1');
  await vi.waitFor(() => expect(listenUserDoc).toHaveBeenCalled());
  snapshot?.({ settings: DEFAULT_SETTINGS });
}

function setOnline(on: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe('useSettings', () => {
  it('reads the first snapshot', async () => {
    await started();
    expect(useSettings.getState().status).toBe('ready');
    expect(useSettings.getState().settings.categoryRules.Health).toBe('never');
  });

  it('updates optimistically, writes the dot path, then says Saved for 2 s', async () => {
    await started();
    vi.useFakeTimers();
    let resolveWrite: () => void = () => undefined;
    updateSetting.mockImplementationOnce(() => new Promise<undefined>((r) => (resolveWrite = () => r(undefined))));
    const p = useSettings.getState().setCategoryRule('Money', 'never');
    expect(useSettings.getState().settings.categoryRules.Money).toBe('never');
    expect(useSettings.getState().saving['rule:Money']).toBe('saving');
    await vi.waitFor(() => expect(updateSetting).toHaveBeenCalledWith('u1', 'settings.categoryRules.Money', 'never'));
    resolveWrite();
    await p;
    expect(useSettings.getState().saving['rule:Money']).toBe('saved');
    vi.advanceTimersByTime(SAVED_MS);
    expect(useSettings.getState().saving['rule:Money']).toBeUndefined();
  });

  it('reverts on failure, marks error and toasts', async () => {
    await started();
    updateSetting.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await useSettings.getState().setDefaultStep('full');
    expect(useSettings.getState().settings.defaultStep).toBe('answer');
    expect(useSettings.getState().saving.defaultStep).toBe('error');
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ tone: 'error', title: SETTINGS_SAVE.failed });
  });

  it('is queued while offline and saves on reconnect', async () => {
    await started();
    setOnline(false);
    let resolveWrite: () => void = () => undefined;
    updateSetting.mockImplementationOnce(() => new Promise<undefined>((r) => (resolveWrite = () => r(undefined))));
    const p = useSettings.getState().setCloudFallback(true);
    expect(useSettings.getState().settings.cloudFallbackForOwnData).toBe(true);
    expect(useSettings.getState().saving.cloudFallbackForOwnData).toBe('queued');
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(useSettings.getState().saving.cloudFallbackForOwnData).toBe('saving');
    await vi.waitFor(() => expect(updateSetting).toHaveBeenCalled());
    resolveWrite();
    await p;
    expect(useSettings.getState().saving.cloudFallbackForOwnData).toBe('saved');
  });

  it('"Describe photos with Gemini Nano": on by default, kept on this device per account, never written to users/{uid}', async () => {
    window.localStorage.removeItem('sieve.describePhotos.u1');
    await started();
    expect(useSettings.getState().describePhotos).toBe(true);
    await useSettings.getState().setDescribePhotos(false);
    expect(useSettings.getState()).toMatchObject({ describePhotos: false, saving: { describePhotos: 'saved' } });
    expect(window.localStorage.getItem('sieve.describePhotos.u1')).toBe('0');
    expect(updateSetting).not.toHaveBeenCalled();
    await started();                                                    // a new session reads it back
    expect(useSettings.getState().describePhotos).toBe(false);
    useSettings.getState().reset();
    expect(useSettings.getState().describePhotos).toBe(true);
    window.localStorage.removeItem('sieve.describePhotos.u1');
  });

  it('push: maps the results, and a refused permission leaves it off', async () => {
    await started();
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: vi.fn(async () => 'granted'), permission: 'default' } });
    expect(await useSettings.getState().setPushEnabled(true)).toBe('ok');
    expect(enablePush).toHaveBeenCalledWith('u1', expect.any(String), expect.any(Promise));
    enablePush.mockResolvedValueOnce('denied' as never);
    useSettings.setState((s) => ({ settings: { ...s.settings, pushEnabled: false } }));
    expect(await useSettings.getState().setPushEnabled(true)).toBe('denied');
    expect(useSettings.getState().settings.pushEnabled).toBe(false);
    expect(await useSettings.getState().setPushEnabled(false)).toBe('ok');
    expect(disablePush).toHaveBeenCalled();
  });
});
