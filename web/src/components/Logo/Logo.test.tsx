import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { Logo } from './Logo';

describe('Logo', () => {
  it('links the name home, as text with no mark', async () => {
    const { container } = render(
      <MemoryRouter>
        <main>
          <Logo to="/" />
        </main>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Sieve' })).toHaveAttribute('href', '/');
    expect(container.querySelector('svg')).toBeNull();
    await expectNoAxeViolations();
  });

  it('renders without a link for the boot splash', () => {
    render(<Logo size="splash" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Sieve')).toBeInTheDocument();
  });
});
