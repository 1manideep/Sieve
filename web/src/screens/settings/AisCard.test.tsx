// Assistants (40 sections 13.8.1 to 13.8.3 and 13.8.9; design handoff of Nov 20, 2026): the marks, the pressed
// assistant opened in place and closed by a second press, Auto-approve answers, Revoke, connecting in place, and a
// second connection for an assistant that has one.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CATEGORIES } from '@sieve/shared';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { AUTO_APPROVE_KEY, AUTO_APPROVE_MS, autoApproveOn, useAutoApprove } from '@/state/autoApprove';
import { useGrants, type GrantsState } from '@/state/grants';
import { DEFAULT_SETTINGS, useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { AisCard, daysLeftText, grantMeta } from './AisCard';
import { formatClock } from './kit/when';

const NOW = Date.now();
const DAY = 86_400_000;
const LINK = 'https://sieve.example/mcp/c_secret';

function grant(over: Partial<GrantView>): GrantView {
  return {
    id: 'g1',
    aiName: 'Claude',
    maxStep: 'answer',
    allowedCategories: CATEGORIES.filter((c) => c !== 'Health'),
    allowedSources: ['gmail'],
    createdAt: NOW - DAY,
    expiresAt: NOW + 20 * DAY,
    linkHint: 'k3x9',
    state: 'active',
    ...over,
  };
}

const revoke = vi.fn<GrantsState['revoke']>(async () => undefined);
const create = vi.fn<GrantsState['create']>(async (input) => ({
  grantId: 'new', link: LINK, linkHint: 'cret', maxStep: input.maxStep, allowedCategories: input.allowedCategories, allowedSources: input.allowedSources, expiresAt: NOW + 30 * DAY,
}));
let stopStore: () => void = () => undefined;

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <main>
        <AisCard connected={['gmail']} />
      </main>
    </MemoryRouter>,
  );
}

const marks = () => screen.getByRole('list', { name: SETTINGS.marksLabel });
const mark = (name: RegExp) => within(marks()).getByRole('button', { name });
const panel = (name: string) => screen.getByRole('article', { name });
const claudeMark = () => mark(/^Claude(?! Code)/);

beforeEach(() => {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useGrants.setState({
    status: 'ready',
    grants: [grant({}), grant({ id: 'g2', aiName: 'ChatGPT', maxStep: 'excerpt' }), grant({ id: 'g3', aiName: 'Old helper', state: 'revoked', revokedAt: NOW - DAY })],
    revoke,
    create,
  });
  useToasts.setState({ toasts: [] });
  stopStore = useAutoApprove.getState().start('u1');
});

