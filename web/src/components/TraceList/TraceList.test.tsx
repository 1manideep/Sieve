import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TraceStep } from '@sieve/shared';
import { expectNoAxeViolations } from '@/test/axe';
import { traceSteps } from '../__fixtures__/proposals';
import { badgeFor, formatMs, TraceList } from './TraceList';

const steps: TraceStep[] = [
  traceSteps.retrieve(),
  traceSteps.ruleNever(),
  traceSteps.selectDevice('Re: Deposit for the apartment'),
  traceSteps.approve(),
  traceSteps.draft(69),
];

function rowOf(kind: string): HTMLElement {
  return document.querySelector(`li[data-kind="${kind}"]`) as HTMLElement;
}

describe('TraceList', () => {
  it('shows one badge per kind and where', async () => {
    render(<main><TraceList steps={steps} /></main>);
    expect(within(rowOf('retrieve')).getByText('This device · plain code')).toBeInTheDocument();
    expect(within(rowOf('rule')).getByText('Rule').closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
    expect(within(rowOf('select')).getByText('This device · Gemini Nano')).toBeInTheDocument();
    expect(within(rowOf('approve')).getByText('You')).toBeInTheDocument();
    expect(within(rowOf('draft')).getByText('Cloud · Gemini')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('colours rule rows red with neverRule, and adds "(sample data)" to cloud badges except the draft', () => {
    expect(badgeFor(traceSteps.ruleNever(), { neverRule: true }).tone).toBe('never');
    expect(badgeFor(traceSteps.selectCloud('x'), { sampleData: true }).text).toBe('Cloud · Gemini (sample data)');
    expect(badgeFor(traceSteps.draft(10), { sampleData: true }).text).toBe('Cloud · Gemini');
    expect(badgeFor(traceSteps.selectCloud('x'), { sampleData: true, nanoSettingUp: true }).text).toBe('Cloud · Gemini (sample data; Nano still setting up)');
  });

  it('totals the characters that left, or says nothing left', async () => {
    const { rerender } = render(<main><TraceList steps={steps} /></main>);
    expect(screen.getByTestId('trace-total')).toHaveTextContent('69 characters left this device');
    rerender(<main><TraceList steps={steps.slice(0, 3)} /></main>);
    expect(screen.getByTestId('trace-total')).toHaveTextContent('Nothing left this device');
    await expectNoAxeViolations();
  });

  it('reveals the requested mode and what the SDK reported; plain code says so', async () => {
    render(<main><TraceList steps={steps} /></main>);
    const select = rowOf('select');
    const button = within(select).getByRole('button', { name: 'Details for this step' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(within(select).getByText('Asked for: PREFER_ON_DEVICE')).toBeVisible();
    expect(within(select).getByText('The Firebase SDK reported: on this device')).toBeVisible();
    expect(within(select).getByText('Model: gemini-nano')).toBeVisible();
    const draft = rowOf('draft');
    await userEvent.click(within(draft).getByRole('button', { name: 'Details for this step' }));
    expect(within(draft).getByText('The Firebase SDK reported: in the cloud')).toBeVisible();
    expect(within(draft).getByText('69 characters left the device')).toBeVisible();
    const retrieve = rowOf('retrieve');
    await userEvent.click(within(retrieve).getByRole('button', { name: 'Details for this step' }));
    expect(within(retrieve).getByText('Plain code, no model')).toBeVisible();
    await expectNoAxeViolations();
  });

  it('collapses with the heading button and formats durations', async () => {
    render(<main><TraceList steps={steps} twoLane /></main>);
    expect(screen.getByRole('group', { name: 'Where each step ran' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'What happened, step by step' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(formatMs(12)).toBe('12 ms');
    expect(formatMs(9400)).toBe('9.4 s');
  });
});
