// /try (80 sections 1, 4 and 7): seat request, granted with the viewer and timer strip, queued with polling every
// 10 s, offline and capped replies, End session. The broker is a vi.fn on fetch.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QUEUE_POLL_MS, SEAT_BROKER_URL } from '@/components/TryOnRealComputer/broker';
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
  it('asks the broker for a seat with its cookie, and says so while it waits', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    renderTry();
    expect(document.title).toBe(TRY.title);
    expect(screen.getByRole('heading', { level: 1, name: TRY.heading })).toBeInTheDocument();
    expect(screen.getByText(TRY.line)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(TRY.requesting);
    expect(fetchMock).toHaveBeenCalledWith(`${SEAT_BROKER_URL}/seat`, expect.objectContaining({ method: 'POST', credentials: 'include' }));
    await expectNoAxeViolations();
  });

  it('embeds the seat with the timer strip, counts down and ends the session', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve(route('POST', '/seat', () => granted()), route('POST', '/seat/L1/end', () => reply({ ok: true })), route('POST', '/seat', () => new Promise<Response>(() => undefined)));
    renderTry();
    await flush();
    const frame = screen.getByTitle(TRY.viewerTitle);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', VIEWER);
    expect(frame).toHaveAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    const strip = screen.getByRole('region', { name: TRY.stripLabel });
    expect(within(strip).getByText(TRY.stripReal)).toBeInTheDocument();
    expect(within(strip).getByText(TRY.stripNano)).toBeInTheDocument();
    expect(within(strip).getByRole('timer')).toHaveTextContent('15:00 left');
    expect(strip.textContent).toContain('Real computer·Gemini Nano on this machine·15:00 left·End session');
    await flush(1000);
    expect(within(strip).getByRole('timer')).toHaveTextContent('14:59 left');
    await expectNoAxeViolations();

    await user.click(within(strip).getByRole('button', { name: TRY.endSession }));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`${SEAT_BROKER_URL}/seat/L1/end`, expect.objectContaining({ method: 'POST', credentials: 'include' }));
    expect(screen.queryByTitle(TRY.viewerTitle)).not.toBeInTheDocument();
    expect(screen.getByText(TRY.ended)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    await user.click(screen.getByRole('button', { name: TRY.again }));
    expect(screen.getByRole('status')).toHaveTextContent(TRY.requesting);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === `${SEAT_BROKER_URL}/seat`)).toHaveLength(2);
  });

  it('ends when the time is up', async () => {
    serve(route('POST', '/seat', () => granted(2000)));
    renderTry();
    await flush();
    expect(screen.getByRole('timer')).toHaveTextContent('00:02 left');
    await flush(2000);
    expect(screen.queryByTitle(TRY.viewerTitle)).not.toBeInTheDocument();
    expect(screen.getByText(TRY.ended)).toBeInTheDocument();
  });

  it('waits in line, polls every 10 s, and opens the seat when one frees up', async () => {
    serve(
      route('POST', '/seat', () => reply({ status: 'queued', position: 2, etaMinutes: 6, ticket: 'T1' })),
      route('GET', '/queue/T1', () => reply({ status: 'queued', position: 1, etaMinutes: 3 })),
      route('GET', '/queue/T1', () => granted()),
    );
    renderTry();
    await flush();
    const queued = fillText(TRY.queued, { n: 2, m: 6 });
    expect(screen.getByRole('status')).toHaveTextContent(queued);
    expect(screen.getByText(queued)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    await expectNoAxeViolations();

    await flush(QUEUE_POLL_MS - 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flush(1000);
    expect(fetchMock).toHaveBeenLastCalledWith(`${SEAT_BROKER_URL}/queue/T1`, expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(screen.getByText(fillText(TRY.queued, { n: 1, m: 3 }))).toBeInTheDocument();

    await flush(QUEUE_POLL_MS);
    expect(screen.getByTitle(TRY.viewerTitle)).toHaveAttribute('src', VIEWER);
    await flush(16);
    expect(useAnnouncer.getState().polite).toBe(TRY.ready);
  });

  it('gives up on the line after two failed polls in a row', async () => {
    serve(
      route('POST', '/seat', () => reply({ status: 'queued', position: 1, etaMinutes: 2, ticket: 'T9' })),
      route('GET', '/queue/T9', () => Promise.reject(new TypeError('Failed to fetch'))),
      route('GET', '/queue/T9', () => reply({}, 502)),
    );
    renderTry();
    await flush();
    await flush(QUEUE_POLL_MS);
    expect(screen.getByText(fillText(TRY.queued, { n: 1, m: 2 }))).toBeInTheDocument();
    await flush(QUEUE_POLL_MS);
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
  });

  it('says the demo computer is offline when the broker cannot be reached', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    renderTry();
    await flush();
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TRY.openPlayground })).toHaveAttribute('href', '/playground');
    await expectNoAxeViolations();
  });

  it('treats a viewer outside the viewer host as offline, and never frames it', async () => {
    serve(route('POST', '/seat', () => reply({ status: 'granted', viewerUrl: 'https://elsewhere.example/v', endsAt: Date.now() + 60_000 })));
    renderTry();
    await flush();
    expect(screen.queryByTitle(TRY.viewerTitle)).not.toBeInTheDocument();
    expect(screen.getByText(TRY.offline)).toBeInTheDocument();
  });

  it('explains the per-browser cap', async () => {
    serve(route('POST', '/seat', () => reply({ error: 'limit' }, 429)));
    renderTry();
    await flush();
    expect(screen.getByText(sentence(TRY.limited))).toBeInTheDocument();
  });

  it('formats the time left as mm:ss', () => {
    expect(formatLeft(15 * 60_000)).toBe('15:00');
    expect(formatLeft(61_001)).toBe('01:02');
    expect(formatLeft(-5)).toBe('00:00');
  });
});
