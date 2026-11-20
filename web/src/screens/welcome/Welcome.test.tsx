import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/state/session';
import { expectNoAxeViolations } from '@/test/axe';
import { WelcomeScreen } from './index';

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
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useSession.setState({ kind: 'none', user: null, signingIn: false });
});

describe('Welcome', () => {
  it('shows the hero, the example, the three tiles, the requirements and the footer', async () => {
    renderWelcome();
    expect(screen.getByText('Built with Gemini Nano and Firebase AI Logic')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Give AI the answer, not your inbox.' })).toBeInTheDocument();
    expect(
      screen.getByText('Sieve finds what a task needs in your email, files and photos with a model on your own device, and shares only what you approve.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try the Playground' })).toHaveAttribute('href', '/playground');
    expect(screen.getByText('No sign-in. A pretend computer with sample mail, photos and documents.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Example: Gemini CLI asked about a deposit and received only the answer.' })).toBeInTheDocument();
    for (const title of ['Found on your device', 'You approve every share', 'A receipt for everything']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/Works best in Chrome 139 or later with Gemini Nano/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://example.com/sieve');
    expect(screen.getByText('Built for #BuildHybridAI 2026')).toBeInTheDocument();
    expect(screen.getByText('Request from Gemini CLI')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('keeps focus on the document; Tab reaches the Playground link before sign-in', async () => {
    renderWelcome();
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Try the Playground' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toHaveFocus();
  });

  it('signs in with Google and goes to ?next (same origin only)', async () => {
    const signInWithGoogle = vi.fn(async () => {
      useSession.setState({ kind: 'google', user: { uid: 'u1', email: 'a@example.com', isAnonymous: false } });
      return 'ok' as const;
    });
    act(() => {
      useSession.setState({ signInWithGoogle });
    });
    renderWelcome('/welcome?next=%2Fsources');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(signInWithGoogle).toHaveBeenCalledOnce();
    expect(await screen.findByText('Sources page')).toBeInTheDocument();
  });

  it('ignores a next that leaves the site, and stays put when the popup is closed', async () => {
    const signInWithGoogle = vi.fn(async () => 'cancelled' as const);
    act(() => {
      useSession.setState({ signInWithGoogle });
    });
    renderWelcome('/welcome?next=%2F%2Fevil.example');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
