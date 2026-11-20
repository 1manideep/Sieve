// Vitest setup for web (60 section 3.4, 40 section 18).
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// No unit test may reach the network by accident.
globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`A unit test tried to fetch ${url}. Mock the module that makes this request.`);
}) as typeof fetch;

// jsdom lacks these; ScrollRestoration calls scrollTo and axe probes canvas. Quiet no-ops keep the output readable.
window.scrollTo = (() => undefined) as typeof window.scrollTo;
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

if (typeof crypto.randomUUID !== 'function') {
  let n = 0;
  Object.defineProperty(crypto, 'randomUUID', {
    value: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
    },
  });
}
