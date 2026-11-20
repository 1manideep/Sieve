import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAvailability } from '@/state/availability';
import { useHomeBase } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { expectNoAxeViolations } from '@/test/axe';
import { makeFakeDb } from '@/components/__fixtures__/fakeDb';
import { SetupScreen, setupDoneKey } from './index';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
const db = makeFakeDb('real');
vi.mock('@/index', () => ({ openDb: () => db }));

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<main><SetupScreen /></main>} />
        <Route path="/" element={<p>Ask page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'a@example.com', isAnonymous: false }, deviceId: 'dev-1', ownerConflict: false });
  useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' } });
});
afterEach(() => {
  useHomeBase.getState().reset();
});

describe('Setup', () => {
  it('step 1: the embedded setup, the stepper text, Skip for now', async () => {
    renderSetup();
    expect(screen.getByRole('heading', { level: 1, name: 'Set up Sieve' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Prepare the on-device model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Prepare the on-device model' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    // First-run setup has no "Try now" link in its head; the control screens do.
    expect(screen.queryByRole('link', { name: 'Try now' })).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('step 2: names this computer and makes it the home base; the done state', async () => {
    const makeThisHomeBase = vi.fn(async () => {
      useHomeBase.setState({ homeBaseDeviceId: 'dev-1' });
    });
    useHomeBase.setState({ makeThisHomeBase });
    renderSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Make this computer your home base' })).toHaveFocus();
    const field = screen.getByLabelText('Name this computer');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Make this my home base' }));
    expect(screen.getByText('Give this computer a name.')).toBeInTheDocument();
    expect(makeThisHomeBase).not.toHaveBeenCalled();
    await userEvent.type(field, 'Mac mini');
    await userEvent.click(screen.getByRole('button', { name: 'Make this my home base' }));
    expect(makeThisHomeBase).toHaveBeenCalledWith('Mac mini');
    expect(await screen.findByText('This computer is your home base.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('step 3: the folder and Gmail cards and the note; step 4: push, Connect an assistant, Finish', async () => {
    const setPushEnabled = vi.fn(async () => 'denied' as const);
    useSettings.setState({ setPushEnabled });
    renderSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Connect a source' })).toBeInTheDocument();
    expect(screen.getByText(/Indexing runs in the background on this device/)).toBeInTheDocument();
    expect(screen.getAllByRole('article').length).toBe(2);
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Get told when an AI asks' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Push notification when a request is waiting'));
    expect(setPushEnabled).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Notifications are blocked for this site. Allow them in Chrome's site settings, then turn this on.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect an assistant' })).toHaveAttribute('href', '/settings?connect=1#ais');
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(localStorage.getItem(setupDoneKey('u1'))).toBe('1');
    expect(screen.getByText('Ask page')).toBeInTheDocument();
  });

  it('Back revisits a step; Skip setup marks it done and goes to Ask', async () => {
    renderSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    act(() => useAvailability.setState({ text: 'available' }));
    expect(screen.getByText('Gemini Nano is ready on this computer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(localStorage.getItem(setupDoneKey('u1'))).toBe('1');
    expect(screen.getByText('Ask page')).toBeInTheDocument();
  });
});
