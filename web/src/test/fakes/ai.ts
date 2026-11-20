// Fake AI layer for shell tests: vi.mock('@/ai', () => import('@/test/fakes/ai')).
import { vi } from 'vitest';
import type { NanoAvailability } from '@sieve/shared';

let availability: { text: NanoAvailability; image: NanoAvailability } = { text: 'available', image: 'available' };

export function setFakeNanoAvailability(text: NanoAvailability, image: NanoAvailability = text): void {
  availability = { text, image };
}

export const initAi = vi.fn();
export const getNanoAvailability = vi.fn(async () => availability);
export const downloadNano = vi.fn(async () => undefined);
export const setNanoSimulation = vi.fn();
