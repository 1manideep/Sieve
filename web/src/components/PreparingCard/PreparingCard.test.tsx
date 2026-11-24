import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveStep } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { traceSteps } from '../__fixtures__/proposals';
import { useAvailability } from '@/state/availability';
import { PreparingCard, workTag } from './PreparingCard';

const running: LiveStep = { id: 'r:1', kind: 'retrieve', label: 'Searching this device…', where: 'code', status: 'running', startedAt: 0 };
const done: LiveStep = { ...running, status: 'done', step: { ...traceSteps.retrieve(30), label: 'Searched 30 emails in 12 ms' } };
const reading: LiveStep = { id: 'r:2', kind: 'select', label: 'Reading 3 emails on this device…', where: 'device', status: 'running', startedAt: 0 };

describe('PreparingCard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    useAvailability.setState({ text: 'checking' });
  });

  it('shows running rows, then the final label and duration; busy while it runs', async () => {
    useAvailability.setState({ text: 'available' });   // this computer has Gemini Nano
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
    expect(screen.getByText('Draft answer, written on this device')).toBeInTheDocument();
    expect(screen.getByTestId('streamed-answer').textContent).toBe('Your deposit was $1,2');
    expect(screen.getByText('Checking that it answers your question before anything can be shared…')).toBeInTheDocument();
  });

  it('after 3 seconds: how long since the question and what is usual, then what happens next', () => {
    const next = "You'll be asked to approve before anything is sent.";
    render(<PreparingCard liveSteps={[reading]} answerPreview="" startedAt={Date.now()} onStop={() => undefined} progressSupported next={next} />);
    expect(screen.queryByTestId('waiting-line')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.queryByTestId('waiting-line')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getAllByTestId('waiting-line').map((p) => p.textContent)).toEqual([
      'Asked 3 seconds ago. Answers usually take 20 seconds to a minute.',
      next,
    ]);
    act(() => {
      vi.advanceTimersByTime(62_000);
    });
    // Past a minute: why it may be slow, and what to do.
    expect(screen.getAllByTestId('waiting-line').map((p) => p.textContent)).toEqual([
      'Asked 1 min 5 s ago. Answers usually take 20 seconds to a minute.',
      next,
      'Taking longer than usual. The computer may be busy. Keep the Sieve tab open: it goes on by itself.',
    ]);
  });

  it('names who it is for, and says when the on-device model is still being set up', () => {
    render(
      <PreparingCard liveSteps={[reading]} answerPreview="" startedAt={Date.now() - 90_000} onStop={() => undefined} progressSupported heading="Preparing an answer for Claude" setupPct={40} />,
    );
    expect(screen.getByRole('heading', { name: 'Preparing an answer for Claude' })).toBeInTheDocument();
    expect(screen.getByText('The on-device model is still being set up (40%). Sieve answers once it is ready.')).toBeInTheDocument();
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it('a step that says why it waits (a first click, a background tab) is not followed by the busy line', () => {
    const click: LiveStep = { id: 'req-1:wait-click', kind: 'select', label: 'Waiting for you to click in this tab once', where: 'device', status: 'running', startedAt: 0 };
    render(<PreparingCard liveSteps={[click]} answerPreview="" startedAt={Date.now() - 90_000} onStop={() => undefined} progressSupported />);
    expect(screen.getByText('Asked 1 min 30 s ago. Answers usually take 20 seconds to a minute.')).toBeInTheDocument();
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it('turns the tag blue when the reading runs in the cloud (sample data)', () => {
    render(<PreparingCard liveSteps={[{ ...reading, where: 'cloud' }]} answerPreview="" startedAt={Date.now()} onStop={() => undefined} progressSupported />);
    expect(screen.getByText('Cloud · Gemini (sample data)')).toBeInTheDocument();
  });

  it('without progress events: heading, an indeterminate bar and Stop', () => {
    render(<PreparingCard liveSteps={[]} answerPreview="" startedAt={Date.now() - 5_000} onStop={() => undefined} progressSupported={false} />);
    expect(screen.getByText('Asked 5 seconds ago. Answers usually take 20 seconds to a minute.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});


describe('workTag: where the work runs, asked of this computer (Nov 24)', () => {
  it('claims Gemini Nano only when this Chrome has it; the account does not decide', () => {
    expect(workTag(false, 'available', 'idle')).toBe('nano');
    expect(workTag(false, 'downloadable', 'done')).toBe('nano');        // set up during this visit
    for (const n of ['downloadable', 'downloading', 'unavailable', 'no-api', 'checking'] as const) {
      expect(workTag(false, n, 'idle'), n).toBe('device');
    }
    expect(workTag(true, 'available', 'idle')).toBe('cloud');           // a reading step ran in the cloud
  });
});
