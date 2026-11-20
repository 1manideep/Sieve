// Seat broker client for "Try it on a real computer" (80 sections 3 and 4).
// app/env.ts has no variable for the broker or the viewer, so the two hostnames of 80 section 3 are constants here
// (they match the CSP in firebase.json: connect-src and frame-src).
export const SEAT_BROKER_URL = 'https://sieve-seats.manideep.info';
export const SEAT_VIEWER_ORIGIN = 'https://sieve-view.manideep.info';

export const HEALTH_POLL_MS = 20_000;        // two misses hide the button within a minute (80 section 10 test 6)
export const HEALTH_FAILURES_TO_HIDE = 2;     // 80 section 4: hidden when /health fails twice in a row
export const QUEUE_POLL_MS = 10_000;          // 80 section 1: the page polls the queue every 10 s
export const BROKER_TIMEOUT_MS = 8_000;

export interface SeatHealth { ok: true; seatsFree: number; seatsTotal: number }
/** `lease` is needed for POST /seat/{lease}/end; 80 section 4 does not list it in the reply yet (change request). */
export interface SeatGranted { status: 'granted'; viewerUrl: string; endsAt: number; lease?: string }
export interface SeatQueued { status: 'queued'; position: number; etaMinutes: number; ticket: string }
/** HTTP 429: the per-browser or hourly cap of 80 section 4, or a full queue. */
export interface SeatLimited { status: 'limited' }
export type SeatReply = SeatGranted | SeatQueued | SeatLimited;

export class BrokerError extends Error {
  constructor(readonly reason: 'unreachable' | 'bad-reply') {
    super(reason === 'unreachable' ? 'The seat broker could not be reached.' : 'The seat broker sent an unexpected reply.');
    this.name = 'BrokerError';
  }
}

type Json = Record<string, unknown>;

async function call(path: string, { allow429 = false, ...init }: RequestInit & { allow429?: boolean }): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BROKER_TIMEOUT_MS);
  const outer = init.signal;
  const onAbort = () => ctl.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(SEAT_BROKER_URL + path, { ...init, signal: ctl.signal, cache: 'no-store' });
    if (res.status === 429 && allow429) return { status: 429, body: null };
    if (!res.ok) throw new BrokerError('unreachable');
    const body: unknown = await res.json().catch(() => {
      throw new BrokerError('bad-reply');
    });
    return { status: res.status, body };
  } catch (error) {
    // The unit-test fetch stub throws synchronously; a real fetch rejects. Both land here.
    if (error instanceof BrokerError) throw error;
    throw new BrokerError('unreachable');
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

function isJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only a viewer page on the viewer host may be framed (80 section 7; 70 R-UI-02). */
export function isViewerUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === SEAT_VIEWER_ORIGIN;
  } catch {
    return false;
  }
}

/** `endsAt` as epoch ms from epoch ms, epoch seconds or an ISO date. */
export function parseEndsAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

export function parseSeatReply(body: unknown, ticket?: string): SeatGranted | SeatQueued {
  if (!isJson(body)) throw new BrokerError('bad-reply');
  if (body.status === 'granted') {
    const endsAt = parseEndsAt(body.endsAt);
    if (!isViewerUrl(body.viewerUrl) || endsAt === undefined) throw new BrokerError('bad-reply');
    const lease = typeof body.lease === 'string' && body.lease !== '' ? body.lease : undefined;
    return { status: 'granted', viewerUrl: body.viewerUrl, endsAt, lease };
  }
  if (body.status === 'queued') {
    const position = count(body.position);
    const etaMinutes = count(body.etaMinutes);
    const t = typeof body.ticket === 'string' && body.ticket !== '' ? body.ticket : ticket;
    if (position === undefined || etaMinutes === undefined || t === undefined) throw new BrokerError('bad-reply');
    return { status: 'queued', position, etaMinutes, ticket: t };
  }
  throw new BrokerError('bad-reply');
}

/** POST /seat. One active lease per browser, bound by the broker's cookie, so credentials go with it. */
export async function requestSeat(signal?: AbortSignal): Promise<SeatReply> {
  const { status, body } = await call('/seat', { method: 'POST', credentials: 'include', signal, allow429: true });
  if (status === 429) return { status: 'limited' };
  return parseSeatReply(body);
}

/** GET /queue/{ticket}: position and ETA, or the granted seat once one frees up. */
export async function checkQueue(ticket: string, signal?: AbortSignal): Promise<SeatGranted | SeatQueued> {
  const { body } = await call(`/queue/${encodeURIComponent(ticket)}`, { method: 'GET', credentials: 'include', signal });
  return parseSeatReply(body, ticket);
}

/** POST /seat/{lease}/end ("End session"). */
export async function endSeat(lease: string): Promise<void> {
  await call(`/seat/${encodeURIComponent(lease)}/end`, { method: 'POST', credentials: 'include', keepalive: true });
}

/** GET /health. Anything but `{ ok: true }` counts as a failure. */
export async function checkHealth(signal?: AbortSignal): Promise<SeatHealth> {
  const { body } = await call('/health', { method: 'GET', credentials: 'omit', signal });
  if (!isJson(body) || body.ok !== true) throw new BrokerError('bad-reply');
  return { ok: true, seatsFree: count(body.seatsFree) ?? 0, seatsTotal: count(body.seatsTotal) ?? 0 };
}
