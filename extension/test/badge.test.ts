import { describe, expect, it } from 'vitest';
import { badgeFor } from '../src/sw/badge';

describe('badgeFor (50 section 7.6)', () => {
  it.each([
    ['disconnected', 0, '', 'Sieve: open Sieve in a tab to receive requests'],
    ['disconnected', 3, '', 'Sieve: open Sieve in a tab to receive requests'],
    ['connected', 0, '', 'Sieve: no requests waiting'],
    ['connected', 1, '1', 'Sieve: 1 request waiting'],
    ['connected', 2, '2', 'Sieve: 2 requests waiting'],
    ['connected', 99, '99', 'Sieve: 99 requests waiting'],
    ['connected', 100, '99+', 'Sieve: 99+ requests waiting'],
    ['not-home-base', 1, '1', 'Sieve: 1 request waiting'],
    ['not-home-base', 0, '', 'Sieve: no requests waiting'],
  ] as const)('%s with %i actionable', (connection, n, text, title) => {
    expect(badgeFor({ connection }, n)).toEqual({ text, title });
  });
});