afterEach(() => {
  stopStore();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('Assistants: the marks and the open assistant', () => {
  it('shows every assistant as a mark, live or to connect, and opens none of them, even the live ones, until pressed', async () => {
    renderCard();
    expect(within(marks()).getAllByRole('button')).toHaveLength(7);
    expect(claudeMark()).toHaveTextContent(SETTINGS.markLive);
    expect(mark(/^ChatGPT/)).toHaveTextContent(SETTINGS.markLive);
    expect(mark(/^Gemini CLI/)).toHaveTextContent(SETTINGS.markSubConnect);
    for (const button of within(marks()).getAllByRole('button')) expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(fillText(SETTINGS.aisNote, { n: 2 }))).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a press opens that assistant in place, and a second press on it closes it', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    expect(claudeMark()).toHaveAttribute('aria-pressed', 'true');
    const claude = panel('Claude');
    expect(within(claude).getByText(grantMeta(grant({}), NOW))).toBeInTheDocument();
    expect(within(claude).getByText(SETTINGS.capAnswer)).toBeInTheDocument();
    expect(within(claude).getByText(SETTINGS.allButHealth)).toBeInTheDocument();
    expect(within(claude).getByText(fillText(SETTINGS.neverChip, { category: 'Health' }))).toBeInTheDocument();
    expect(within(claude).getByText('Gmail')).toBeInTheDocument();
    expect(within(claude).getByText(daysLeftText(grant({}), NOW))).toBeInTheDocument();
    expect(within(claude).getByRole('button', { name: SETTINGS.narrow })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await expectNoAxeViolations();

    await user.click(claudeMark());
    expect(claudeMark()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(mark(/^Gemini CLI/));
    expect(panel(fillText(SETTINGS.connectHeading, { name: 'Gemini CLI' }))).toBeInTheDocument();
    await user.click(mark(/^Gemini CLI/));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('pressing another mark opens that assistant instead', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    await user.click(mark(/^ChatGPT/));
    expect(mark(/^ChatGPT/)).toHaveAttribute('aria-pressed', 'true');
    expect(claudeMark()).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel('ChatGPT')).getByText(SETTINGS.capExcerpt)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Claude' })).not.toBeInTheDocument();
  });

  it('says when a connection expires soon', async () => {
    const user = userEvent.setup();
    useGrants.setState({ grants: [grant({ state: 'expiring', expiresAt: NOW + 2 * DAY })] });
    renderCard();
    await user.click(claudeMark());
    expect(within(panel('Claude')).getByText(fillText(SETTINGS.expiresSoon, { left: fillText(SETTINGS.daysLeft, { n: 2 }) }))).toBeInTheDocument();
  });

  it('shows the loading and the error states in place of the panel, once a mark is pressed', async () => {
    const user = userEvent.setup();
    useGrants.setState({ status: 'loading', grants: [] });
    const view = renderCard();
    expect(screen.queryByText(SETTINGS.aisLoading)).not.toBeInTheDocument();
    await user.click(claudeMark());
    expect(screen.getByText(SETTINGS.aisLoading)).toBeInTheDocument();
    view.unmount();
    useGrants.setState({ status: 'error', grants: [] });
    renderCard();
    expect(screen.queryByText(SETTINGS.aisError)).not.toBeInTheDocument();
    await user.click(claudeMark());
    expect(screen.getByText(SETTINGS.aisError)).toBeInTheDocument();
  });
});

describe('Assistants: auto-approve (40 section 13.8.9)', () => {
  it('is an off switch with its note on the open connection', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    const toggle = within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(SETTINGS.autoApproveNote);
    expect(screen.queryByText(/Auto-approving until/)).not.toBeInTheDocument();
  });

  it('turns on for this connection only: the pill, the mark and the note above say so', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    const until = useAutoApprove.getState().until.g1;
    expect(until).toBeGreaterThanOrEqual(NOW + AUTO_APPROVE_MS);
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    expect(autoApproveOn('u1', 'g2')).toBe(false);
    expect(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'true');
    expect(within(panel('Claude')).getByText(fillText(SETTINGS.autoApproveUntil, { time: formatClock(until!) }))).toBeInTheDocument();
    expect(claudeMark()).toHaveTextContent(SETTINGS.markLiveAuto);
    expect(screen.getByText(fillText(SETTINGS.aisNoteAuto, { n: 2, names: 'Claude', time: formatClock(until!) }))).toBeInTheDocument();
    await expectNoAxeViolations();

    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(claudeMark()).toHaveTextContent(SETTINGS.markLive);
  });

  it('reads a switch that was already on', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), JSON.stringify({ g1: Date.now() + 60_000 }));
    stopStore();
    stopStore = useAutoApprove.getState().start('u1');
    renderCard();
    // Auto-approve being on does not open the assistant either.
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(claudeMark());
    expect(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'true');
  });

  it('Revoke asks in place, then revokes and clears auto-approve for that connection only', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(mark(/^ChatGPT/));
    await user.click(within(panel('ChatGPT')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(claudeMark());
    await user.click(within(panel('Claude')).getByRole('button', { name: SETTINGS.revoke }));
    const confirm = within(panel('Claude')).getByRole('group', { name: fillText(SETTINGS.revokeTitle, { aiName: 'Claude' }) });
    expect(confirm).toHaveFocus();
    expect(within(confirm).getByText(SETTINGS.revokeBody)).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: SETTINGS.revokeConfirm }));
    expect(revoke).toHaveBeenCalledWith('g1');
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(autoApproveOn('u1', 'g2')).toBe(true);
    expect(useToasts.getState().toasts.at(-1)?.title).toBe(fillText(SETTINGS.revoked, { aiName: 'Claude' }));
  });

  it('Cancel leaves the connection as it was', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    await user.click(within(panel('Claude')).getByRole('button', { name: SETTINGS.revoke }));
    await user.click(within(panel('Claude')).getByRole('button', { name: SETTINGS.cancel }));
    expect(revoke).not.toHaveBeenCalled();
    expect(within(panel('Claude')).getByRole('button', { name: SETTINGS.narrow })).toBeInTheDocument();
  });
});

