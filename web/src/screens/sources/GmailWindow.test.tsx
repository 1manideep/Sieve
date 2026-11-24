import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { GMAIL_WINDOW_KEY } from '@/state/gmailWindow';
import { useSources } from '@/state/sources';
import { GmailWindow } from './GmailWindow';

describe('GmailWindow: Read email from (Nov 24)', () => {
  const original = useSources.getState().setGmailWindow;
  afterEach(() => {
    window.localStorage.removeItem(GMAIL_WINDOW_KEY);
    useSources.setState({ setGmailWindow: original, busy: {} });
  });

  it('starts on the default, offers the windows, and applies a choice', async () => {
    const setGmailWindow = vi.fn(async () => 12);
    useSources.setState({ setGmailWindow });
    render(<main><GmailWindow /></main>);
    const select = screen.getByLabelText('Read email from');
    expect(select).toHaveValue('default');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'The last 6 months (default)', 'The last 7 days', 'The last 14 days', 'The last 30 days', 'The last 90 days',
      'Only the last 6 months', 'The last year',
    ]);
    await expectNoAxeViolations();
    await userEvent.selectOptions(select, '30');
    expect(setGmailWindow).toHaveBeenCalledWith(30);
    expect(await screen.findByText('Removed 12 older emails from this computer.')).toBeInTheDocument();
    await userEvent.selectOptions(select, 'default');
    expect(setGmailWindow).toHaveBeenLastCalledWith(undefined);
  });

  it('shows the window this computer saved, and goes back if saving fails', async () => {
    window.localStorage.setItem(GMAIL_WINDOW_KEY, '14');
    const setGmailWindow = vi.fn(async () => {
      throw new Error('storage');
    });
    useSources.setState({ setGmailWindow });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<main><GmailWindow /></main>);
    const select = screen.getByLabelText('Read email from');
    expect(select).toHaveValue('14');
    await userEvent.selectOptions(select, '7');
    expect(select).toHaveValue('14');
  });
});
