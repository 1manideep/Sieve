// Requests (40 section 13.5): every state with axe, exact copy, and the store calls behind each control.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { CATEGORIES, type Proposal, type StepOption } from '@sieve/shared';
import { DEPOSIT_ANSWER, landlordReady, option, unavailable } from '@/components/__fixtures__/proposals';
import { CONSOLE, HOME_BASE_DIALOG, REQUESTS, SOURCES, fillText } from '@/copy/screens-controls';
import { STATUS_POPOVER } from '@/copy/strings';
import { useGrants } from '@/state/grants';
import { useHomeBase, type HomeBaseState, type PendingEntry } from '@/state/homeBase';
import { useNetwork } from '@/state/network';
import { useRecords } from '@/state/records';
import { useSources, type SourcesState } from '@/state/sources';
import type { GrantView, RelayRequestView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { makeFakeDb } from '@/components/__fixtures__/fakeDb';
import { Component } from './index';

vi.mock('@/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pipeline')>()),
  composeOutgoingText: (parts: StepOption[]) => parts.map((p) => p.text).join('\n\n'),
}));
// The real index, read for the Gmail source row (70 R-MAIL-10): a Dexie on fake-indexeddb with the sources store.
const realDb = makeFakeDb('real');
vi.mock('@/index', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/index')>()), openDb: () => realDb }));

const AI = 'Gemini CLI';

/** Matches the innermost element whose whole text is `text` (for sentences with <bdi> or <kbd> inside). */
const sentence = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);
const NOW = Date.now();
const REASON = `${AI} may only receive the answer.`;

function request(over: Partial<RelayRequestView> = {}): RelayRequestView {
  return {
    id: 'req-1',
    requester: { kind: 'outside', grantId: 'g1', aiName: AI },
    tool: 'sieve_answer',
    requestedStep: 'answer',
    maxStep: 'answer',
    allowedCategories: [...CATEGORIES],
    allowedSources: ['gmail', 'folder', 'upload'],
    question: 'What did my landlord say about the deposit?',
    status: 'awaiting-person',
    createdAt: NOW - 60_000,
    expireAt: NOW + 3_600_000,
    ...over,
  };
}

const relayProposal: Proposal = {
  ...landlordReady,
  requestId: 'req-1',
  requester: { kind: 'outside', grantId: 'g1', aiName: AI },
  question: 'What did my landlord say about the deposit?',
  requestedStep: 'answer',
  maxStep: 'answer',
  related: [],
  options: [option('answer', DEPOSIT_ANSWER), unavailable('excerpt', REASON), unavailable('full', REASON)],
};

function entry(over: Partial<PendingEntry> = {}): PendingEntry {
  return {
    requestId: 'req-1',
    request: request(),
    phase: 'awaiting-person',
    liveSteps: [],
    answerPreview: '',
    proposal: relayProposal,
    relatedSelected: [],
    relatedOptions: {},
    relatedLoading: [],
    lastPreviewItemIds: [],
    ...over,
  };
}

const activeGrant: GrantView = {
  id: 'g1',
  aiName: AI,
  maxStep: 'answer',
  allowedCategories: [...CATEGORIES],
  allowedSources: ['gmail'],
  createdAt: NOW - 86_400_000,
  expiresAt: NOW + 20 * 86_400_000,
  linkHint: 'k3x9',
  state: 'active',
};

function setEntries(list: PendingEntry[], extra: Partial<HomeBaseState> = {}) {
  useHomeBase.setState({
    entries: Object.fromEntries(list.map((e) => [e.requestId, e])),
    order: list.map((e) => e.requestId),
    awaitingCount: list.filter((e) => e.phase === 'awaiting-person').length,
    ...extra,
  });
}

