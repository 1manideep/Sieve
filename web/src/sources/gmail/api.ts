// Gmail REST from the browser (20 section 15.2): bearer token, quota bucket, backoff, typed errors.
import { BACKOFF, GMAIL_API, GMAIL_BUCKET_CAPACITY, GMAIL_COST, GMAIL_LIST_PAGE, GMAIL_MAX_CONCURRENCY, GMAIL_UNITS_PER_MINUTE } from '../../index/config';
import { emitIndexEvent } from '../../index/events';
import { getGmailToken, rejectGmailToken } from './auth';
import { UnitBucket } from './rateLimit';

export type Priority = 'interactive' | 'background';

export class GmailAuthError extends Error {
  constructor(message = 'Gmail needs you to sign in again.') {
    super(message);
    this.name = 'GmailAuthError';
  }
}
export class GmailNotFoundError extends Error {
  constructor(message = 'Not found in Gmail.') {
    super(message);
    this.name = 'GmailNotFoundError';
  }
}
export class GmailForbiddenError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'GmailForbiddenError';
  }
}
export class GmailNetworkError extends Error {
  constructor(message = "Couldn't reach Gmail.") {
    super(message);
    this.name = 'GmailNetworkError';
  }
}
export class GmailRateError extends Error {
  constructor(message = 'Gmail is limiting requests.') {
    super(message);
    this.name = 'GmailRateError';
  }
}

export interface GmailPart { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[] }
export interface GmailMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; historyId?: string;
  internalDate?: string; sizeEstimate?: number; payload?: GmailPart }
export interface GmailHistory { id: string; messagesAdded?: { message: GmailMessage }[]; messagesDeleted?: { message: GmailMessage }[];
  labelsAdded?: { message: GmailMessage; labelIds: string[] }[]; labelsRemoved?: { message: GmailMessage; labelIds: string[] }[] }

let bucket: UnitBucket | null = null;
function theBucket(): UnitBucket {
  bucket ??= new UnitBucket({ unitsPerMinute: GMAIL_UNITS_PER_MINUTE, capacity: GMAIL_BUCKET_CAPACITY, maxConcurrency: GMAIL_MAX_CONCURRENCY });
  return bucket;
}

/** Tests: a fresh bucket (and an injectable clock). */
export function resetGmailBucket(b?: UnitBucket): void {
  bucket = b ?? null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function buildUrl(path: string, query?: Record<string, string | string[] | number>): string {
  const url = new URL(GMAIL_API + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, x);
    else url.searchParams.append(k, String(v));
  }
  return url.toString();
}

const RETRY_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

export async function gmailFetch<T>(path: string, opts: { units: number; priority: Priority; signal?: AbortSignal; query?: Record<string, string | string[] | number> }): Promise<T> {
  const url = buildUrl(path, opts.query);
  for (let attempt = 0; ; attempt++) {
    const tok = getGmailToken();
    if (!tok) throw new GmailAuthError();
    const release = await theBucket().acquire(opts.units, opts.priority, opts.signal);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, signal: opts.signal });
    } catch (e) {
      release();
      if ((e as { name?: string }).name === 'AbortError') throw e;
      if (attempt + 1 >= BACKOFF.maxAttempts) throw new GmailNetworkError();
      await sleep(Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** attempt) + Math.random() * BACKOFF.jitterMs, opts.signal);
      continue;
    }
    release();
    if (res.ok) return (await res.json()) as T;
    let reason = '';
    let message = '';
    try {
      const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
      reason = body.error?.errors?.[0]?.reason ?? '';
      message = body.error?.message ?? '';
    } catch {
      // no JSON body
    }
    if (res.status === 401) {
      rejectGmailToken(tok);   // the registry then drops it from the store too (20 section 15.1)
      emitIndexEvent({ type: 'gmail-auth-lost' });
      throw new GmailAuthError();
    }
    if (res.status === 404) throw new GmailNotFoundError();
    if (res.status === 400) throw new Error(message || 'Gmail did not accept the request.');
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && RETRY_REASONS.has(reason));
    if (res.status === 403 && !retryable) {
      emitIndexEvent({ type: 'gmail-forbidden', reason: reason || 'forbidden' });
      throw new GmailForbiddenError(reason || 'forbidden', `Gmail refused access: ${reason || 'forbidden'}.`);
    }
    if (!retryable) throw new Error(`Gmail answered ${res.status}.`);
    if (attempt + 1 >= BACKOFF.maxAttempts) {
      emitIndexEvent({ type: 'gmail-rate-limited' });
      throw new GmailRateError();
    }
    const retryAfter = Number(res.headers.get('Retry-After'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** attempt) + Math.random() * BACKOFF.jitterMs;
    await sleep(wait, opts.signal);
  }
}

export function getProfile(p: Priority = 'interactive'): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }> {
  return gmailFetch('/profile', { units: GMAIL_COST.profile, priority: p });
}

export function listMessages(q: string, pageToken?: string, maxResults = GMAIL_LIST_PAGE, p: Priority = 'background', signal?: AbortSignal):
  Promise<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: number }> {
  const query: Record<string, string | number> = { q, maxResults };
  if (pageToken) query.pageToken = pageToken;
  return gmailFetch('/messages', { units: GMAIL_COST.list, priority: p, signal, query });
}

export function getMessage(id: string, format: 'minimal' | 'metadata' | 'full', p: Priority = 'background', signal?: AbortSignal): Promise<GmailMessage> {
  const query: Record<string, string | string[]> = { format };
  if (format === 'metadata') query.metadataHeaders = ['From', 'To', 'Subject', 'Date'];
  return gmailFetch(`/messages/${encodeURIComponent(id)}`, { units: format === 'full' ? GMAIL_COST.getFull : GMAIL_COST.get, priority: p, signal, query });
}

export function listHistory(startHistoryId: string, pageToken?: string, signal?: AbortSignal):
  Promise<{ history?: GmailHistory[]; nextPageToken?: string; historyId: string }> {
  const query: Record<string, string | string[] | number> = {
    startHistoryId, historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'], maxResults: 500,
  };
  if (pageToken) query.pageToken = pageToken;
  return gmailFetch('/history', { units: GMAIL_COST.history, priority: 'background', signal, query });
}
