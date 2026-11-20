import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { Notice } from './Notice';

describe('Notice', () => {
  it('has no role when static, and role status when it answers something the person did', async () => {
    const { rerender } = render(
      <main>
        <Notice tone="warning" title="Money asks first" actions={<button type="button">Settings</button>}>
          <p>Check the exact text before you share it.</p>
        </Notice>
      </main>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Money asks first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    await expectNoAxeViolations();
    rerender(
      <main>
        <Notice tone="info" live>
          <p>Saved.</p>
        </Notice>
      </main>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    await expectNoAxeViolations();
  });
});
