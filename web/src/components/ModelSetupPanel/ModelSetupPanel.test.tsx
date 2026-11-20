import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncer } from '@/state/announcer';
import { useAvailability, type AvailabilityState } from '@/state/availability';
import { expectNoAxeViolations } from '@/test/axe';
import { ModelSetupPanel, type ModelSetupPanelProps } from './ModelSetupPanel';
import { panelState, setupErrorMessage, setupEtaMs } from './setupProgress';

function setAvailability(patch: Partial<AvailabilityState>) {
  act(() => {
    useAvailability.setState(patch);
  });
}

function renderPanel(props: ModelSetupPanelProps = {}) {
  return render(
    <MemoryRouter initialEntries={['/prepare']}>
      <Routes>
        <Route path="/prepare" element={<main><ModelSetupPanel {...props} /></main>} />
        <Route path="/playground" element={<p>Playground page</p>} />
        <Route path="/" element={<p>Ask page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useAvailability.setState({ text: 'checking', image: 'checking', setup: { state: 'idle' } });
});

describe('ModelSetupPanel (page)', () => {
  it('downloadable: the facts and "Start setup", which calls startSetup synchronously in the click', async () => {
    const startSetup = vi.fn();
    useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' }, startSetup });
    renderPanel();
    expect(screen.getByText('One-time setup')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Prepare the on-device model' })).toBeInTheDocument();
    expect(screen.getByText('Runs on this computer. What it reads never leaves it.')).toBeInTheDocument();
    expect(screen.getByText('About 3 to 4 minutes, one time. Keep this tab open while it downloads.')).toBeInTheDocument();
    expect(screen.getByText('Needs about 22 GB of free disk space.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start setup' });
    expect(start).toHaveFocus();
    await expectNoAxeViolations();
    await userEvent.click(start);
    expect(startSetup).toHaveBeenCalledOnce();
  });

  it('downloading: a determinate bar, the percentage, the tab note, and announcements at 25, 50 and 75', async () => {
    useAvailability.setState({ text: 'downloadable', setup: { state: 'downloading', fraction: 0.1, startedAt: Date.now() } });
    renderPanel();
    const bar = screen.getByRole('progressbar', { name: 'Setting up the on-device model' });
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect(bar).toHaveAttribute('aria-valuetext', '10% downloaded');
    expect(screen.getByTestId('setup-progress-text')).toHaveTextContent('10%');
    expect(screen.getByRole('link', { name: 'Open the Playground in a new tab' })).toHaveAttribute('target', '_blank');
    await expectNoAxeViolations();
    const original = useAnnouncer.getState().announce;
    const announce = vi.fn();
    useAnnouncer.setState({ announce });
    setAvailability({ setup: { state: 'downloading', fraction: 0.26 } });
    setAvailability({ setup: { state: 'downloading', fraction: 0.3 } });
    setAvailability({ setup: { state: 'downloading', fraction: 0.52 } });
    expect(announce.mock.calls.map((c) => c[0])).toEqual(['Setup 25% done.', 'Setup 50% done.']);
    useAnnouncer.setState({ announce: original });
  });

  it('installing, then ready: "The on-device model is ready" and Continue goes back', async () => {
    useAvailability.setState({ text: 'downloadable', setup: { state: 'installing', fraction: 1 } });
    renderPanel({ backHref: '/playground' });
    expect(screen.getByText('Installing on this device…')).toBeInTheDocument();
    expect(screen.getByText('Almost done. Chrome is unpacking the model.')).toBeInTheDocument();
    setAvailability({ text: 'available', setup: { state: 'done' } });
    expect(screen.getByRole('heading', { name: 'The on-device model is ready' })).toBeInTheDocument();
    expect(screen.getByText('Gemini Nano is set up in this Chrome.')).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Continue' });
    expect(go).toHaveFocus();
    await expectNoAxeViolations();
    await userEvent.click(go);
    expect(screen.getByText('Playground page')).toBeInTheDocument();
  });

  it('downloading in another tab: "Show progress"; an error: the mapped message and Try again', async () => {
    const startSetup = vi.fn();
    useAvailability.setState({ text: 'downloading', setup: { state: 'idle' }, startSetup });
    const { unmount } = renderPanel();
    expect(screen.getByText('Chrome is already setting up the model.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show progress' }));
    expect(startSetup).toHaveBeenCalledOnce();
    unmount();
    useAvailability.setState({ text: 'downloadable', setup: { state: 'error', error: 'Chrome needs more free disk space (about 22 GB) to set up the model.' } });
    renderPanel();
    expect(screen.getByText("Setup didn't finish")).toBeInTheDocument();
    expect(screen.getByText('Chrome needs more free disk space (about 22 GB) to set up the model.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(startSetup).toHaveBeenCalledTimes(2);
    await expectNoAxeViolations();
  });

  it('unavailable: the requirements, "Open the Playground" and Back', async () => {
    useAvailability.setState({ text: 'unavailable', setup: { state: 'idle' } });
    renderPanel();
    expect(screen.getByText("This Chrome can't run the on-device model")).toBeInTheDocument();
    expect(screen.getByText(/Gemini Nano needs desktop Chrome 139 or later/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Playground' })).toHaveAttribute('href', '/playground');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Ask page')).toBeInTheDocument();
  });
});

describe('ModelSetupPanel (embedded and compact)', () => {
  it('embedded: no H1, and the ready line', async () => {
    useAvailability.setState({ text: 'available', setup: { state: 'idle' } });
    renderPanel({ embedded: true });
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('Gemini Nano is ready on this computer.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('compact: the setup button, progress, installing, ready and the cannot-run line', async () => {
    const startSetup = vi.fn();
    useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' }, startSetup });
    renderPanel({ variant: 'compact' });
    expect(screen.getByText("Gemini Nano isn't set up in this Chrome yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set up on-device AI (about 4 GB, about 3 to 4 minutes)' }));
    expect(startSetup).toHaveBeenCalledOnce();
    setAvailability({ setup: { state: 'downloading', fraction: 0.42 } });
    expect(screen.getByText('Setting up Gemini Nano on this computer · 42%')).toBeInTheDocument();
    setAvailability({ setup: { state: 'installing', fraction: 1 } });
    expect(screen.getByText('Installing… Chrome is unpacking the model. This can sit near 90% for a minute or two.')).toBeInTheDocument();
    setAvailability({ text: 'available', setup: { state: 'done' } });
    expect(screen.getByText('On-device model ready')).toBeInTheDocument();
    setAvailability({ text: 'unavailable', setup: { state: 'idle' } });
    expect(screen.getByText("This Chrome can't run Gemini Nano. Playground answers run in the cloud on sample data.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Why?' })).toHaveAttribute('href', '/prepare?back=/playground');
    await expectNoAxeViolations();
  });
});

describe('setup helpers', () => {
  it('maps rejections to the copy of 40 section 13.2', () => {
    expect(setupErrorMessage({ name: 'QuotaExceededError' })).toBe('Chrome needs more free disk space (about 22 GB) to set up the model.');
    expect(setupErrorMessage({ code: 'needs-click' })).toBe('Chrome needs a click to start. Press Try again.');
    expect(setupErrorMessage({ name: 'NetworkError' })).toBe('The download stopped. Check your connection and press Try again.');
    expect(setupErrorMessage(new Error('boom'), false)).toBe('The download stopped. Check your connection and press Try again.');
    expect(setupErrorMessage(new Error('boom'), true)).toBe("Chrome couldn't set up the model. Try again, or use the Playground, which works without it.");
  });

  it('estimates the time left only after 10 s of samples', () => {
    expect(setupEtaMs([{ at: 0, fraction: 0 }, { at: 5000, fraction: 0.1 }], 5000)).toBeUndefined();
    expect(setupEtaMs([{ at: 0, fraction: 0 }, { at: 10_000, fraction: 0.1 }], 10_000)).toBe(90_000);
    expect(setupEtaMs([{ at: 0, fraction: 0.5 }, { at: 20_000, fraction: 0.5 }], 20_000)).toBeUndefined();
  });

  it('picks the state the panel shows', () => {
    expect(panelState('downloadable', 'idle')).toBe('idle');
    expect(panelState('downloading', 'idle')).toBe('elsewhere');
    expect(panelState('downloadable', 'downloading')).toBe('downloading');
    expect(panelState('available', 'idle')).toBe('ready');
    expect(panelState('no-api', 'idle')).toBe('unavailable');
    expect(panelState('checking', 'idle')).toBe('checking');
  });
});
