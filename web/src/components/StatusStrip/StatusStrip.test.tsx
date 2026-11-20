import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { expectNoAxeViolations } from '@/test/axe';
import { STATUS_POPOVER } from '@/copy/strings';
import { useAvailability } from '@/state/availability';
import { useHomeBase } from '@/state/homeBase';
import { useIndexing } from '@/state/indexing';
import { useNetwork } from '@/state/network';
import { StatusStrip } from './StatusStrip';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderStrip(extensionEnabled = false) {
  const router = createMemoryRouter(
    [{ path: '*', element: (<main><StatusStrip extensionEnabled={extensionEnabled} /><Where /></main>) }],
    { initialEntries: ['/sources'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('StatusStrip', () => {
  afterEach(() => {
    useHomeBase.getState().reset();
    useNetwork.setState({ online: true });
    useAvailability.setState({ text: 'checking', image: 'checking', setup: { state: 'idle' } });
    useIndexing.setState({ state: 'idle', left: 0, done: 0, total: 0, etaMs: undefined });
  });

  it('shows the segments from the stores and names the pill', async () => {
    useHomeBase.setState({ role: 'active', presence: 'online' });
    useAvailability.setState({ text: 'available' });
    useIndexing.setState({ state: 'running', left: 412, done: 88, total: 500 });
    renderStrip();
    const pill = screen.getByRole('button', {
      name: 'Status: Home base online, On-device model ready, Indexing 412 left. Show details.',
    });
    expect(pill).toHaveTextContent('Home base online · On-device model ready · Indexing 412 left');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    await expectNoAxeViolations();
  });

  it('opens the popover, focuses its heading and closes on Escape', async () => {
    const user = userEvent.setup();
    useHomeBase.setState({ role: 'not-home-base' });
    useAvailability.setState({ text: 'downloadable' });
    renderStrip();
    const pill = screen.getByRole('button', { name: /^Status: / });
    await user.click(pill);
    expect(pill).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: STATUS_POPOVER.heading })).toHaveFocus();
    expect(screen.getByText(STATUS_POPOVER.homeBaseNone)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STATUS_POPOVER.makeHomeBase })).toBeInTheDocument();
    expect(screen.getByText(STATUS_POPOVER.modelDownloadable)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pill).toHaveFocus();
  });

  it('"Set it up" goes to /prepare with the current path', async () => {
    const user = userEvent.setup();
    useAvailability.setState({ text: 'downloadable' });
    renderStrip();
    await user.click(screen.getByRole('button', { name: /^Status: / }));
    await user.click(screen.getByRole('button', { name: STATUS_POPOVER.setItUp }));
    expect(screen.getByTestId('where')).toHaveTextContent('/prepare?back=%2Fsources');
  });

  it('calls the home base store for "Stop being the home base"', async () => {
    const user = userEvent.setup();
    const stop = vi.fn(async () => undefined);
    useHomeBase.setState({ role: 'active', presence: 'online', stopBeingHomeBase: stop });
    useAvailability.setState({ text: 'available' });
    renderStrip();
    await user.click(screen.getByRole('button', { name: /^Status: / }));
    await user.click(screen.getByRole('button', { name: STATUS_POPOVER.stopHomeBase }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it('shows indexing progress with Pause and the Sources link', async () => {
    const user = userEvent.setup();
    useAvailability.setState({ text: 'available' });
    useIndexing.setState({ state: 'running', left: 40, done: 60, total: 100 });
    renderStrip();
    await user.click(screen.getByRole('button', { name: /^Status: / }));
    expect(screen.getByRole('progressbar', { name: STATUS_POPOVER.indexingProgress })).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByRole('button', { name: STATUS_POPOVER.pause })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: STATUS_POPOVER.sourcesLink })).toHaveAttribute('href', '/sources');
    await expectNoAxeViolations();
  });

  it('shows the extension row only when configured, with a link to get it', async () => {
    const user = userEvent.setup();
    useHomeBase.setState({ role: 'active', presence: 'online', extension: 'not-installed' });
    renderStrip(true);
    await user.click(screen.getByRole('button', { name: /^Status: / }));
    expect(screen.getByText(STATUS_POPOVER.extensionNotInstalled)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: STATUS_POPOVER.getExtension })).toHaveAttribute('target', '_blank');
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    renderStrip();
    await user.click(screen.getByRole('button', { name: /^Status: / }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('where'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
