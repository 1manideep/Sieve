import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAvailability } from '@/state/availability';
import { useSession } from '@/state/session';
import { expectNoAxeViolations } from '@/test/axe';
import { PrepareScreen } from './index';

vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp'));
vi.mock('firebase/auth', () => import('@/test/fakes/firebaseAuth'));
vi.mock('@/ai', () => import('@/test/fakes/ai'));

afterEach(() => {
  useAvailability.setState({ text: 'checking', setup: { state: 'idle' } });
  useSession.setState({ kind: 'none' });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <main>
        <PrepareScreen />
      </main>
    </MemoryRouter>,
  );
}

describe('Prepare the on-device model', () => {
  it('one card with the setup; Back goes to ?back=', async () => {
    useAvailability.setState({ text: 'downloadable', setup: { state: 'idle' } });
    renderAt('/prepare?back=/setup');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/setup');
    expect(screen.getByRole('heading', { level: 1, name: 'Prepare the on-device model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('Back defaults to "/" for everyone, and never leaves the site', () => {
    useSession.setState({ kind: 'google' });
    const { unmount } = renderAt('/prepare');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/ask');
    unmount();
    useSession.setState({ kind: 'none' });
    renderAt('/prepare?back=https://evil.example');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/ask');
  });

  it('unavailable: the requirements and the way to cloud fallback; no Playground', async () => {
    useAvailability.setState({ text: 'no-api', setup: { state: 'idle' } });
    renderAt('/prepare');
    expect(screen.getByText("This Chrome can't run the on-device model")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on cloud fallback' })).toHaveAttribute('href', '/settings#cloud');
    expect(screen.queryByRole('link', { name: /Playground/ })).toBeNull();
    await expectNoAxeViolations();
  });
});
