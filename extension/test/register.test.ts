import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, ExtensionToPage } from '@sieve/shared';
import type { WorkerToPanel } from '../src/shared/internal';
import { register } from '../src/sw/register';
import { createFakeChrome, flush, pageSender, PAGE_SENDER } from './fakeChrome';
import type { FakeChrome, FakePort } from './fakeChrome';
import { DEPOSIT, LEASE, STATEMENT, hello, pending, resolved, withId } from './fixtures';

let fc: FakeChrome;

beforeEach(() => {
  vi.useFakeTimers();
  fc = createFakeChrome();
});

afterEach(() => {
  vi.useRealTimers();
  expect(fc.localCalls).toEqual([]); // storage.local and storage.sync are never called
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

  it('a click opens the side panel in the owner window, synchronously', async () => {
    register(fc.api);
    const page = await connectedPage(true, pageSender({ tab: { id: 11, windowId: 7 } }));
    page.postMessage(pending([DEPOSIT]));
    await flush();
    fc.calls.length = 0;
    fc.raw.notifications.onClicked.emit(`sieve-req-${DEPOSIT.requestId}`);
    expect(fc.calls[0]).toBe('sidePanel.open');
    expect(fc.opened).toEqual([{ windowId: 7 }]);
    await flush();
    expect(fc.notifications.size).toBe(0);
    expect(fc.tabUpdates).toEqual([]);
  });

  it('a click falls back to focusing the Sieve tab when sidePanel.open rejects', async () => {
    fc = createFakeChrome({ sidePanelOpenRejects: true });
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

  it('open-app without a connection opens APP_URL + /requests', async () => {
    register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/open-app' });
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
  it('calls sidePanel.open synchronously, before any other API call', () => {
    register(fc.api);
    fc.calls.length = 0;
    fc.raw.commands.onCommand.emit('open-sieve', { windowId: 5 });
    // Nothing was awaited: the call happened inside the same task as the gesture.
    expect(fc.calls).toEqual(['sidePanel.open']);
    expect(fc.opened).toEqual([{ windowId: 5 }]);
  });

  it('closes the panel open in that window, and opens one in a window without a panel', () => {
    fc = createFakeChrome({ withSidePanelClose: true });
    const reg = register(fc.api);
    const panel = fc.connectPanel();
    panel.postMessage({ type: 'panel/hello', visible: true, windowId: 5 });
    fc.calls.length = 0;
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('close');
    expect(panel.ofType('panel/close')).toEqual([{ type: 'panel/close' }]);
    expect(fc.closed).toEqual([{ windowId: 5 }]);
    expect(fc.calls).toEqual(['sidePanel.close']);
    expect(reg.handleCommand('open-sieve', { windowId: 6 })).toBe('open');
    expect(fc.opened).toEqual([{ windowId: 6 }]);
    panel.disconnect(); // the panel closed itself
    expect(reg.handleCommand('open-sieve', { windowId: 5 })).toBe('open');
    expect(fc.opened).toEqual([{ windowId: 6 }, { windowId: 5 }]);
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
  });
});
