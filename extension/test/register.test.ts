import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, ExtensionToPage } from '@sieve/shared';
import type { WorkerToPanel } from '../src/shared/internal';
import { ARRIVAL_SETTLE_MS } from '../src/sw/arrival';
import { register } from '../src/sw/register';
import { createFakeChrome, flush, pageSender, PAGE_SENDER } from './fakeChrome';
import type { FakeChrome, FakeChromeOptions, FakePort } from './fakeChrome';
import { DEPOSIT, LEASE, STATEMENT, hello, pending, resolved, withId } from './fixtures';

let fc: FakeChrome;

beforeEach(() => {
  vi.useFakeTimers();
  fc = createFakeChrome();
});

afterEach(() => {
  vi.useRealTimers();
  // storage.sync is never called and storage.local is never cleared; storage.local holds the settings key only,
  // and the worker only reads it (the popup's settings menu writes it).
  expect(fc.localCalls).toEqual([]);
  expect(fc.calls).not.toContain('storage.local.set');
  expect(Object.keys(fc.local).every((k) => k === 'settings')).toBe(true);
  const keys = Object.keys(fc.session);
  expect(keys.every((k) => k === 'announced')).toBe(true);
  const announced = fc.session.announced;
  if (announced !== undefined) {
    expect(Array.isArray(announced)).toBe(true);
    for (const id of announced as unknown[]) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  }
});

async function connectedPage(homeBase = true, sender = PAGE_SENDER): Promise<FakePort> {
  const page = fc.connectPage(sender);
  page.postMessage(hello(homeBase));
  await flush();
  return page;
}

function decisionsOn(port: FakePort): Decision[] {
  return port.ofType<Extract<ExtensionToPage, { type: 'sieve/decision' }>>('sieve/decision').map((m) => m.decision);
}

function lastState(panel: FakePort) {
  const states = panel.ofType<Extract<WorkerToPanel, { type: 'panel/state' }>>('panel/state');
  return states[states.length - 1]?.state;
}

describe('start', () => {
  it('sets the panel behaviour and badge colours, then the disconnected badge after the grace period', () => {
    register(fc.api);
    expect(fc.calls.slice(0, 3)).toEqual(['sidePanel.setPanelBehavior', 'action.setBadgeBackgroundColor', 'action.setBadgeTextColor']);
    // The icon opens the popup, so the side panel must not take the click (Chrome keeps the old setting otherwise).
    expect(fc.behaviors).toEqual([{ openPanelOnActionClick: false }]);
    expect(fc.badge).toMatchObject({ color: '#B91C1C', textColor: '#FFFFFF' });
    fc.badge.text = '3'; // left over from before a worker restart
    vi.advanceTimersByTime(1_999);
    expect(fc.badge.text).toBe('3');
    vi.advanceTimersByTime(1);
    expect(fc.badge).toMatchObject({ text: '', title: 'Sieve: open Sieve in a tab to receive requests' });
  });
});

