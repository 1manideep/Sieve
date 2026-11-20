import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RecordMeta } from '@/state/records';
import { expectNoAxeViolations } from '@/test/axe';
import { landlordReady } from '../__fixtures__/proposals';
import { RelatedList } from './RelatedList';

const NOW = Date.UTC(2026, 10, 18);
const meta: Record<string, RecordMeta | null> = {
  'playground:pg-mail-01': { title: 'Deposit for the apartment', kind: 'email', category: 'Home', date: NOW - 2 * 86_400_000, source: 'playground' },
  'playground:pg-mail-03': null,
  'playground:pg-mail-02': { title: 'Re: Deposit for the apartment', kind: 'email', category: 'Home', date: NOW, source: 'playground' },
};

describe('RelatedList', () => {
  it('aside: suggested, not shared; ticking calls back; loading and error rows', async () => {
    const onToggle = vi.fn();
    render(
      <main>
        <RelatedList
          variant="aside"
          related={landlordReady.related}
          meta={meta}
          selected={['playground:pg-mail-01']}
          loading={['playground:pg-mail-01']}
          errors={{ 'playground:pg-mail-03': "Couldn't prepare this item." }}
          onToggle={onToggle}
          now={NOW}
        />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Might also matter' })).toBeInTheDocument();
    expect(screen.getByText('Suggested, not shared. Tick to include.')).toBeInTheDocument();
    expect(screen.getByText('2 days ago · Your email about the deposit')).toBeInTheDocument();
    expect(screen.getByText('Preparing…')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Deposit for the apartment/ })).toBeDisabled();
    expect(screen.getByText('An item no longer on this device')).toBeInTheDocument();
    expect(screen.getByText("Couldn't prepare this item.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /An item no longer on this device/ }));
    expect(onToggle).toHaveBeenCalledWith('playground:pg-mail-03');
    await expectNoAxeViolations();
  });

  it('is hidden in the aside when there is nothing related', () => {
    const { container } = render(<RelatedList variant="aside" related={[]} meta={{}} selected={[]} loading={[]} onToggle={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('list (relay): the main item first, checked and disabled, as "Best match"', async () => {
    render(
      <main>
        <RelatedList variant="list" mainId="playground:pg-mail-02" related={landlordReady.related} meta={meta} selected={[]} loading={[]} onToggle={() => undefined} now={NOW} />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Found on this device' })).toBeInTheDocument();
    const main = screen.getAllByRole('checkbox')[0];
    expect(main).toBeChecked();
    expect(main).toBeDisabled();
    expect(screen.getByText('Best match')).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
