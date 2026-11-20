import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows the title, the sentence and actions', async () => {
    render(
      <main>
        <EmptyState icon="shield" title="What has AI seen?" body="Nothing shared yet." actions={<button type="button">Clear filters</button>} />
      </main>,
    );
    expect(screen.getByText('What has AI seen?')).toBeInTheDocument();
    expect(screen.getByText('Nothing shared yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
