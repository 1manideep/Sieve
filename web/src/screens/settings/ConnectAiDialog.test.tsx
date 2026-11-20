// 40 section 18 and AT-21: the link appears once; Copy; "Close without copying?"; after closing, the link string is in
// no store, no storage and not the URL.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '@sieve/shared';
import { SETTINGS, fillText } from '@/copy/screens-controls';
import { useAnnouncer } from '@/state/announcer';
import { useAskPlayground, useAskReal } from '@/state/ask';
import { useAudit } from '@/state/audit';
import { useAvailability } from '@/state/availability';
import { useGrants, type GrantsState } from '@/state/grants';
import { useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
import { useNetwork } from '@/state/network';
import { usePlayground } from '@/state/playground';
import { useReceipts } from '@/state/receipts';
import { useRecords } from '@/state/records';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useSources } from '@/state/sources';
import { useToasts } from '@/state/toasts';
import { expectNoAxeViolations } from '@/test/axe';
import { ConnectAiDialog } from './ConnectAiDialog';

const sentence = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

const LINK = 'https://sieve.manideep.info/mcp/c_9f3k2Lq8ZtWvX1yB7mN4pR6sT0uA5dE';

const STORES = [
  useAnnouncer, useAskPlayground, useAskReal, useAudit, useAvailability, useGrants, useHomeBase, useIndexing,
  useNetwork, usePlayground, useReceipts, useRecords, useSession, useSettings, useSources, useToasts,
];

const create = vi.fn<GrantsState['create']>(async (input) => ({
  grantId: 'g-new',
  link: LINK,
  linkHint: LINK.slice(-4),
  maxStep: input.maxStep,
  allowedCategories: input.allowedCategories,
  allowedSources: input.allowedSources,
  expiresAt: Date.now() + 30 * 86_400_000,
}));

function Harness({ connected }: { connected: ('gmail' | 'folder' | 'upload')[] }) {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConnectAiDialog open={open} onClose={() => setOpen(false)} connected={connected} />
    </main>
  );
}

async function toLinkStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = screen.getByRole('dialog', { name: SETTINGS.connectTitle });
  await user.click(within(dialog).getByRole('button', { name: 'ChatGPT' }));
  await user.click(within(dialog).getByRole('button', { name: SETTINGS.next }));
  await user.click(within(dialog).getByRole('button', { name: SETTINGS.create }));
  await within(dialog).findByRole('heading', { name: fillText(SETTINGS.stepLink, { aiName: 'ChatGPT' }) });
  return dialog;
}