describe('Assistants: connecting in place (40 section 13.8.2)', () => {
  it('a mark with no connection opens the connect steps, with the connected sources on', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(mark(/^Gemini CLI/));
    const connect = panel(fillText(SETTINGS.connectHeading, { name: 'Gemini CLI' }));
    expect(within(connect).getByText(SETTINGS.step1of2)).toBeInTheDocument();
    expect(within(connect).getByRole('radio', { name: SETTINGS.capAnswer })).toBeChecked();
    expect(within(connect).getByText(SETTINGS.capNoteAnswer)).toBeInTheDocument();
    const categories = within(connect).getByRole('group', { name: SETTINGS.categories });
    expect(within(categories).getAllByRole('button')).toHaveLength(8);
    expect(within(categories).getByText(fillText(SETTINGS.neverChip, { category: 'Health' }))).toBeInTheDocument();
    const sources = within(connect).getByRole('group', { name: SETTINGS.sources });
    expect(within(sources).getByRole('button', { name: 'Gmail' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sources).getByRole('button', { name: 'Local folder' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(connect).getByRole('radio', { name: SETTINGS.days30 })).toBeChecked();
    expect(within(connect).queryByRole('textbox')).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('creates the link with the chosen limits, shows it once with how to add it, and stays until Done', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCard();
    await user.click(mark(/^Gemini CLI/));
    const name = fillText(SETTINGS.connectHeading, { name: 'Gemini CLI' });
    await user.click(within(panel(name)).getByRole('radio', { name: SETTINGS.capExcerpt }));
    await user.click(within(panel(name)).getByRole('button', { name: 'Newsletters' }));
    await user.click(within(panel(name)).getByRole('radio', { name: SETTINGS.days7 }));
    await user.click(within(panel(name)).getByRole('button', { name: SETTINGS.create }));
    expect(create).toHaveBeenCalledWith({
      aiName: 'Gemini CLI',
      maxStep: 'excerpt',
      allowedCategories: CATEGORIES.filter((c) => c !== 'Health' && c !== 'Newsletters'),
      allowedSources: ['gmail'],
      days: 7,
    });
    const linked = panel(name);
    expect(await within(linked).findByText(SETTINGS.step2of2)).toBeInTheDocument();
    expect(within(linked).getByRole('heading', { name: fillText(SETTINGS.stepLink, { aiName: 'Gemini CLI' }) })).toHaveFocus();
    expect(within(linked).getByRole('textbox', { name: SETTINGS.linkLabel })).toHaveValue(LINK);
    expect(within(linked).getByText(SETTINGS.howToKinds.geminiCli)).toBeInTheDocument();
    await expectNoAxeViolations();

    // The new connection is live already, but the link stays on screen until Done.
    useGrants.setState({ grants: [...useGrants.getState().grants, grant({ id: 'new', aiName: 'Gemini CLI' })] });
    expect(within(panel(name)).getByRole('textbox', { name: SETTINGS.linkLabel })).toHaveValue(LINK);
    await user.click(within(panel(name)).getByRole('button', { name: SETTINGS.copyLink }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(within(panel(name)).getByRole('button', { name: SETTINGS.copied })).toBeInTheDocument();
    await user.click(within(panel(name)).getByRole('button', { name: SETTINGS.done }));
    expect(screen.queryByRole('textbox', { name: SETTINGS.linkLabel })).not.toBeInTheDocument();
    expect(panel('Gemini CLI')).toBeInTheDocument();
  });

  it('asks before leaving a link that was not copied: by Done and by another mark', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(mark(/^Cursor/));
    const name = fillText(SETTINGS.connectHeading, { name: 'Cursor' });
    await user.click(within(panel(name)).getByRole('button', { name: SETTINGS.create }));
    await within(panel(name)).findByText(SETTINGS.step2of2);

    await user.click(within(panel(name)).getByRole('button', { name: SETTINGS.done }));
    let dialog = await screen.findByRole('dialog', { name: SETTINGS.closeTitle });
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.closeCancel }));
    expect(within(panel(name)).getByRole('textbox', { name: SETTINGS.linkLabel })).toHaveValue(LINK);

    await user.click(claudeMark());
    dialog = await screen.findByRole('dialog', { name: SETTINGS.closeTitle });
    expect(mark(/^Cursor/)).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.closeConfirm }));
    expect(claudeMark()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox', { name: SETTINGS.linkLabel })).not.toBeInTheDocument();
  });

  it('asks before closing a link that was not copied by pressing its own mark again', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(mark(/^Cursor/));
    const name = fillText(SETTINGS.connectHeading, { name: 'Cursor' });
    await user.click(within(panel(name)).getByRole('button', { name: SETTINGS.create }));
    await within(panel(name)).findByText(SETTINGS.step2of2);

    await user.click(mark(/^Cursor/));
    let dialog = await screen.findByRole('dialog', { name: SETTINGS.closeTitle });
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.closeCancel }));
    expect(mark(/^Cursor/)).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel(name)).getByRole('textbox', { name: SETTINGS.linkLabel })).toHaveValue(LINK);

    await user.click(mark(/^Cursor/));
    dialog = await screen.findByRole('dialog', { name: SETTINGS.closeTitle });
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.closeConfirm }));
    expect(mark(/^Cursor/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('"Other" asks for a name, and needs at least one category and one source', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(mark(/^Other/));
    const other = panel(SETTINGS.connectTitle);
    await user.click(within(other).getByRole('button', { name: SETTINGS.create }));
    expect(within(other).getByText(SETTINGS.nameError)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.type(within(other).getByRole('textbox', { name: SETTINGS.nameLabel }), '  My   helper ');
    await user.click(within(within(other).getByRole('group', { name: SETTINGS.sources })).getByRole('button', { name: 'Gmail' }));
    await user.click(within(other).getByRole('button', { name: SETTINGS.create }));
    expect(within(other).getByText(SETTINGS.keepOne)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.click(within(within(other).getByRole('group', { name: SETTINGS.sources })).getByRole('button', { name: 'Local folder' }));
    await user.click(within(other).getByRole('button', { name: SETTINGS.create }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ aiName: 'My helper', allowedSources: ['folder'], days: 30 }));
  });

  it('says so when the link could not be made, and keeps the form', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    create.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'functions/unavailable' }));
    renderCard();
    await user.click(mark(/^Cursor/));
    const cursor = panel(fillText(SETTINGS.connectHeading, { name: 'Cursor' }));
    await user.click(within(cursor).getByRole('button', { name: SETTINGS.create }));
    expect(await within(cursor).findByRole('status')).not.toBeEmptyDOMElement();
    expect(within(cursor).getByText(SETTINGS.step1of2)).toBeInTheDocument();
  });
});

