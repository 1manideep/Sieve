// FakeGmail (70 section 15.2): an in-memory mailbox behind a fetch replacement for gmail.googleapis.com.
// Messages, a history log with its own ids, a profile, `q` support for the operators Sieve sends, paging,
// fault scripts consumed in order, and quota units counted with 20's GMAIL_COST.

export interface FakePart { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: FakePart[] }
export interface FakeMessage {
  id: string; threadId: string; labelIds: string[]; internalDate: number; snippet: string; sizeEstimate: number;
  payload: FakePart; subject: string; from: string; body: string;
}
interface HistoryEntry {
  id: string;
  messagesAdded?: { message: { id: string; threadId: string; labelIds: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] }[];
}
export interface Fault { match: string; status: number; headers?: Record<string, string>; body?: unknown; times?: number }

const COST = { profile: 1, list: 5, history: 2, get: 20, getFull: 60 };

export function b64url(s: string | Uint8Array): string {
  const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : s;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) } });
}

function gmailDate(s: string): number {
  const [y, m, d] = s.split('/').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

export class FakeGmail {
  messages = new Map<string, FakeMessage>();
  private history: HistoryEntry[] = [];
  historyId = 1000;
  historyFloor = 0;
  email = 'alex.rivera@inbox.example';
  token = 'ya29.fake-token-0123456789';
  units = 0;
  calls: string[] = [];
  now = Date.parse('2026-11-17T09:00:00-06:00');
  private faults: Fault[] = [];
  private nextId = 1;
  private uninstall: (() => void) | null = null;

  /** Add a message. `silent` skips the history entry (a message that existed before the cursor). */
  add(m: { id?: string; threadId?: string; subject?: string; from?: string; text?: string; html?: string; internalDate?: number; labelIds?: string[]; payload?: FakePart; snippet?: string }, opts?: { silent?: boolean }): FakeMessage {
    const id = m.id ?? (0x18c2f0a9d1e4b000 + this.nextId++).toString(16);
    const subject = m.subject ?? '(subject)';
    const from = m.from ?? 'Dana Whitfield <dana@thistlewick-pm.example>';
    const body = m.text ?? '';
    const headers = [
      { name: 'From', value: from },
      { name: 'To', value: `Alex Rivera <${this.email}>` },
      { name: 'Subject', value: subject },
      { name: 'Date', value: new Date(m.internalDate ?? this.now).toUTCString() },
    ];
    const payload: FakePart = m.payload ? { ...m.payload, headers: [...headers, ...(m.payload.headers ?? [])] } : m.html
      ? { mimeType: 'multipart/alternative', headers, parts: [
        { partId: '0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: b64url(body), size: body.length } },
        { partId: '1', mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { data: b64url(m.html), size: m.html.length } },
      ] }
      : { mimeType: 'text/plain', headers: [...headers, { name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: b64url(body), size: body.length } };
    const msg: FakeMessage = {
      id, threadId: m.threadId ?? id, labelIds: m.labelIds ?? ['INBOX'], internalDate: m.internalDate ?? this.now - this.nextId * 60_000,
      snippet: m.snippet ?? body.slice(0, 120), sizeEstimate: 1000 + body.length, payload, subject, from, body,
    };
    this.messages.set(id, msg);
    if (!opts?.silent) this.log({ messagesAdded: [{ message: { id, threadId: msg.threadId, labelIds: msg.labelIds } }] });
    else this.historyId++;
    return msg;
  }

  private log(e: Omit<HistoryEntry, 'id'>): void {
    this.historyId++;
    this.history.push({ id: String(this.historyId), ...e });
  }

  delete(id: string): void {
    const m = this.messages.get(id);
    this.messages.delete(id);
    if (m) this.log({ messagesDeleted: [{ message: { id, threadId: m.threadId } }] });
  }

  /** Delete without a history entry (a delete Sieve can only notice by asking Gmail). */
  deleteSilently(id: string): void {
    this.messages.delete(id);
  }

  trash(id: string): void {
    const m = this.messages.get(id);
    if (!m) return;
    m.labelIds = [...m.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'];
    this.log({ labelsAdded: [{ message: { id, threadId: m.threadId, labelIds: m.labelIds }, labelIds: ['TRASH'] }] });
  }

  restore(id: string): void {
    const m = this.messages.get(id);
    if (!m) return;
    m.labelIds = [...m.labelIds.filter((l) => l !== 'TRASH'), 'INBOX'];
    this.log({ labelsRemoved: [{ message: { id, threadId: m.threadId, labelIds: m.labelIds }, labelIds: ['TRASH'] }] });
  }

  /** History older than now returns 404 (Gmail keeps it at least about a week, sometimes hours). */
  expireHistory(): void {
    this.historyFloor = this.historyId;
  }

  script(faults: Fault[]): void {
    this.faults.push(...faults.map((f) => ({ ...f })));
  }

  private matches(q: string, m: FakeMessage): boolean {
    let rest = q;
    const take = (re: RegExp) => {
      const out: string[] = [];
      rest = rest.replace(re, (_, v: string) => {
        out.push(v);
        return ' ';
      });
      return out;
    };
    for (const v of take(/newer_than:(\d+)m/g)) if (m.internalDate < this.now - Number(v) * 31 * 86_400_000) return false;
    for (const v of take(/after:(\d{4}\/\d{2}\/\d{2})/g)) if (m.internalDate < gmailDate(v) + 86_400_000) return false;
    for (const v of take(/before:(\d{4}\/\d{2}\/\d{2})/g)) if (m.internalDate >= gmailDate(v)) return false;
    for (const v of take(/-in:(\w+)/g)) if (m.labelIds.includes(v.toUpperCase().replace(/S$/, ''))) return false;
    for (const v of take(/from:"([^"]+)"/g)) if (!m.from.toLowerCase().includes(v.toLowerCase())) return false;
    for (const v of take(/from:(\S+)/g)) if (!m.from.toLowerCase().includes(v.toLowerCase())) return false;
    rest = rest.replace(/has:attachment|\{[^}]*\}/g, ' ');
    const hay = `${m.subject}\n${m.from}\n${m.body}`.toLowerCase();
    for (const v of take(/"([^"]+)"/g)) if (!hay.includes(v.toLowerCase())) return false;
    for (const w of rest.split(/\s+/).filter(Boolean)) if (!hay.includes(w.toLowerCase())) return false;
    return true;
  }

  private visible(m: FakeMessage): boolean {
    return !m.labelIds.includes('TRASH') && !m.labelIds.includes('SPAM');
  }

  handle = async (url: URL, headers: Headers): Promise<Response> => {
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    const route = path.startsWith('/messages/') ? 'GET /messages/*' : `GET ${path}`;
    this.calls.push(`${route}${url.search}`);
    const fault = this.faults.find((f) => f.match === route || f.match === 'GET *');
    if (fault) {
      fault.times = (fault.times ?? 1) - 1;
      if (fault.times <= 0) this.faults.splice(this.faults.indexOf(fault), 1);
      return json(fault.status, fault.body ?? { error: { code: fault.status, message: 'fault', errors: [{ reason: 'backendError' }] } }, fault.headers);
    }
    if (headers.get('Authorization') !== `Bearer ${this.token}`) return json(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
    if (path === '/profile') {
      this.units += COST.profile;
      return json(200, { emailAddress: this.email, historyId: String(this.historyId), messagesTotal: this.messages.size });
    }
    if (path === '/messages') {
      this.units += COST.list;
      const q = url.searchParams.get('q') ?? '';
      const max = Number(url.searchParams.get('maxResults') ?? 100);
      const offset = Number(url.searchParams.get('pageToken') ?? 0);
      const all = [...this.messages.values()].filter((m) => this.visible(m) && this.matches(q, m)).sort((a, b) => b.internalDate - a.internalDate);
      const page = all.slice(offset, offset + max);
      const body: Record<string, unknown> = { resultSizeEstimate: all.length };
      if (page.length > 0) body.messages = page.map((m) => ({ id: m.id, threadId: m.threadId }));
      if (offset + max < all.length) body.nextPageToken = String(offset + max);
      return json(200, body);
    }
    if (path.startsWith('/messages/')) {
      const id = decodeURIComponent(path.slice('/messages/'.length));
      const format = url.searchParams.get('format') ?? 'full';
      this.units += format === 'full' ? COST.getFull : COST.get;
      const m = this.messages.get(id);
      if (!m) return json(404, { error: { code: 404, message: 'Requested entity was not found.', errors: [{ reason: 'notFound' }] } });
      const base = { id: m.id, threadId: m.threadId, labelIds: m.labelIds, historyId: String(this.historyId) };
      if (format === 'minimal') return json(200, base);
      const meta = { ...base, snippet: m.snippet, internalDate: String(m.internalDate), sizeEstimate: m.sizeEstimate };
      if (format === 'metadata') {
        const wanted = new Set(url.searchParams.getAll('metadataHeaders').map((h) => h.toLowerCase()));
        return json(200, { ...meta, payload: { mimeType: m.payload.mimeType, headers: (m.payload.headers ?? []).filter((h) => wanted.has(h.name.toLowerCase())) } });
      }
      return json(200, { ...meta, payload: m.payload });
    }
    if (path === '/history') {
      this.units += COST.history;
      const start = Number(url.searchParams.get('startHistoryId') ?? 0);
      if (start < this.historyFloor) return json(404, { error: { code: 404, message: 'Requested entity was not found.', errors: [{ reason: 'notFound' }] } });
      const entries = this.history.filter((h) => Number(h.id) > start);
      return json(200, { history: entries.length > 0 ? entries : undefined, historyId: String(this.historyId) });
    }
    return json(404, { error: { code: 404, message: 'no route' } });
  };

  /** Replace fetch for gmail.googleapis.com only; other URLs fall through to the previous fetch. */
  install(): () => void {
    const prev = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href);
      if (url.hostname !== 'gmail.googleapis.com') return prev(input, init);
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return this.handle(url, new Headers(init?.headers));
    }) as typeof fetch;
    this.uninstall = () => {
      globalThis.fetch = prev;
    };
    return this.uninstall;
  }

  restoreFetch(): void {
    this.uninstall?.();
    this.uninstall = null;
  }
}
