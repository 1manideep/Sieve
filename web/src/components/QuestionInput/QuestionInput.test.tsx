import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { isBlankQuestion, QuestionInput } from './QuestionInput';

function Harness({ onSubmit, initial = '' }: { onSubmit(q: string): void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <main>
      <QuestionInput
        label="What are you looking for?"
        placeholder="e.g. my landlord's email about the deposit"
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        button={<button type="submit">Find on this device</button>}
      />
      <button type="button">Elsewhere</button>
    </main>
  );
}

describe('QuestionInput', () => {
  it('has a visible label, maxLength 500, and Enter submits', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByLabelText('What are you looking for?');
    expect(input).toHaveAttribute('maxlength', '500');
    await userEvent.type(input, 'deposit{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('deposit');
    await expectNoAxeViolations();
  });

  it('an empty or invisible-only question shows "Type a question first." and submits nothing', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} initial={String.fromCharCode(0x200b, 0x200b, 32)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Find on this device' }));
    expect(onSubmit).not.toHaveBeenCalled();
    const input = screen.getByLabelText('What are you looking for?');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Type a question first.');
    expect(isBlankQuestion(String.fromCharCode(0xfeff))).toBe(true);
    expect(isBlankQuestion('a')).toBe(false);
    await expectNoAxeViolations();
  });

  it('counts past 400 characters, and notes a paste that was cut at 500', async () => {
    render(<Harness onSubmit={() => undefined} initial={'x'.repeat(401)} />);
    expect(screen.getByText('401 of 500')).toBeInTheDocument();
    const input = screen.getByLabelText('What are you looking for?');
    fireEvent.paste(input, { clipboardData: { getData: () => 'y'.repeat(200) } });
    expect(screen.getByText('Sieve kept the first 500 characters of what you pasted. Questions work best short: who, what and roughly when.')).toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });

  it('"/" focuses the field when focus is not in an editable element', async () => {
    render(<Harness onSubmit={() => undefined} />);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await userEvent.keyboard('/');
    expect(screen.getByLabelText('What are you looking for?')).toHaveFocus();
    await userEvent.keyboard('/');
    expect(screen.getByLabelText('What are you looking for?')).toHaveValue('/');
  });
});
