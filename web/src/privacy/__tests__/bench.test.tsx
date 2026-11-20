// The dev bench page renders and offers its three actions (the real run is the manual browser check).
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { PrivacyBench } from '../dev/PrivacyBench';
import { setPrivacyModelHost } from '../model/client';

vi.mock('../../ai', () => ({ runModel: vi.fn(), getNanoAvailability: vi.fn() }));

test('PrivacyBench renders', () => {
  setPrivacyModelHost(null);
  render(<PrivacyBench />);
  expect(screen.getByRole('heading', { name: 'Privacy bench' })).toBeTruthy();
  for (const name of ['Load the privacy model', 'Run the corpus', 'Copy report']) expect(screen.getByRole('button', { name })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Copy report' }) as HTMLButtonElement).disabled).toBe(true);
});
