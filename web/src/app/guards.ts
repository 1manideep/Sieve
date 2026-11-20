// Route guards (40 section 5.3).
import { redirect, type LoaderFunctionArgs } from 'react-router-dom';
import { useSession, whenAuthReady } from '@/state/session';

export async function requireGoogle({ request }: LoaderFunctionArgs): Promise<null> {
  await whenAuthReady();
  if (useSession.getState().kind !== 'google') {
    const url = new URL(request.url);
    throw redirect('/?next=' + encodeURIComponent(url.pathname + url.search + url.hash));
  }
  return null;
}

