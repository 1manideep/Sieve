import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { Segmented } from './Segmented';
import { nextRadioIndex, tabStopIndex } from './rovingRadio';

function Harness({ onChange }: { onChange(v: string): void }) {
  const [value, setValue] = useState('a');
  return (
    <main>
      <Segmented
        label="Pick one"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        options={[
          { value: 'a', label: 'First' },
          { value: 'b', label: 'Second', disabled: true },
          { value: 'c', label: 'Third' },
        ]}
      />
    </main>
  );
}

describe('rovingRadio', () => {
  it('moves with arrows and skips unavailable options, wrapping around', () => {
    expect(nextRadioIndex(0, 'ArrowRight', [true, false, true])).toBe(2);
    expect(nextRadioIndex(2, 'ArrowRight', [true, false, true])).toBe(0);
    expect(nextRadioIndex(0, 'ArrowLeft', [true, false, true])).toBe(2);
    expect(nextRadioIndex(1, 'Home', [false, true, true])).toBe(1);
    expect(nextRadioIndex(0, 'End', [true, true, false])).toBe(1);
    expect(nextRadioIndex(0, 'Enter', [true, true])).toBeNull();
    expect(nextRadioIndex(0, 'ArrowRight', [false, false])).toBeNull();
    expect(tabStopIndex(1, [true, false, true])).toBe(0);
    expect(tabStopIndex(2, [true, false, true])).toBe(2);
  });
});

describe('Segmented', () => {
  it('is a radiogroup with roving focus; arrows select and skip the disabled option', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Pick one' });
    expect(group).toBeInTheDocument();
    const first = screen.getByRole('radio', { name: 'First' });
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Second' })).toHaveAttribute('aria-disabled', 'true');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(screen.getByRole('radio', { name: 'Third' })).toHaveFocus();
    await userEvent.click(screen.getByRole('radio', { name: 'Second' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations();
  });
});
