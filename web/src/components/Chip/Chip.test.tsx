import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { Chip } from './Chip';

describe('Chip', () => {
  it('is a button that reports whether it is the current one', async () => {
    const onClick = vi.fn();
    render(
      <main>
        <Chip selected onClick={onClick}>Landlord's email about the deposit</Chip>
        <Chip onClick={onClick} selectedStyle="inverse">What does my lease say about pets?</Chip>
      </main>,
    );
    expect(screen.getByRole('button', { name: "Landlord's email about the deposit" })).toHaveAttribute('aria-pressed', 'true');
    const other = screen.getByRole('button', { name: 'What does my lease say about pets?' });
    expect(other).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(other);
    expect(onClick).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });
});