function renderRequests(path = '/requests') {
  const router = createMemoryRouter(
    [
      { path: '/requests', element: <main><Component /></main> },
      { path: '/settings', element: <main><p>settings page</p></main> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const decide = vi.fn<HomeBaseState['decide']>(async () => ({ ok: true }));
const makeThisHomeBase = vi.fn<HomeBaseState['makeThisHomeBase']>(async () => undefined);
const useThisTab = vi.fn<HomeBaseState['useThisTab']>(async () => undefined);
const dismissDone = vi.fn<HomeBaseState['dismissDone']>();

beforeEach(() => {
  useHomeBase.setState({ role: 'active', presence: 'online', decide, makeThisHomeBase, useThisTab, dismissDone });
  useGrants.setState({ status: 'ready', grants: [activeGrant] });
  useRecords.setState({ meta: {}, ensure: vi.fn(async () => undefined) });
  useNetwork.setState({ online: true });
  window.localStorage.setItem('sieve.tip.memorySaver', '1');
});

afterEach(() => {
  useHomeBase.getState().reset();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('Requests', () => {
  it('sets the document title and shows the empty state when this tab is the home base', async () => {
    renderRequests();
    expect(document.title).toBe('Requests · Sieve');
    expect(screen.getByRole('heading', { level: 1, name: 'Requests' })).toBeInTheDocument();
    // The head ends with the white link to the demo computer.
    expect(screen.getByRole('link', { name: CONSOLE.tryNow })).toHaveAttribute('href', '/try');
    // F11: the list pane says nothing is waiting; the right pane explains how a request arrives.
    expect(screen.getByRole('region', { name: REQUESTS.listLabel })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: REQUESTS.listLabel })).getByText(REQUESTS.noneWaitingTitle)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: REQUESTS.noneWaitingTitle })).toBeInTheDocument();
    expect(screen.getByText(REQUESTS.howBody)).toBeInTheDocument();
    expect(screen.getByText(REQUESTS.pickOne)).toBeInTheDocument();
    expect(screen.getByText('Only what you approve leaves your computer.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('shows the Memory Saver tip once and remembers the dismissal', async () => {
    window.localStorage.removeItem('sieve.tip.memorySaver');
    const user = userEvent.setup();
    renderRequests();
    expect(screen.getByText(REQUESTS.memorySaverTip)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: REQUESTS.dismiss }));
    expect(screen.queryByText(REQUESTS.memorySaverTip)).not.toBeInTheDocument();
    expect(window.localStorage.getItem('sieve.tip.memorySaver')).toBe('1');
  });

  it('offers "Make this my home base" when this computer is not the home base, through the 11.2 dialog', async () => {
    const user = userEvent.setup();
    useHomeBase.setState({ role: 'not-home-base' });
    renderRequests();
    expect(screen.getByText(REQUESTS.bannerNotHomeBase)).toBeInTheDocument();
    // F11: the list pane is always there; the banner carries the home-base action.
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: REQUESTS.makeHomeBase }));
    const dialog = screen.getByRole('dialog', { name: HOME_BASE_DIALOG.title });
    const field = within(dialog).getByLabelText(HOME_BASE_DIALOG.nameLabel);
    await user.clear(field);
    await user.click(within(dialog).getByRole('button', { name: HOME_BASE_DIALOG.confirm }));
    expect(within(dialog).getByText(HOME_BASE_DIALOG.nameError)).toBeInTheDocument();
    expect(makeThisHomeBase).not.toHaveBeenCalled();
    await user.type(field, 'Studio Mac');
    await user.click(within(dialog).getByRole('button', { name: HOME_BASE_DIALOG.confirm }));
    expect(makeThisHomeBase).toHaveBeenCalledWith('Studio Mac');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the other computer, and lists its waiting requests read-only', async () => {
    useHomeBase.setState({
      role: 'other-device',
      homeBaseLabel: 'Chrome on Windows',
      recent: [request({ id: 'req-9', status: 'awaiting-person' })],
    });
    renderRequests();
    expect(screen.getByText(sentence(fillText(REQUESTS.bannerOtherDevice, { label: 'Chrome on Windows' })))).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: REQUESTS.listLabel });
    expect(within(list).getAllByText(fillText(REQUESTS.waitingOn, { label: 'Chrome on Windows' })).length).toBeGreaterThan(0);
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Approve, ${DEPOSIT_ANSWER.length} characters` })).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('lets a standby tab take over', async () => {
    const user = userEvent.setup();
    useHomeBase.setState({ role: 'standby' });
    renderRequests();
    expect(screen.getByText(REQUESTS.bannerStandby)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: REQUESTS.useThisTab }));
    expect(useThisTab).toHaveBeenCalledOnce();
  });

  it('warns when the active home base lost its connection', async () => {
    useHomeBase.setState({ presence: 'offline' });
    renderRequests();
    expect(screen.getByText(REQUESTS.bannerOffline)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says no AI can ask yet when there is no active grant, with a link to connect one', async () => {
    useGrants.setState({ status: 'ready', grants: [{ ...activeGrant, state: 'revoked', revokedAt: NOW }] });
    renderRequests();
    expect(screen.getByText(REQUESTS.bannerNoGrant)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: REQUESTS.connectAi })).toHaveAttribute('href', '/settings?connect=1#ais');
    await expectNoAxeViolations();
  });

  it('says Gmail syncing paused in a plain note, and Continue re-authorizes from the click (70 R-MAIL-10)', async () => {
    const user = userEvent.setup();
    const reauthorize = vi.fn<SourcesState['reauthorize']>(async () => undefined);
    useSources.setState({ reauthorize, busy: {} });
    await realDb.table('sources').put({ kind: 'gmail', connected: true, paused: false, progress: { done: 30, total: 30 }, needsAuth: true });
    try {
      renderRequests();
      const note = await screen.findByText(SOURCES.needsAuthGmail);
      expect(note.closest('[data-tone]')).toHaveAttribute('data-tone', 'info');
      await expectNoAxeViolations();
      await user.click(screen.getByRole('button', { name: SOURCES.continue }));
      expect(reauthorize).toHaveBeenCalledWith('gmail');
      await realDb.table('sources').put({ kind: 'gmail', connected: true, paused: false, progress: { done: 30, total: 30 } });
      await waitFor(() => expect(screen.queryByText(SOURCES.needsAuthGmail)).not.toBeInTheDocument());
    } finally {
      await realDb.table('sources').clear();
    }
  });

  it('warns, with the card\'s sentence, only when Google refused read-only Gmail access after Continue', async () => {
    useSources.setState({ busy: {} });
    await realDb.table('sources').put({
      kind: 'gmail', connected: true, paused: false, progress: { done: 30, total: 30 },
      needsAuth: true, errorCode: 'auth-needed', error: SOURCES.needsAuthGmailRefused,
    });
    try {
      renderRequests();
      const warning = await screen.findByText(SOURCES.needsAuthGmailRefused);
      expect(warning.closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
      expect(screen.getByRole('button', { name: SOURCES.continue })).toBeInTheDocument();
      expect(screen.queryByText(SOURCES.needsAuthGmail)).not.toBeInTheDocument();
    } finally {
      await realDb.table('sources').clear();
    }
  });

  it('shows the first-click notice and the extension shortcut', async () => {
    useHomeBase.setState({ waitingForClick: true, extension: 'connected', extensionShortcut: 'Ctrl+Shift+S' } as Partial<HomeBaseState>);
    renderRequests();
    expect(screen.getByText(STATUS_POPOVER.homeBaseNeedsClick)).toBeInTheDocument();
    expect(screen.getByText(sentence(fillText(REQUESTS.shortcutTip, { shortcut: 'Ctrl+Shift+S' })))).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says how to set a shortcut when the extension has none', () => {
    useHomeBase.setState({ extension: 'connected', extensionShortcut: '' } as Partial<HomeBaseState>);
    renderRequests();
    expect(screen.getByText(REQUESTS.shortcutUnset)).toBeInTheDocument();
  });

  it('shows the request header and the live trace while the home base prepares', async () => {
    setEntries([
      entry({
        phase: 'preparing',
        proposal: undefined,
        liveSteps: [{ id: 's1', kind: 'retrieve', label: 'Reading 3 emails on this device…', where: 'device', status: 'running', startedAt: NOW }],
      }),
    ]);
    renderRequests();
    expect(screen.getByText('Reading 3 emails on this device…')).toBeInTheDocument();
    // No item yet: the first line names the assistant and its step cap, without a category.
    expect(screen.getByText(sentence(`${AI} asks · Answers only`))).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'BLOCKQUOTE' && el.textContent === '"What did my landlord say about the deposit?"')).toBeInTheDocument();
    expect(screen.queryByText(REQUESTS.cellPicked)).not.toBeInTheDocument();
    // F11: the list always shows, with the one request pinned under Waiting.
    expect(within(screen.getByRole('listbox', { name: REQUESTS.listLabel })).getAllByRole('option')).toHaveLength(1);
    await expectNoAxeViolations();
  });

  it('approves the step it shows, and keeps steps above the grant disabled with the reason (AT-11)', async () => {
    const user = userEvent.setup();
    setEntries([entry()]);
    renderRequests();
    // The card's first line, the question and the three cells.
    expect(screen.getByText(sentence(`${AI} asks · Answers only · Home`))).toBeInTheDocument();
    expect(screen.getByText(REQUESTS.cellSearched, { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText(REQUESTS.cellPicked, { selector: 'dt' }).nextElementSibling).toHaveTextContent('Re: Deposit for the apartment');
    expect(screen.getByText(REQUESTS.cellWouldLeave, { selector: 'dt' }).nextElementSibling).toHaveTextContent(`${DEPOSIT_ANSWER.length} characters`);
    expect(screen.getByRole('radio', { name: '1 · Answer only' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '2 · Excerpt' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: '3 · Full email' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(`Excerpt: ${REASON}`)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: `Exactly what ${AI} would receive` })).toHaveTextContent(DEPOSIT_ANSWER);
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: `Approve, ${DEPOSIT_ANSWER.length} characters` }));
    expect(decide).toHaveBeenCalledWith({ requestId: 'req-1', approved: true, step: 'answer', decidedBy: 'app' });
  });

  it('denies with no step', async () => {
    const user = userEvent.setup();
    setEntries([entry()]);
    renderRequests();
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(decide).toHaveBeenCalledWith({ requestId: 'req-1', approved: false, step: undefined, decidedBy: 'app' });
  });

  it('shows why a decision was not sent', async () => {
    const user = userEvent.setup();
    decide.mockResolvedValueOnce({ ok: false, reason: 'expired', message: 'This request expired. Nothing was sent.' });
    setEntries([entry()]);
    renderRequests();
    await user.click(screen.getByRole('button', { name: `Approve, ${DEPOSIT_ANSWER.length} characters` }));
    expect(await screen.findByText('This request expired. Nothing was sent.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('blocks approval while offline, with the reason', async () => {
    useNetwork.setState({ online: false });
    setEntries([entry()]);
    renderRequests();
    expect(screen.getByRole('button', { name: `Approve, ${DEPOSIT_ANSWER.length} characters` })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(REQUESTS.blockedOffline)).toBeInTheDocument();
  });

  it('shows the result after a share and dismisses it with Done', async () => {
    const user = userEvent.setup();
    const done = entry({ phase: 'done', result: { kind: 'sent', step: 'answer', itemCount: 1, by: 'app' } });
    const waiting = entry({ requestId: 'req-2', request: request({ id: 'req-2', question: 'When is my flight?' }), proposal: { ...relayProposal, requestId: 'req-2' } });
    setEntries([done, waiting]);
    renderRequests('/requests?id=req-1');
    const list = screen.getByRole('listbox', { name: REQUESTS.listLabel });
    expect(within(list).getByText(REQUESTS.groupWaiting)).toBeInTheDocument();
    const selected = within(list).getAllByRole('option').find((a) => a.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent(REQUESTS.phaseSent);
    expect(within(list).getByText(REQUESTS.phaseWaiting)).toBeInTheDocument();
    expect(screen.getByText(`Sent the answer to ${AI}. Receipt saved.`)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(dismissDone).toHaveBeenCalledWith('req-1');
  });

  it('selects the oldest request waiting for the person when ?id= does not match', () => {
    const done = entry({ phase: 'done', result: { kind: 'declined', by: 'extension' } });
    const waiting = entry({ requestId: 'req-2', request: request({ id: 'req-2', question: 'When is my flight?' }), proposal: { ...relayProposal, requestId: 'req-2' } });
    setEntries([done, waiting]);
    renderRequests('/requests?id=nope');
    const list = screen.getByRole('listbox', { name: REQUESTS.listLabel });
    const selected = within(list).getAllByRole('option').find((a) => a.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent('When is my flight?');
  });

  it('lists the last 24 hours of requests with their status labels', async () => {
    useHomeBase.setState({
      recent: [
        request({ id: 'r1', status: 'answered' }),
        request({ id: 'r2', status: 'collected', question: 'Flight number?' }),
        request({ id: 'r3', status: 'blocked', question: 'Test results?' }),
        request({ id: 'r4', status: 'offline', question: 'Old one', createdAt: new Date(NOW).setHours(0, 0, 0, 0) - 3_600_000 }),
      ],
    });
    renderRequests();
    // F11: every request is a row grouped by day; the status is the row's hidden label, and the detail shows it as a tag.
    const list = screen.getByRole('listbox', { name: REQUESTS.listLabel });
    expect(within(list).getByText(`Sent, waiting for ${AI} to collect`)).toBeInTheDocument();
    expect(within(list).getByText(`Collected by ${AI}`)).toBeInTheDocument();
    expect(within(list).getByText(REQUESTS.status.blocked)).toBeInTheDocument();
    expect(within(list).getByText('Old one')).toBeInTheDocument();
    expect(within(list).getByText(REQUESTS.groupYesterday)).toBeInTheDocument();
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    await userEvent.click(within(list).getByRole('option', { name: /Test results\?/ }));
    const detail = screen.getByRole('article', { name: REQUESTS.selectedLabel });
    expect(within(detail).getByText('Test results?')).toBeInTheDocument();
    expect(within(detail).getByText(REQUESTS.status.blocked)).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