describe('external ports', () => {
  it.each([
    ['wrong name', () => fc.connectPage(PAGE_SENDER, 'other-port')],
    ['wrong origin', () => fc.connectPage(pageSender({ origin: 'https://evil.example' }))],
    ['127.0.0.1 instead of localhost', () => fc.connectPage(pageSender({ origin: 'http://127.0.0.1:5173' }))],
    ['no origin', () => fc.connectPage(pageSender({ origin: undefined }))],
    ['frameId 1', () => fc.connectPage(pageSender({ frameId: 1 }))],
    ['no tab', () => fc.connectPage(pageSender({ tab: undefined }))],
  ])('rejects %s', (_name, connect) => {
    const reg = register(fc.api);
    const page = connect();
    expect(page.connected).toBe(false);
    expect(reg.hub.connCount()).toBe(0);
  });

  it('rejects the 9th connection', () => {
    const reg = register(fc.api);
    const ports = Array.from({ length: 8 }, (_, i) => fc.connectPage(pageSender({ tab: { id: 20 + i, windowId: 1 } })));
    expect(ports.every((p) => p.connected)).toBe(true);
    const ninth = fc.connectPage(pageSender({ tab: { id: 99, windowId: 1 } }));
    expect(ninth.connected).toBe(false);
    expect(reg.hub.connCount()).toBe(8);
  });

  it('disconnects a port without hello within 5 s', () => {
    const reg = register(fc.api);
    const page = fc.connectPage(PAGE_SENDER);
    page.postMessage(pending([DEPOSIT])); // ignored before hello
    vi.advanceTimersByTime(4_999);
    expect(page.connected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(page.connected).toBe(false);
    expect(reg.hub.connCount()).toBe(0);
  });

  it('keeps a port that said hello past 5 s', async () => {
    register(fc.api);
    const page = await connectedPage();
    vi.advanceTimersByTime(10_000);
    expect(page.connected).toBe(true);
  });

  it('disconnects after 5 invalid messages and ignores them meanwhile', async () => {
    const reg = register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    for (let i = 0; i < 4; i++) page.postMessage({ type: 'sieve/pending', version: 2, proposals: [] });
    expect(page.connected).toBe(true);
    expect(reg.view().proposals).toHaveLength(1);
    page.postMessage(pending([withId(DEPOSIT, 'x', { options: [] })]));
    expect(page.connected).toBe(false);
    expect(reg.view().proposals).toHaveLength(0);
  });
});

describe('hello and hello-ack', () => {
  it('replies with the manifest version and the open-sieve binding', async () => {
    fc = createFakeChrome({ version: '0.1.7', shortcut: '⌃⇧S' });
    register(fc.api);
    const page = await connectedPage();
    expect(page.received).toEqual([{ type: 'sieve/hello-ack', version: 1, extensionVersion: '0.1.7', shortcut: '⌃⇧S' }]);
  });

  it("sends '' when the shortcut is unset, and omits it when commands.getAll fails", async () => {
    fc = createFakeChrome({ shortcut: '' });
    register(fc.api);
    expect((await connectedPage()).received[0]).toEqual({ type: 'sieve/hello-ack', version: 1, extensionVersion: '0.1.0', shortcut: '' });
    fc = createFakeChrome({ shortcut: null });
    register(fc.api);
    expect((await connectedPage()).received[0]).toEqual({ type: 'sieve/hello-ack', version: 1, extensionVersion: '0.1.0' });
  });
});

describe('badge', () => {
  it('follows the waiting count (50 section 7.6)', async () => {
    register(fc.api);
    const page = await connectedPage();
    expect(fc.badge).toMatchObject({ text: '', title: 'Sieve: no requests waiting' });
    page.postMessage(pending([DEPOSIT]));
    expect(fc.badge).toMatchObject({ text: '1', title: 'Sieve: 1 request waiting' });
    page.postMessage(pending([DEPOSIT, LEASE, withId(DEPOSIT, 'nm', { outcome: 'no-match' })]));
    expect(fc.badge).toMatchObject({ text: '2', title: 'Sieve: 2 requests waiting' });
    page.postMessage(resolved(DEPOSIT.requestId, 'approved'));
    expect(fc.badge.text).toBe('1');
    page.disconnect();
    expect(fc.badge).toMatchObject({ text: '', title: 'Sieve: open Sieve in a tab to receive requests' });
  });
});

describe('notifications', () => {
  it('creates one notification per new actionable id, naming the assistant only', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT, withId(LEASE, 'nm', { outcome: 'no-match' })]));
    await flush();
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${DEPOSIT.requestId}`]);
    const n = fc.notifications.get(`sieve-req-${DEPOSIT.requestId}`);
    expect(n).toEqual({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'A request is waiting',
      message: 'Test assistant is asking for something. Review it in Sieve.',
      priority: 0,
      requireInteraction: false,
    });
    expect(JSON.stringify(n)).not.toContain('deposit');
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.calls.filter((c) => c === 'notifications.create')).toHaveLength(1);
  });

  it('cuts a long assistant name to 40 characters', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([withId(DEPOSIT, 'long', { requester: { kind: 'outside', grantId: 'g', aiName: 'A'.repeat(80) } })]));
    await flush();
    expect(fc.notifications.get('sieve-req-long')?.message).toBe(`${'A'.repeat(40)} is asking for something. Review it in Sieve.`);
  });

  it('names each request after the link it came through, never a name from an earlier request', async () => {
    register(fc.api);
    const page = await connectedPage();
    const fromClaude = withId(DEPOSIT, 'via-claude', { requester: { kind: 'outside', grantId: 'grant-claude', aiName: 'Claude' } });
    const fromGemini = withId(LEASE, 'via-gemini', { requester: { kind: 'outside', grantId: 'grant-gemini', aiName: 'Gemini' } });
    page.postMessage(pending([fromClaude]));
    await flush();
    page.postMessage(pending([fromClaude, fromGemini]));
    await flush();
    expect(fc.notifications.get('sieve-req-via-claude')?.message).toBe('Claude is asking for something. Review it in Sieve.');
    expect(fc.notifications.get('sieve-req-via-gemini')?.message).toBe('Gemini is asking for something. Review it in Sieve.');
    // The same link used from another assistant keeps the link's name: the extension shows what the request carries.
    const reused = withId(STATEMENT, 'claude-link-in-gemini', { requester: { kind: 'outside', grantId: 'grant-claude', aiName: 'Claude' } });
    page.postMessage(pending([fromClaude, fromGemini, reused]));
    await flush();
    expect(fc.notifications.get('sieve-req-claude-link-in-gemini')?.message).toBe('Claude is asking for something. Review it in Sieve.');
    page.postMessage(resolved('via-gemini', 'declined'));
    const panel = fc.connectPanel();
    const st = lastState(panel);
    expect(st?.proposals.map((p) => (p.requester.kind === 'outside' ? p.requester.aiName : ''))).toEqual(['Claude', 'Claude']);
    expect(st?.resolved.map((r) => [r.requestId, r.aiName])).toEqual([['via-gemini', 'Gemini']]);
  });

  it('creates none while a panel is visible, and does not announce the id later', async () => {
    register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 1 });
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.notifications.size).toBe(0);
    panel.postMessage({ type: 'panel/visibility', visible: false });
    page.postMessage(pending([DEPOSIT, LEASE]));
    await flush();
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${LEASE.requestId}`]);
  });

  it('does not re-announce ids after a worker restart with the same storage.session', async () => {
    register(fc.api);
    let page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.session.announced).toEqual([DEPOSIT.requestId]);
    fc.notifications.clear();
    const session = fc.session;
    fc = createFakeChrome({ session }); // a new worker: fresh globals, same session storage
    register(fc.api);
    page = await connectedPage();
    page.postMessage(pending([DEPOSIT, LEASE]));
    await flush();
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${LEASE.requestId}`]);
    expect(fc.session.announced).toEqual([DEPOSIT.requestId, LEASE.requestId]);
  });

  it('clears the notification on resolved and on removal from the list', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT, LEASE]));
    await flush();
    expect(fc.notifications.size).toBe(2);
    page.postMessage(resolved(DEPOSIT.requestId, 'approved'));
    await flush();
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${LEASE.requestId}`]);
    page.postMessage(pending([]));
    await flush();
    expect(fc.notifications.size).toBe(0);
  });

  it('a click opens the popup in the owner window, synchronously', async () => {
    register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 7 } }));
    page.postMessage(pending([DEPOSIT]));
    await flush();
    fc.calls.length = 0;
    fc.raw.notifications.onClicked.emit(`sieve-req-${DEPOSIT.requestId}`);
    expect(fc.calls[0]).toBe('action.openPopup');
    expect(fc.popups).toEqual([{ windowId: 7 }]);
    await flush();
    expect(fc.opened).toEqual([]);
    expect(fc.notifications.size).toBe(0);
    expect(fc.tabUpdates).toEqual([]);
  });

  it('a click falls back to the side panel when openPopup rejects', async () => {
    fc = createFakeChrome({ openPopup: 'rejects' });
    register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 7 } }));
    page.postMessage(pending([DEPOSIT]));
    await flush();
    fc.raw.notifications.onClicked.emit(`sieve-req-${DEPOSIT.requestId}`);
    await flush();
    expect(fc.popups).toEqual([{ windowId: 7 }]);
    expect(fc.opened).toEqual([{ windowId: 7 }]);
    expect(fc.tabUpdates).toEqual([]);
  });

  it('without openPopup (Chrome before 127), a click opens the side panel synchronously', async () => {
    fc = createFakeChrome({ openPopup: 'missing' });
    register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 7 } }));
    page.postMessage(pending([DEPOSIT]));
    await flush();
    fc.calls.length = 0;
    fc.raw.notifications.onClicked.emit(`sieve-req-${DEPOSIT.requestId}`);
    expect(fc.calls[0]).toBe('sidePanel.open');
    expect(fc.opened).toEqual([{ windowId: 7 }]);
  });

  it('a click falls back to focusing the Sieve tab when the popup and the side panel both fail', async () => {
    fc = createFakeChrome({ openPopup: 'rejects', sidePanelOpenRejects: true });
    register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 7 } }));
    page.postMessage(pending([DEPOSIT]));
    await flush();
    fc.raw.notifications.onClicked.emit(`sieve-req-${DEPOSIT.requestId}`);
    await flush();
    expect(fc.tabUpdates).toEqual([{ tabId: 11, props: { active: true } }]);
    expect(fc.windowUpdates).toEqual([{ windowId: 7, props: { focused: true } }]);
    expect(page.ofType('sieve/open-app')).toEqual([{ type: 'sieve/open-app', version: 1, requestId: DEPOSIT.requestId }]);
  });

  it('ignores clicks on notifications that are not Sieve requests', () => {
    register(fc.api);
    fc.raw.notifications.onClicked.emit('something-else');
    expect(fc.opened).toEqual([]);
    expect(fc.popups).toEqual([]);
  });
});

