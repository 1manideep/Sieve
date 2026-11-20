import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('reports its value as a percentage', async () => {
    render(<main><ProgressBar value={0.256} label="Indexing progress" valueText="64 of 250" /></main>);
    const bar = screen.getByRole('progressbar', { name: 'Indexing progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '26');
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 250');
    await expectNoAxeViolations();
  });

  it('is indeterminate without a value and clamps out-of-range values', () => {
    const { rerender } = render(<ProgressBar label="Loading" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    rerender(<ProgressBar label="Loading" value={1.7} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
