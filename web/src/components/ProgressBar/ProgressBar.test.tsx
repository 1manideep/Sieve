import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('reports its value as a percentage', async () => {
    render(<main><ProgressBar value={0.256} label="Indexing progress" valueText="64 of 250" /></main>);
    const bar = screen.getByRole('progressbar', { name: 'Indexing progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '26');
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 250');
    await expectNoAxeViolations();
  });

  it('is indeterminate without a value and clamps out-of-range values', () => {
    const { rerender } = render(<ProgressBar label="Loading" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    rerender(<ProgressBar label="Loading" value={1.7} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('fills with a 600 ms ease-out width transition that reduced motion keeps (it is not motion)', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ProgressBar.module.css'), 'utf8');
    const fill = /\.fill\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(fill).toMatch(/transition:\s*width 600ms var\(--ease-out/);
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([^@]*)\}/.exec(css)?.[1] ?? '';
    expect(reduced).not.toMatch(/\.fill\b/);
    expect(reduced).not.toMatch(/transition/);
  });
});