describe('opening the popup when a request arrives (50 section 7.7)', () => {
  const FOCUSED = { id: 3, focused: true };

  it('opens the popup once in the last focused normal window, instead of a notification', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.lastFocusedQueries).toEqual([{ windowTypes: ['normal'] }]);
    expect(fc.popups).toEqual([{ windowId: 3 }]);
    expect(fc.notifications.size).toBe(0);
    expect(fc.badge).toMatchObject({ text: '1', title: 'Sieve: 1 request waiting' }); // the badge counts it as before
    expect(fc.session.announced).toEqual([DEPOSIT.requestId]);
    expect(fc.opened).toEqual([]);
  });

  it('opens once when several requests arrive together, in one list or back to back', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT, LEASE]));
    page.postMessage(pending([DEPOSIT, LEASE, STATEMENT])); // before the popup has said hello
    await flush();
    expect(fc.popups).toEqual([{ windowId: 3 }]);
    expect(fc.notifications.size).toBe(0);
    expect(fc.session.announced).toEqual([DEPOSIT.requestId, LEASE.requestId, STATEMENT.requestId]);
  });

  it('does not open again for a request the person closed, even after a worker restart', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    let page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toHaveLength(1);
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 3, surface: 'popup' });
    popup.disconnect(); // the person closed it without deciding
    vi.advanceTimersByTime(ARRIVAL_SETTLE_MS + 1_000);
    page.postMessage(pending([DEPOSIT])); // the page repeats its list
    page.disconnect(); // the tab reloads, so the same request is added again
    page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toHaveLength(1);
    expect(fc.notifications.size).toBe(0);
    // A new worker with the same storage.session: still not again. A new request opens it once more.
    const { session } = fc;
    fc = createFakeChrome({ lastFocused: FOCUSED, session });
    register(fc.api);
    page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toEqual([]);
    page.postMessage(pending([DEPOSIT, LEASE]));
    await flush();
    expect(fc.popups).toEqual([{ windowId: 3 }]);
    expect(fc.notifications.size).toBe(0);
  });

  it('after the popup closes, the next new request opens it again; while it shows, nothing else happens', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 3, surface: 'popup' });
    page.postMessage(pending([DEPOSIT, LEASE])); // listed in the open popup
    await flush();
    expect(fc.popups).toHaveLength(1);
    expect(fc.notifications.size).toBe(0);
    popup.disconnect(); // closed at once: its hello ended the settle wait, so nothing is hidden
    page.postMessage(pending([DEPOSIT, LEASE, STATEMENT]));
    await flush();
    expect(fc.popups).toEqual([{ windowId: 3 }, { windowId: 3 }]);
    expect(fc.notifications.size).toBe(0);
  });

  it('a popup that never says hello stops counting as shown after the settle wait', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    vi.advanceTimersByTime(ARRIVAL_SETTLE_MS - 1);
    page.postMessage(pending([DEPOSIT, LEASE])); // still coming up: counts as shown
    await flush();
    expect(fc.popups).toHaveLength(1);
    expect(fc.notifications.size).toBe(0);
    vi.advanceTimersByTime(1);
    page.postMessage(pending([DEPOSIT, LEASE, STATEMENT]));
    await flush();
    expect(fc.popups).toHaveLength(2);
  });

  it('respects the setting: off means only the badge and the notification', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED, local: { settings: { openOnArrival: false } } });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.calls).toContain('storage.local.get');
    expect(fc.calls).not.toContain('windows.getLastFocused');
    expect(fc.popups).toEqual([]);
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${DEPOSIT.requestId}`]);
    expect(fc.badge.text).toBe('1');
  });

  it('reads the setting at each arrival, so a change applies to the next request', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED, local: { settings: { openOnArrival: false } } });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toEqual([]);
    fc.local.settings = { openOnArrival: true }; // the popup's switch wrote it
    page.postMessage(pending([DEPOSIT, LEASE]));
    await flush();
    expect(fc.popups).toEqual([{ windowId: 3 }]);
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${DEPOSIT.requestId}`]);
  });

  it('a stored value that is not a boolean counts as the default, on', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED, local: { settings: { openOnArrival: 'no' } } });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toEqual([{ windowId: 3 }]);
  });

  it.each<[string, FakeChromeOptions, number]>([
    ['openPopup rejects (a popup already open, or Chrome refuses)', { openPopup: 'rejects', lastFocused: FOCUSED }, 1],
    ['no Chrome window has focus (the person is in another app)', { lastFocused: { id: 3, focused: false } }, 0],
    ['there is no normal window', { lastFocused: null }, 0],
    ['Chrome before 127 has no openPopup', { openPopup: 'missing', lastFocused: FOCUSED }, 0],
  ])('falls back to the badge and the notification when %s, and never opens the side panel', async (_name, opts, tries) => {
    fc = createFakeChrome(opts);
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toHaveLength(tries);
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${DEPOSIT.requestId}`]);
    expect(fc.badge.text).toBe('1');
    // No gesture here: Chrome would refuse sidePanel.open, so the worker never calls it on arrival.
    expect(fc.opened).toEqual([]);
    expect(fc.calls).not.toContain('sidePanel.open');
  });

  it('neither opens nor notifies while a panel is visible', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 3, surface: 'panel' });
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    await flush();
    expect(fc.popups).toEqual([]);
    expect(fc.notifications.size).toBe(0);
    expect(fc.calls).not.toContain('windows.getLastFocused');
  });

  it('a request answered while the popup was being tried gets no notification', async () => {
    fc = createFakeChrome({ openPopup: 'rejects', lastFocused: FOCUSED });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT, LEASE]));
    page.postMessage(resolved(DEPOSIT.requestId, 'approved')); // answered in the app meanwhile
    await flush();
    expect([...fc.notifications.keys()]).toEqual([`sieve-req-${LEASE.requestId}`]);
  });

  it('does not open for a request that needs nothing from the person here', async () => {
    fc = createFakeChrome({ lastFocused: FOCUSED });
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([withId(DEPOSIT, 'nm', { outcome: 'no-match' }), withId(DEPOSIT, 'blk', { outcome: 'blocked-never' })]));
    await flush();
    expect(fc.popups).toEqual([]);
    expect(fc.notifications.size).toBe(0);
  });
});

describe('decisions', () => {
  it('posts the decision only to the owner port', async () => {
    register(fc.api);
    const a = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 1 } }));
    const b = await connectedPage(false, pageSender({ tab: { id: 12, windowId: 1 } }));
    a.postMessage(pending([DEPOSIT]));
    b.postMessage(pending([LEASE]));
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: true, step: 'excerpt' });
    panel.postMessage({ type: 'panel/decide', requestId: LEASE.requestId, approved: false });
    expect(decisionsOn(a)).toEqual([
      { requestId: DEPOSIT.requestId, approved: true, step: 'excerpt', itemIds: [], decidedBy: 'extension', decidedAt: Date.now() },
    ]);
    const [deny] = decisionsOn(b);
    expect(deny).toEqual({ requestId: LEASE.requestId, approved: false, itemIds: [], decidedBy: 'extension', decidedAt: Date.now() });
    expect(deny && 'step' in deny).toBe(false);
    expect(a.ofType('sieve/decision')).toHaveLength(1);
  });

  it('rejects a bad step back to the panel that asked, and sends nothing to the page', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([LEASE]));
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/decide', requestId: LEASE.requestId, approved: true, step: 'full' });
    expect(panel.ofType('panel/decide-rejected')).toEqual([{ type: 'panel/decide-rejected', requestId: LEASE.requestId, reason: 'step-unavailable' }]);
    expect(decisionsOn(page)).toEqual([]);
  });

  it('marks a decision slow after 15 s without resolved', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: true, step: 'answer' });
    expect(lastState(panel)?.inflight).toEqual([{ requestId: DEPOSIT.requestId, approved: true, step: 'answer', sentAt: Date.now(), slow: false }]);
    expect(fc.badge.text).toBe(''); // in flight: not actionable
    vi.advanceTimersByTime(15_000);
    expect(lastState(panel)?.inflight[0]?.slow).toBe(true);
  });

  it('resolved after a decision shows the result and clears the in-flight entry', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: true, step: 'excerpt' });
    page.postMessage(resolved(DEPOSIT.requestId, 'approved'));
    page.postMessage(pending([]));
    const st = lastState(panel);
    expect(st?.inflight).toEqual([]);
    expect(st?.resolved[0]).toMatchObject({ requestId: DEPOSIT.requestId, outcome: 'approved', step: 'excerpt', decidedHere: true });
    vi.advanceTimersByTime(20_000);
    expect(lastState(panel)?.resolved[0]?.outcome).toBe('approved');
  });

  it('a page that closes mid-decision leaves a lost result', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: true, step: 'answer' });
    page.disconnect();
    const st = lastState(panel);
    expect(st?.resolved[0]).toMatchObject({ requestId: DEPOSIT.requestId, outcome: 'lost' });
    expect(st?.connection).toBe('disconnected');
  });
});

describe('panel ports', () => {
  it('posts the current state at once and after every change', async () => {
    register(fc.api);
    const panel = fc.connectPanel();
    expect(lastState(panel)?.connection).toBe('connecting');
    const page = await connectedPage();
    page.postMessage(pending([STATEMENT]));
    expect(lastState(panel)).toMatchObject({ connection: 'connected', proposals: [STATEMENT] });
  });

  it.each([
    ['wrong name', { id: 'ackgioeokfkdnehjoaoeldnpgodhljcc', url: 'chrome-extension://ackgioeokfkdnehjoaoeldnpgodhljcc/sidepanel/index.html' }, 'x'],
    ['another extension', { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/sidepanel/index.html' }, 'sieve-panel'],
    ['another page of this extension', { id: 'ackgioeokfkdnehjoaoeldnpgodhljcc', url: 'chrome-extension://ackgioeokfkdnehjoaoeldnpgodhljcc/other.html' }, 'sieve-panel'],
  ])('rejects %s', (_name, sender, name) => {
    register(fc.api);
    const panel = fc.connectPanel(sender, name);
    expect(panel.connected).toBe(false);
    expect(panel.received).toEqual([]);
  });

  it('open-app without a connection opens the signed-in home, APP_URL + /ask', async () => {
    register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/open-app' });
    await flush();
    expect(fc.created).toEqual([{ url: 'http://localhost:5173/ask' }]);
  });

  it('open-app for a request, with its tab gone, opens APP_URL + /requests', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    page.postMessage(resolved(DEPOSIT.requestId, 'declined'));
    page.disconnect();
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/open-app', requestId: DEPOSIT.requestId }); // "Open the receipt"
    await flush();
    expect(fc.created).toEqual([{ url: 'http://localhost:5173/requests' }]);
  });

  it('open-app focuses the owner tab and tells the page which request', async () => {
    register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 31, windowId: 4 } }));
    page.postMessage(pending([DEPOSIT]));
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/open-app', requestId: DEPOSIT.requestId });
    await flush();
    expect(fc.tabUpdates).toEqual([{ tabId: 31, props: { active: true } }]);
    expect(fc.windowUpdates).toEqual([{ windowId: 4, props: { focused: true } }]);
    expect(fc.created).toEqual([]);
    expect(page.ofType('sieve/open-app')).toEqual([{ type: 'sieve/open-app', version: 1, requestId: DEPOSIT.requestId }]);
  });

  it('dismiss removes a resolved entry from the state', async () => {
    register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    page.postMessage(resolved(DEPOSIT.requestId, 'declined'));
    const panel = fc.connectPanel();
    expect(lastState(panel)?.resolved).toHaveLength(1);
    panel.postMessage({ type: 'panel/dismiss', requestId: DEPOSIT.requestId });
    expect(lastState(panel)?.resolved).toEqual([]);
  });
});

describe('the open-sieve shortcut (50 section 8.9)', () => {
  it('opens the popup with action.openPopup, synchronously, before any other API call', () => {
    register(fc.api);
    fc.calls.length = 0;
    fc.raw.commands.onCommand.emit('open-sieve', { windowId: 5 });
    // Nothing was awaited: the call happened inside the same task as the gesture.
    expect(fc.calls).toEqual(['action.openPopup']);
    expect(fc.popups).toEqual([{ windowId: 5 }]);
    expect(fc.opened).toEqual([]);
  });

  it('falls back to the side panel when openPopup rejects', async () => {
    fc = createFakeChrome({ openPopup: 'rejects' });
    const reg = register(fc.api);
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('popup');
    await flush();
    expect(fc.popups).toEqual([{ windowId: 5 }]);
    expect(fc.opened).toEqual([{ windowId: 5 }]);
  });

  it('without openPopup (Chrome before 127), calls sidePanel.open synchronously, before any other API call', () => {
    fc = createFakeChrome({ openPopup: 'missing' });
    register(fc.api);
    fc.calls.length = 0;
    fc.raw.commands.onCommand.emit('open-sieve', { windowId: 5 });
    expect(fc.calls).toEqual(['sidePanel.open']);
    expect(fc.opened).toEqual([{ windowId: 5 }]);
  });

  it('closes the popup open in that window, and a second press opens it again', () => {
    const reg = register(fc.api);
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 5, surface: 'popup' });
    fc.calls.length = 0;
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('close');
    expect(popup.ofType('panel/close')).toEqual([{ type: 'panel/close' }]);
    expect(fc.calls).toEqual([]); // the popup closes itself; the side panel is not touched
    popup.disconnect(); // window.close(): the port goes with the page
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('popup');
    expect(fc.popups).toEqual([{ windowId: 5 }]);
  });

  it('closes the side panel open in that window, and opens the popup in a window without one', () => {
    fc = createFakeChrome({ withSidePanelClose: true });
    const reg = register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 5, surface: 'panel' });
    fc.calls.length = 0;
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('close');
    expect(panel.ofType('panel/close')).toEqual([{ type: 'panel/close' }]);
    expect(fc.closed).toEqual([{ windowId: 5 }]);
    expect(fc.calls).toEqual(['sidePanel.close']);
    expect(reg.handleCommand('open-sieve', { windowId: 6 })).toBe('popup');
    expect(fc.popups).toEqual([{ windowId: 6 }]);
    panel.disconnect(); // the panel closed itself
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('popup');
    expect(fc.popups).toEqual([{ windowId: 6 }, { windowId: 5 }]);
    expect(fc.opened).toEqual([]);
  });

  it('a hello without a surface counts as the side panel', () => {
    fc = createFakeChrome({ openPopup: 'missing' });
    const reg = register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 8 });
    expect(reg.panelViews()).toEqual([{ surface: 'panel', visible: true, windowId: 8 }]);
    expect(reg.handleCommand('open-sieve', { windowId: 8 })).toBe('close');
  });

  it('closes the popup first when a popup and the side panel share the window', () => {
    const reg = register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 5, surface: 'panel' });
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 5, surface: 'popup' });
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('close');
    expect(popup.ofType('panel/close')).toHaveLength(1);
    expect(panel.ofType('panel/close')).toHaveLength(0);
  });

  it('without sidePanel.close, only the panel/close message closes it', () => {
    const reg = register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 2 });
    expect(reg.handleCommand('open-sieve', { windowId: 2 })).toBe('close');
    expect(panel.ofType('panel/close')).toHaveLength(1);
    expect(fc.closed).toEqual([]);
  });

  it('ignores other commands and a command without a window', () => {
    const reg = register(fc.api);
    expect(reg.handleCommand('something', { windowId: 1 })).toBe('ignored');
    expect(reg.handleCommand('open-sieve', undefined)).toBe('ignored');
    expect(fc.opened).toEqual([]);
    expect(fc.popups).toEqual([]);
  });
});

describe('the popup', () => {
  it('panel/open-side opens the side panel in the popup window, then closes the popup', async () => {
    const reg = register(fc.api);
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 4, surface: 'popup' });
    expect(reg.panelViews()).toEqual([{ surface: 'popup', visible: true, windowId: 4 }]);
    popup.postMessage({ type: 'panel/open-side' });
    await flush();
    expect(fc.opened).toEqual([{ windowId: 4 }]);
    expect(popup.ofType('panel/close')).toEqual([{ type: 'panel/close' }]);
  });

  it('panel/open-side keeps the popup open when Chrome refuses, and does nothing before the window is known', async () => {
    fc = createFakeChrome({ sidePanelOpenRejects: true });
    register(fc.api);
    const early = fc.connectPanel();
    early.postMessage({ type: 'panel/open-side' }); // no hello yet: no window
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 4, surface: 'popup' });
    popup.postMessage({ type: 'panel/open-side' });
    await flush();
    expect(fc.opened).toEqual([{ windowId: 4 }]);
    expect(popup.ofType('panel/close')).toEqual([]);
    expect(early.ofType('panel/close')).toEqual([]);
  });

  it('opening and closing it 50 times leaves no port behind and no extra state in the hub', async () => {
    const reg = register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 3 } }));
    page.postMessage(pending([DEPOSIT]));
    await flush();
    const before = reg.view();
    const notified = fc.calls.filter((c) => c === 'notifications.create').length;
    for (let i = 0; i < 50; i++) {
      const popup = fc.connectPanel();
      popup.postMessage({ type: 'panel/hello', visible: true, windowId: 3, surface: 'popup' });
      expect(lastState(popup)?.proposals).toEqual([DEPOSIT]); // every popup gets the current state at once
      expect(reg.panelViews()).toHaveLength(1);
      popup.disconnect(); // the popup lost focus and closed
      expect(reg.panelViews()).toEqual([]);
    }
    expect(reg.hub.connCount()).toBe(1);
    expect(reg.view()).toEqual(before);
    // Nothing is posted to a closed popup, and with none open a new request notifies again.
    page.postMessage(pending([DEPOSIT, LEASE]));
    await flush();
    expect(fc.calls.filter((c) => c === 'notifications.create').length).toBe(notified + 1);
    expect([...fc.notifications.keys()]).toContain(`sieve-req-${LEASE.requestId}`);
  });

  it('a decision from a popup that closes at once still reaches the page, and the next popup sees the result', async () => {
    const reg = register(fc.api);
    const page = await connectedPage();
    page.postMessage(pending([DEPOSIT]));
    const popup = fc.connectPanel();
    popup.postMessage({ type: 'panel/hello', visible: true, windowId: 1, surface: 'popup' });
    popup.postMessage({ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: true, step: 'answer' });
    popup.disconnect();
    expect(decisionsOn(page)).toHaveLength(1);
    page.postMessage(resolved(DEPOSIT.requestId, 'approved'));
    page.postMessage(pending([]));
    const next = fc.connectPanel();
    const st = lastState(next);
    expect(st?.resolved).toHaveLength(1);
    expect(st?.resolved[0]).toMatchObject({ requestId: DEPOSIT.requestId, outcome: 'approved', step: 'answer', decidedHere: true });
    expect(st?.inflight).toEqual([]);
    expect(reg.panelViews()).toEqual([{ surface: 'panel', visible: false }]); // connected, no hello yet
  });
});
