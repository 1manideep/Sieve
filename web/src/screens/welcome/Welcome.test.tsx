import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WELCOME_COPY } from '@/copy/screens-main';
import { SCREENS } from '@/copy/strings';
import { useSession } from '@/state/session';
import { expectNoAxeViolations } from '@/test/axe';
import { WelcomeScreen, makeStars } from './index';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));

function renderWelcome(path = '/welcome') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/welcome" element={<main><WelcomeScreen /></main>} />
        <Route path="/" element={<p>Ask page</p>} />
        <Route path="/sources" element={<p>Sources page</p>} />
        <Route path="/playground" element={<p>Playground page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useSession.setState({ kind: 'none', user: null, signingIn: false });
});

describe('Welcome', () => {
  it('shows the sentence, the lead, the two buttons, the scene and the footer numbers', async () => {
    renderWelcome();
    expect(screen.getByRole('heading', { level: 1, name: 'Only what you approve leaves your computer.' })).toBeInTheDocument();
    expect(screen.getByText(SCREENS.welcome.lead)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Sieve' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try on a real computer' })).toHaveAttribute('href', '/try');
    expect(screen.getByRole('link', { name: WELCOME_COPY.signInNoteLink })).toHaveAttribute('href', '/playground');
    expect(screen.getByRole('img', { name: WELCOME_COPY.sceneLabel })).toBeInTheDocument();
    const numbers = screen.getByRole('list', { name: WELCOME_COPY.numbersLabel });
    for (const n of WELCOME_COPY.numbers) {
      expect(within(numbers).getByText(n.value)).toBeInTheDocument();
      expect(within(numbers).getByText(n.caption)).toBeInTheDocument();
    }
    expect(screen.getByText(WELCOME_COPY.built)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('draws 120 seeded stars, hidden from assistive tech, each on its own clock', () => {
    renderWelcome();
    const sky = screen.getByTestId('stars');
    expect(sky).toHaveAttribute('aria-hidden', 'true');
    expect(sky.children).toHaveLength(120);
    const first = sky.children[0] as HTMLElement;
    expect(first.style.animationDuration).toMatch(/^[4-9](\.\d)?s$/);
    expect(makeStars(3, 7)).toEqual(makeStars(3, 7));
  });

  it('keeps focus on the document; Tab reaches Open Sieve, then Try on a real computer', async () => {
    renderWelcome();
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Open Sieve' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Try on a real computer' })).toHaveFocus();
  });

  it('Open Sieve signs in with Google and goes to ?next (same origin only)', async () => {
    const signInWithGoogle = vi.fn(async () => {
      useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'a@example.com', isAnonymous: false } });
      return 'ok' as const;
    });
    act(() => {
      useSession.setState({ signInWithGoogle });
    });
    renderWelcome('/welcome?next=%2Fsources');
    await userEvent.click(screen.getByRole('button', { name: 'Open Sieve' }));
    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(await screen.findByText('Sources page')).toBeInTheDocument();
  });

  it('ignores a next that leaves the site, and stays put when the popup is closed', async () => {
    const signInWithGoogle = vi.fn(async () => 'cancelled' as const);
    act(() => {
      useSession.setState({ signInWithGoogle });
    });
    renderWelcome('/welcome?next=%2F%2Fevil.example');
    await userEvent.click(screen.getByRole('button', { name: 'Open Sieve' }));
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('goes to the Playground when sign-in is not possible', async () => {
    const signInWithGoogle = vi.fn(async () => 'error' as const);
    act(() => {
      useSession.setState({ signInWithGoogle });
    });
    renderWelcome();
    await userEvent.click(screen.getByRole('button', { name: 'Open Sieve' }));
    expect(await screen.findByText('Playground page')).toBeInTheDocument();
  });
});
