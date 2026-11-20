// "Send a test request to the extension" (50 sections 11 and 13.3) in every state, with axe: disabled until the
// extension is connected, sent, answered (approved and declined), expired, and unavailable.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProposalPreview } from '@sieve/shared';
import { TEST_REQUEST, fillText } from '@/copy/screens-controls';
import type { BridgeHandlers, ExtensionBridge } from '@/relay/extensionBridge';
import { createTestRequests, type TestRequests } from '@/relay/testRequest';
import { useAnnouncer } from '@/state/announcer';
import type { ExtensionStatus } from '@/state/homeBase';
import { expectNoAxeViolations } from '@/test/axe';
import { TestRequestButton } from './TestRequestButton';

/** A module instance wired to a fake bridge, with the 2-minute timer held so a test can fire it. */
function wired(status: ExtensionStatus = 'connected') {
  let expire: (() => void) | undefined;
  const requests = createTestRequests({
    now: () => 1_000,
    newId: () => 'one',
    setTimer: (fn) => {
      expire = fn;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => undefined,
  });
  const bridge = { start: vi.fn(), stop: vi.fn(), sendPending: vi.fn(), sendResolved: vi.fn() } satisfies ExtensionBridge;
  let handlers: BridgeHandlers | undefined;
  requests.wrapMakeBridge((h) => {
    handlers = h;
    return bridge;
  })({ onDecision: vi.fn(), onOpenApp: vi.fn(), onStatus: vi.fn(), getPending: () => [] });
  const h = handlers as BridgeHandlers;
  h.onStatus(status);
  return { requests, bridge, handlers: h, expire: () => expire?.() };
}

function renderButton(status: ExtensionStatus, requests: TestRequests) {
  return render(
    <main>
      <TestRequestButton status={status} requests={requests} />
    </main>,
  );
}

const button = () => screen.getByRole('button', { name: TEST_REQUEST.button });

afterEach(() => {
  useAnnouncer.setState({ polite: '', assertive: '' });
});

describe('TestRequestButton', () => {
  it.each(['not-installed', 'connecting', 'reconnecting', 'idle'] as const)('is disabled while the extension is %s', async (status) => {
    const { requests } = wired(status);
    renderButton(status, requests);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(TEST_REQUEST.note);
    expect(screen.queryByText(TEST_REQUEST.sent)).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('sends one made-up request through the bridge and says where to look', async () => {
    const user = userEvent.setup();
    const { requests, bridge, handlers } = wired();
    renderButton('connected', requests);
    expect(button()).toBeEnabled();
    await user.click(button());
    expect(bridge.sendPending).toHaveBeenCalledTimes(1);
    const list: ProposalPreview[] = handlers.getPending();
    expect(list.map((p) => [p.requestId, p.requester.aiName, p.outcome])).toEqual([['test-one', 'Test', 'ready']]);
    expect(screen.getByText(TEST_REQUEST.sent)).toBeInTheDocument();
    await waitFor(() => expect(useAnnouncer.getState().polite).toBe(TEST_REQUEST.sent));
    await expectNoAxeViolations();
  });

  it.each([
    [true, TEST_REQUEST.approved],
    [false, TEST_REQUEST.declined],
  ] as const)('shows what the side panel answered (approved %s)', async (approved, word) => {
    const user = userEvent.setup();
    const { requests, bridge, handlers } = wired();
    renderButton('connected', requests);
    await user.click(button());
    act(() => {
      handlers.onDecision({ requestId: 'test-one', approved, ...(approved ? { step: 'answer' as const } : {}), decidedBy: 'extension' });
    });
    const line = fillText(TEST_REQUEST.answered, { answer: word });
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByText(TEST_REQUEST.sent)).not.toBeInTheDocument();
    expect(bridge.sendResolved).toHaveBeenCalledWith('test-one', approved ? 'approved' : 'declined');
    expect(handlers.getPending()).toEqual([]);
    await waitFor(() => expect(useAnnouncer.getState().polite).toBe(line));
    await expectNoAxeViolations();
  });

  it('says the test request was removed after 2 minutes without an answer', async () => {
    const user = userEvent.setup();
    const { requests, bridge, handlers, expire } = wired();
    renderButton('connected', requests);
    await user.click(button());
    act(() => expire());
    expect(screen.getByText(TEST_REQUEST.expired)).toBeInTheDocument();
    expect(bridge.sendResolved).toHaveBeenCalledWith('test-one', 'expired');
    expect(handlers.getPending()).toEqual([]);
    expect(button()).toBeEnabled();
    await expectNoAxeViolations();
  });

  it('explains when no bridge could carry the request', async () => {
    const user = userEvent.setup();
    renderButton('connected', createTestRequests());
    await user.click(button());
    expect(screen.getByText(TEST_REQUEST.unavailable)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('does not announce the line that was already there when the screen opened', async () => {
    const { requests } = wired();
    requests.send();
    renderButton('connected', requests);
    expect(screen.getByText(TEST_REQUEST.sent)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(useAnnouncer.getState().polite).not.toBe(TEST_REQUEST.sent);
  });
});
