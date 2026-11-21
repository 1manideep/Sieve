// The "Auto-approve answers" switch on each connection card (40 section 13.8.9, testing mode).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CATEGORIES } from '@sieve/shared';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { AUTO_APPROVE_KEY, AUTO_APPROVE_MS, autoApproveOn, useAutoApprove } from '@/state/autoApprove';
import { useGrants, type GrantsState } from '@/state/grants';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { AisCard } from './AisCard';
import { formatClock } from './kit/when';

const NOW = Date.now();
const DAY = 86_400_000;

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
let stopStore: () => void = () => undefined;

function renderCard() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <main>
        <AisCard connected={[]} />
      </main>
    </MemoryRouter>,
  );
}

const rowOf = (name: string) => (screen.getAllByText(name).find((el) => el.tagName === 'BDI') as HTMLElement).closest('li') as HTMLElement;

beforeEach(() => {
  useGrants.setState({
    status: 'ready',
    grants: [grant({}), grant({ id: 'g2', aiName: 'ChatGPT' }), grant({ id: 'g3', aiName: 'Old helper', state: 'revoked', revokedAt: NOW - DAY })],
    revoke,
  });
  useToasts.setState({ toasts: [] });
  stopStore = useAutoApprove.getState().start('u1');
});

afterEach(() => {
  stopStore();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('AisCard: auto-approve', () => {
  it('shows an off switch with its note next to Revoke on each current connection only', async () => {
    renderCard();
    const row = rowOf('Claude');
    const toggle = within(row).getByRole('switch', { name: SETTINGS.autoApprove });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(SETTINGS.autoApproveNote);
    expect(within(row).getByRole('button', { name: SETTINGS.revoke })).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);   // the revoked one is under Past connections, without it
    expect(within(row).queryByText(/Auto-approving until/)).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('turns on for this connection: "Auto-approving until {time}" and Stop', async () => {
    const user = userEvent.setup();
    renderCard();
    const row = rowOf('Claude');
    await user.click(within(row).getByRole('switch', { name: SETTINGS.autoApprove }));
    const until = useAutoApprove.getState().until.g1;
    expect(until).toBeGreaterThanOrEqual(NOW + AUTO_APPROVE_MS);
    expect(autoApproveOn('u1', 'g1')).toBe(true);
    expect(autoApproveOn('u1', 'g2')).toBe(false);
    expect(within(row).getByRole('switch', { name: SETTINGS.autoApprove })).toBeChecked();
    expect(within(row).getByText(fillText(SETTINGS.autoApproveUntil, { time: formatClock(until) }))).toBeInTheDocument();
    expect(within(rowOf('ChatGPT')).getByRole('switch')).not.toBeChecked();
    await expectNoAxeViolations();

    await user.click(within(row).getByRole('button', { name: SETTINGS.autoApproveStop }));
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(within(row).getByRole('switch', { name: SETTINGS.autoApprove })).not.toBeChecked();
    expect(within(row).queryByRole('button', { name: SETTINGS.autoApproveStop })).not.toBeInTheDocument();
  });

  it('turning the switch off stops it at once', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), JSON.stringify({ g1: Date.now() + 60_000 }));
    stopStore();
    stopStore = useAutoApprove.getState().start('u1');
    renderCard();
    const toggle = within(rowOf('Claude')).getByRole('switch', { name: SETTINGS.autoApprove });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(autoApproveOn('u1', 'g1')).toBe(false);
  });

  it('Revoke clears auto-approve for that connection', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(within(rowOf('Claude')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(within(rowOf('ChatGPT')).getByRole('switch', { name: SETTINGS.autoApprove }));
    await user.click(within(rowOf('Claude')).getByRole('button', { name: SETTINGS.revoke }));
    const dialog = screen.getByRole('dialog', { name: fillText(SETTINGS.revokeTitle, { aiName: 'Claude' }) });
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.revokeConfirm }));
    expect(revoke).toHaveBeenCalledWith('g1');
    expect(autoApproveOn('u1', 'g1')).toBe(false);
    expect(autoApproveOn('u1', 'g2')).toBe(true);
  });
});

describe('AisCard: the assistant marks (F5B)', () => {
  it('shows every assistant, live ones pressed to filter, grey ones opening Connect with the name filled', async () => {
    const user = userEvent.setup();
    renderCard();
    const row = screen.getByRole('list', { name: SETTINGS.marksLabel });
    const buttons = within(row).getAllByRole('button');
    expect(buttons).toHaveLength(7);
    const claude = within(row).getByRole('button', { name: /^Claude, Live/ });
    expect(claude).toHaveAttribute('aria-pressed', 'false');
    expect(within(row).getByRole('button', { name: /^Gemini, Not connected/ })).not.toHaveAttribute('aria-pressed');
    await user.click(claude);
    expect(claude).toHaveAttribute('aria-pressed', 'true');
    expect(rowOf('Claude')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /^Cursor, Not connected/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cursor')).toBeInTheDocument();
  });
});
