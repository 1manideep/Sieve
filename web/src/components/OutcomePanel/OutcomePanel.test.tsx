import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { draftDiscarded, OutcomePanel } from './OutcomePanel';

function renderIn(node: React.ReactNode) {
  return render(<MemoryRouter><main>{node}</main></MemoryRouter>);
}

describe('OutcomePanel', () => {
  it('blocked-never (real): the category in title and body, and "Change category rules"', async () => {
    renderIn(<OutcomePanel outcome="blocked-never" category="Health" variant="real" />);
    expect(screen.getByText('Health is never shared')).toBeInTheDocument();
    expect(screen.getByText('Sieve found a match, but your rules never share Health. Nothing left this device, and no model read it.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change category rules' })).toHaveAttribute('href', '/settings#rules');
    await expectNoAxeViolations();
  });

  it('no-match: the real and Playground bodies', async () => {
    const { unmount } = renderIn(<OutcomePanel outcome="no-match" variant="real" />);
    expect(screen.getByText('Try other words, or check that the right source is connected.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/sources');
    unmount();
    renderIn(<OutcomePanel outcome="no-match" variant="playground" />);
    expect(screen.getByText('Nothing on this device matched')).toBeInTheDocument();
    expect(screen.getByText('Try one of the suggested questions.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    await expectNoAxeViolations();
  });

  it('no-match after the second check threw out the draft: says so, instead of "try other words" (Nov 24)', async () => {
    renderIn(<OutcomePanel outcome="no-match" discarded variant="real" />);
    expect(screen.getByText('Nothing on this device matched')).toBeInTheDocument();
    expect(screen.getByText(/Sieve's draft came from an item that doesn't answer this, so it was thrown away/)).toBeInTheDocument();
    expect(screen.queryByText(/Try other words/)).not.toBeInTheDocument();
    await expectNoAxeViolations();
    expect(draftDiscarded({ outcome: 'no-match', reasonCode: 'second-check-no-top' })).toBe(true);
    expect(draftDiscarded({ outcome: 'no-match', reasonCode: 'search-found-nothing' })).toBe(false);
    expect(draftDiscarded({ outcome: 'no-match' })).toBe(false);
    expect(draftDiscarded({ outcome: 'blocked-never', reasonCode: 'second-check-no-top' })).toBe(false);
  });

  it('model-unavailable: Settings and Set up the on-device model (real); no Playground', async () => {
    renderIn(<OutcomePanel outcome="model-unavailable" variant="real" />);
    expect(screen.getByText("The on-device model isn't available")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up the on-device model' })).toHaveAttribute('href', '/prepare?back=/');
    expect(screen.queryByRole('link', { name: /Playground/ })).toBeNull();
    await expectNoAxeViolations();
  });

  it('error: Nothing was shared, and Try again', async () => {
    const onRetry = vi.fn();
    renderIn(<OutcomePanel outcome="error" variant="playground" onRetry={onRetry} />);
    expect(screen.getByText('Something went wrong on this device')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('unsupported: a count, or one fact at a time (Nov 21)', async () => {
    const { unmount } = renderIn(<OutcomePanel outcome="unsupported" variant="real" />);
    expect(screen.getByText("Counts aren't available")).toBeInTheDocument();
    unmount();
    renderIn(<OutcomePanel outcome="unsupported" oneFact variant="real" />);
    expect(screen.getByText('Sieve shares one fact at a time at this level')).toBeInTheDocument();
    expect(screen.getByText('This asks for several things at once, or the answer held more than one. Ask about one thing, or ask for the excerpt.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
