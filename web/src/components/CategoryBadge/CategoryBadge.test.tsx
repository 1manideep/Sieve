import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { CategoryBadge } from './CategoryBadge';

describe('CategoryBadge', () => {
  it('badge mode: the category, plus "Ask first" or "Never shared"', async () => {
    const { rerender } = render(<main><CategoryBadge category="Home" rule="approve" /></main>);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Ask first')).toBeNull();
    rerender(<main><CategoryBadge category="Money" rule="ask-first" /></main>);
    expect(screen.getByText('Ask first').closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
    rerender(<main><CategoryBadge category="Health" rule="never" /></main>);
    expect(screen.getByText('Never shared').closest('[data-tone]')).toHaveAttribute('data-tone', 'never');
    await expectNoAxeViolations();
  });

  it('rule-line mode: one tag per rule', async () => {
    const { rerender } = render(<main><CategoryBadge category="Home" rule="approve" mode="rule-line" /></main>);
    expect(screen.getByText('Home · shares with your approval').closest('[data-tone]')).toHaveAttribute('data-tone', 'device');
    rerender(<main><CategoryBadge category="Money" rule="ask-first" mode="rule-line" /></main>);
    expect(screen.getByText('Money · asks first')).toBeInTheDocument();
    rerender(<main><CategoryBadge category="Health" rule="never" mode="rule-line" /></main>);
    expect(screen.getByText('Health · never shared')).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
