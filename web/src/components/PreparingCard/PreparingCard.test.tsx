import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveStep } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { traceSteps } from '../__fixtures__/proposals';
import { PreparingCard } from './PreparingCard';

const running: LiveStep = { id: 'r:1', kind: 'retrieve', label: 'Searching this device…', where: 'code', status: 'running', startedAt: 0 };
const done: LiveStep = { ...running, status: 'done', step: { ...traceSteps.retrieve(30), label: 'Searched 30 emails in 12 ms' } };
const reading: LiveStep = { id: 'r:2', kind: 'select', label: 'Reading 3 emails on this device…', where: 'device', status: 'running', startedAt: 0 };

describe('PreparingCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows running rows, then the final label and duration; busy while it runs', async () => {
    const onStop = vi.fn();
    const { rerender } = render(<main><PreparingCard liveSteps={[running]} answerPreview="" startedAt={Date.now()} onStop={onStop} progressSupported /></main>);
    expect(screen.getByRole('heading', { name: 'Working on this device' })).toBeInTheDocument();
    expect(screen.getByTestId('preparing-card')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Gemini Nano · on this device')).toBeInTheDocument();
    expect(screen.getByText('Searching this device…')).toBeInTheDocument();
    rerender(<main><PreparingCard liveSteps={[done, reading]} answerPreview="" startedAt={Date.now()} onStop={onStop} progressSupported /></main>);
    expect(screen.getByText('Searched 30 emails in 12 ms')).toBeInTheDocument();
    expect(screen.getByText('12 ms')).toBeInTheDocument();
    expect(screen.getByText('Reading 3 emails on this device…')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Stop' }).click();
    expect(onStop).toHaveBeenCalledOnce();
    vi.useRealTimers();
    await expectNoAxeViolations();
  });

  it('streams the answer as it is written, with the checking line', () => {
    render(<PreparingCard liveSteps={[done, reading]} answerPreview="Your deposit was $1,2" startedAt={Date.now()} onStop={() => undefined} progressSupported />);
    expect(screen.getByText('Answer, written on this device')).toBeInTheDocument();
    expect(screen.getByTestId('streamed-answer').textContent).toBe('Your deposit was $1,2');
    expect(screen.getByText('Checking it before anything can be shared…')).toBeInTheDocument();
  });

  it('adds the slow line after 3 seconds without an answer', () => {
    render(<PreparingCard liveSteps={[reading]} answerPreview="" startedAt={Date.now()} onStop={() => undefined} progressSupported />);
    const line = 'Gemini Nano is reading on this device. This usually takes about 10 seconds.';
    expect(screen.queryByText(line)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.queryByText(line)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('turns the tag blue when the reading runs in the cloud (sample data)', () => {
    render(<PreparingCard liveSteps={[{ ...reading, where: 'cloud' }]} answerPreview="" startedAt={Date.now()} onStop={() => undefined} progressSupported />);
    expect(screen.getByText('Cloud · Gemini (sample data)')).toBeInTheDocument();
  });

  it('without progress events: heading, the slow line from the start, an indeterminate bar and Stop', () => {
    render(<PreparingCard liveSteps={[]} answerPreview="" startedAt={Date.now()} onStop={() => undefined} progressSupported={false} />);
    expect(screen.getByText('Gemini Nano is reading on this device. This usually takes about 10 seconds.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});
