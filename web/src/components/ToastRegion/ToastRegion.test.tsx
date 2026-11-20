import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { SHELL } from '@/copy/strings';
import { DEFAULT_TOAST_MS, ERROR_TOAST_MS, useToasts } from '@/state/toasts';
import { ToastRegion } from './ToastRegion';

describe('ToastRegion', () => {
  afterEach(() => {
    vi.useRealTimers();
    useToasts.setState({ toasts: [] });
  });

  it('shows a toast in the Notifications region and dismisses it', async () => {
    render(<ToastRegion />);
    act(() => {
      useToasts.getState().push({ tone: 'success', title: 'Saved', body: 'Your rule was saved.' });
    });
    const region = screen.getByRole('region', { name: SHELL.notifications });
    expect(region).toHaveTextContent('Saved');
    expect(region).toHaveTextContent('Your rule was saved.');
    await expectNoAxeViolations();
    act(() => screen.getByRole('button', { name: SHELL.dismiss }).click());
    expect(region).not.toHaveTextContent('Saved');
  });

  it('keeps at most three toasts, newest last', () => {
    render(<ToastRegion />);
    act(() => {
      for (const n of [1, 2, 3, 4]) useToasts.getState().push({ tone: 'info', title: `Toast ${n}` });
    });
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['Toast 2', 'Toast 3', 'Toast 4']);
  });

  it('uses 6 s by default and 10 s for errors, then closes on its own', () => {
    vi.useFakeTimers();
    render(<ToastRegion />);
    act(() => {
      useToasts.getState().push({ tone: 'info', title: 'Info' });
      useToasts.getState().push({ tone: 'error', title: 'Error' });
    });
    expect(useToasts.getState().toasts.map((t) => t.timeoutMs)).toEqual([DEFAULT_TOAST_MS, ERROR_TOAST_MS]);
    act(() => vi.advanceTimersByTime(DEFAULT_TOAST_MS + 1));
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['Error']);
    act(() => vi.advanceTimersByTime(ERROR_TOAST_MS));
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
