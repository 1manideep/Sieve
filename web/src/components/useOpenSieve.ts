// Open Sieve (40 sections 6.3 and 13.1): the one way into the product, shared by the public header, Welcome and
// Try. Google sign-in, then ?next or `/ask`; a new account goes on to /setup (the Google session sends it, 40 section
// 6.5). Cancelled changes nothing; an error stays on this screen, where the session store has shown its toast.
// Public screens have no route loader, so the auth listener may not have reported yet: the click waits for it first,
// and a Google session kept from before (IndexedDB, 40 section 4.2) goes straight in with no popup.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession, whenAuthReady } from '@/state/session';
import { safePath, waitForGoogle } from './signIn';

/** The first auth callback can wait on a token refresh; never hold the click longer than this before asking Google. */
const AUTH_WAIT_MS = 4000;

function authSettled(): Promise<void> {
  return Promise.race([whenAuthReady(), new Promise<void>((resolve) => setTimeout(resolve, AUTH_WAIT_MS))]);
}

export function useOpenSieve(): { openSieve(): Promise<void>; signingIn: boolean } {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const signingIn = useSession((s) => s.signingIn);
  const [checking, setChecking] = useState(false);

  const openSieve = async () => {
    const next = safePath(params.get('next'), '/ask');
    const before = useSession.getState();
    if (before.kind !== 'google' && before.status === 'loading') {
      setChecking(true);
      try {
        await authSettled();
      } finally {
        setChecking(false);
      }
    }
    if (useSession.getState().kind === 'google') {
      navigate(next);
      return;
    }
    const result = await useSession.getState().signInWithGoogle();
    if (result !== 'ok') return;
    await waitForGoogle();
    navigate(next);
  };

  return { openSieve, signingIn: signingIn || checking };
}
