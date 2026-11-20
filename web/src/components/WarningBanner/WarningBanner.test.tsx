import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Warning, WarningKind } from '@sieve/shared';
import { expectNoAxeViolations } from '@/test/axe';
import { WarningBanner, WarningList } from './WarningBanner';

const w = (kind: WarningKind, message = `${kind} message`): Warning => ({ kind, message });

describe('WarningBanner', () => {
  it.each([
    ['injection', 'Possible instruction aimed at an AI', 'warning'],
    ['hidden-text-removed', 'Hidden text removed before any model read it', 'warning'],
    ['ask-first', 'Money asks first', 'warning'],
    ['cloud-fallback', 'Uses the cloud model', 'cloud'],
    ['sample-data-cloud', 'Sample data ran in the cloud', 'cloud'],
    ['pii-redacted', 'Personal details hidden', 'info'],
  ] as const)('%s: title "%s", tone %s, body from the pipeline', async (kind, title, tone) => {
    render(<main><WarningBanner warning={w(kind)} category="Money" /></main>);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(`${kind} message`)).toBeInTheDocument();
    expect(document.querySelector(`[data-warning="${kind}"] [data-tone]`)).toHaveAttribute('data-tone', tone);
    await expectNoAxeViolations();
  });

  it('shows the message alone for kinds without a title', () => {
    render(<WarningBanner warning={w('source-unchecked', "Sieve couldn't check that this email still exists.")} />);
    expect(screen.getByText("Sieve couldn't check that this email still exists.")).toBeInTheDocument();
  });
});

describe('WarningList', () => {
  it('orders warnings as in 40 section 16.6, with ask-first last (just above the buttons)', () => {
    const { container } = render(
      <WarningList warnings={[w('pii-redacted'), w('ask-first'), w('injection'), w('sample-data-cloud'), w('hidden-text-removed')]} category="Money" showCleanCheck />,
    );
    expect([...container.querySelectorAll('[data-warning]')].map((e) => e.getAttribute('data-warning'))).toEqual([
      'injection', 'hidden-text-removed', 'sample-data-cloud', 'pii-redacted', 'ask-first',
    ]);
    expect(screen.queryByText('Checked on this device: no hidden instructions found')).toBeNull();
  });

  it('adds the clean-check tag only when the trace has an injection step and nothing was flagged', async () => {
    const { rerender } = render(<main><WarningList warnings={[w('pii-redacted')]} showCleanCheck /></main>);
    expect(screen.getByText('Checked on this device: no hidden instructions found')).toBeInTheDocument();
    await expectNoAxeViolations();
    rerender(<main><WarningList warnings={[w('pii-redacted')]} showCleanCheck={false} /></main>);
    expect(screen.queryByText('Checked on this device: no hidden instructions found')).toBeNull();
    rerender(<main><WarningList warnings={[w('hidden-text-removed')]} showCleanCheck /></main>);
    expect(screen.queryByText('Checked on this device: no hidden instructions found')).toBeNull();
  });
});
