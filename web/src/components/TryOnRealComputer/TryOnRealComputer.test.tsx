// "Try it on a real computer" (80 sections 1, 4 and 7): shown only while GET /health succeeds, hidden after two
// failures in a row, never inside a seat. The broker is a vi.fn on fetch.
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { TRY } from '@/copy/screens-controls';
import { expectNoAxeViolations } from '@/test/axe';
import { HEALTH_POLL_MS, SEAT_BROKER_URL, checkHealth, isViewerUrl, parseEndsAt, parseSeatReply } from './broker';
import { TryOnRealComputer } from './TryOnRealComputer';

const fetchMock = vi.fn<typeof fetch>();

function reply(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const healthy = () => reply({ ok: true, seatsFree: 1, seatsTotal: 2 });
const down = () => Promise.reject(new TypeError('Failed to fetch'));

function renderButton(path = '/playground') {
  const router = createMemoryRouter([{ path: '*', element: <main><TryOnRealComputer /></main> }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('TryOnRealComputer', () => {
  it('appears once the broker is healthy and links to /try', async () => {
    fetchMock.mockImplementation(async () => healthy());
    renderButton();
    expect(screen.queryByRole('link', { name: TRY.button })).not.toBeInTheDocument();
    await flush();
    expect(screen.getByRole('link', { name: TRY.button })).toHaveAttribute('href', '/try');
    expect(screen.getByText(TRY.line)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${SEAT_BROKER_URL}/health`, expect.objectContaining({ method: 'GET', credentials: 'omit' }));
    vi.useRealTimers();
    await expectNoAxeViolations();
  });

  it('stays hidden while the broker is unreachable', async () => {
    fetchMock.mockImplementation(down);
    renderButton();
    await flush();
    await flush(HEALTH_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('link', { name: TRY.button })).not.toBeInTheDocument();
  });

  it('survives one failed check and hides after two in a row', async () => {
    fetchMock
      .mockImplementationOnce(async () => healthy())
      .mockImplementationOnce(down)
      .mockImplementationOnce(async () => healthy())
      .mockImplementationOnce(down)
      .mockImplementationOnce(async () => reply({ ok: false, seatsFree: 0, seatsTotal: 2 }))
      .mockImplementationOnce(async () => healthy());
    renderButton();
    await flush();
    expect(screen.getByRole('link', { name: TRY.button })).toBeInTheDocument();
    await flush(HEALTH_POLL_MS); // one failure
    expect(screen.getByRole('link', { name: TRY.button })).toBeInTheDocument();
    await flush(HEALTH_POLL_MS); // success resets the count
    await flush(HEALTH_POLL_MS); // failure 1
    expect(screen.getByRole('link', { name: TRY.button })).toBeInTheDocument();
    await flush(HEALTH_POLL_MS); // { ok: false } is failure 2
    expect(screen.queryByRole('link', { name: TRY.button })).not.toBeInTheDocument();
    await flush(HEALTH_POLL_MS); // back again
    expect(screen.getByRole('link', { name: TRY.button })).toBeInTheDocument();
  });

  it('never shows inside a demo computer seat, even after navigating away from ?seat=1', async () => {
    fetchMock.mockImplementation(async () => healthy());
    const first = renderButton('/playground?seat=1');
    await flush();
    expect(screen.queryByRole('link', { name: TRY.button })).not.toBeInTheDocument();
    first.unmount();
    renderButton('/playground');
    await flush();
    expect(screen.queryByRole('link', { name: TRY.button })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops polling when unmounted', async () => {
    fetchMock.mockImplementation(async () => healthy());
    const view = renderButton();
    await flush();
    view.unmount();
    await flush(HEALTH_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('broker replies', () => {
  it('accepts only viewer pages on the viewer host', () => {
    expect(isViewerUrl('https://sieve-view.manideep.info/s/abc?token=1')).toBe(true);
    expect(isViewerUrl('http://sieve-view.manideep.info/s/abc')).toBe(false);
    expect(isViewerUrl('https://sieve-view.manideep.info.evil.example/s')).toBe(false);
    expect(isViewerUrl('javascript:alert(1)')).toBe(false);
    expect(isViewerUrl(42)).toBe(false);
  });

  it('reads endsAt as epoch ms, epoch seconds or an ISO date', () => {
    expect(parseEndsAt(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(parseEndsAt(1_800_000_000)).toBe(1_800_000_000_000);
    expect(parseEndsAt('2026-11-18T12:00:00Z')).toBe(Date.parse('2026-11-18T12:00:00Z'));
    expect(parseEndsAt('soon')).toBeUndefined();
  });

  it('parses granted and queued replies and rejects anything else', () => {
    expect(parseSeatReply({ status: 'granted', viewerUrl: 'https://sieve-view.manideep.info/s/a', endsAt: 1_800_000_000_000, lease: 'L1' })).toEqual({
      status: 'granted', viewerUrl: 'https://sieve-view.manideep.info/s/a', endsAt: 1_800_000_000_000, lease: 'L1',
    });
    expect(parseSeatReply({ status: 'queued', position: 2, etaMinutes: 6 }, 'T1')).toEqual({ status: 'queued', position: 2, etaMinutes: 6, ticket: 'T1' });
    expect(() => parseSeatReply({ status: 'granted', viewerUrl: 'https://elsewhere.example/', endsAt: 1 })).toThrow();
    expect(() => parseSeatReply({ status: 'queued', position: 2 })).toThrow();
    expect(() => parseSeatReply('nope')).toThrow();
  });

  it('treats a health reply without ok: true as a failure', async () => {
    fetchMock.mockImplementation(async () => reply({ ok: false }));
    await expect(checkHealth()).rejects.toThrow();
    fetchMock.mockImplementation(async () => reply({}, 503));
    await expect(checkHealth()).rejects.toThrow();
  });
});
