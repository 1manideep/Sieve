// The upload of an approved file: its place, its one request, and what happens when Storage says no.
import { SHARED_FILE_MAX_BYTES, SHARED_FILE_PATH_RE } from '@sieve/shared';
import { describe, expect, it, vi } from 'vitest';
import { HandoffError, handoffObjectName, removeHandoff, uploadHandoff, type HandoffDeps } from './handoff';

const UID = 'u'.repeat(28);
const REQ = 'r'.repeat(20);
const file = new Blob([new Uint8Array(1200)], { type: 'application/pdf' });

function deps(respond: (url: string, init: RequestInit) => Response | Promise<Response>, over: Partial<HandoffDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const d: HandoffDeps = {
    bucket: 'sieve-test.firebasestorage.app',
    idToken: async () => 'id-token',
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond(String(url), init ?? {});
    }) as typeof fetch,
    ...over,
  };
  return { d, calls };
}

describe('uploadHandoff', () => {
  it("puts the file in this person's place for this request, in one request with their sign-in", async () => {
    const { d, calls } = deps(() => new Response('{}', { status: 200 }), { appCheckToken: async () => 'check' });
    const path = await uploadHandoff(UID, REQ, file, 'application/pdf', d);
    expect(path).toMatch(SHARED_FILE_PATH_RE);
    expect(path.startsWith(`handoffs/${UID}/${REQ}/`)).toBe(true);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v0/b/sieve-test.firebasestorage.app/o');
    expect(url.searchParams.get('name')).toBe(path);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toEqual({ Authorization: 'Firebase id-token', 'Content-Type': 'application/pdf', 'X-Firebase-AppCheck': 'check' });
    expect(calls[0]!.init.body).toBe(file);
  });

  it('names every upload differently', () => {
    const names = new Set(Array.from({ length: 50 }, () => handoffObjectName()));
    expect(names.size).toBe(50);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('refuses an empty or oversized file before any request, and says when Storage refuses or cannot be reached', async () => {
    const quiet = deps(() => new Response('{}', { status: 200 }));
    await expect(uploadHandoff(UID, REQ, new Blob([]), 'application/pdf', quiet.d)).rejects.toMatchObject({ code: 'too-large' });
    const big = { size: SHARED_FILE_MAX_BYTES + 1 } as Blob;
    await expect(uploadHandoff(UID, REQ, big, 'application/pdf', quiet.d)).rejects.toBeInstanceOf(HandoffError);
    expect(quiet.calls).toHaveLength(0);
    await expect(uploadHandoff(UID, REQ, file, 'application/pdf', deps(() => new Response('no', { status: 403 })).d)).rejects.toMatchObject({ code: 'refused' });
    await expect(uploadHandoff(UID, REQ, file, 'application/pdf', deps(() => { throw new TypeError('network'); }).d)).rejects.toMatchObject({ code: 'offline' });
    // an App Check token that cannot be had does not stop the upload: Storage decides
    const noCheck = deps(() => new Response('{}', { status: 200 }), { appCheckToken: async () => { throw new Error('x'); } });
    await uploadHandoff(UID, REQ, file, 'application/pdf', noCheck.d);
    expect(noCheck.calls[0]!.init.headers).toEqual({ Authorization: 'Firebase id-token', 'Content-Type': 'application/pdf' });
  });

  it('ends as offline when an upload or a sign-in token hangs, so an approval never waits forever (Nov 23)', async () => {
    const hung = deps((_url, init) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }), { timeoutMs: 20 });
    await expect(uploadHandoff(UID, REQ, file, 'application/pdf', hung.d)).rejects.toMatchObject({ name: 'HandoffError', code: 'offline' });
    expect(hung.calls[0]!.init.signal?.aborted).toBe(true);
    const noToken = deps(() => new Response('{}', { status: 200 }), { idToken: () => new Promise<string>(() => undefined), timeoutMs: 20 });
    await expect(uploadHandoff(UID, REQ, file, 'application/pdf', noToken.d)).rejects.toMatchObject({ code: 'offline' });
    expect(noToken.calls).toHaveLength(0);
  });

  it("a caller's own stop is passed on as it is", async () => {
    const ctl = new AbortController();
    const slow = deps((_url, init) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const p = uploadHandoff(UID, REQ, file, 'application/pdf', slow.d, ctl.signal);
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('takes a file back with one delete, and never throws', async () => {
    const path = `handoffs/${UID}/${REQ}/${'o'.repeat(24)}`;
    const ok = deps(() => new Response(null, { status: 204 }));
    await removeHandoff(path, ok.d);
    expect(ok.calls[0]!.init.method).toBe('DELETE');
    expect(ok.calls[0]!.url).toBe(`https://firebasestorage.googleapis.com/v0/b/sieve-test.firebasestorage.app/o/${encodeURIComponent(path)}`);
    const down = deps(() => { throw new TypeError('network'); });
    await expect(removeHandoff(path, down.d)).resolves.toBeUndefined();
    const other = deps(vi.fn(() => new Response(null, { status: 204 })));
    await removeHandoff('users/someone/else', other.d);
    expect(other.calls).toHaveLength(0);
  });
});
