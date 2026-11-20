// What has AI seen? (40 section 13.7): list states, row copy, filters, revoke and the audit badge, each with axe.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Receipt } from '@sieve/shared';
import { CONSOLE, SEEN, fillText } from '@/copy/screens-controls';
import { useAudit } from '@/state/audit';
import { markAutoApproved } from '@/state/autoApprove';
import { DEFAULT_RECEIPT_FILTERS, useReceipts, type ReceiptsState } from '@/state/receipts';
import { useRecords, type RecordMeta } from '@/state/records';
import { useSession } from '@/state/session';
import { useToasts } from '@/state/toasts';
import { expectNoAxeViolations } from '@/test/axe';
import { Component } from './index';

const AI = 'Gemini CLI';
const NOW = Date.now();
const today = (() => {
  const d = new Date(NOW);
  d.setHours(9, 15, 0, 0);
  return d.getTime();
})();
const yesterday = today - 86_400_000 + 3_600_000; // 10:15 AM the day before
const outside = { kind: 'outside' as const, grantId: 'g1', aiName: AI };
const inApp = { kind: 'in-app' as const, aiName: 'Gemini (in Sieve)' as const };

function receipt(over: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    requestId: 'r1',
    requester: outside,
    question: 'What did my landlord say about the deposit?',
    step: 'answer',
    itemIds: ['gmail:m1'],
    status: 'delivered',
    decidedBy: 'app',
    chars: 41,
    createdAt: today,
    ...over,
  };
}

const meta: Record<string, RecordMeta | null> = {
  'gmail:m1': { title: 'Re: Deposit for the apartment', kind: 'email', category: 'Home', date: NOW, source: 'gmail' },
  'gmail:m2': { title: 'Move-out inspection', kind: 'email', category: 'Home', date: NOW, source: 'gmail' },
  'folder:h1': { title: 'Lab results', kind: 'document', category: 'Health', date: NOW, source: 'folder' },
  'upload:u1': { title: 'lease.pdf', kind: 'document', category: 'Home', date: NOW, source: 'upload' },
  'gmail:gone': null,
};

const delivered = receipt({ id: 'r1' });
const pending = receipt({
  id: 'r2',
  requestId: 'r2',
  step: 'excerpt',
  itemIds: ['gmail:m1', 'gmail:m2', 'upload:u1'],
  status: 'pending-collection',
  decidedBy: 'extension',
  chars: 1204,
  createdAt: yesterday,
});
const inAppFull = receipt({
  id: 'r3',
  requestId: 'r3',
  requester: inApp,
  question: 'Draft a short, polite reply.',
  step: 'full',
  itemIds: ['upload:u1'],
  chars: 960,
  createdAt: Date.UTC(2025, 10, 12, 18),
});
const blocked = receipt({ id: 'r4', requestId: 'r4', step: undefined, itemIds: ['folder:h1'], status: 'blocked', decidedBy: 'rule', chars: 0 });
const declined = receipt({ id: 'r5', requestId: 'r5', step: undefined, status: 'declined', chars: 0 });
const expired = receipt({ id: 'r6', requestId: 'r6', status: 'expired', chars: 41 });
const missing = receipt({ id: 'r7', requestId: 'r7', itemIds: ['gmail:gone'] });
const revoked = receipt({ id: 'r8', requestId: 'r8', status: 'revoked' });

const start = vi.fn<ReceiptsState['start']>(() => () => undefined);
const revoke = vi.fn<ReceiptsState['revoke']>(async () => undefined);

function setReceipts(list: Receipt[], status: ReceiptsState['status'] = 'ready') {
  useReceipts.setState({ status, receipts: list });
}

function renderSeen() {
  const router = createMemoryRouter([{ path: '/seen', element: <main><Component /></main> }], { initialEntries: ['/seen'] });
  return render(<RouterProvider router={router} />);
}

/** The receipt rows of the table (without its header row). */
function receiptRows(): HTMLElement[] {
  return within(screen.getByRole('table', { name: SEEN.listLabel })).getAllByRole('row').slice(1);
}

const sentence = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

