import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { orbStateFor, SieveOrb } from './SieveOrb';

describe('SieveOrb (Nov 24)', () => {
  it('says what Sieve is doing: searching, reading and writing, checking, else working', () => {
    expect(orbStateFor('retrieve')).toBe('searching');
    for (const k of ['select', 'answer', 'excerpt', 'draft'] as const) expect(orbStateFor(k)).toBe('composing');
    for (const k of ['clean', 'pii', 'injection'] as const) expect(orbStateFor(k)).toBe('solving');
    for (const k of ['rule', 'label', 'caption', 'deliver', 'approve'] as const) expect(orbStateFor(k)).toBe('working');
    expect(orbStateFor(undefined)).toBe('working');
    expect(orbStateFor('retrieve', true)).toBe('solving');   // a draft being checked
  });

  it('is decoration: hidden from screen readers, beside a text label', () => {
    render(<SieveOrb kind="retrieve" />);
    expect(screen.getByTestId('thinking-orb')).toHaveAttribute('aria-hidden', 'true');
  });
});
