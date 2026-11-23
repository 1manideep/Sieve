// Gmail access running out, on every page of the home base (Nov 23): the quiet notice before it ends, the warning
// after, the one line about pop-ups, the extension told, and the state as the row and the time give it.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeDb } from '@/components/__fixtures__/fakeDb';
import { GMAIL_ACCESS, SOURCES } from '@/copy/screens-controls';
import { useHomeBase } from '@/state/homeBase';
import { useSources, type SourcesState } from '@/state/sources';
import { expectNoAxeViolations } from '@/test/axe';
import { GmailAccess } from './GmailAccess';
import { gmailAccessState } from './gmailRow';

const realDb = makeFakeDb('real');
vi.mock('@/index', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/index')>()), openDb: () => realDb }));
const renew = vi.hoisted(() => ({ blocked: false, listeners: new Set<() => void>() }));
vi.mock('@/sources/gmail/renew', () => ({
  renewBlockedByChrome: () => renew.blocked,
  onRenewBlocked: (fn: () => void) => {
    renew.listeners.add(fn);
    return () => renew.listeners.delete(fn);
  },
}));

const MIN = 60_000;
const SKEW = 60_000;   // GMAIL_TOKEN_SKEW_MS: the token is not used in its last minute
const row = (over: Record<string, unknown> = {}) => ({ kind: 'gmail', connected: true, paused: false, progress: { done: 30, total: 30 }, ...over });
const reauthorize = vi.fn<SourcesState['reauthorize']>(async () => undefined);

beforeEach(() => {
  useSources.setState({ reauthorize, busy: {} });
  useHomeBase.setState({ gmailEnded: false });
  renew.blocked = false;
});
afterEach(async () => {
  await realDb.table('sources').clear();
  reauthorize.mockClear();
});

describe('gmailAccessState', () => {
  const now = 1_800_000_000_000;
  it('ending in the last 10 minutes, ended once it ran out or the row says so, refused when Google said no', () => {
    expect(gmailAccessState(undefined, now)).toEqual({ kind: 'ok' });
    expect(gmailAccessState(row({ accessToken: { expiresAt: now + SKEW + 30 * MIN } }), now)).toEqual({ kind: 'ok' });
    expect(gmailAccessState(row({ accessToken: { expiresAt: now + SKEW + 10 * MIN } }), now)).toEqual({ kind: 'ending', minutes: 10 });
    expect(gmailAccessState(row({ accessToken: { expiresAt: now + SKEW + 20_000 } }), now)).toEqual({ kind: 'ending', minutes: 1 });
    expect(gmailAccessState(row({ accessToken: { expiresAt: now + SKEW } }), now)).toEqual({ kind: 'ended' });
    expect(gmailAccessState(row({ needsAuth: true }), now)).toEqual({ kind: 'ended' });
    // a tab already took the spent token off the row, before the next sync marks it
    expect(gmailAccessState(row({ tokenEndedAt: now - 5 * MIN }), now)).toEqual({ kind: 'ended' });
    expect(gmailAccessState(row(), now)).toEqual({ kind: 'ok' });
    expect(gmailAccessState(row({ needsAuth: true, errorCode: 'auth-needed' }), now)).toEqual({ kind: 'refused' });
    // paused, or not connected: nothing to say
    expect(gmailAccessState(row({ needsAuth: true, paused: true }), now)).toEqual({ kind: 'ok' });
    expect(gmailAccessState(row({ connected: false, needsAuth: true }), now)).toEqual({ kind: 'ok' });
  });
});

describe('GmailAccess', () => {
  it('before it runs out: a quiet notice, and "Keep Gmail connected" renews inside the click', async () => {
    const user = userEvent.setup();
    await realDb.table('sources').put(row({ accessToken: { value: 'token', expiresAt: Date.now() + SKEW + 8 * MIN - 1_000, scope: 'gmail.readonly' } }));
    render(<main><GmailAccess /></main>);
    const text = await screen.findByText('Gmail access on this computer ends in 8 min. Keep it connected so Sieve can read new mail and answer about the latest.');
    expect(text.closest('[data-tone]')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByText(GMAIL_ACCESS.popups)).toBeInTheDocument();
    expect(useHomeBase.getState().gmailEnded).toBe(false);
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: 'Keep Gmail connected' }));
    expect(reauthorize).toHaveBeenCalledWith('gmail');
    // renewed: the notice goes
    await act(async () => {
      await realDb.table('sources').put(row({ accessToken: { value: 'new', expiresAt: Date.now() + 60 * MIN, scope: 'gmail.readonly' } }));
    });
    await waitFor(() => expect(screen.queryByTestId('gmail-access')).not.toBeInTheDocument());
  });

  it('once it ran out: the warning with Reconnect Gmail, and the extension is told', async () => {
    const user = userEvent.setup();
    await realDb.table('sources').put(row({ needsAuth: true }));
    render(<main><GmailAccess /></main>);
    const text = await screen.findByText(
      "Gmail access on this computer ran out. Until you reconnect, Sieve can't read new mail, answer about the latest mail or send an attachment.",
    );
    expect(text.closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('To renew without a click, allow pop-ups for this site: press the icon left of the address, open Site settings and set Pop-ups and redirects to Allow.')).toBeInTheDocument();
    await waitFor(() => expect(useHomeBase.getState().gmailEnded).toBe(true));
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: 'Reconnect Gmail' }));
    expect(reauthorize).toHaveBeenCalledWith('gmail');
    await act(async () => {
      await realDb.table('sources').put(row({ accessToken: { value: 'new', expiresAt: Date.now() + 60 * MIN, scope: 'gmail.readonly' } }));
    });
    await waitFor(() => expect(useHomeBase.getState().gmailEnded).toBe(false));
  });

  it('says when Chrome blocked the renewal window', async () => {
    await realDb.table('sources').put(row({ needsAuth: true }));
    render(<main><GmailAccess /></main>);
    await screen.findByText(GMAIL_ACCESS.popups);
    act(() => {
      renew.blocked = true;
      for (const fn of renew.listeners) fn();
    });
    expect(screen.getByText(`Chrome blocked the window Sieve opens to renew Gmail access. ${GMAIL_ACCESS.popups}`)).toBeInTheDocument();
  });

  it('shows what went wrong with the last click, and a refusal without the pop-up line', async () => {
    await realDb.table('sources').put(row({ accessToken: { value: 't', expiresAt: Date.now() + SKEW + 5 * MIN, scope: 'gmail.readonly' }, errorCode: 'popup-closed', error: 'Sign-in was closed. Nothing changed.' }));
    const { unmount } = render(<main><GmailAccess /></main>);
    expect(await screen.findByText('Sign-in was closed. Nothing changed.')).toBeInTheDocument();
    unmount();
    await realDb.table('sources').put(row({ needsAuth: true, errorCode: 'auth-needed', error: SOURCES.needsAuthGmailRefused }));
    render(<main><GmailAccess /></main>);
    expect(await screen.findByText("Google didn't allow read-only Gmail access. Reconnect to try again.")).toBeInTheDocument();
    expect(screen.queryByText(GMAIL_ACCESS.popups)).not.toBeInTheDocument();
  });

  it('says nothing while access has time left, or Gmail is not connected', async () => {
    await realDb.table('sources').put(row({ accessToken: { value: 't', expiresAt: Date.now() + 40 * MIN, scope: 'gmail.readonly' } }));
    const { container } = render(<GmailAccess />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container).toBeEmptyDOMElement();
  });
});
