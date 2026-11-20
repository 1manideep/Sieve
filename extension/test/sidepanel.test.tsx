// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProposalPreview } from '@sieve/shared';
import type { PanelState, WorkerToPanel } from '../src/shared/internal';
import { approveOnlyIfAsked } from '../src/shared/labels';
import { App, CONNECTING_DELAY_MS } from '../src/sidepanel/App';
import type { PanelApi } from '../src/sidepanel/usePanelPort';
import { portPair } from './fakeChrome';
import type { FakePort } from './fakeChrome';
import {
  DEPOSIT,
  DEPOSIT_ANSWER,
  DEPOSIT_EXCERPT,
  DEPOSIT_FULL,
  LEASE,
  LEASE_EXCERPT,
  STATEMENT,
  option,
  panelState,
  resolvedEntry,
  withId,
} from './fixtures';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const box: { worker: FakePort | null } = { worker: null };
  const sent: unknown[] = [];
  const closePanel = vi.fn();
  const api: PanelApi = {
    runtime: {
      connect: ({ name }) => {
        const { near, far } = portPair(name, {});
        box.worker = far;
        far.onMessage.addListener((m) => sent.push(m));
        return near as unknown as chrome.runtime.Port;
      },
    },
    getWindowId: () => Promise.resolve(7),
    closePanel,
  };
  const utils = render(<App api={api} />);
  const post = (msg: WorkerToPanel) =>
    act(() => {
      box.worker?.postMessage(msg);
    });
  const push = (state: PanelState) => post({ type: 'panel/state', state });
  const decisions = () => sent.filter((m) => (m as { type: string }).type === 'panel/decide');
  return { ...utils, api, box, sent, closePanel, post, push, decisions };
}

