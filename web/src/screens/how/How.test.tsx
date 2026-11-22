// /how: the paper's headings, figures and tables, the "On this page" links, the video placeholder, the section on
// tests with its button, and the two links under "What's next".
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/app/env';
import { PRIVACY, TESTS } from '@/copy/how-tests';
import { HOW_COPY } from '@/copy/screens-how';
import { SCREENS } from '@/copy/strings';
import { expectNoAxeViolations } from '@/test/axe';
import { HOW_VIDEO_URL, HowScreen, VideoCard } from './index';

const SECTIONS = [
  ['introduction', 'Introduction'],
  ['summary', 'Summary'],
  ['principles', 'Design principles'],
  ['architecture', 'Architecture'],
  ['index', 'The private index'],
  ['question', 'The path of one question'],
  ['ladder', 'The need-to-know ladder'],
  ['rules', 'Category rules'],
  ['hidden-instructions', 'Hidden instructions'],
  ['personal-details', 'Personal details'],
  ['relay', 'The relay'],
  ['receipts', 'Receipts and the trace'],
  ['models', 'Where each model call runs'],
  ['tests', 'How Sieve is tested'],
  ['limits', 'Limits'],
  ['next', "What's next"],
] as const;

function renderHow() {
  return render(
    <MemoryRouter initialEntries={['/how']}>
      <main>
        <HowScreen />
      </main>
    </MemoryRouter>,
  );
}