beforeEach(() => {
  useGrants.setState({ create });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConnectAiDialog', () => {
  it('asks for a name first, with quick-fill chips', async () => {
    const user = userEvent.setup();
    render(<Harness connected={['gmail']} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.connectTitle });
    const name = within(dialog).getByLabelText(SETTINGS.stepWhich);
    expect(name).toHaveFocus();
    expect(within(dialog).getByText(SETTINGS.nameHelp)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.next }));
    expect(within(dialog).getByText(SETTINGS.nameError)).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    await expectNoAxeViolations();
    for (const chip of SETTINGS.quickFill) {
      await user.click(within(dialog).getByRole('button', { name: chip }));
      expect(name).toHaveValue(chip);
    }
  });

  it('defaults the limits and sends them to issueGrant', async () => {
    const user = userEvent.setup();
    render(<Harness connected={['gmail', 'folder']} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.connectTitle });
    await user.type(within(dialog).getByLabelText(SETTINGS.stepWhich), '  Research   helper ');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.next }));

    expect(within(dialog).getByRole('heading', { name: SETTINGS.stepWhat })).toHaveFocus();
    expect(within(dialog).getByRole('radio', { name: SETTINGS.capAnswer, description: SETTINGS.capNoteAnswer })).toBeChecked();
    const categories = within(dialog).getByRole('group', { name: SETTINGS.categories });
    for (const c of CATEGORIES) {
      const box = within(categories).getByRole('checkbox', { name: c === 'Health' ? `Health ${SETTINGS.neverSuffix}` : c });
      if (c === 'Health') expect(box).not.toBeChecked();
      else expect(box).toBeChecked();
    }
    const sources = within(dialog).getByRole('group', { name: SETTINGS.sources });
    expect(within(sources).getByRole('checkbox', { name: 'Gmail' })).toBeChecked();
    expect(within(sources).getByRole('checkbox', { name: 'Local folder' })).toBeChecked();
    expect(within(sources).getByRole('checkbox', { name: 'Files you add' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: SETTINGS.days30 })).toBeChecked();
    await expectNoAxeViolations();

    await user.click(within(sources).getByRole('checkbox', { name: 'Gmail' }));
    await user.click(within(sources).getByRole('checkbox', { name: 'Local folder' }));
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.create }));
    expect(within(dialog).getByText(SETTINGS.keepOne)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.click(within(sources).getByRole('checkbox', { name: 'Files you add' }));
    await user.click(within(dialog).getByRole('radio', { name: SETTINGS.capExcerpt }));
    await user.click(within(dialog).getByRole('radio', { name: SETTINGS.days90 }));
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.create }));
    expect(create).toHaveBeenCalledWith({
      aiName: 'Research helper',
      maxStep: 'excerpt',
      allowedCategories: CATEGORIES.filter((c) => c !== 'Health'),
      allowedSources: ['upload'],
      days: 90,
    });
  });

  it('ticks all three sources when none is connected', async () => {
    const user = userEvent.setup();
    render(<Harness connected={[]} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.connectTitle });
    await user.type(within(dialog).getByLabelText(SETTINGS.stepWhich), 'Helper');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.next }));
    const sources = within(dialog).getByRole('group', { name: SETTINGS.sources });
    expect(within(sources).getAllByRole('checkbox').every((b) => (b as HTMLInputElement).checked)).toBe(true);
  });

  it('shows the server error inline and stays on the limits step', async () => {
    const user = userEvent.setup();
    create.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    render(<Harness connected={['gmail']} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.connectTitle });
    await user.type(within(dialog).getByLabelText(SETTINGS.stepWhich), 'Helper');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.next }));
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.create }));
    expect(await within(dialog).findByText("Couldn't reach Sieve's server. Try again.")).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: SETTINGS.stepWhat })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('shows the link once, copies it, asks before closing without copying, and keeps it out of every store', async () => {
    const user = userEvent.setup();
    render(<Harness connected={['gmail']} />);
    const dialog = await toLinkStep(user);

    const field = within(dialog).getByLabelText(SETTINGS.linkLabel);
    expect(field).toHaveValue(LINK);
    expect(field).toHaveAttribute('readonly');
    expect(within(dialog).getByText(sentence(fillText(SETTINGS.copyNow, { aiName: 'ChatGPT' })))).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: SETTINGS.howTo })).toBeInTheDocument();
    const steps = within(dialog).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toEqual([fillText(SETTINGS.howTo1, { aiName: 'ChatGPT' }), SETTINGS.howTo2, SETTINGS.howTo3]);
    await expectNoAxeViolations();

    // Done before copying asks first; Go back returns to the link.
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.done }));
    const confirm = screen.getByRole('dialog', { name: SETTINGS.closeTitle });
    expect(within(confirm).getByText(SETTINGS.closeBody)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: SETTINGS.closeCancel }));
    expect(screen.queryByRole('dialog', { name: SETTINGS.closeTitle })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(SETTINGS.linkLabel)).toHaveValue(LINK);

    await user.click(within(dialog).getByRole('button', { name: SETTINGS.copyLink }));
    expect(await navigator.clipboard.readText()).toBe(LINK);
    expect(within(dialog).getByRole('button', { name: SETTINGS.copied })).toBeInTheDocument();
    await waitFor(() => expect(useAnnouncer.getState().polite).toBe(SETTINGS.linkCopied));

    await user.click(within(dialog).getByRole('button', { name: SETTINGS.done }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();

    for (const store of STORES) expect(JSON.stringify(store.getState())).not.toContain(LINK);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(LINK);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(LINK);
    expect(window.location.href).not.toContain(LINK);

    // Opening again starts over: the link is never shown a second time.
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: SETTINGS.connectTitle })).not.toHaveTextContent(LINK);
    expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();
  });

  it('closes without copying after "Close anyway", and Escape on the link step behaves like Done', async () => {
    const user = userEvent.setup();
    render(<Harness connected={['gmail']} />);
    await toLinkStep(user);
    await user.keyboard('{Escape}');
    const confirm = screen.getByRole('dialog', { name: SETTINGS.closeTitle });
    await user.click(within(confirm).getByRole('button', { name: SETTINGS.closeConfirm }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const store of STORES) expect(JSON.stringify(store.getState())).not.toContain(LINK);
  });
});
