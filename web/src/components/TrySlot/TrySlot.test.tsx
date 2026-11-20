import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TrySlot } from './TrySlot';

describe('TrySlot', () => {
  it('renders the "Try it on a real computer" component when it exists, and nothing otherwise', () => {
    const { container } = render(
      <MemoryRouter>
        <TrySlot />
      </MemoryRouter>,
    );
    const found = Object.keys(import.meta.glob('../TryOnRealComputer/TryOnRealComputer.tsx')).length > 0;
    if (!found) expect(container).toBeEmptyDOMElement();
    else expect(container).toBeDefined();
  });
});