function rail() {
  return screen.getByRole('navigation', { name: HOW_COPY.onThisPage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/how', () => {
  it('has one h1, the lead, the status line and the 16 sections in order, each under its id', async () => {
    renderHow();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s.map((h) => h.textContent)).toEqual(['How Sieve works']);
    expect(SCREENS.how.heading).toBe('How Sieve works');
    expect(screen.getByText(/^An AI assistant sends a question\./)).toBeInTheDocument();
    expect(screen.getByText(/^This content was last updated in November 2026/)).toBeInTheDocument();

    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(SECTIONS.map(([, title]) => title));
    h2s.forEach((h2, i) => expect(h2.closest('section')).toHaveAttribute('id', SECTIONS[i]?.[0]));
    await expectNoAxeViolations();
  });

  it('draws the four figures with their captions; the three diagrams are labelled images with their own arrowheads', () => {
    const { container } = renderHow();
    const figures = screen.getAllByRole('figure');
    expect(figures).toHaveLength(4);
    figures.forEach((figure, i) => {
      expect(figure.querySelector('figcaption b')).toHaveTextContent(`Figure ${i + 1}`);
    });
    expect(figures[0]).toHaveTextContent('The question goes in, and one approved text comes out.');
    expect(figures[3]).toHaveTextContent('One request through the relay.');

    const diagrams = [figures[0], figures[1], figures[3]].map((f) => within(f as HTMLElement).getByRole('img'));
    for (const svg of diagrams) {
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('aria-label')?.length).toBeGreaterThan(40);
    }
    expect(within(figures[1] as HTMLElement).getByRole('img')).toHaveAccessibleName(/^Ten steps in three lanes\./);

    // Figure 3 is HTML: three slips, the masks marked in the full item.
    const slips = within(figures[2] as HTMLElement).getAllByRole('heading', { level: 3 });
    expect(slips.map((h) => h.textContent)).toEqual(['Answer', 'Excerpt', 'Full item']);
    expect(figures[2]).toHaveTextContent('From: [name] <[email]>');

    const markerIds = [...container.querySelectorAll('marker')].map((m) => m.id);
    expect(markerIds).toHaveLength(6);
    expect(new Set(markerIds).size).toBe(6);
    for (const line of container.querySelectorAll('[marker-end]')) {
      const id = /^url\(#(.+)\)$/.exec(line.getAttribute('marker-end') ?? '')?.[1];
      expect(markerIds).toContain(id);
    }
  });

  it('has the five tables, each with its caption', () => {
    renderHow();
    expect(screen.getAllByRole('table')).toHaveLength(5);
    for (const caption of [
      'Table 1 · The parts of Sieve',
      'Table 2 · What each step does',
      'Table 3 · The three steps',
      'Table 4 · Rules a category can have',
      'Table 5 · Inference mode by step',
    ]) {
      expect(screen.getByRole('table', { name: caption })).toBeInTheDocument();
    }
    const steps = screen.getByRole('table', { name: 'Table 2 · What each step does' });
    expect(within(steps).getAllByRole('row')).toHaveLength(11);
    expect(within(steps).getByRole('columnheader', { name: HOW_COPY.number })).toBeInTheDocument();
  });

  it('shows four numbers about the tests, and opens every test behind them with one button', async () => {
    renderHow();
    const section = document.getElementById('tests') as HTMLElement;
    const stats = within(section).getAllByRole('listitem');
    expect(stats.map((li) => li.querySelector('b')?.textContent)).toEqual([TESTS.automated.tests.toLocaleString('en-US'), '96%', '23 of 27', '0']);
    expect(stats[2]).toHaveTextContent('The first round scored 5.');
    // whose mailbox it was and what was replaced, said before anything is opened
    expect(PRIVACY).toMatch(/^The live rounds ran on the developer's own personal Gmail\./);
    expect(PRIVACY).toContain('has been replaced with an invented one');
    expect(section).toHaveTextContent(PRIVACY);

    const button = within(section).getByRole('button', { name: 'Show all the tests' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(section).queryByRole('heading', { level: 3 })).toBeNull();
    expect(within(section).queryByRole('table')).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('Hide the tests');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).toBeVisible();
    expect(within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Automated tests',
      'Search benchmark',
      'The on-device model',
      'Live rounds on a real mailbox',
      'What these tests do not show',
    ]);
    expect(within(section).getByRole('table', { name: 'Table 6 · Search benchmark: 68 questions among 2,020 items' })).toBeInTheDocument();
    const rounds = within(section).getByRole('table', { name: 'Table 7 · Live rounds, 37 runs each' });
    expect(within(rounds).getAllByRole('row')).toHaveLength(TESTS.live.rounds.length + 1);
    expect(section).toHaveTextContent('Round 3 met three of the four: 85% right (23 of 27), 7% missed (2 of 27), nothing made up, and 8% wrong (2 of 25 answers).');
    expect(screen.getAllByRole('table')).toHaveLength(7);
    await expectNoAxeViolations();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('table')).toHaveLength(5);
  });

  it('counts every run of every live round once', () => {
    const { live } = TESTS;
    expect(live.answerable + live.absent).toBe(live.runs);
    for (const r of live.rounds) {
      expect(r.right + r.wrong + r.missed + r.nothing + r.declined + r.errors, r.name).toBe(live.runs);
    }
    // the summary's "made-up answers" line: the runs since round 1 that returned nothing, correctly
    expect(live.rounds.slice(1).reduce((sum, r) => sum + r.nothing, 0)).toBe(live.absentRuns);
  });

  it('points every "On this page" link, in the rail and in the folded list, at a section that exists', () => {
    const { container } = renderHow();
    const folded = container.querySelector('details');
    expect(folded).not.toBeNull();
    const lists = [within(rail()).getAllByRole('link'), within(folded as HTMLElement).getAllByRole('link', { hidden: true })];
    for (const links of lists) {
      expect(links.map((a) => a.textContent)).toEqual(SECTIONS.map(([, title]) => title));
      for (const link of links) {
        const id = new URL(link.getAttribute('href') ?? '', 'https://sieve.test').hash.slice(1);
        const section = document.getElementById(id);
        expect(section?.tagName.toLowerCase()).toBe('section');
        expect(within(section as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent(link.textContent ?? '');
      }
    }
    // Before anything is observed, the first section is the one being read.
    expect(within(rail()).getByRole('link', { name: 'Introduction' })).toHaveAttribute('aria-current', 'location');
  });

  it('moves the mark in the rail to the section being read', () => {
    let notify: IntersectionObserverCallback = () => undefined;
    const observed: string[] = [];
    class FakeObserver {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe(target: Element) {
        observed.push(target.id);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    renderHow();
    expect(observed).toEqual(SECTIONS.map(([id]) => id));

    const seen = (id: string, isIntersecting: boolean) => ({ target: document.getElementById(id), isIntersecting }) as unknown as IntersectionObserverEntry;
    act(() => notify([seen('relay', true), seen('receipts', true)], {} as IntersectionObserver));
    expect(within(rail()).getByRole('link', { name: 'The relay' })).toHaveAttribute('aria-current', 'location');
    expect(within(rail()).getByRole('link', { name: 'Introduction' })).not.toHaveAttribute('aria-current');

    act(() => notify([seen('relay', false)], {} as IntersectionObserver));
    expect(within(rail()).getByRole('link', { name: 'Receipts and the trace' })).toHaveAttribute('aria-current', 'location');
    expect(within(rail()).getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('shows the video as a still placeholder: no link, no button, the "coming soon" chip', () => {
    expect(HOW_VIDEO_URL).toBeNull();
    renderHow();
    const video = screen.getByRole('img', { name: HOW_COPY.video.label });
    expect(video.tagName.toLowerCase()).toBe('div');
    expect(video.closest('a, button')).toBeNull();
    expect(video.querySelector('a, button')).toBeNull();
    expect(video).toHaveTextContent(HOW_COPY.video.title);
    expect(video).toHaveTextContent(HOW_COPY.video.soon);
  });

  it('opens the video in a new tab once it has a URL, without the chip', () => {
    render(<VideoCard url="https://video.example/how" />);
    const link = screen.getByRole('link', { name: HOW_COPY.video.title });
    expect(link).toHaveAttribute('href', 'https://video.example/how');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText(HOW_COPY.video.soon)).toBeNull();
  });

  it('sends "Try on a real computer" to the demo computer and "Read the source" to the repository; nothing links to the Playground', () => {
    renderHow();
    const next = document.getElementById('next') as HTMLElement;
    const links = within(next).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Try on a real computer', 'Read the source']);
    expect(links[0]).toHaveAttribute('href', '/try');
    expect(document.body).not.toHaveTextContent(/playground/i);
    expect(links[1]).toHaveAttribute('href', env.repoUrl);
    expect(links[1]).toHaveAttribute('target', '_blank');
  });

  it('keeps the copy free of em dashes, en dashes and double hyphens', () => {
    const { container } = renderHow();
    const words = [container.textContent ?? '', ...[...container.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '')];
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|--`);
    for (const text of words) expect(text).not.toMatch(dashes);
  });
});
