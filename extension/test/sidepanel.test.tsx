// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProposalPreview } from '@sieve/shared';
import type { PanelState, Surface, WorkerToPanel } from '../src/shared/internal';
import { approveOnlyIfAsked, sentHeading } from '../src/shared/labels';
import { App, CONNECTING_DELAY_MS } from '../src/sidepanel/App';
import { LIFTING_TEXT_TEST_ID, TRANSITION_TEST_ID } from '../src/sidepanel/components/ApprovedTransition';
import { shortcutHint } from '../src/sidepanel/shortcut';
import type { SettingsStore } from '../src/sidepanel/components/SettingsMenu';
import { detectSurface } from '../src/sidepanel/surface';
import type { PanelApi } from '../src/sidepanel/usePanelPort';
import type { Settings } from '../src/shared/settings';
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

function setup(opts: { surface?: Surface; openSidePanel?: () => Promise<void>; settings?: SettingsStore } = {}) {
  const box: { worker: FakePort | null } = { worker: null };
  const sent: unknown[] = [];
  const closePanel = vi.fn();
  const api: PanelApi = {
    ...(opts.surface ? { surface: opts.surface } : {}),
    ...(opts.openSidePanel ? { openSidePanel: opts.openSidePanel } : {}),
    ...(opts.settings ? { settings: opts.settings } : {}),
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
    // "Open the receipt" goes with a saved receipt (approved or declined) and asks the worker to open the app for it.
    const openReceipt = within(c).queryByRole('button', { name: 'Open the receipt' });
    expect(openReceipt !== null).toBe(tag !== null);
    if (openReceipt) {
      fireEvent.click(openReceipt);
      expect(t.sent).toContainEqual({ type: 'panel/open-app', requestId: DEPOSIT.requestId });
    }
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

  it('a resolved request that is not selected does not show (there is no Recent list)', () => {
    const t = setup();
    t.push(panelState({ proposals: [LEASE], resolved: [resolvedEntry({ outcome: 'expired', step: undefined })] }));
    expect(screen.getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});

describe('approve animation (board F8B)', () => {
  const approvedState = (step: 'answer' | 'excerpt' = 'answer') =>
    panelState({ proposals: [], resolved: [resolvedEntry({ outcome: 'approved', step, decidedHere: true })] });

  function approveHere(t: ReturnType<typeof setup>) {
    t.push(panelState({ proposals: [DEPOSIT] }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    t.push(panelState({ proposals: [DEPOSIT], inflight: [{ requestId: DEPOSIT.requestId, approved: true, step: 'answer', sentAt: 1, slow: false }] }));
    t.push(approvedState());
  }

  it('plays once for a request approved from this panel, with the exact text lifting out', async () => {
    const t = setup();
    approveHere(t);
    expect(screen.getAllByTestId(TRANSITION_TEST_ID)).toHaveLength(1);
    expect(screen.getByTestId(LIFTING_TEXT_TEST_ID).textContent).toBe(DEPOSIT_ANSWER);
    // The heading counts what this panel sent, with the name isolated for bidi text (board F8B).
    const heading = screen.getByRole('heading', { name: sentHeading(DEPOSIT_ANSWER.length, 'Test assistant') });
    expect(heading.querySelector('bdi')?.textContent).toBe('Test assistant');
    expect(screen.queryByRole('heading', { name: 'Shared' })).not.toBeInTheDocument();
    expect(screen.getByText('Sent: answer only. Nothing else left this device.')).toBeInTheDocument();
    expect(screen.getByText('Receipt saved in "What has AI seen?"')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the receipt' }));
    expect(t.sent).toContainEqual({ type: 'panel/open-app', requestId: DEPOSIT.requestId });
    // The ghost of the old card is hidden from assistive tech and holds no controls.
    const ghost = screen.getByTestId(TRANSITION_TEST_ID).querySelector('[aria-hidden="true"]');
    expect(ghost?.querySelector('button, a, [tabindex]')).toBeNull();
    await expectNoAxeViolations();

    // A re-render with the same state keeps the one mounted transition; it never starts over.
    t.push(approvedState());
    t.push(approvedState());
    expect(screen.getAllByTestId(TRANSITION_TEST_ID)).toHaveLength(1);

    // Once it has been shown, a remount of the result shows the plain card, not the animation again.
    t.push(panelState({ connection: 'connecting', resolved: [resolvedEntry({ outcome: 'approved', step: 'answer', decidedHere: true })] }));
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    t.push(approvedState());
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: sentHeading(DEPOSIT_ANSWER.length, 'Test assistant') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the receipt' })).toBeInTheDocument();
  });

  it('Done during or after the animation dismisses the result', () => {
    const t = setup();
    approveHere(t);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(t.sent).toContainEqual({ type: 'panel/dismiss', requestId: DEPOSIT.requestId });
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No requests waiting' })).toBeInTheDocument();
  });

  it('does not play for a denied request', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    t.push(panelState({ proposals: [], resolved: [resolvedEntry({ outcome: 'declined', decidedHere: true, step: undefined })] }));
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Declined' })).toBeInTheDocument();
  });

  it('does not play for a request approved in the app or elsewhere, which keeps the "Shared" heading', () => {
    const t = setup();
    t.push(panelState({ proposals: [DEPOSIT] }));
    t.push(panelState({ proposals: [], resolved: [resolvedEntry({ outcome: 'approved', decidedHere: false, step: undefined })] }));
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shared' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Sent \d/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the receipt' }));
    expect(t.sent).toContainEqual({ type: 'panel/open-app', requestId: DEPOSIT.requestId });
  });

  it('respects prefers-reduced-motion: straight to the result', async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const t = setup();
      approveHere(t);
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
      expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
      expect(screen.queryByTestId(LIFTING_TEXT_TEST_ID)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: sentHeading(DEPOSIT_ANSWER.length, 'Test assistant') })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
      await expectNoAxeViolations();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('header and footer', () => {
  it('the close button closes the panel', () => {
    const t = setup();
    t.push(panelState());
    fireEvent.click(screen.getByRole('button', { name: 'Close the panel' }));
    expect(t.closePanel).toHaveBeenCalledTimes(1);
  });

  it('the footer shows the shortcut for the platform next to Open Sieve', () => {
    const t = setup();
    t.push(panelState());
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(shortcutHint())).toBeInTheDocument();
    fireEvent.click(within(footer).getByRole('button', { name: 'Open Sieve' }));
    expect(t.sent).toContainEqual({ type: 'panel/open-app' });
  });

  it('shortcutHint: Control+Shift+S on a Mac, Alt+Shift+S elsewhere', () => {
    expect(shortcutHint({ platform: 'MacIntel' })).toBe('Control+Shift+S');
    expect(shortcutHint({ userAgentData: { platform: 'macOS' } })).toBe('Control+Shift+S');
    expect(shortcutHint({ platform: 'Win32' })).toBe('Alt+Shift+S');
    expect(shortcutHint({ platform: 'Linux x86_64' })).toBe('Alt+Shift+S');
    expect(shortcutHint({})).toBe('Alt+Shift+S');
  });
});

describe('settings (50 section 8.10)', () => {
  function memoryStore(initial: Settings = { openOnArrival: true }, opts: { writeRejects?: boolean } = {}) {
    let current: Settings = { ...initial };
    const writes: Partial<Settings>[] = [];
    const store: SettingsStore = {
      read: vi.fn(() => Promise.resolve({ ...current })),
      write: vi.fn((change: Partial<Settings>) => {
        writes.push(change);
        if (opts.writeRejects) return Promise.reject(new Error('quota'));
        current = { ...current, ...change };
        return Promise.resolve({ ...current });
      }),
    };
    return { store, writes, current: () => current };
  }
  const gear = () => screen.getByRole('button', { name: 'Settings' });
  const toggle = () => screen.getByRole('switch', { name: 'Open when a request arrives' });
  const settle = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

  it('the gear shows the settings: "Open when a request arrives", on by default', async () => {
    const { store } = memoryStore();
    const t = setup({ surface: 'popup', settings: store });
    t.push(panelState());
    await settle();
    expect(gear()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument(); // hidden until the gear is pressed
    fireEvent.click(gear());
    expect(gear()).toHaveAttribute('aria-expanded', 'true');
    expect(gear()).toHaveAttribute('aria-controls', screen.getByRole('region', { name: 'Settings' }).id);
    expect(toggle()).toBeChecked();
    expect(toggle()).toBeEnabled();
    expect(toggle()).toHaveAccessibleDescription(
      'Sieve opens its popup by itself when a new request comes in. When this is off, you get the badge and a notification.',
    );
    // The header keeps the close button next to the gear.
    expect(within(screen.getByRole('banner')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Settings', 'Close the panel']);
    await expectNoAxeViolations();
    fireEvent.click(gear());
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('turning it off saves openOnArrival false; a stored off shows off, and turning it on saves true', async () => {
    const { store, writes, current } = memoryStore();
    const t = setup({ settings: store });
    t.push(panelState({ proposals: [DEPOSIT] }));
    await settle();
    fireEvent.click(gear());
    await act(async () => {
      fireEvent.click(toggle());
      await Promise.resolve();
    });
    expect(writes).toEqual([{ openOnArrival: false }]);
    expect(current()).toEqual({ openOnArrival: false });
    expect(toggle()).not.toBeChecked();
    expect(screen.getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument(); // the card stays
    cleanup();
    const off = memoryStore({ openOnArrival: false });
    setup({ settings: off.store }).push(panelState());
    await settle();
    fireEvent.click(gear());
    expect(toggle()).not.toBeChecked();
    await act(async () => {
      fireEvent.click(toggle());
      await Promise.resolve();
    });
    expect(off.writes).toEqual([{ openOnArrival: true }]);
    expect(toggle()).toBeChecked();
  });

  it('Escape closes the settings and puts focus back on the gear', async () => {
    const { store } = memoryStore();
    setup({ settings: store }).push(panelState());
    await settle();
    fireEvent.click(gear());
    toggle().focus();
    fireEvent.keyDown(toggle(), { key: 'Escape' });
    expect(gear()).toHaveAttribute('aria-expanded', 'false');
    expect(gear()).toHaveFocus();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('a save that fails puts the switch back and says so', async () => {
    const { store } = memoryStore({ openOnArrival: true }, { writeRejects: true });
    setup({ settings: store }).push(panelState());
    await settle();
    fireEvent.click(gear());
    await act(async () => {
      fireEvent.click(toggle());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toggle()).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save this setting. Try again.");
  });

  it('quick presses end on the last choice, even when the saves finish out of order', async () => {
    const pendingWrites: { change: Partial<Settings>; done: (v: Settings) => void }[] = [];
    const store: SettingsStore = {
      read: () => Promise.resolve({ openOnArrival: true }),
      write: (change) => new Promise<Settings>((done) => pendingWrites.push({ change, done })),
    };
    setup({ settings: store }).push(panelState());
    await settle();
    fireEvent.click(gear());
    fireEvent.click(toggle()); // off
    fireEvent.click(toggle()); // on
    fireEvent.click(toggle()); // off
    expect(pendingWrites.map((w) => w.change)).toEqual([{ openOnArrival: false }, { openOnArrival: true }, { openOnArrival: false }]);
    await act(async () => {
      pendingWrites[2]?.done({ openOnArrival: false });
      pendingWrites[0]?.done({ openOnArrival: false });
      pendingWrites[1]?.done({ openOnArrival: true }); // an older save, finishing last
      await Promise.resolve();
    });
    expect(toggle()).not.toBeChecked();
  });

  it('the switch waits for the stored value before it can be changed', () => {
    const store: SettingsStore = { read: () => new Promise(() => {}), write: vi.fn() };
    setup({ settings: store }).push(panelState());
    fireEvent.click(gear());
    expect(toggle()).toBeDisabled();
    expect(toggle()).toBeChecked(); // shows the default meanwhile
  });

  it('without a settings store the header has no gear', () => {
    setup().push(panelState());
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
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
    expect(t.sent).toContainEqual({ type: 'panel/hello', visible: true, surface: 'panel' });
    expect(t.sent).toContainEqual({ type: 'panel/hello', visible: true, windowId: 7, surface: 'panel' });
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

describe('the popup (toolbar icon) and the side panel', () => {
  const keepOpen = () => screen.queryByRole('button', { name: 'Keep open on the side' });

  it('the popup says hello as a popup and shows "Keep open on the side" next to Open Sieve', async () => {
    const t = setup({ surface: 'popup', openSidePanel: vi.fn(() => Promise.resolve()) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(t.sent).toContainEqual({ type: 'panel/hello', visible: true, windowId: 7, surface: 'popup' });
    t.push(panelState());
    expect(t.container.firstElementChild).toHaveAttribute('data-surface', 'popup');
    const footer = screen.getByRole('contentinfo');
    const buttons = within(footer).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Keep open on the side', 'Open Sieve']);
    expect(within(footer).getByText(shortcutHint())).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('"Keep open on the side" opens the side panel from the click, then closes the popup', async () => {
    const openSidePanel = vi.fn(() => Promise.resolve());
    const t = setup({ surface: 'popup', openSidePanel });
    t.push(panelState({ proposals: [], resolved: [] }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep open on the side' }));
      await Promise.resolve();
    });
    expect(openSidePanel).toHaveBeenCalledTimes(1);
    expect(t.closePanel).toHaveBeenCalledTimes(1);
    expect(t.sent).not.toContainEqual({ type: 'panel/open-side' });
  });

  it('when Chrome refuses, the popup asks the worker and stays open', async () => {
    const openSidePanel = vi.fn(() => Promise.reject(new Error('refused')));
    const t = setup({ surface: 'popup', openSidePanel });
    t.push(panelState());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep open on the side' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(t.sent).toContainEqual({ type: 'panel/open-side' });
    expect(t.closePanel).not.toHaveBeenCalled();
  });

  it('the side panel never shows the button, and neither does a popup that cannot open the side panel', () => {
    const t = setup({ surface: 'panel', openSidePanel: vi.fn(() => Promise.resolve()) });
    t.push(panelState());
    expect(t.container.firstElementChild).toHaveAttribute('data-surface', 'panel');
    expect(within(screen.getByRole('contentinfo')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Open Sieve']);
    expect(keepOpen()).not.toBeInTheDocument();
    cleanup();
    setup().push(panelState()); // no surface given: the side panel
    expect(keepOpen()).not.toBeInTheDocument();
    cleanup();
    setup({ surface: 'popup' }).push(panelState());
    expect(keepOpen()).not.toBeInTheDocument();
  });

  it('the popup keeps every state and its footer rules: request, empty, disconnected, connecting', () => {
    const t = setup({ surface: 'popup', openSidePanel: vi.fn(() => Promise.resolve()) });
    t.push(panelState({ proposals: [DEPOSIT] }));
    expect(screen.getByRole('heading', { name: 'A request is waiting' })).toBeInTheDocument();
    expect(keepOpen()).toBeInTheDocument();
    t.push(panelState({ connection: 'disconnected' }));
    expect(screen.getByRole('heading', { name: "Sieve isn't open" })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument(); // as in the side panel: no footer here
    t.push(panelState({ connection: 'connecting' }));
    expect(screen.getByText('Connecting to your Sieve tab…')).toBeInTheDocument();
    t.push(panelState());
    expect(screen.getByRole('heading', { name: 'No requests waiting' })).toBeInTheDocument();
    expect(keepOpen()).toBeInTheDocument();
  });

  it('a popup that opens after an approval shows the plain result card, never the animation', async () => {
    const t = setup({ surface: 'popup', openSidePanel: vi.fn(() => Promise.resolve()) });
    t.push(panelState({ proposals: [LEASE], resolved: [resolvedEntry({ outcome: 'approved', step: 'answer', decidedHere: true })] }));
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shared' })).toBeInTheDocument();
    expect(screen.getByText('Sent: answer only. Nothing else left this device.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Also waiting (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(t.sent).toContainEqual({ type: 'panel/dismiss', requestId: DEPOSIT.requestId });
    expect(outgoing().textContent).toBe(LEASE_EXCERPT);
    await expectNoAxeViolations();
  });

  it('a popup that opens while the decision is in flight shows the locked card, then the plain result', () => {
    const t = setup({ surface: 'popup' });
    t.push(panelState({ proposals: [DEPOSIT], inflight: [{ requestId: DEPOSIT.requestId, approved: true, step: 'answer', sentAt: 1, slow: false }] }));
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    t.push(panelState({ resolved: [resolvedEntry({ outcome: 'approved', step: 'answer', decidedHere: true })] }));
    expect(screen.queryByTestId(TRANSITION_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shared' })).toBeInTheDocument();
  });

  it('a page that opens does not pick up results decided elsewhere, or ones already Done', () => {
    setup({ surface: 'popup' }).push(
      panelState({
        resolved: [
          resolvedEntry({ requestId: 'x1', outcome: 'expired', step: undefined }),
          resolvedEntry({ requestId: 'x2', outcome: 'approved', decidedHere: false, step: undefined }),
        ],
      }),
    );
    expect(screen.getByRole('heading', { name: 'No requests waiting' })).toBeInTheDocument();
    cleanup();
    // Declined and lost here count too; the newest one wins.
    setup({ surface: 'popup' }).push(
      panelState({
        connection: 'disconnected',
        resolved: [resolvedEntry({ requestId: 'x3', outcome: 'lost' }), resolvedEntry({ requestId: 'x4', outcome: 'declined', step: undefined })],
      }),
    );
    expect(screen.getByRole('heading', { name: 'Not confirmed' })).toBeInTheDocument();
  });

  it('detectSurface: a window among the popup views is the popup; anything else is the side panel', () => {
    const self = {};
    expect(detectSurface({ search: '', popupViews: () => [self], self })).toBe('popup');
    expect(detectSurface({ search: '', popupViews: () => [{}], self })).toBe('panel');
    expect(detectSurface({ search: '', popupViews: () => [], self })).toBe('panel');
    const missing = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'getViews')");
    };
    expect(detectSurface({ search: '', popupViews: missing, self })).toBe('panel');
    expect(detectSurface({ search: '?surface=popup', popupViews: () => [], self })).toBe('popup');
    expect(detectSurface({ search: '?surface=panel', popupViews: () => [self], self })).toBe('panel');
    expect(detectSurface({ search: '?surface=tab', popupViews: () => [self], self })).toBe('popup');
  });
});

describe('sizing: the popup follows its content (Chrome caps it at 800 x 600)', () => {
  // Read as text from disk (a `new URL(..., import.meta.url)` would go through Vite's asset handling).
  const css = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sidepanel', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (text: string, selector: string) => {
    const at = text.indexOf(`${selector} {`);
    expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
    return text.slice(at, text.indexOf('}', at));
  };
  const panelCss = css('panel.css');
  const uiCss = css('ui.module.css');

  it('the root, html, body and #root never use 100vh or any viewport height', () => {
    for (const text of [panelCss, uiCss]) expect(text).not.toMatch(/100[dsl]?vh/);
    expect(rule(uiCss, '.panel')).not.toMatch(/vh/);
    expect(rule(uiCss, '.popup')).not.toMatch(/vh/);
    expect(panelCss).not.toMatch(/vh/);
    const t = setup({ surface: 'popup' });
    t.push(panelState());
    const root = t.container.firstElementChild as HTMLElement;
    expect(root.getAttribute('style')).toBeNull();
  });

  it('the popup is 400 px wide, at most 600 px tall, and scrolls inside the main area', () => {
    expect(rule(panelCss, "html[data-surface='popup'] body")).toContain('width: 400px');
    expect(rule(uiCss, '.popup')).toContain('max-height: 600px');
    const main = rule(uiCss, '.popup .main');
    expect(main).toContain('overflow-y: auto');
    expect(main).toContain('overflow-x: hidden');
    expect(main).toContain('min-height: 0');
    expect(rule(uiCss, '.popup .outgoingBox')).toContain('max-height: 240px');
    // Only the side panel fills its height (100%, not viewport units).
    expect(rule(panelCss, "html[data-surface='panel'] #root")).toContain('height: 100%');
  });

  it('the new text button has a visible focus ring', () => {
    expect(uiCss).toMatch(/\.btnText:focus-visible[^{]*\{[^}]*outline: 2px solid/);
  });
});
