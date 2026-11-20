import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { SHELL } from '@/copy/strings';
import { useNetwork } from '@/state/network';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  afterEach(() => useNetwork.setState({ online: true }));

  it('is hidden while online', () => {
    useNetwork.setState({ online: true });
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the offline text as a status while offline', async () => {
    useNetwork.setState({ online: false });
    render(<main><OfflineBanner /></main>);
    expect(screen.getByRole('status')).toHaveTextContent(SHELL.offline);
    await expectNoAxeViolations();
    act(() => useNetwork.setState({ online: true }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
