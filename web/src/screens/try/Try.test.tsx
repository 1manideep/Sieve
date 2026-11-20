// /try (80 sections 1, 4 and 7; F6 and F6A): the seat rows from GET /health on arrival, Take seat 1 / Join the queue,
// granted with the viewer and the lease bar, full screen (the browser's, or the window when the browser refuses),
// queued with polling every 10 s, offline and capped replies, End session. The broker is a vi.fn on fetch.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { HEALTH_POLL_MS, QUEUE_POLL_MS, SEAT_BROKER_URL } from '@/components/TryOnRealComputer/broker';
import { TRY, fillText } from '@/copy/screens-controls';
import { useAnnouncer } from '@/state/announcer';
import axe from 'axe-core';
import { Component, formatLeft } from './index';

const fetchMock = vi.fn<typeof fetch>();
const VIEWER = 'https://sieve-view.manideep.info/s/one-time-token';

function reply(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function granted(endsIn = 15 * 60_000, lease: string | undefined = 'L1') {
  return reply({ status: 'granted', viewerUrl: VIEWER, endsAt: Date.now() + endsIn, lease });
}

function route(method: string, path: string, impl: () => Promise<Response> | Response) {
  return { method, url: `${SEAT_BROKER_URL}${path}`, impl };
}

/** GET /health with {free} of {total} seats free. */
function health(free = 1, total = 2) {
  return route('GET', '/health', () => reply({ ok: true, seatsFree: free, seatsTotal: total }));
}

/** Answers each call with the first matching route, in order; a route answers once. */
function serve(...routes: ReturnType<typeof route>[]) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const i = routes.findIndex((r) => r.url === url && r.method === method);
    if (i === -1) throw new TypeError(`unexpected ${method} ${url}`);
    const [r] = routes.splice(i, 1);
    return r.impl();
  });
}

