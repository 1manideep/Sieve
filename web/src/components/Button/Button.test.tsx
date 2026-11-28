import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { Button, LinkButton } from './Button';

describe('Button', () => {
  it('is a type="button" by default and runs onClick', async () => {
    const onClick = vi.fn();
    render(<main><Button variant="primary" onClick={onClick}>Approve</Button></main>);
    const button = screen.getByRole('button', { name: 'Approve' });
    expect(button).toHaveAttribute('type', 'button');
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('marks itself busy without changing the label', () => {
    render(<Button variant="secondary" busy>Saving</Button>);
    expect(screen.getByRole('button', { name: 'Saving' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('LinkButton', () => {
  it('renders a router link, or an external link in a new tab', async () => {
    render(
      <MemoryRouter>
        <main>
          <LinkButton to="/playground" variant="secondary">Playground</LinkButton>
          <LinkButton to="https://example.com" external variant="secondary">Source code</LinkButton>
        </main>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '/playground');
    const external = screen.getByRole('link', { name: 'Source code' });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener');
    await expectNoAxeViolations();
  });

  it('renders a plain link with the download attribute for a file to save', () => {
    render(<LinkButton to="/downloads/file.zip" download variant="primary">Download</LinkButton>);
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('href', '/downloads/file.zip');
    expect(link).toHaveAttribute('download');
    expect(link).not.toHaveAttribute('target');
  });
});
