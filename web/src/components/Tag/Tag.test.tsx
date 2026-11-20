import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { Tag } from './Tag';

describe('Tag', () => {
  it('renders its text with the tone, and an optional decorative icon', async () => {
    render(
      <main>
        <Tag tone="device">This device · Gemini Nano</Tag>
        <Tag tone="cloud" icon="cloud">Cloud · Gemini</Tag>
        <Tag tone="never">Never shared</Tag>
      </main>,
    );
    expect(screen.getByText('This device · Gemini Nano').closest('[data-tone]')).toHaveAttribute('data-tone', 'device');
    const cloud = screen.getByText('Cloud · Gemini').closest('[data-tone]');
    expect(cloud).toHaveAttribute('data-tone', 'cloud');
    expect(cloud?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await expectNoAxeViolations();
  });
});
