import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { traceSteps } from '../__fixtures__/proposals';
import { TwoLaneTrace } from './TwoLaneTrace';

describe('TwoLaneTrace', () => {
  it('puts device and plain-code steps in the device lane, cloud steps in the cloud lane, and the characters on the arrow', async () => {
    const { container } = render(
      <main>
        <TwoLaneTrace steps={[traceSteps.retrieve(), traceSteps.selectDevice('Re: Deposit'), traceSteps.approve(), traceSteps.draft(69)]} />
      </main>,
    );
    const device = container.querySelector('[data-lane="device"]') as HTMLElement;
    const cloud = container.querySelector('[data-lane="cloud"]') as HTMLElement;
    expect(within(device).getByText('On this device')).toBeInTheDocument();
    expect(within(device).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Searched', 'Read and answered', 'You approved']);
    expect(within(cloud).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Drafted a reply']);
    expect(screen.getByTestId('lane-arrow')).toHaveTextContent('69 characters crossed to the cloud');
    await expectNoAxeViolations();
  });

  it('says when nothing crossed and nothing ran in the cloud', async () => {
    render(<main><TwoLaneTrace steps={[traceSteps.retrieve(), traceSteps.selectDevice('x')]} /></main>);
    expect(screen.getByTestId('lane-arrow')).toHaveTextContent('Nothing crossed to the cloud');
    expect(screen.getByText('Nothing ran in the cloud.')).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
