import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHELL } from '@/copy/strings';
import { emitIndexEvent } from '@/index/events';
import { expectNoAxeViolations } from '@/test/axe';
import { TabClosedBanner } from './TabClosedBanner';

describe('TabClosedBanner (R-PLAT-09)', () => {
  it('stays hidden until another tab closes the index here, then asks to reload', async () => {
    const { container } = render(<main><TabClosedBanner /></main>);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => emitIndexEvent({ type: 'db-blocked', db: 'sieve-real' }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => emitIndexEvent({ type: 'db-closed', db: 'sieve-real' }));
    expect(screen.getByRole('alert')).toHaveTextContent(SHELL.updatedInAnotherTab);
    expect(screen.getByRole('button', { name: SHELL.reload })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