beforeEach(() => {
  useSession.setState({ kind: 'google', user: { uid: 'uid-1', email: 'person@example.com', isAnonymous: false } });
  useReceipts.setState({ status: 'ready', receipts: [], filters: { ...DEFAULT_RECEIPT_FILTERS }, limit: 100, start, revoke });
  useRecords.setState({ meta, ensure: vi.fn(async () => undefined) });
  useAudit.setState({ state: 'checking', entries: undefined, checkedAt: undefined, brokenAt: undefined, start: vi.fn(() => () => undefined), check: vi.fn(async () => undefined) });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('What has AI seen?', () => {
  it('starts the receipts listener and the audit check, and shows four skeleton rows while loading', async () => {
    setReceipts([], 'loading');
    renderSeen();
    expect(document.title).toBe('What has AI seen? · Sieve');
    expect(start).toHaveBeenCalledWith('real', 'uid-1');
    expect(useAudit.getState().start).toHaveBeenCalledOnce();
    expect(screen.getByText(SEEN.loading)).toBeInTheDocument();
    expect(screen.getByText(SEEN.auditChecking)).toBeInTheDocument();
    expect(screen.getByText(SEEN.note)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('offers to try again when the receipts could not load', async () => {
    const user = userEvent.setup();
    setReceipts([], 'error');
    renderSeen();
    expect(screen.getByText(SEEN.loadError)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: SEEN.tryAgain }));
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('says nothing has been shared yet', async () => {
    renderSeen();
    expect(screen.getByText(SEEN.empty)).toBeInTheDocument();
    expect(screen.queryByText(SEEN.show)).not.toBeInTheDocument();
    // The head: no range pill without receipts, and the white link to the demo computer.
    expect(screen.queryByRole('button', { name: SEEN.range30d })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: CONSOLE.tryNow })).toHaveAttribute('href', '/try');
    await expectNoAxeViolations();
  });

  it('writes each row as what left, who asked, and how it was decided', async () => {
    setReceipts([delivered, pending, inAppFull, blocked, declined, expired, missing, revoked]);
    renderSeen();
    // The four numbers: 4 shares in 30 days (delivered, pending, missing, revoked; the in-app full item from 2025
    // counts for characters and whole items, not for the 30 days), their characters, one whole item, 2 blocked or
    // declined.
    expect(screen.getByText(SEEN.statShares).previousElementSibling).toHaveTextContent('4');
    expect(screen.getByText(SEEN.statChars).previousElementSibling).toHaveTextContent('2,287');
    expect(screen.getByText(SEEN.statFull).previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText(SEEN.statBlocked).previousElementSibling).toHaveTextContent('2');
    const rows = receiptRows();
    expect(rows).toHaveLength(8);

    const [r1, r2, r3, r4, r5, r6, r7, r8] = rows;
    expect(within(r1).getByText(/^Today, 9:15 AM$/)).toBeInTheDocument();
    expect(within(r1).getByText(sentence('Answer only from "Re: Deposit for the apartment"'))).toBeInTheDocument();
    expect(within(r1).getByText(sentence(`${AI} asked: "What did my landlord say about the deposit?"`))).toBeInTheDocument();
    expect(within(r1).getByText('Answer only')).toBeInTheDocument();
    expect(within(r1).getByText(SEEN.byApp)).toBeInTheDocument();
    expect(within(r1).getByText(SEEN.statusDelivered)).toBeInTheDocument();
    expect(within(r1).getByText('41 characters left')).toBeInTheDocument();
    expect(within(r1).getByRole('button', { name: `Revoke ${AI}'s access to this item` })).toBeInTheDocument();

    expect(within(r2).getByText(/^Yesterday, 10:15 AM$/)).toBeInTheDocument();
    expect(within(r2).getByText(sentence('Excerpt from 3 items: "Re: Deposit for the apartment" and 2 more'))).toBeInTheDocument();
    expect(within(r2).getByText(SEEN.byExtension)).toBeInTheDocument();
    expect(within(r2).getByText(`Waiting for ${AI} to collect`)).toBeInTheDocument();
    expect(within(r2).getByText('1,204 characters left')).toBeInTheDocument();

    expect(within(r3).getByText('Nov 12, 2025')).toBeInTheDocument();
    expect(within(r3).getByText(sentence('Full item from "lease.pdf"'))).toBeInTheDocument();
    expect(within(r3).getByText(sentence('You asked Gemini (in Sieve) to: "Draft a short, polite reply."'))).toBeInTheDocument();
    expect(within(r3).queryByRole('button')).not.toBeInTheDocument();

    expect(within(r4).getByText('Nothing shared: Health is never shared')).toBeInTheDocument();
    expect(within(r4).getByText(SEEN.byRule)).toBeInTheDocument();
    expect(within(r4).getByText(SEEN.statusNothingLeft)).toBeInTheDocument();
    expect(within(r4).getByText(SEEN.nothingLeft)).toBeInTheDocument();

    expect(within(r5).getByText(SEEN.declinedWhat)).toBeInTheDocument();
    expect(within(r5).getByText(SEEN.byDeclined)).toBeInTheDocument();

    expect(within(r6).getByText(SEEN.expiredWhat)).toBeInTheDocument();
    expect(within(r6).getByText(SEEN.statusExpired)).toBeInTheDocument();
    expect(within(r6).getByText(SEEN.nothingLeft)).toBeInTheDocument();

    expect(within(r7).getByText(sentence(`Answer only from "${SEEN.missingTitle}"`))).toBeInTheDocument();

    expect(within(r8).getByRole('button', { name: SEEN.revoked })).toBeDisabled();
    await expectNoAxeViolations();
  });

  it('filters by AI, source and date, and clears filters when nothing matches', async () => {
    const user = userEvent.setup();
    setReceipts([delivered, pending, inAppFull]);
    renderSeen();
    const group = screen.getByRole('group', { name: SEEN.show });
    expect(within(group).getByRole('button', { name: SEEN.all })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([SEEN.all, 'Gemini (in Sieve)', AI]);
    await user.click(within(group).getByRole('button', { name: 'Gemini (in Sieve)' }));
    expect(useReceipts.getState().filters.ai).toBe('Gemini (in Sieve)');
    expect(receiptRows()).toHaveLength(1);
    await expectNoAxeViolations();

    await user.click(within(group).getByRole('button', { name: SEEN.all }));
    await user.selectOptions(screen.getByLabelText(SEEN.sourceLabel), SEEN.sourceUpload);
    expect(useReceipts.getState().filters.source).toBe('upload');
    expect(receiptRows()).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText(SEEN.whenLabel), SEEN.rangeToday);
    expect(useReceipts.getState().filters.range).toBe('today');
    expect(screen.getByText(SEEN.filteredEmpty)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: SEEN.clearFilters }));
    expect(useReceipts.getState().filters).toEqual(DEFAULT_RECEIPT_FILTERS);
    expect(receiptRows()).toHaveLength(3);
  });

  it('turns the 30-day range on and off from the pill in the head', async () => {
    const user = userEvent.setup();
    setReceipts([delivered, pending, inAppFull]);
    renderSeen();
    const pill = screen.getByRole('button', { name: SEEN.range30d });
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    await user.click(pill);
    expect(useReceipts.getState().filters.range).toBe('30d');
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    // The in-app full item is from 2025, so it drops out; the When filter shows the same range.
    expect(receiptRows()).toHaveLength(2);
    expect(screen.getByLabelText(SEEN.whenLabel)).toHaveValue('30d');
    await expectNoAxeViolations();
    await user.click(pill);
    expect(useReceipts.getState().filters.range).toBe('any');
    expect(receiptRows()).toHaveLength(3);
  });

  it('confirms a revoke, then says so and disables the row', async () => {
    const user = userEvent.setup();
    setReceipts([delivered]);
    renderSeen();
    await user.click(screen.getByRole('button', { name: `Revoke ${AI}'s access to this item` }));
    const dialog = screen.getByRole('dialog', { name: fillText(SEEN.revokeTitle, { aiName: AI }) });
    expect(within(dialog).getByText(fillText(SEEN.revokeBody, { aiName: AI }))).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(dialog).getByRole('button', { name: SEEN.revokeConfirm }));
    expect(revoke).toHaveBeenCalledWith('r1');
    expect(useToasts.getState().toasts.map((t) => t.title)).toContain(`${AI} can't get that item again.`);
    expect(await screen.findByRole('button', { name: SEEN.revoked })).toBeDisabled();
  });

  it('shows more receipts when the page is full', async () => {
    const user = userEvent.setup();
    useReceipts.setState({ limit: 2 });
    setReceipts([delivered, pending]);
    renderSeen();
    await user.click(screen.getByRole('button', { name: SEEN.showMore }));
    expect(useReceipts.getState().limit).toBe(102);
  });

  it('shows the audit result and explains it', async () => {
    const user = userEvent.setup();
    useAudit.setState({ state: 'intact', entries: 12, checkedAt: NOW - 2 * 60_000 });
    setReceipts([delivered]);
    renderSeen();
    const badge = screen.getByRole('button', { name: SEEN.auditIntact });
    expect(screen.getByText(sentence('12 entries checked 2 minutes ago'))).toBeInTheDocument();
    expect(screen.getByText(SEEN.auditPopover)).not.toBeVisible();
    await user.click(badge);
    expect(badge).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(SEEN.auditPopover)).toBeVisible();
    await expectNoAxeViolations();
    await user.keyboard('{Escape}');
    expect(badge).toHaveAttribute('aria-expanded', 'false');
    expect(badge).toHaveFocus();
  });

  it('says when the log check failed, when there is no activity, and when it could not run', async () => {
    const user = userEvent.setup();
    useAudit.setState({ state: 'broken', entries: 12, brokenAt: 7 });
    const view = renderSeen();
    expect(screen.getByRole('button', { name: 'Log check failed at entry 7' })).toBeInTheDocument();
    expect(screen.getByText(SEEN.auditBrokenSub)).toBeInTheDocument();
    await expectNoAxeViolations();
    view.unmount();

    useAudit.setState({ state: 'intact', entries: 0 });
    const second = renderSeen();
    expect(screen.getByRole('button', { name: SEEN.auditNoActivity })).toBeInTheDocument();
    second.unmount();

    useAudit.setState({ state: 'unavailable' });
    renderSeen();
    expect(screen.getByRole('button', { name: SEEN.auditUnavailable })).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: SEEN.tryAgain }));
    expect(useAudit.getState().check).toHaveBeenCalledOnce();
  });

  it('shows "Approved automatically" on receipts this computer approved with auto-approve (40 section 13.8.9)', () => {
    markAutoApproved('uid-1', 'r1');
    setReceipts([delivered, receipt({ id: 'r9', requestId: 'r9' })]);
    renderSeen();
    const [auto, manual] = receiptRows();
    expect(within(auto).getByText(SEEN.byAuto)).toBeInTheDocument();
    expect(within(auto).queryByText(SEEN.byApp)).not.toBeInTheDocument();
    expect(within(manual).getByText(SEEN.byApp)).toBeInTheDocument();
    window.localStorage.clear();
  });
});
