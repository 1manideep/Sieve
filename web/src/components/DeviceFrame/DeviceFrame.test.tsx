import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { DeviceFrame } from './DeviceFrame';

describe('DeviceFrame', () => {
  it('is the "Playground device" region with its label, toolbar, strip and windows', async () => {
    render(
      <main>
        <DeviceFrame label="Playground device · sample data" toolbar={<button type="button">Ready</button>} strip={<p>On-device model ready</p>}>
          <section aria-label="Sieve">window</section>
        </DeviceFrame>
      </main>,
    );
    expect(screen.getByRole('region', { name: 'Playground device' })).toBeInTheDocument();
    expect(screen.getByText('Playground device · sample data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.getByText('On-device model ready')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sieve' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