describe('Assistants: a new connection for a live assistant', () => {
  const claudePanels = () => screen.getAllByRole('article', { name: 'Claude' });
  const connectClaude = fillText(SETTINGS.connectHeading, { name: 'Claude' });

  it('offers New connection, next to the note, only on a live connection', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    const claude = panel('Claude');
    expect(within(claude).getByText(`${SETTINGS.capNoteAnswer} ${SETTINGS.narrowNote}`)).toBeInTheDocument();
    expect(within(claude).getByRole('button', { name: SETTINGS.newConnection })).toBeInTheDocument();

    await user.click(mark(/^Gemini CLI/));
    expect(panel(fillText(SETTINGS.connectHeading, { name: 'Gemini CLI' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SETTINGS.newConnection })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SETTINGS.cancel })).not.toBeInTheDocument();
  });

  it('opens the connect steps for that assistant in place of its connections, and Cancel goes back', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(claudeMark());
    await user.click(within(panel('Claude')).getByRole('button', { name: SETTINGS.newConnection }));
    const connect = panel(connectClaude);
    expect(within(connect).getByText(SETTINGS.step1of2)).toBeInTheDocument();
    expect(within(connect).getByRole('radio', { name: SETTINGS.capAnswer })).toBeChecked();
    expect(screen.queryByRole('article', { name: 'Claude' })).not.toBeInTheDocument();
    expect(claudeMark()).toHaveAttribute('aria-pressed', 'true');
    await expectNoAxeViolations();

    await user.click(within(connect).getByRole('button', { name: SETTINGS.cancel }));
    expect(panel('Claude')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: connectClaude })).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    // Closing the assistant and opening it again shows its connections, not the steps.
    await user.click(within(panel('Claude')).getByRole('button', { name: SETTINGS.newConnection }));
    await user.click(claudeMark());
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await user.click(claudeMark());
    expect(panel('Claude')).toBeInTheDocument();
  });

  it('makes a second connection with a higher limit; both are listed and the first keeps its Auto-approve', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCard();
    await user.click(claudeMark());
    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(within(panel('Claude')).getByRole('button', { name: SETTINGS.newConnection }));
    await user.click(within(panel(connectClaude)).getByRole('radio', { name: SETTINGS.capFull }));
    await user.click(within(panel(connectClaude)).getByRole('button', { name: SETTINGS.create }));
    expect(create).toHaveBeenCalledWith({
      aiName: 'Claude',
      maxStep: 'full',
      allowedCategories: CATEGORIES.filter((c) => c !== 'Health'),
      allowedSources: ['gmail'],
      days: 30,
    });
    expect(await within(panel(connectClaude)).findByText(SETTINGS.step2of2)).toBeInTheDocument();
    expect(within(panel(connectClaude)).queryByRole('button', { name: SETTINGS.cancel })).not.toBeInTheDocument();

    // The new connection is live already, but the link stays on screen until Done.
    const second = grant({ id: 'new', maxStep: 'full', linkHint: 'cret', createdAt: NOW });
    useGrants.setState({ grants: [second, ...useGrants.getState().grants] });
    expect(within(panel(connectClaude)).getByRole('textbox', { name: SETTINGS.linkLabel })).toHaveValue(LINK);
    await user.click(within(panel(connectClaude)).getByRole('button', { name: SETTINGS.copyLink }));
    await user.click(within(panel(connectClaude)).getByRole('button', { name: SETTINGS.done }));

    expect(claudePanels()).toHaveLength(2);
    const [newer, older] = claudePanels();
    expect(newer).toHaveAccessibleDescription(grantMeta(second, NOW));
    expect(within(newer).getByText(SETTINGS.capFull)).toBeInTheDocument();
    expect(within(newer).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'false');
    expect(older).toHaveAccessibleDescription(grantMeta(grant({}), NOW));
    expect(within(older).getByText(SETTINGS.capAnswer)).toBeInTheDocument();
    expect(within(older).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'true');
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    expect(autoApproveOn('u1', 'new')).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it('Revoke on one of two connections leaves the other, with its Auto-approve', async () => {
    const user = userEvent.setup();
    useGrants.setState({ grants: [grant({ id: 'g4', maxStep: 'full', linkHint: 'p7qa', createdAt: NOW }), ...useGrants.getState().grants] });
    renderCard();
    await user.click(claudeMark());
    const [newer, older] = claudePanels();
    await user.click(within(older).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(within(newer).getByRole('switch', { name: SETTINGS.autoApprove }));
    const { until } = useAutoApprove.getState();
    expect(screen.getByText(fillText(SETTINGS.aisNoteAuto, { n: 3, names: 'Claude', time: formatClock(Math.max(until.g1, until.g4)) }))).toBeInTheDocument();

    await user.click(within(newer).getByRole('button', { name: SETTINGS.revoke }));
    const confirm = within(newer).getByRole('group', { name: fillText(SETTINGS.revokeTitle, { aiName: 'Claude' }) });
    await user.click(within(confirm).getByRole('button', { name: SETTINGS.revokeConfirm }));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('g4');
    expect(autoApproveOn('u1', 'g4')).toBe(false);
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    expect(useToasts.getState().toasts.at(-1)?.title).toBe(fillText(SETTINGS.revokedOne, { aiName: 'Claude', hint: 'p7qa' }));

    act(() => useGrants.setState({ grants: useGrants.getState().grants.map((g) => (g.id === 'g4' ? { ...g, state: 'revoked', revokedAt: NOW } : g)) }));
    expect(claudePanels()).toHaveLength(1);
    expect(claudePanels()[0]).toHaveAccessibleDescription(grantMeta(grant({}), NOW));
    expect(within(claudePanels()[0]).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'true');
    expect(claudeMark()).toHaveTextContent(SETTINGS.markLiveAuto);
  });
});
