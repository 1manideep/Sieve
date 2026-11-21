import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_BASE } from '@/copy/strings';
import { IN_FRONT_TAG, showInFrontNotice } from './inFrontNotice';

/** A stand-in for the browser's Notification: records what was shown. */
function fakeNotification(permission: NotificationPermission) {
  const shown: FakeNotification[] = [];
  const requestPermission = vi.fn();
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      readonly title: string,
      readonly options: NotificationOptions,
    ) {
      shown.push(this);
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return { shown, requestPermission };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('showInFrontNotice', () => {
  it('shows one tagged notification, and a click brings this tab to the front', () => {
    const { shown } = fakeNotification('granted');
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    showInFrontNotice('Gemini CLI', true);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe(HOME_BASE.inFrontTitle);
    expect(shown[0]?.options).toMatchObject({ body: HOME_BASE.inFrontBody('Gemini CLI'), tag: IN_FRONT_TAG });
    shown[0]?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(shown[0]?.close).toHaveBeenCalled();
  });

  it('never asks for permission, and shows nothing when notifications are off or not allowed', () => {
    for (const permission of ['default', 'denied'] as const) {
      const { shown, requestPermission } = fakeNotification(permission);
      showInFrontNotice('Gemini CLI', true);
      expect(shown).toHaveLength(0);
      expect(requestPermission).not.toHaveBeenCalled();
    }
    const { shown } = fakeNotification('granted');
    showInFrontNotice('Gemini CLI', false);
    expect(shown).toHaveLength(0);
  });

  it('says nothing and does not throw where the page cannot show notifications', () => {
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Blocked() {
          throw new TypeError('Illegal constructor');
        },
        { permission: 'granted' },
      ),
    );
    expect(() => showInFrontNotice('Gemini CLI', true)).not.toThrow();
  });
});
