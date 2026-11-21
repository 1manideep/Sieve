// Assistants (40 sections 13.8.1 to 13.8.3 and 13.8.9; design handoff of Nov 20, 2026): the marks, the selected
// assistant opened in one panel in place, Auto-approve answers, Revoke, and connecting in place.
import { render, screen, within } from '@testing-library/react';
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
  it('shows every assistant as a mark, live or to connect, and opens the first live one in place', async () => {
    renderCard();
    expect(within(marks()).getAllByRole('button')).toHaveLength(7);
    expect(mark(/^Claude(?! Code)/)).toHaveTextContent(SETTINGS.markLive);
    expect(mark(/^Claude(?! Code)/)).toHaveAttribute('aria-pressed', 'true');
    expect(mark(/^ChatGPT/)).toHaveTextContent(SETTINGS.markLive);
    expect(mark(/^Gemini CLI/)).toHaveTextContent(SETTINGS.markSubConnect);
    expect(screen.getByText(fillText(SETTINGS.aisNote, { n: 2 }))).toBeInTheDocument();

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
  });

  it('pressing another mark opens that assistant instead', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(mark(/^ChatGPT/));
    expect(mark(/^ChatGPT/)).toHaveAttribute('aria-pressed', 'true');
    expect(mark(/^Claude(?! Code)/)).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel('ChatGPT')).getByText(SETTINGS.capExcerpt)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Claude' })).not.toBeInTheDocument();
  });

  it('says when a connection expires soon', () => {
    useGrants.setState({ grants: [grant({ state: 'expiring', expiresAt: NOW + 2 * DAY })] });
    renderCard();
    expect(within(panel('Claude')).getByText(fillText(SETTINGS.expiresSoon, { left: fillText(SETTINGS.daysLeft, { n: 2 }) }))).toBeInTheDocument();
  });

  it('shows the loading and the error states in place of the panel', () => {
    useGrants.setState({ status: 'loading', grants: [] });
    const view = renderCard();
    expect(screen.getByText(SETTINGS.aisLoading)).toBeInTheDocument();
    view.unmount();
    useGrants.setState({ status: 'error', grants: [] });
    renderCard();
    expect(screen.getByText(SETTINGS.aisError)).toBeInTheDocument();
  });
});

describe('Assistants: auto-approve (40 section 13.8.9)', () => {
  it('is an off switch with its note on the open connection', async () => {
    renderCard();
    const toggle = within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(SETTINGS.autoApproveNote);
    expect(screen.queryByText(/Auto-approving until/)).not.toBeInTheDocument();
  });

  it('turns on for this connection only: the pill, the mark and the note above say so', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    const until = useAutoApprove.getState().until.g1;
    expect(until).toBeGreaterThanOrEqual(NOW + AUTO_APPROVE_MS);
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    expect(autoApproveOn('u1', 'g2')).toBe(false);
    expect(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'true');
    expect(within(panel('Claude')).getByText(fillText(SETTINGS.autoApproveUntil, { time: formatClock(until!) }))).toBeInTheDocument();
    expect(mark(/^Claude(?! Code)/)).toHaveTextContent(SETTINGS.markLiveAuto);
    expect(screen.getByText(fillText(SETTINGS.aisNoteAuto, { n: 2, names: 'Claude', time: formatClock(until!) }))).toBeInTheDocument();
    await expectNoAxeViolations();

    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(mark(/^Claude(?! Code)/)).toHaveTextContent(SETTINGS.markLive);
  });

  it('reads a switch that was already on', () => {
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), JSON.stringify({ g1: Date.now() + 60_000 }));
    stopStore();
    stopStore = useAutoApprove.getState().start('u1');
    renderCard();
    expect(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove })).toHaveAttribute('aria-checked', 'true');
  });

  it('Revoke asks in place, then revokes and clears auto-approve for that connection only', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(within(panel('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(mark(/^ChatGPT/));
    await user.click(within(panel('ChatGPT')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(mark(/^Claude(?! Code)/));
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

    await user.click(mark(/^Claude(?! Code)/));
    dialog = await screen.findByRole('dialog', { name: SETTINGS.closeTitle });
    expect(mark(/^Cursor/)).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.closeConfirm }));
    expect(mark(/^Claude(?! Code)/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox', { name: SETTINGS.linkLabel })).not.toBeInTheDocument();
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
