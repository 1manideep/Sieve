// "Auto-approve on" in the status strip (40 sections 8.1 and 13.8.9): a segment and a link to Settings.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { STATUS } from '@/copy/strings';
import { useAutoApprove } from '@/state/autoApprove';
import { useHomeBase } from '@/state/homeBase';
import { expectNoAxeViolations } from '@/test/axe';
import { StatusStrip } from './StatusStrip';
import { statusModel, type StatusInput } from './statusModel';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.hash}</p>;
}

function renderStrip(layout: 'pill' | 'card' = 'card') {
  const router = createMemoryRouter(
    [{ path: '*', element: (<main><StatusStrip extensionEnabled={false} layout={layout} /><Where /></main>) }],
    { initialEntries: ['/requests'] },
  );
  return render(<RouterProvider router={router} />);
}

const input: StatusInput = {
  online: true,
  homeBase: { role: 'active', presence: 'online', homeBaseLabel: undefined, waitingForClick: false, extension: 'off' },
  availability: { text: 'available', setup: { state: 'idle' } },
  indexing: { state: 'idle', left: 0, done: 0, total: 0, etaMs: undefined },
  extensionEnabled: false,
};

let stop: () => void = () => undefined;

afterEach(() => {
  stop();
  window.localStorage.clear();
  useHomeBase.getState().reset();
});

describe('status strip: auto-approve', () => {
  it('adds an amber "Auto-approve on" segment only while it is on', () => {
    expect(statusModel(input).segments.map((s) => s.id)).not.toContain('auto-approve');
    const on = statusModel({ ...input, autoApprove: true });
    expect(on.segments.at(-1)).toEqual({ id: 'auto-approve', text: STATUS.autoApproveOn, tone: 'amber' });
    expect(on.tone).toBe('amber');
    expect(on.accessibleName).toContain(STATUS.autoApproveOn);
  });

  it('shows a link to Settings under the meter card while any connection has it on, and clears at once', async () => {
    const user = userEvent.setup();
    stop = useAutoApprove.getState().start('u1');
    useHomeBase.setState({ role: 'active', presence: 'online' });
    renderStrip();
    expect(screen.queryByRole('link', { name: STATUS.autoApproveOn })).not.toBeInTheDocument();
    act(() => useAutoApprove.getState().turnOn('g1'));
    const link = await screen.findByRole('link', { name: STATUS.autoApproveOn });
    expect(link).toHaveAttribute('href', '/settings#ais');
    expect(screen.getByRole('button', { name: /^Status: / }).getAttribute('aria-label')).toContain(STATUS.autoApproveOn);
    await expectNoAxeViolations();
    await user.click(link);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#ais');
    act(() => useAutoApprove.getState().turnOff('g1'));
    expect(screen.queryByRole('link', { name: STATUS.autoApproveOn })).not.toBeInTheDocument();
  });
});
