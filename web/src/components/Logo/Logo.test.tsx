import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { Logo } from './Logo';

describe('Logo', () => {
  it('links the wordmark home, with the shield hidden from assistive tech', async () => {
    const { container } = render(
      <MemoryRouter>
        <main>
          <Logo to="/" />
        </main>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Sieve' })).toHaveAttribute('href', '/');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await expectNoAxeViolations();
  });

  it('renders without a link for the boot splash', () => {
    render(<Logo size="splash" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Sieve')).toBeInTheDocument();
  });
});
