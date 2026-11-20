import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { SCREENS } from '@/copy/strings';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the H1, the lead and the actions', async () => {
    render(
      <main>
        <PageHeader title={SCREENS.seen.heading} lead={SCREENS.seen.lead} actions={<button type="button">Check</button>} />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 1, name: SCREENS.seen.heading })).toBeInTheDocument();
    expect(screen.getByText(SCREENS.seen.lead)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
