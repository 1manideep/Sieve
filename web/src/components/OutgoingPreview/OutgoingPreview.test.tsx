import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { DEPOSIT_ANSWER, DEPOSIT_FULL, option } from '../__fixtures__/proposals';
import { OutgoingPreview } from './OutgoingPreview';

describe('OutgoingPreview', () => {
  it('renders option.text exactly, punctuation included', async () => {
    render(<main><OutgoingPreview id="p" label="What would leave this device" option={option('answer', DEPOSIT_ANSWER)} /></main>);
    expect(screen.getByRole('region', { name: 'What would leave this device' })).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-text').textContent).toBe('Your deposit was $1,200, paid on March 3.');
    expect(screen.getByText('41 characters · No personal details found')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('shows redaction chips and the count of hidden details', async () => {
    const full = option('full', DEPOSIT_FULL, { redactions: 3 });
    render(<main><OutgoingPreview id="p" label="What would leave this device" option={full} /></main>);
    expect(screen.getByTestId('outgoing-text').textContent).toBe(DEPOSIT_FULL);
    expect(screen.getByText('[name 1]')).toHaveAttribute('title', 'Hidden on this device');
    expect(screen.getByText(`${full.chars} characters · 3 personal details hidden on this device`)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('in-app: the instruction block and the total; one redaction reads in the singular', async () => {
    const instruction = 'Draft a short, polite reply.';
    render(
      <main>
        <OutgoingPreview id="p" label="What would leave this device" option={option('excerpt', 'Hi [name].', { redactions: 1 })} instruction={instruction} />
      </main>,
    );
    expect(screen.getByText('Plus your instruction')).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-instruction').textContent).toBe(`“${instruction}”`);
    expect(screen.getByText(`10 characters · 1 personal detail hidden on this device · ${10 + instruction.length} characters in total`)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says when the text is more than Sieve sends at once', async () => {
    render(<main><OutgoingPreview id="p" label="Exactly what Gemini CLI would receive" option={option('full', 'x'.repeat(8001))} overLimit /></main>);
    expect(screen.getByText('This is more than Sieve sends at once (8,000 characters). Untick an item or pick a lower step.')).toBeInTheDocument();
    expect(screen.getByText('8,001 characters · No personal details found')).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