function renderTry() {
  const router = createMemoryRouter(
    [
      { path: '/try', element: <main><Component /></main> },
      { path: '/playground', element: <main><p>playground</p></main> },
    ],
    { initialEntries: ['/try'] },
  );
  return render(<RouterProvider router={router} />);
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** As test/axe.ts, without probing the cross-origin viewer frame (jsdom cannot message into it). */
async function expectNoAxeViolations(): Promise<void> {
  const result = await axe.run(document.body, { iframes: false, rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

function seatTexts() {
  return within(screen.getByRole('list', { name: TRY.seatsLabel })).getAllByRole('listitem').map((li) => li.textContent);
}

/** Arrive, let the health answer land, press Take seat 1 and let the seat reply land. */
async function arriveAndTake(user: ReturnType<typeof userEvent.setup>) {
  renderTry();
  await flush();
  await user.click(screen.getByRole('button', { name: TRY.takeSeat }));
  await flush();
}

const sentence = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('/try', () => {
  it('on arrival only asks how many seats are free, and offers Take seat 1 and Join the queue', async () => {
    serve(health(1, 2));
    renderTry();
    expect(document.title).toBe(TRY.title);
    expect(screen.getByRole('heading', { level: 1, name: TRY.heading })).toBeInTheDocument();
    expect(screen.getByText(TRY.intro)).toBeInTheDocument();
    expect(seatTexts()).toEqual([`${fillText(TRY.seatName, { n: 1 })}${TRY.seatChecking}`, `${fillText(TRY.seatName, { n: 2 })}${TRY.seatChecking}`]);
    await flush();
    expect(seatTexts()).toEqual([`${fillText(TRY.seatName, { n: 1 })}${TRY.seatFree}`, `${fillText(TRY.seatName, { n: 2 })}${TRY.seatInUse}`]);
    expect(screen.getByRole('button', { name: TRY.takeSeat })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TRY.joinQueue })).toBeInTheDocument();
    // Arriving moves no focus.
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByText(TRY.placeholderTitle)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: TRY.factsLabel })).getAllByRole('listitem')).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`${SEAT_BROKER_URL}/health`, expect.objectContaining({ method: 'GET', credentials: 'omit' }));
    await expectNoAxeViolations();
  });

  it('asks for a seat with its cookie on Take seat 1, and says so while it waits', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => new Promise<Response>(() => undefined)));
    renderTry();
    await flush();
    const take = screen.getByRole('button', { name: TRY.takeSeat });
    await user.click(take);
    expect(fetchMock).toHaveBeenCalledWith(`${SEAT_BROKER_URL}/seat`, expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(screen.getByRole('status')).toHaveTextContent(TRY.requesting);
    expect(take).toHaveAttribute('aria-busy', 'true');
    expect(take).toHaveFocus();
    // A second press while the first is out asks nothing more.
    await user.click(take);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === `${SEAT_BROKER_URL}/seat`)).toHaveLength(1);
    await expectNoAxeViolations();
  });

  it('embeds the seat with the lease bar, counts down and ends the session', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(
      health(2, 2),
      route('POST', '/seat', () => granted()),
      route('POST', '/seat/L1/end', () => reply({ ok: true })),
      health(1, 2),
      route('POST', '/seat', () => new Promise<Response>(() => undefined)),
    );
    await arriveAndTake(user);
    const frame = screen.getByTitle(TRY.viewerTitle);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', VIEWER);
    expect(frame).toHaveAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    const strip = screen.getByRole('region', { name: TRY.stripLabel });
    expect(within(strip).getByRole('timer')).toHaveTextContent('15:00 left');
    expect(within(strip).getAllByRole('button').map((b) => b.textContent)).toEqual([TRY.fullScreen, TRY.extend, TRY.endSession]);
    expect(within(strip).getByRole('button', { name: TRY.fullScreen })).toHaveFocus();
    expect(screen.queryByText(TRY.placeholderTitle)).not.toBeInTheDocument();
    expect(seatTexts()).toEqual([`${fillText(TRY.seatName, { n: 1 })}${TRY.seatYours}`, `${fillText(TRY.seatName, { n: 2 })}${TRY.seatFree}`]);
    await flush(16);
    expect(useAnnouncer.getState().polite).toBe(TRY.ready);
    await flush(1000);
    expect(within(strip).getByRole('timer')).toHaveTextContent('14:59 left');
    await expectNoAxeViolations();

    await user.click(within(strip).getByRole('button', { name: TRY.endSession }));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`${SEAT_BROKER_URL}/seat/L1/end`, expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(screen.queryByTitle(TRY.viewerTitle)).not.toBeInTheDocument();
    expect(screen.getByText(TRY.ended)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    // The rows ask the broker again once the session is over.
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === `${SEAT_BROKER_URL}/health`)).toHaveLength(2);
    expect(screen.getByRole('button', { name: TRY.takeSeat })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: TRY.takeSeat }));
    expect(screen.getByRole('status')).toHaveTextContent(TRY.requesting);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === `${SEAT_BROKER_URL}/seat`)).toHaveLength(2);
  });

  it('makes Join the queue the way in when every seat is in use', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(0, 2), route('POST', '/seat', () => reply({ status: 'queued', position: 1, etaMinutes: 4, ticket: 'T2' })));
    renderTry();
    await flush();
    expect(seatTexts()).toEqual([`${fillText(TRY.seatName, { n: 1 })}${TRY.seatInUse}`, `${fillText(TRY.seatName, { n: 2 })}${TRY.seatInUse}`]);
    expect(screen.getByText(TRY.allInUse)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: TRY.takeSeat })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: TRY.joinQueue }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(fillText(TRY.queued, { n: 1, m: 4 }));
  });

  it('says the demo computer is offline when the health check fails, and Try again asks again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(route('GET', '/health', () => Promise.reject(new TypeError('Failed to fetch'))), health(1, 2));
    renderTry();
    await flush();
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
    expect(seatTexts()).toEqual([`${fillText(TRY.seatName, { n: 1 })}${TRY.seatOffline}`, `${fillText(TRY.seatName, { n: 2 })}${TRY.seatOffline}`]);
    expect(screen.queryByRole('button', { name: TRY.takeSeat })).not.toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: TRY.again }));
    await flush();
    expect(screen.queryByText(TRY.offline)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: TRY.takeSeat })).toBeInTheDocument();
    expect(seatTexts()[0]).toBe(`${fillText(TRY.seatName, { n: 1 })}${TRY.seatFree}`);
  });

  it('checks the seats again every 20 s while the visitor looks', async () => {
    serve(health(0, 2), health(1, 2));
    renderTry();
    await flush();
    expect(seatTexts()[0]).toBe(`${fillText(TRY.seatName, { n: 1 })}${TRY.seatInUse}`);
    await flush(HEALTH_POLL_MS);
    expect(seatTexts()[0]).toBe(`${fillText(TRY.seatName, { n: 1 })}${TRY.seatFree}`);
    expect(screen.getByRole('button', { name: TRY.takeSeat })).toBeInTheDocument();
  });

  it('goes full screen on the frame and shows the seat pill until it exits', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => granted(5 * 60_000)));
    const request = vi.fn(function (this: Element) {
      Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: request, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true });
    try {
      await arriveAndTake(user);
      await user.click(screen.getByRole('button', { name: TRY.fullScreen }));
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.contexts[0]).toBe(screen.getByTitle(TRY.viewerTitle).parentElement);
      const pill = screen.getByRole('group', { name: TRY.seatBar });
      expect(pill).toHaveTextContent(`${fillText(TRY.seatName, { n: 1 })} · 05:00 left`);
      expect(within(pill).getByRole('button', { name: TRY.exitFullScreen })).toHaveFocus();
      expect(screen.getAllByRole('timer')).toHaveLength(1);

      await user.click(within(pill).getByRole('button', { name: TRY.extend }));
      await flush(16);
      expect(useAnnouncer.getState().polite).toBe(TRY.extendSoon);

      await user.click(within(pill).getByRole('button', { name: TRY.exitFullScreen }));
      expect(exit).toHaveBeenCalledOnce();
      expect(screen.queryByRole('group', { name: TRY.seatBar })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: TRY.fullScreen })).toHaveFocus();

      // Escape in the browser's own full screen: the page follows the fullscreenchange event.
      await user.click(screen.getByRole('button', { name: TRY.fullScreen }));
      expect(screen.getByRole('group', { name: TRY.seatBar })).toBeInTheDocument();
      act(() => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      expect(screen.queryByRole('group', { name: TRY.seatBar })).not.toBeInTheDocument();
    } finally {
      delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
      delete (document as { exitFullscreen?: unknown }).exitFullscreen;
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    }
  });

  it('covers the window when the browser refuses full screen, and Escape leaves it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => granted()));
    const request = vi.fn(() => Promise.reject(new TypeError('Permissions check failed')));
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: request, configurable: true });
    try {
      await arriveAndTake(user);
      await user.click(screen.getByRole('button', { name: TRY.fullScreen }));
      await flush();
      const pill = screen.getByRole('group', { name: TRY.seatBar });
      expect(within(pill).getByRole('button', { name: TRY.endSession })).toBeInTheDocument();
      expect(document.documentElement.style.overflow).toBe('hidden');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: TRY.seatBar })).not.toBeInTheDocument();
      expect(document.documentElement.style.overflow).toBe('');
    } finally {
      delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });

  it('ends when the time is up', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => granted(2000)), health());
    await arriveAndTake(user);
    expect(screen.getByRole('timer')).toHaveTextContent('00:02 left');
    await flush(2000);
    expect(screen.queryByTitle(TRY.viewerTitle)).not.toBeInTheDocument();
    expect(screen.getByText(TRY.ended)).toBeInTheDocument();
  });

  it('waits in line, polls every 10 s, and opens the seat when one frees up', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(
      health(0, 2),
      route('POST', '/seat', () => reply({ status: 'queued', position: 2, etaMinutes: 6, ticket: 'T1' })),
      route('GET', '/queue/T1', () => reply({ status: 'queued', position: 1, etaMinutes: 3 })),
      route('GET', '/queue/T1', () => granted()),
    );
    renderTry();
    await flush();
    await user.click(screen.getByRole('button', { name: TRY.joinQueue }));
    await flush();
    const queued = fillText(TRY.queued, { n: 2, m: 6 });
    expect(screen.getByRole('status')).toHaveTextContent(queued);
    expect(screen.getByText(queued)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    await expectNoAxeViolations();

    expect(seatTexts()).toEqual([`${fillText(TRY.seatName, { n: 1 })}${TRY.seatInUse}`, `${fillText(TRY.seatName, { n: 2 })}${TRY.seatInUse}`]);
    await flush(QUEUE_POLL_MS - 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush(1000);
    expect(fetchMock).toHaveBeenLastCalledWith(`${SEAT_BROKER_URL}/queue/T1`, expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(screen.getByText(fillText(TRY.queued, { n: 1, m: 3 }))).toBeInTheDocument();

    await flush(QUEUE_POLL_MS);
    expect(screen.getByTitle(TRY.viewerTitle)).toHaveAttribute('src', VIEWER);
    await flush(16);
    expect(useAnnouncer.getState().polite).toBe(TRY.ready);
  });

  it('gives up on the line after two failed polls in a row', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(
      health(0, 2),
      route('POST', '/seat', () => reply({ status: 'queued', position: 1, etaMinutes: 2, ticket: 'T9' })),
      route('GET', '/queue/T9', () => Promise.reject(new TypeError('Failed to fetch'))),
      route('GET', '/queue/T9', () => reply({}, 502)),
    );
    renderTry();
    await flush();
    await user.click(screen.getByRole('button', { name: TRY.joinQueue }));
    await flush();
    await flush(QUEUE_POLL_MS);
    expect(screen.getByText(fillText(TRY.queued, { n: 1, m: 2 }))).toBeInTheDocument();
    await flush(QUEUE_POLL_MS);
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
  });

  it('says the demo computer is offline when the seat request cannot reach the broker', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => Promise.reject(new TypeError('Failed to fetch'))));
    await arriveAndTake(user);
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
    expect(seatTexts()[0]).toBe(`${fillText(TRY.seatName, { n: 1 })}${TRY.seatOffline}`);
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    await expectNoAxeViolations();
  });

  it('treats a viewer outside the viewer host as offline, and never frames it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => reply({ status: 'granted', viewerUrl: 'https://elsewhere.example/v', endsAt: Date.now() + 60_000 })));
    await arriveAndTake(user);
    expect(screen.queryByTitle(TRY.viewerTitle)).not.toBeInTheDocument();
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
  });

  it('explains the per-browser cap', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(health(), route('POST', '/seat', () => reply({ error: 'limit' }, 429)));
    await arriveAndTake(user);
    expect(screen.getByText(sentence(TRY.limited))).toBeInTheDocument();
  });

  it('formats the time left as mm:ss', () => {
    expect(formatLeft(15 * 60_000)).toBe('15:00');
    expect(formatLeft(61_001)).toBe('01:02');
    expect(formatLeft(-5)).toBe('00:00');
  });
});
