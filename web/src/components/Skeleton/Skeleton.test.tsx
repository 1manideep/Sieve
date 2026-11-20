import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('draws decorative static lines', async () => {
    const { container } = render(
      <main>
        <Skeleton lines={4} />
      </main>,
    );
    const block = container.querySelector('[aria-hidden="true"]');
    expect(block?.children).toHaveLength(4);
    await expectNoAxeViolations();
  });
});
