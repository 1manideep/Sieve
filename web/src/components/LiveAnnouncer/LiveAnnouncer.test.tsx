import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { announce } from '@/state/announcer';
import { LiveAnnouncer } from './LiveAnnouncer';

describe('LiveAnnouncer', () => {
  it('has a polite and an assertive region', () => {
    render(<LiveAnnouncer />);
    expect(screen.getByTestId('announcer-polite')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('announcer-assertive')).toHaveAttribute('aria-live', 'assertive');
  });

  it('empties the region, then sets the text on the next frame', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    render(<LiveAnnouncer />);
    act(() => announce('Sent the answer to Gemini CLI.'));
    expect(screen.getByTestId('announcer-polite')).toBeEmptyDOMElement();
    act(() => frames.forEach((f) => f(0)));
    expect(screen.getByTestId('announcer-polite')).toHaveTextContent('Sent the answer to Gemini CLI.');
    act(() => announce('Denied.', 'assertive'));
    act(() => frames.forEach((f) => f(0)));
    expect(screen.getByTestId('announcer-assertive')).toHaveTextContent('Denied.');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
