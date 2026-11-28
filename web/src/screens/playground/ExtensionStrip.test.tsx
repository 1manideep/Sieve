// The Playground's extension strip (50 section 11, 60 section 7.2) in every state, with axe and the exact copy.
// The bridge is faked: a page bridge over a scripted factory, and a test-request module wired to it.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EXTENSION_ZIP_URL, zipLinkLabel } from '@/components/ExtensionInstall/ExtensionInstall';
import { PLAYGROUND_COPY } from '@/copy/screens-main';
import { EXTENSION_INSTALL, TEST_REQUEST } from '@/copy/screens-controls';
import type { BridgeHandlers, ExtensionBridge } from '@/relay/extensionBridge';
import { createPlaygroundBridge } from '@/relay/playgroundBridge';
import { createTestRequests } from '@/relay/testRequest';
import { useAnnouncer } from '@/state/announcer';
import type { ExtensionStatus } from '@/state/homeBase';
import { expectNoAxeViolations } from '@/test/axe';
import { ExtensionStrip, extensionLine } from './ExtensionStrip';

/** A Playground bridge whose port is a fake the test drives through the handlers it was built with. */
function faked() {
  const requests = createTestRequests({ now: () => 1_000, newId: () => 'one', setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => undefined });
  let handlers: BridgeHandlers | undefined;
  const port = { start: vi.fn(), stop: vi.fn(), sendPending: vi.fn(), sendResolved: vi.fn() } satisfies ExtensionBridge;
  const bridge = createPlaygroundBridge(
    requests.wrapMakeBridge((h) => {
      handlers = h;
      port.start.mockImplementation(() => h.onStatus('connecting'));
      port.stop.mockImplementation(() => h.onStatus('idle'));
      return port;
    }),
  );
  const report = (s: ExtensionStatus) => act(() => handlers?.onStatus(s));
  return { requests, bridge, port, report, handlers: () => handlers as BridgeHandlers };
}

function renderStrip(f: ReturnType<typeof faked>) {
  return render(
    <MemoryRouter>
      <main>
        <ExtensionStrip bridge={f.bridge} requests={f.requests} />
      </main>
    </MemoryRouter>,
  );
}

const strip = () => screen.queryByTestId('extension-strip');
const button = () => screen.getByRole('button', { name: TEST_REQUEST.button });
const download = () => screen.queryByRole('link', { name: zipLinkLabel() });
const howTo = () => screen.getByRole('button', { name: EXTENSION_INSTALL.howTo });

afterEach(() => {
  useAnnouncer.setState({ polite: '', assertive: '' });
});

describe('ExtensionStrip', () => {
  it('renders nothing while the extension is off (no VITE_EXTENSION_ID)', () => {
    const bridge = createPlaygroundBridge(null);
    render(<MemoryRouter><ExtensionStrip bridge={bridge} /></MemoryRouter>);
    bridge.start();
    expect(strip()).not.toBeInTheDocument();
    expect(extensionLine('off')).toBeNull();
  });

  it('connecting: the state, the quick-start lead, the button disabled', async () => {
    const f = faked();
    renderStrip(f);
    act(() => void f.bridge.start());
    expect(screen.getByText(PLAYGROUND_COPY.extensionConnecting)).toBeInTheDocument();
    expect(screen.getByText(PLAYGROUND_COPY.extensionLead)).toBeInTheDocument();
    expect(button()).toBeDisabled();
    expect(download()).toHaveAttribute('href', EXTENSION_ZIP_URL);
    expect(howTo()).toHaveAttribute('aria-expanded', 'false');   // folded until the state is known
    await expectNoAxeViolations();
  });

  it('not installed: the state, the zip to download with the steps open, the button disabled', async () => {
    const f = faked();
    renderStrip(f);
    act(() => void f.bridge.start());
    f.report('not-installed');
    expect(screen.getByText(PLAYGROUND_COPY.extensionNotInstalled)).toBeInTheDocument();
    expect(download()).toHaveAttribute('href', '/downloads/sieve-extension-0.0.0-test.zip');
    expect(download()).toHaveAttribute('download');
    expect(howTo()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(EXTENSION_INSTALL.step1)).toBeVisible();
    expect(button()).toBeDisabled();
    await expectNoAxeViolations();
  });

  it('connected: the button sends one test request through the tab\'s port and says where to look', async () => {
    const user = userEvent.setup();
    const f = faked();
    renderStrip(f);
    act(() => void f.bridge.start());
    f.report('connected');
    expect(screen.getByText(PLAYGROUND_COPY.extensionConnected)).toBeInTheDocument();
    expect(download()).toBeInTheDocument();
    expect(howTo()).toHaveAttribute('aria-expanded', 'false');   // installed: the steps stay folded
    expect(button()).toBeEnabled();
    await user.click(button());
    expect(f.port.sendPending).toHaveBeenCalledTimes(1);
    expect(f.handlers().getPending().map((p) => [p.requestId, p.requester.aiName])).toEqual([['test-one', 'Test']]);
    expect(screen.getByText(TEST_REQUEST.sent)).toBeInTheDocument();
    await expectNoAxeViolations();

    act(() => f.handlers().onDecision({ requestId: 'test-one', approved: true, step: 'answer', decidedBy: 'extension' }));
    expect(screen.getByText('The side panel answered: approved')).toBeInTheDocument();
    expect(f.port.sendResolved).toHaveBeenCalledWith('test-one', 'approved');
    await expectNoAxeViolations();
  });

  it('reconnecting: the state, the button disabled; then gone when the port closes', async () => {
    const f = faked();
    renderStrip(f);
    let stop: () => void = () => undefined;
    act(() => {
      stop = f.bridge.start();
    });
    f.report('connected');
    f.report('reconnecting');
    expect(screen.getByText(PLAYGROUND_COPY.extensionReconnecting)).toBeInTheDocument();
    expect(button()).toBeDisabled();
    await expectNoAxeViolations();
    act(() => stop());
    expect(f.port.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(PLAYGROUND_COPY.extensionConnecting)).toBeInTheDocument();   // 'idle': the port is closed, nothing to send to
    expect(button()).toBeDisabled();
  });
});
