import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fill } from '@/copy/screens-main';
import { Fill } from './Fill';

describe('Fill', () => {
  it('wraps every inserted value in bdi and keeps the sentence order', () => {
    const { container } = render(<p><Fill template={'Picked "{title}" and wrote the answer'} values={{ title: 'שלום' }} /></p>);
    expect(container.textContent).toBe('Picked "שלום" and wrote the answer');
    expect(container.querySelector('bdi')?.textContent).toBe('שלום');
  });

  it('leaves unknown placeholders as they are; fill() does the same for plain text', () => {
    const { container } = render(<p><Fill template="{a} and {b}" values={{ a: 'one' }} /></p>);
    expect(container.textContent).toBe('one and {b}');
    expect(fill('{n} of 500', { n: 412 })).toBe('412 of 500');
    expect(fill('{x}', {})).toBe('{x}');
  });
});
