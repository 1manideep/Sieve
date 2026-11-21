// What has AI seen? (40 section 13.7; design handoff of Nov 20, 2026): list states, totals, day groups, row copy,
// a receipt opened in place, filters, revoke and the audit pill, with axe.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Receipt } from '@sieve/shared';
import { LADDER_LABELS } from '@sieve/shared';
import { SEEN, SENTENCE, fillText } from '@/copy/screens-controls';
import { useAudit } from '@/state/audit';
import { markAutoApproved } from '@/state/autoApprove';
import { useReceipts, type ReceiptsState } from '@/state/receipts';
import { useRecords, type RecordMeta } from '@/state/records';
import { useSession } from '@/state/session';
import { useToasts } from '@/state/toasts';
import { expectNoAxeViolations } from '@/test/axe';
import { Component, receiptTotals } from './index';

vi.mock('@/components/dbTables', async (original) => ({ ...(await original<typeof import('@/components/dbTables')>()), useDb: () => null }));
vi.mock('../sources/sourcesDb', async (original) => ({ ...(await original<typeof import('../sources/sourcesDb')>()), useRecordCount: () => 500 }));

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

const refresh = vi.fn<ReceiptsState['refresh']>(() => undefined);
const showMore = vi.fn<ReceiptsState['showMore']>(() => undefined);
const revoke = vi.fn<ReceiptsState['revoke']>(async () => undefined);

function setReceipts(list: Receipt[], status: ReceiptsState['status'] = 'ready') {
  useReceipts.setState({ status, receipts: list });
}

function renderSeen() {
  const router = createMemoryRouter([{ path: '/seen', element: <main><Component /></main> }], { initialEntries: ['/seen'] });
  return render(<RouterProvider router={router} />);
}

