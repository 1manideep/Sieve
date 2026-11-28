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
import { EXTENSION_ZIP_URL, zipLinkLabel } from '@/components/ExtensionInstall/ExtensionInstall';
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
        <Route path="/ask" element={<p>Ask page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db.table('sources').clear();
  useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'a@example.com', isAnonymous: false }, deviceId: 'dev-1', ownerConflict: false });
  useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' } });
});
afterEach(() => {
  useHomeBase.getState().reset();
});

describe('Setup', () => {
  it('step 1: connect your data first, with the Gmail and folder cards, the note and Skip for now', async () => {
    renderSetup();
    expect(screen.getByRole('heading', { level: 1, name: 'Set up Sieve' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Connect your data' })).toBeInTheDocument();
    expect(screen.getByText('Sieve reads your Gmail and the folders you pick, on this computer only. Mail and files never reach our server.')).toBeInTheDocument();
    expect(screen.getByText(/Indexing runs in the background on this device/)).toBeInTheDocument();
    expect(await screen.findAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    // First-run setup has no "Try now" link in its head; the control screens do.
    expect(screen.queryByRole('link', { name: 'Try now' })).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('step 1: Next once a real source is connected', async () => {
    await db.table('sources').put({ kind: 'folder', connected: true, paused: false, progress: { done: 3, total: 40 }, folderName: 'Documents' });
    renderSetup();
    expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
  });

  it('step 2: the embedded model setup, Skip for now, then Next when the model is ready', async () => {
    renderSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Prepare the on-device model' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Prepare the on-device model' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    act(() => useAvailability.setState({ text: 'downloadable', setup: { state: 'downloading', fraction: 0.3 } }));
    expect(screen.getByText('The download keeps going in the background while you finish setup.')).toBeInTheDocument();
    await expectNoAxeViolations();
    act(() => useAvailability.setState({ text: 'available', setup: { state: 'done' } }));
    expect(screen.getByText('Gemini Nano is ready on this computer.')).toBeInTheDocument();
    expect(screen.queryByText('The download keeps going in the background while you finish setup.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('step 3: names this computer and makes it the home base; the done state', async () => {
    const makeThisHomeBase = vi.fn(async () => {
      useHomeBase.setState({ homeBaseDeviceId: 'dev-1' });
    });
    useHomeBase.setState({ makeThisHomeBase });
    renderSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
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

  it('step 4: push, Connect an assistant, Finish', async () => {
    const setPushEnabled = vi.fn(async () => 'denied' as const);
    useSettings.setState({ setPushEnabled });
    renderSetup();
    for (let i = 0; i < 3; i += 1) await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
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

  it('step 4: the extension download with the steps to install it; none in a build without the extension', async () => {
    renderSetup();
    for (let i = 0; i < 3; i += 1) await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    // No VITE_EXTENSION_ID in tests and the port is closed: nothing about the extension.
    expect(screen.queryByText('Sieve extension')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: zipLinkLabel() })).not.toBeInTheDocument();
    act(() => useHomeBase.setState({ extension: 'not-installed' }));
    expect(screen.getByText('Sieve extension')).toBeInTheDocument();
    expect(screen.getByText('Approve requests next to any tab with the Sieve extension.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: zipLinkLabel() })).toHaveAttribute('href', EXTENSION_ZIP_URL);
    expect(screen.getByRole('link', { name: zipLinkLabel() }).className).toMatch(/secondary/);   // Finish stays the one primary
    expect(screen.getByRole('button', { name: 'How to install' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Turn on Developer mode, at the top right.')).toBeVisible();
    await expectNoAxeViolations();
    act(() => useHomeBase.setState({ extension: 'connected' }));
    expect(screen.getByText('Sieve extension connected. Approve requests from its side panel.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'How to install' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Back revisits a step; Skip setup marks it done and goes to Ask', async () => {
    renderSetup();
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Connect your data' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(localStorage.getItem(setupDoneKey('u1'))).toBe('1');
    expect(screen.getByText('Ask page')).toBeInTheDocument();
  });
});
