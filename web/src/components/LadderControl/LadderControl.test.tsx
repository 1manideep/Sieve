import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ItemKind, LadderStep, StepOption } from '@sieve/shared';
import { expectNoAxeViolations } from '@/test/axe';
import { option, unavailable } from '../__fixtures__/proposals';
import { LadderControl, type LadderControlProps } from './LadderControl';

const all: StepOption[] = [option('answer', 'A'), option('excerpt', 'B'), option('full', 'C')];
const middleOff: StepOption[] = [option('answer', 'A'), unavailable('excerpt', "Sieve couldn't find the exact lines that hold this answer."), option('full', 'C')];

function Harness(props: Partial<LadderControlProps> & { onPick?: (s: LadderStep) => void; kind?: ItemKind }) {
  const [value, setValue] = useState<LadderStep>(props.value ?? 'answer');
  return (
    <main>
      <LadderControl
        label="Share the least it can"
        options={props.options ?? all}
        value={value}
        onChange={(s) => {
          setValue(s);
          props.onPick?.(s);
        }}
        kind={props.kind}
        requestedStep={props.requestedStep}
        aiName={props.aiName}
        disabled={props.disabled}
        previewId="preview"
      />
      <div id="preview" />
    </main>
  );
}

describe('LadderControl', () => {
  it('has three radios with the exact labels, and "3 · Full email" for emails', async () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Share the least it can' })).toHaveAttribute('aria-controls', 'preview');
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['1 · Answer only', '2 · Excerpt', '3 · Full item']);
    rerender(<Harness kind="email" />);
    expect(screen.getByRole('radio', { name: '3 · Full email' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 · Answer only' })).toHaveAttribute('aria-checked', 'true');
    await expectNoAxeViolations();
  });

  it('names the third step "The file itself" when that is what it would send (Nov 22)', () => {
    const withFile: StepOption[] = [option('answer', 'A'), option('excerpt', 'B'), option('full', 'Lease_2026.pdf (PDF, 182 KB)', { file: { name: 'Lease_2026.pdf', mime: 'application/pdf', bytes: 182_000 } })];
    render(<Harness options={withFile} kind="document" />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['1 · Answer only', '2 · Excerpt', '3 · The file itself']);
  });

  it('arrow keys skip unavailable options; clicking one does nothing; reason lines show', async () => {
    const onPick = vi.fn();
    render(<Harness options={middleOff} onPick={onPick} kind="email" />);
    screen.getByRole('radio', { name: '1 · Answer only' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onPick).toHaveBeenLastCalledWith('full');
    expect(screen.getByRole('radio', { name: '3 · Full email' })).toHaveFocus();
    await userEvent.click(screen.getByRole('radio', { name: '2 · Excerpt' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: '2 · Excerpt' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText("Excerpt: Sieve couldn't find the exact lines that hold this answer.")).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says "More than Gemini CLI asked for." above the requested step (relay)', async () => {
    render(<Harness value="excerpt" requestedStep="answer" aiName="Gemini CLI" />);
    expect(screen.getByText('More than Gemini CLI asked for.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('is locked after a decision but keeps showing the choice', async () => {
    const onPick = vi.fn();
    render(<Harness value="excerpt" disabled onPick={onPick} />);
    const chosen = screen.getByRole('radio', { name: '2 · Excerpt' });
    expect(chosen).toHaveAttribute('aria-checked', 'true');
    expect(chosen).toHaveAttribute('tabindex', '0');
    chosen.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(screen.getByRole('radio', { name: '3 · Full item' }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
    await expectNoAxeViolations();
  });
});