/** The receipt rows, in order: each is the button that opens its receipt. */
function receiptRows(): HTMLElement[] {
  return within(screen.getByRole('region', { name: SEEN.listLabel }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-controls')?.startsWith('receipt-'));
}
const rowOf = (question: RegExp) => screen.getByRole('button', { name: question });

beforeEach(() => {
  useSession.setState({ kind: 'google', user: { uid: 'uid-1', email: 'person@example.com', isAnonymous: false } });
  useReceipts.setState({ status: 'ready', receipts: [], limit: 100, refresh, showMore, revoke });
  useRecords.setState({ meta, ensure: vi.fn(async () => undefined) });
  useAudit.setState({ state: 'checking', entries: undefined, checkedAt: undefined, brokenAt: undefined, start: vi.fn(() => () => undefined), check: vi.fn(async () => undefined) });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('What has AI seen?', () => {
  it('starts the audit check and shows the loading rows while the receipts load', async () => {
    setReceipts([], 'loading');
    renderSeen();
    expect(document.title).toBe('What has AI seen? · Sieve');
    expect(useAudit.getState().start).toHaveBeenCalledOnce();
    expect(screen.getByText(SEEN.loading)).toBeInTheDocument();
    expect(screen.getByText(SEEN.auditChecking)).toBeInTheDocument();
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: SEEN.totalsLabel })).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('offers to try again when the receipts could not load', async () => {
    const user = userEvent.setup();
    setReceipts([], 'error');
    renderSeen();
    expect(screen.getByText(SEEN.loadError)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SEEN.tryAgain }));
    expect(refresh).toHaveBeenCalledWith('real');
  });

  it('says nothing has been shared yet, with every item counted as never shared', async () => {
    renderSeen();
    expect(screen.getByText(SEEN.empty)).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: SEEN.totalsLabel });
    expect(within(totals).getByText('500')).toBeInTheDocument();
    expect(within(totals).getByText(SEEN.statNoShares)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('adds up the totals from the loaded receipts', () => {
    const totals = receiptTotals([delivered, pending, inAppFull, blocked, declined, expired, revoked], NOW);
    expect(totals.week).toBe(3);                    // delivered, pending and revoked; the full item is a year old
    expect(totals.chars).toBe(41 + 1204 + 960 + 41);
    expect(totals.byAi).toEqual([[AI, 3], ['Gemini (in Sieve)', 1]]);
    expect(totals.sharedItems).toBe(3);             // gmail:m1, gmail:m2, upload:u1
  });

  it('groups the receipts by day and writes each row: what was asked, the item, the step, who decided', async () => {
    setReceipts([delivered, blocked, declined, expired, revoked, pending, inAppFull]);
    renderSeen();
    const list = screen.getByRole('region', { name: SEEN.listLabel });
    const days = within(list).getAllByRole('heading', { level: 2 });
    expect(days).toHaveLength(3);
    expect(days[0]).toHaveTextContent(/^Today · /);
    expect(days[1]).toHaveTextContent(/^Yesterday · /);
    expect(within(list).getByText(fillText(SEEN.daySum, { n: '5', chars: '82' }))).toBeInTheDocument();
    expect(within(list).getByText(fillText(SEEN.daySumOne, { chars: '1,204' }))).toBeInTheDocument();

    const rows = receiptRows();
    expect(rows).toHaveLength(7);
    const first = rows[0]!;
    expect(first).toHaveTextContent('"What did my landlord say about the deposit?"');
    expect(first).toHaveTextContent('Re: Deposit for the apartment');
    expect(first).toHaveTextContent(LADDER_LABELS.answer);
    expect(first).toHaveTextContent(fillText(SEEN.charsLeft, { chars: '41' }));
    expect(first).toHaveTextContent(SEEN.byApp);
    expect(first).toHaveTextContent('9:15 AM');
    expect(first).toHaveAttribute('aria-expanded', 'false');

    expect(rows[1]).toHaveTextContent(fillText(SEEN.blockedWhat, { category: 'Health' }));
    expect(rows[1]).toHaveTextContent(SEEN.stepNothing);
    expect(rows[1]).toHaveTextContent(SEEN.byRule);
    expect(rows[2]).toHaveTextContent(SEEN.declinedWhat);
    expect(rows[2]).toHaveTextContent(SEEN.byDeclined);
    expect(rows[3]).toHaveTextContent(SEEN.expiredWhat);
    expect(rows[3]).toHaveTextContent(SEEN.byExpired);
    expect(rows[4]).toHaveTextContent(SEEN.statusRevoked);
    expect(rows[5]).toHaveTextContent(LADDER_LABELS.excerpt);
    expect(rows[5]).toHaveTextContent(SEEN.byExtension);
    expect(rows[6]).toHaveTextContent(LADDER_LABELS.full);
    expect(rows[6]).toHaveTextContent('lease.pdf');
    await expectNoAxeViolations();
  });

  it('names an item that is no longer on this device', () => {
    setReceipts([missing]);
    renderSeen();
    expect(receiptRows()[0]).toHaveTextContent(SEEN.missingTitle);
  });

  it('opens a receipt in place: what left, where it came from, what happened, and Revoke', async () => {
    const user = userEvent.setup();
    setReceipts([delivered, blocked, declined]);
    renderSeen();
    await user.click(rowOf(/What did my landlord say/));
    const row = receiptRows()[0]!;
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const open = screen.getByRole('region', { name: fillText(SEEN.receiptRegion, { aiName: AI, time: '9:15 AM' }) });
    expect(open).toHaveAttribute('id', row.getAttribute('aria-controls'));
    expect(within(open).getByText(fillText(SEEN.leftAnswer, { chars: '41' }))).toBeInTheDocument();
    expect(within(open).getByText(`${SEEN.leftKept} · ${SEEN.byApp}`)).toBeInTheDocument();
    expect(within(open).getByText('Re: Deposit for the apartment')).toBeInTheDocument();
    expect(within(open).getByText(/^Gmail · .* · Home$/)).toBeInTheDocument();
    const steps = within(open).getAllByRole('listitem').filter((li) => li.closest('ol'));
    expect(steps.map((s) => s.textContent)).toEqual([
      `${SEEN.traceApproved}${SEEN.traceApprovedApp}${SEEN.badgeYou}`,
      `${SEEN.traceDelivered}${fillText(SEEN.traceDeliveredDetail, { chars: '41', aiName: AI })}${fillText(SEEN.badgeCloud, { aiName: AI })}`,
    ]);
    expect(within(open).getByRole('button', { name: fillText(SEEN.revokeLabel, { aiName: AI }) })).toBeInTheDocument();
    expect(within(open).getByText(SEEN.note)).toBeInTheDocument();
    await expectNoAxeViolations();

    // One receipt is open at a time; a blocked one says the rule stopped it and offers no Revoke.
    await user.click(receiptRows()[1]!);
    expect(screen.getAllByRole('region', { name: /^Receipt: / })).toHaveLength(1);
    const stopped = screen.getByRole('region', { name: /^Receipt: / });
    expect(within(stopped).getByText(fillText(SEEN.nothingBlocked, { category: 'Health' }))).toBeInTheDocument();
    expect(within(stopped).getByText(fillText(SEEN.traceRuleNever, { category: 'Health' }))).toBeInTheDocument();
    expect(within(stopped).getByText(SEEN.nothingLeftMeta)).toBeInTheDocument();
    expect(within(stopped).queryByRole('button')).not.toBeInTheDocument();

    await user.click(receiptRows()[2]!);
    expect(screen.getByText(fillText(SEEN.nothingDeclined, { aiName: AI }))).toBeInTheDocument();
    await user.click(receiptRows()[2]!);
    expect(screen.queryByRole('region', { name: /^Receipt: / })).not.toBeInTheDocument();
  });

  it('filters by assistant, by nothing shared and by words, and clears the filters when nothing matches', async () => {
    const user = userEvent.setup();
    setReceipts([delivered, blocked, pending, inAppFull]);
    renderSeen();
    expect(screen.getByRole('status')).toHaveTextContent(fillText(SEEN.countText, { n: '4', total: '4' }));
    const chips = screen.getByRole('group', { name: SEEN.assistantLabel });
    expect(within(chips).getByRole('button', { name: SEEN.allAssistants })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(chips).getByRole('button', { name: 'Gemini (in Sieve)' }));
    expect(receiptRows()).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(fillText(SEEN.countText, { n: '1', total: '4' }));

    await user.click(within(chips).getByRole('button', { name: SEEN.allAssistants }));
    await user.click(screen.getByRole('button', { name: SEEN.nothingChip }));
    expect(receiptRows()).toHaveLength(1);
    expect(receiptRows()[0]).toHaveTextContent(SEEN.byRule);
    await user.click(screen.getByRole('button', { name: SEEN.nothingChip }));

    await user.type(screen.getByRole('searchbox', { name: SEEN.searchLabel }), 'lease');
    expect(receiptRows()).toHaveLength(2);          // the two receipts that hold lease.pdf
    await user.type(screen.getByRole('searchbox', { name: SEEN.searchLabel }), ' zzz');
    expect(screen.getByText(SEEN.filteredEmpty)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SEEN.clearFilters }));
    expect(receiptRows()).toHaveLength(4);
    expect(screen.getByRole('searchbox', { name: SEEN.searchLabel })).toHaveValue('');
  });

  it('confirms a revoke, then says so and marks the receipt revoked', async () => {
    const user = userEvent.setup();
    setReceipts([delivered]);
    renderSeen();
    await user.click(receiptRows()[0]!);
    await user.click(screen.getByRole('button', { name: fillText(SEEN.revokeLabel, { aiName: AI }) }));
    const dialog = await screen.findByRole('dialog', { name: fillText(SEEN.revokeTitle, { aiName: AI }) });
    await user.click(within(dialog).getByRole('button', { name: SEEN.revokeConfirm }));
    expect(revoke).toHaveBeenCalledWith('r1');
    expect(useToasts.getState().toasts.at(-1)?.title).toBe(fillText(SEEN.revokeDone, { aiName: AI }));
    expect(receiptRows()[0]).toHaveTextContent(SEEN.statusRevoked);
    expect(screen.queryByRole('button', { name: fillText(SEEN.revokeLabel, { aiName: AI }) })).not.toBeInTheDocument();
    expect(screen.getByText(fillText(SEEN.traceRevokedDetail, { aiName: AI }))).toBeInTheDocument();
  });

  it('says so when a revoke fails and leaves the receipt as it was', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    revoke.mockRejectedValueOnce(new Error('offline'));
    setReceipts([delivered]);
    renderSeen();
    await user.click(receiptRows()[0]!);
    await user.click(screen.getByRole('button', { name: fillText(SEEN.revokeLabel, { aiName: AI }) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: SEEN.revokeConfirm }));
    expect(useToasts.getState().toasts.at(-1)?.title).toBe(SEEN.revokeFailed);
    expect(receiptRows()[0]).toHaveTextContent(SEEN.byApp);
  });

  it('shows more receipts when the page is full', async () => {
    const user = userEvent.setup();
    useReceipts.setState({ limit: 2 });
    setReceipts([delivered, pending]);
    renderSeen();
    await user.click(screen.getByRole('button', { name: SEEN.showMore }));
    expect(showMore).toHaveBeenCalledOnce();
  });

  it('shows the audit result in the head and explains it', async () => {
    const user = userEvent.setup();
    useAudit.setState({ state: 'intact', entries: 214, checkedAt: NOW - 120_000 });
    renderSeen();
    const pill = screen.getByRole('button', { name: new RegExp(`^${SEEN.auditIntact}`) });
    expect(pill).toHaveTextContent('214 entries checked 2 minutes ago');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    await user.click(pill);
    expect(pill).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(SEEN.auditPopover)).toBeVisible();
    await expectNoAxeViolations();
    await user.keyboard('{Escape}');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
  });

  it('says when the log check failed, when there is no activity, and when it could not run', async () => {
    const user = userEvent.setup();
    useAudit.setState({ state: 'broken', brokenAt: 7 });
    const view = renderSeen();
    expect(screen.getByRole('button', { name: fillText(SEEN.auditBroken, { n: '7' }) })).toBeInTheDocument();
    expect(screen.getByText(SEEN.auditBrokenSub)).toBeInTheDocument();
    view.unmount();

    useAudit.setState({ state: 'intact', entries: 0, brokenAt: undefined });
    const second = renderSeen();
    expect(screen.getByRole('button', { name: SEEN.auditNoActivity })).toBeInTheDocument();
    second.unmount();

    useAudit.setState({ state: 'unavailable' });
    renderSeen();
    expect(screen.getByRole('button', { name: SEEN.auditUnavailable })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SEEN.tryAgain }));
    expect(useAudit.getState().check).toHaveBeenCalledOnce();
  });

  it('shows "Approved automatically" on receipts this computer approved with auto-approve (40 section 13.8.9)', async () => {
    const user = userEvent.setup();
    markAutoApproved('uid-1', 'r1');
    setReceipts([delivered, pending]);
    renderSeen();
    const rows = receiptRows();
    expect(rows[0]).toHaveTextContent(SEEN.byAuto);
    expect(rows[1]).not.toHaveTextContent(SEEN.byAuto);
    await user.click(rows[0]!);
    expect(screen.getByText(fillText(SEEN.traceAutoDetail, { aiName: AI }))).toBeInTheDocument();
    markAutoApproved('uid-1', 'r1', false);
  });
});