async function expectNoAxeViolations() {
  const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const card = () => screen.getByRole('article');
const outgoing = () => screen.getByTestId('outgoing-text');
const radio = (name: string) => screen.getByRole('radio', { name });

describe('states', () => {
  it('shows nothing for 1.5 s, then the connecting state', async () => {
    vi.useFakeTimers();
    setup();
    expect(screen.queryByText('Connecting to your Sieve tab…')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(CONNECTING_DELAY_MS);
    });
    expect(screen.getByText('Connecting to your Sieve tab…')).toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    vi.useRealTimers();
    await expectNoAxeViolations();
  });

  it('connecting state from the worker', async () => {
    const t = setup();
    t.push(panelState({ connection: 'connecting' }));
    expect(screen.getByText('Connecting to your Sieve tab…')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('disconnected: heading, body and Open Sieve', async () => {
    const t = setup();
    t.push(panelState({ connection: 'disconnected' }));
    expect(screen.getByRole('heading', { name: "Sieve isn't open" })).toBeInTheDocument();
    expect(
      screen.getByText('Requests reach this panel from your Sieve tab on this computer. Open Sieve in a tab and keep it open.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Home base offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Sieve' }));
    expect(t.sent).toContainEqual({ type: 'panel/open-app' });
    await expectNoAxeViolations();
  });

  it('empty: no requests waiting', async () => {
    const t = setup();
    t.push(panelState());
    expect(screen.getByRole('heading', { name: 'No requests waiting' })).toBeInTheDocument();
    expect(
      screen.getByText('When an AI assistant you connected asks Sieve for something, it shows up here for you to approve.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Home base online')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a Playground tab only shows "Sieve tab open"', () => {
    const t = setup();
    t.push(panelState({ connection: 'not-home-base' }));
    expect(screen.getByText('Sieve tab open')).toBeInTheDocument();
  });
});

describe('request card', () => {
  it('shows the request, the item and the exact answer text', async () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    const c = card();
    expect(within(c).getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument();
    expect(within(c).getByText((_, el) => el?.tagName === 'P' && el.textContent === `Test assistant asked for: "${DEPOSIT.question}"`)).toBeInTheDocument();
    expect(within(c).getByText('Re: Deposit for the apartment')).toBeInTheDocument();
    expect(within(c).getByText('Oct 29 · Home · found on this device')).toBeInTheDocument();
    expect(within(c).getByText('How much to share')).toBeInTheDocument();
    expect(within(c).getByText('Exactly what will be sent')).toBeInTheDocument();
    expect(outgoing().textContent).toBe(DEPOSIT_ANSWER);
    expect(within(c).getByText(`${DEPOSIT_ANSWER.length} characters`)).toBeInTheDocument();
    expect(radio('Answer only')).toHaveAttribute('aria-checked', 'true');
    expect(within(c).getByText('No hidden instructions flagged on this device')).toBeInTheDocument();
    // 70 R-MCP-09: the social-engineering line sits above the decision buttons, the name isolated for bidi text
    const line = within(c).getByText((_, el) => el?.tagName === 'P' && el.textContent === approveOnlyIfAsked('Test assistant'));
    expect(line.querySelector('bdi')?.textContent).toBe('Test assistant');
    expect(line.compareDocumentPosition(within(c).getByRole('button', { name: 'Approve' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(c).getByText('This preview came from your Sieve tab on this computer, not through the server.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('selecting Excerpt shows exactly options[1].text, Full item shows redactions, and Approve sends the step', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    fireEvent.click(radio('Excerpt'));
    expect(outgoing().textContent).toBe(DEPOSIT_EXCERPT);
    fireEvent.click(radio('Full item'));
    expect(outgoing().textContent).toBe(DEPOSIT_FULL);
    expect(screen.getByText(`${DEPOSIT_FULL.length} characters · 1 redacted`)).toBeInTheDocument();
    fireEvent.click(radio('Excerpt'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(t.decisions()).toEqual([{ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: true, step: 'excerpt' }]);
  });

  it('Deny sends approved: false and no step', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(t.decisions()).toEqual([{ type: 'panel/decide', requestId: DEPOSIT.requestId, approved: false }]);
  });

  it('renders text exactly, with no markup from content', () => {
    const t = setup();
    const evil = '<img src=x onerror="window.__xss=1"> https://evil.example/?q=1 **bold**';
    t.push(panelState({ proposals: [withId(DEPOSIT, 'xss', { question: evil, options: [option('answer', evil), DEPOSIT.options[1]!, DEPOSIT.options[2]!] })] }));
    expect(outgoing().textContent).toBe(evil);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });
});

describe('step selection rules (50 section 8.5)', () => {
  it('defaults to requestedStep when available', () => {
    const t = setup();
    t.push(panelState({ proposals: [LEASE] }));
    expect(radio('Excerpt')).toHaveAttribute('aria-checked', 'true');
    expect(outgoing().textContent).toBe(LEASE_EXCERPT);
  });

  it('falls back to the highest available step below requestedStep', () => {
    const t = setup();
    const p = withId(DEPOSIT, 'fb', {
      requestedStep: 'full',
      options: [DEPOSIT.options[0]!, DEPOSIT.options[1]!, { ...DEPOSIT.options[2]!, available: false, unavailableReason: 'Too long to send at once' }],
    });
    t.push(panelState({ proposals: [p] }));
    expect(radio('Excerpt')).toHaveAttribute('aria-checked', 'true');
  });

  it('selects nothing and disables Approve when no step at or below the request is available', () => {
    const t = setup();
    const p = withId(DEPOSIT, 'none', {
      options: [{ ...DEPOSIT.options[0]!, available: false, unavailableReason: 'No answer was written' }, DEPOSIT.options[1]!, DEPOSIT.options[2]!],
    });
    t.push(panelState({ proposals: [p] }));
    for (const name of ['Answer only', 'Excerpt', 'Full item']) expect(radio(name)).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('outgoing-text')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('unavailable steps are disabled with their reason and cannot be picked by click or keyboard', async () => {
    const t = setup();
    t.push(panelState({ proposals: [LEASE] }));
    const full = radio('Full item');
    expect(full).toHaveAttribute('aria-disabled', 'true');
    expect(full).toHaveAttribute('title', 'Planner may only receive an excerpt.');
    expect(full).toHaveAccessibleDescription('Full item: Planner may only receive an excerpt.');
    fireEvent.click(full);
    expect(full).toHaveAttribute('aria-checked', 'false');
    const excerpt = radio('Excerpt');
    excerpt.focus();
    fireEvent.keyDown(excerpt, { key: 'ArrowRight' }); // skips Full item, wraps to Answer only
    expect(radio('Answer only')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Answer only')).toHaveFocus();
    fireEvent.keyDown(radio('Answer only'), { key: 'ArrowLeft' }); // wraps backwards over Full item
    expect(radio('Excerpt')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radio('Excerpt'), { key: 'ArrowDown' });
    expect(radio('Full item')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Excerpt')).toHaveAttribute('tabindex', '-1');
    expect(radio('Answer only')).toHaveAttribute('tabindex', '0');
    await expectNoAxeViolations();
  });

  it('a step above maxStep is disabled even when the option says available', () => {
    const t = setup();
    t.push(panelState({ proposals: [withId(DEPOSIT, 'cap', { maxStep: 'answer' })] }));
    expect(radio('Excerpt')).toHaveAttribute('aria-disabled', 'true');
    expect(radio('Full item')).toHaveAttribute('title', "That step isn't available for this request.");
  });

  it('Space selects the focused step', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    fireEvent.keyDown(radio('Excerpt'), { key: ' ' });
    expect(radio('Excerpt')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('rules and warnings', () => {
  it('ask-first shows the rule tag and the warning with its shared title', async () => {
    const t = setup();
    t.push(panelState({ proposals: [STATEMENT] }));
    expect(screen.getAllByText('Money asks first').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Money items ask first. Check the text before you approve.')).toBeInTheDocument();
    expect(screen.getByText('No hidden instructions flagged on this device')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('never shows the red rule tag', () => {
    const t = setup();
    t.push(panelState({ proposals: [withId(DEPOSIT, 'nv', { rule: 'never', outcome: 'blocked-never', item: { ...DEPOSIT.item!, category: 'Health' } })] }));
    expect(screen.getByText('Health is never shared')).toBeInTheDocument();
  });

  it('the clean tag is absent with an injection or hidden-text warning', () => {
    const t = setup();
    t.push(panelState({ proposals: [withId(DEPOSIT, 'inj', { warnings: [{ kind: 'injection', message: 'This email asks an AI to forward your mail.' }] })] }));
    expect(screen.getByText('Possible instruction aimed at an AI')).toBeInTheDocument();
    expect(screen.queryByText('No hidden instructions flagged on this device')).not.toBeInTheDocument();
    t.push(panelState({ proposals: [withId(DEPOSIT, 'hid', { warnings: [{ kind: 'hidden-text-removed', message: 'Removed 2 hidden lines.' }] })] }));
    expect(screen.queryByText('No hidden instructions flagged on this device')).not.toBeInTheDocument();
  });

  it('warnings follow the app order', () => {
    const t = setup();
    t.push(panelState({
      proposals: [withId(DEPOSIT, 'ord', {
        warnings: [
          { kind: 'pii-redacted', message: 'p' },
          { kind: 'cloud-fallback', message: 'c' },
          { kind: 'injection', message: 'i' },
        ],
      })],
    }));
    const items = within(card()).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Possible instruction aimed at an AIi', 'Uses the cloud modelc', 'Personal details hiddenp']);
  });
});

describe('non-ready outcomes', () => {
  const cases: [ProposalPreview['outcome'], string, string, { approve: boolean; deny: boolean; open: boolean }][] = [
    ['blocked-never', 'Blocked by your rules', 'Home is never shared. Nothing left this device.', { approve: false, deny: false, open: true }],
    ['no-match', 'Nothing found', 'Sieve found nothing on this device that answers this. Deny to tell the assistant, or open Sieve to look yourself.', { approve: false, deny: true, open: false }],
    ['needs-cloud-consent', 'Needs your OK for the cloud', 'This Chrome has no on-device model, so this request needs the cloud. Decide in Sieve, where you can see exactly what goes.', { approve: false, deny: false, open: true }],
    ['model-unavailable', "Sieve can't read this yet", "The on-device model isn't ready. Open Sieve to see its status.", { approve: false, deny: false, open: true }],
    ['error', 'Something went wrong', "Sieve couldn't prepare this request. Open Sieve to see what happened.", { approve: false, deny: false, open: true }],
  ];

  it.each(cases)('%s', async (outcome, heading, body, buttons) => {
    const t = setup();
    t.push(panelState({ proposals: [withId(DEPOSIT, 'o', { outcome })] }));
    const c = card();
    expect(within(c).getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(within(c).getByText(body)).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Approve' }) !== null).toBe(buttons.approve);
    expect(within(c).queryByRole('button', { name: 'Deny' }) !== null).toBe(buttons.deny);
    expect(within(c).queryByRole('button', { name: 'Open Sieve' }) !== null).toBe(buttons.open);
    expect(within(c).queryByRole('radiogroup')).not.toBeInTheDocument();
    if (buttons.open) {
      fireEvent.click(within(c).getByRole('button', { name: 'Open Sieve' }));
      expect(t.sent).toContainEqual({ type: 'panel/open-app', requestId: 'o' });
    }
    await expectNoAxeViolations();
  });
});

describe('sending, slow and rejections', () => {
  it('locks the card while a decision is in flight', async () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT], inflight: [{ requestId: DEPOSIT.requestId, approved: true, step: 'answer', sentAt: 1, slow: false }] }));
    const approve = screen.getByRole('button', { name: 'Sending…' });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    fireEvent.click(radio('Excerpt'));
    expect(radio('Answer only')).toHaveAttribute('aria-checked', 'true');
    await expectNoAxeViolations();
  });

  it('shows the slow note and re-enables the buttons', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT], inflight: [{ requestId: DEPOSIT.requestId, approved: true, step: 'answer', sentAt: 1, slow: true }] }));
    expect(screen.getByText('Still waiting for your Sieve tab to confirm. Open Sieve to check.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it.each([
    ['step-unavailable', "That step isn't available for this request."],
    ['unknown-request', 'This request is no longer waiting.'],
    ['not-ready', 'This request is no longer waiting.'],
    ['no-owner', 'Your Sieve tab disconnected. Open Sieve to check.'],
  ] as const)('rejection %s', (reason, text) => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    t.post({ type: 'panel/decide-rejected', requestId: DEPOSIT.requestId, reason });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('already-sent shows no message', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    t.post({ type: 'panel/decide-rejected', requestId: DEPOSIT.requestId, reason: 'already-sent' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('results', () => {
  const cases = [
    ['approved here', resolvedEntry({ outcome: 'approved', step: 'excerpt', decidedHere: true }), 'Shared', 'Sent: excerpt. Nothing else left this device.', 'Receipt saved in "What has AI seen?"'],
    ['approved here, answer', resolvedEntry({ outcome: 'approved', step: 'answer', decidedHere: true }), 'Shared', 'Sent: answer only. Nothing else left this device.', 'Receipt saved in "What has AI seen?"'],
    ['approved in app', resolvedEntry({ outcome: 'approved', decidedHere: false, step: undefined }), 'Shared', 'Approved in the Sieve app.', 'Receipt saved in "What has AI seen?"'],
    ['declined', resolvedEntry({ outcome: 'declined', decidedHere: true, step: undefined }), 'Declined', 'Nothing left this device. The assistant was told you declined.', 'Receipt saved: declined'],
    ['expired', resolvedEntry({ outcome: 'expired', decidedHere: false, step: undefined }), 'Expired', 'This request ran out of time before it was approved. Nothing was shared.', null],
    ['error', resolvedEntry({ outcome: 'error', decidedHere: false, step: undefined }), 'Not sent', "Sieve couldn't finish this request. Nothing was sent. Open Sieve to see what happened.", null],
    ['lost', resolvedEntry({ outcome: 'lost', decidedHere: true }), 'Not confirmed', 'Your Sieve tab closed before it confirmed. Open Sieve to check this request.', null],
  ] as const;

  it.each(cases)('%s', async (_name, entry, heading, body, tag) => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    t.push(panelState({ proposals: [], resolved: [entry] }));
    const c = card();
    expect(within(c).getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(within(c).getByText(body)).toBeInTheDocument();
    if (tag) expect(within(c).getByText(tag)).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('Done dismisses the result and selects the next waiting request', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT, LEASE] }));
    t.push(panelState({ proposals: [LEASE], resolved: [resolvedEntry({ outcome: 'declined', step: undefined })] }));
    expect(screen.getByRole('heading', { name: 'Declined' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Also waiting (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(t.sent).toContainEqual({ type: 'panel/dismiss', requestId: DEPOSIT.requestId });
    expect(screen.getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument();
    expect(outgoing().textContent).toBe(LEASE_EXCERPT);
  });

  it('a lost result stays on screen after every tab is gone, then Done shows the disconnected state', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    t.push(panelState({ connection: 'disconnected', resolved: [resolvedEntry({ outcome: 'lost' })] }));
    expect(screen.getByRole('heading', { name: 'Not confirmed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { name: "Sieve isn't open" })).toBeInTheDocument();
  });

  it('other resolved requests show compactly under Recent', () => {
    const t = setup();
    t.push(panelState({ proposals: [LEASE], resolved: [resolvedEntry({ outcome: 'expired', step: undefined })] }));
    expect(screen.getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});

describe('also waiting, live region and the shortcut', () => {
  it('lists other requests and selects one on click', async () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT, LEASE, STATEMENT] }));
    expect(screen.getByRole('heading', { name: 'Also waiting (2)' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: `Planner: "${LEASE.question}"` });
    fireEvent.click(row);
    expect(outgoing().textContent).toBe(LEASE_EXCERPT);
    expect(screen.getByRole('button', { name: `Test assistant: "${DEPOSIT.question}"` })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('announces a new request and the result heading after a decision', () => {
    const t = setup();
    t.push(panelState());
    t.push(panelState({ proposals: [DEPOSIT] }));
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('New request from ⁨Test assistant⁩');
    t.push(panelState({ proposals: [], resolved: [resolvedEntry()] }));
    expect(live?.textContent).toBe('Shared');
  });

  it('does not announce what was already waiting when the panel opens', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('');
  });

  it('says hello with its window id, and closes itself on panel/close', async () => {
    const t = setup();
    await act(async () => {
      await Promise.resolve();
    });
    expect(t.sent).toContainEqual({ type: 'panel/hello', visible: true });
    expect(t.sent).toContainEqual({ type: 'panel/hello', visible: true, windowId: 7 });
    t.post({ type: 'panel/close' });
    expect(t.closePanel).toHaveBeenCalledTimes(1);
  });

  it('reconnects after the worker drops the port', () => {
    vi.useFakeTimers();
    const t = setup();
    const first = t.box.worker;
    act(() => {
      first?.disconnect();
      vi.advanceTimersByTime(250);
    });
    expect(t.box.worker).not.toBe(first);
    t.push(panelState({ proposals: [DEPOSIT] }));
    expect(screen.getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument();
  });
});
