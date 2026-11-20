// A Google session kept from before (40 sections 4.2 and 6): getAuth keeps the user in IndexedDB, so a reload, a new
// tab or a new Chrome window comes back signed in. Public screens have no route loader, so Open Sieve itself waits for
// the auth listener and goes straight in with no popup. Its own file: the session store starts fresh, as on a reload.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { FakeUser } from '@/test/fakes/firebaseAuth';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));
const startGoogleSession = vi.fn(async () => undefined);
const stopGoogleSession = vi.fn(async () => undefined);
vi.mock('@/app/googleSession', () => ({ startGoogleSession, stopGoogleSession }));

const auth = await import('@/test/fakes/firebaseAuth');
const { useSession, whenSessionSettled } = await import('@/state/session');
const { useOpenSieve } = await import('./useOpenSieve');

const kept: FakeUser = {
  uid: 'uid-mani',
  email: 'mani@example.com',
  displayName: 'Mani',
  photoURL: 'https://lh3.googleusercontent.com/a/photo',
  isAnonymous: false,
};

function OpenButton() {
  const { openSieve, signingIn } = useOpenSieve();
  return (
    <button type="button" disabled={signingIn} onClick={() => void openSieve()}>
      Open Sieve
    </button>
  );
}

describe('a Google session kept from before', () => {
  it('comes back as kind google with no popup: Open Sieve on a public screen goes straight to /ask', async () => {
    auth.setFakeAuthUser(kept);   // what the SDK reads back from IndexedDB on a reload
    expect(useSession.getState()).toMatchObject({ status: 'loading', kind: 'none' });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<OpenButton />} />
          <Route path="/ask" element={<p>Ask page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open Sieve' }));
    expect(await screen.findByText('Ask page')).toBeInTheDocument();
    await whenSessionSettled();

    expect(useSession.getState()).toMatchObject({
      status: 'ready',
      kind: 'google',
      ownerConflict: false,
      user: { uid: 'uid-mani', email: 'mani@example.com', photoURL: kept.photoURL, isAnonymous: false },
    });
    expect(auth.signInWithPopup).not.toHaveBeenCalled();
    expect(startGoogleSession).toHaveBeenCalledOnce();
    // Nothing on the way in signs the person out or stops the session.
    expect(stopGoogleSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
