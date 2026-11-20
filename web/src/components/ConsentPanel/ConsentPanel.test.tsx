import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { uploadNeedsConsent } from '../__fixtures__/proposals';
import { ConsentPanel } from './ConsentPanel';

const item = uploadNeedsConsent.item!;
const full = uploadNeedsConsent.options[2];

describe('ConsentPanel', () => {
  it('shows the exact text in the disclosure; allow and decline call back', async () => {
    const onAllow = vi.fn();
    const onDecline = vi.fn();
    render(<main><ConsentPanel variant="playground-upload" item={item} fullOption={full} onAllow={onAllow} onDecline={onDecline} /></main>);
    expect(screen.getByRole('heading', { name: 'Allow the cloud model to read this item?' })).toBeInTheDocument();
    expect(screen.getByText(/This is your own file and this Chrome has no on-device model/).textContent).toBe(
      'This is your own file and this Chrome has no on-device model. Allow the cloud model to read "move-out-notes.txt"?',
    );
    const disclosure = screen.getByRole('button', { name: 'Show the exact text' });
    expect(screen.queryByRole('region', { name: 'What the cloud model would read' })).toBeNull();
    await userEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'What the cloud model would read' })).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-text').textContent).toBe(full.text);
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Allow the cloud for this file' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onAllow).toHaveBeenCalledOnce();
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('own data: the item sentence and "Allow the cloud for this item"; without text it says why', async () => {
    render(<main><ConsentPanel variant="own" item={item} onAllow={() => undefined} onDecline={() => undefined} /></main>);
    expect(screen.getByText(/so Sieve can't read/).textContent).toBe(
      'This Chrome has no on-device model, so Sieve can\'t read "move-out-notes.txt" here. With your OK, the cloud model reads this one item, with personal details hidden. Nothing else is sent.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show the exact text' }));
    expect(screen.getByText("Sieve can't show the text without reading the item, so it shows only the title.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow the cloud for this item' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('relay: Deny instead of Not now', () => {
    render(<ConsentPanel variant="relay" item={item} onAllow={() => undefined} onDecline={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });
});
