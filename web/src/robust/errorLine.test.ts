import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGE_CHARS, errorLine } from './errorLine';

describe('errorLine', () => {
  it('gives the name and the message', () => {
    expect(errorLine(new TypeError('Failed to fetch dynamically imported module: /assets/liveSearch-x.js'))).toBe(
      'TypeError: Failed to fetch dynamically imported module: /assets/liveSearch-x.js',
    );
    expect(errorLine(new DOMException('The on-device model took too long.', 'TimeoutError'))).toBe('TimeoutError: The on-device model took too long.');
  });

  it(`cuts the message at ${ERROR_MESSAGE_CHARS} characters`, () => {
    const line = errorLine(new Error('x'.repeat(500)));
    expect(line).toBe(`Error: ${'x'.repeat(ERROR_MESSAGE_CHARS)}`);
  });

  it('keeps only the name of a SyntaxError, whose message quotes the text it parsed', () => {
    let thrown: unknown;
    try {
      JSON.parse('Your order 88231 ships Friday');
    } catch (e) {
      thrown = e;
    }
    expect(errorLine(thrown)).toBe('SyntaxError');
  });

  it('gives only the type of a thrown value that is not an error', () => {
    expect(errorLine('the question as a string')).toBe('string');
    expect(errorLine(undefined)).toBe('undefined');
    expect(errorLine(null)).toBe('object');
    expect(errorLine({ name: 'Custom' })).toBe('Custom');
  });
});
