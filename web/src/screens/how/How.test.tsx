// /how (F4): Run walks the four steps; the card's Approve finishes them; Run again starts over.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HOW_COPY } from '@/copy/screens-main';
import { SCREENS } from '@/copy/strings';
import { expectNoAxeViolations } from '@/test/axe';
import { CHOSEN, DASH_COUNT, HowScreen, makeDashes } from './index';

function renderHow() {
  return render(
    <MemoryRouter initialEntries={['/how']}>
      <main>
        <HowScreen />
      </main>
    </MemoryRouter>,
  );
}

function counters() {
  const list = screen.getByRole('list', { name: HOW_COPY.countersLabel });
  return within(list).getAllByRole('listitem').map((li) => li.textContent);
}

describe('/how', () => {
  it('starts ready: 46 seeded dashes, the first caption and zero counts', async () => {
    renderHow();
    expect(screen.getByRole('heading', { level: 1, name: SCREENS.how.heading })).toBeInTheDocument();
    const field = screen.getByTestId('dashes');
    expect(field).toHaveAttribute('aria-hidden', 'true');
    expect(field.querySelectorAll('[data-chosen]')).toHaveLength(1);
    expect(field.children).toHaveLength(DASH_COUNT);
    expect(makeDashes()[CHOSEN]).toMatchObject({ x: 300, y: 316, c: '#8AB4F8' });
    expect(makeDashes()).toEqual(makeDashes());
    expect(screen.getByText(HOW_COPY.stepLabels[0])).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.captions[0])).toBeInTheDocument();
    expect(counters()).toEqual([`46${HOW_COPY.searched}`, `0${HOW_COPY.readByModel}`, `0${HOW_COPY.left}`]);
    await expectNoAxeViolations();
  });

  it('advances through the steps, waits for Approve, then runs again', async () => {
    const user = userEvent.setup();
    renderHow();

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText(HOW_COPY.stepLabels[1])).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.matched)).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.captions[1])).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(HOW_COPY.itemTitle)).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.reading)).toBeInTheDocument();
    expect(counters()[1]).toBe(`1${HOW_COPY.readByModel}`);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(HOW_COPY.sentence)).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: HOW_COPY.approve });

    // The bar's button waits for the choice: it takes the focus to Approve and changes nothing.
    await user.click(screen.getByRole('button', { name: HOW_COPY.runLabels[3] }));
    expect(approve).toHaveFocus();
    expect(screen.getByText(HOW_COPY.stepLabels[3])).toBeInTheDocument();

    await user.click(approve);
    expect(screen.getByText(HOW_COPY.stepLabels[4])).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.approved)).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.cloudTitle)).toBeInTheDocument();
    expect(screen.getByText(HOW_COPY.stayed)).toBeInTheDocument();
    expect(counters()).toEqual([`46${HOW_COPY.searched}`, `1${HOW_COPY.readByModel}`, `44${HOW_COPY.left}`]);
    await expectNoAxeViolations();

    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(screen.getByText(HOW_COPY.stepLabels[0])).toBeInTheDocument();
    expect(screen.queryByText(HOW_COPY.cloudTitle)).not.toBeInTheDocument();
    expect(counters()[2]).toBe(`0${HOW_COPY.left}`);
  });
});
