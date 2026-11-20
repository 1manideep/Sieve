import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { ErrorBoundary } from './ErrorBoundary';

let broken = true;
function Boom() {
  if (broken) throw new Error('render failed');
  return <p>Back again</p>;
}

describe('ErrorBoundary', () => {
  it('shows the fallback card, logs to the console only, and resets on Try again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReset = vi.fn(() => {
      broken = false;
    });
    function Host() {
      const [n] = useState(0);
      return (
        <main>
          <ErrorBoundary onReset={onReset} key={n}>
            <Boom />
          </ErrorBoundary>
        </main>
      );
    }
    render(<Host />);
    expect(screen.getByRole('heading', { name: "This part couldn't be shown" })).toBeInTheDocument();
    expect(screen.getByText('Nothing was shared.')).toBeInTheDocument();
    await expectNoAxeViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.getByText('Back again')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
