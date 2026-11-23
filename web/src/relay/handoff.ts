// After the person approves sending a file itself, the home base puts it where the relay can make a link to it:
// handoffs/{uid}/{requestId}/{object} in Cloud Storage (storage.rules: this person's own place, once, at most
// 20 MB, and no client can read it back). One plain request with the person's Firebase sign-in, so the Storage SDK
// does not have to load. Nothing is uploaded before the approval, and a file whose answer could not be written is
// taken back at once.
import { SHARED_FILE_MAX_BYTES, SHARED_FILE_PATH_RE } from '@sieve/shared';

export class HandoffError extends Error {
  constructor(readonly code: 'too-large' | 'refused' | 'offline') {
    super(code);
    this.name = 'HandoffError';
  }
}

export interface HandoffDeps {
  bucket: string;
  idToken(): Promise<string>;
  appCheckToken?(): Promise<string | undefined>;
  fetch?: typeof fetch;
  /** Tests: a shorter limit than UPLOAD_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * An upload that has not finished by then ends as 'offline', so an approval never spins forever (Nov 23, 2026: a
 * blocked request once left the card waiting). 20 MB at a slow 2 Mbit/s takes about 80 seconds.
 */
export const UPLOAD_TIMEOUT_MS = 90_000;

const HOST = 'https://firebasestorage.googleapis.com/v0/b';
const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** 24 characters nobody can guess, of the kinds the Storage rules accept. */
export function handoffObjectName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let out = '';
  for (const b of bytes) out += NAME_CHARS[b % NAME_CHARS.length];
  return out;
}

async function headers(deps: HandoffDeps, mime?: string): Promise<Record<string, string>> {
  const out: Record<string, string> = { Authorization: `Firebase ${await deps.idToken()}` };
  if (mime) out['Content-Type'] = mime;
  const check = await deps.appCheckToken?.().catch(() => undefined);
  if (check) out['X-Firebase-AppCheck'] = check;
  return out;
}

/**
 * Uploads the file and returns its place. Throws HandoffError ('offline' also when it takes longer than
 * UPLOAD_TIMEOUT_MS, the sign-in tokens included); nothing is left behind when it does.
 */
export async function uploadHandoff(uid: string, requestId: string, blob: Blob, mime: string, deps: HandoffDeps, signal?: AbortSignal): Promise<string> {
  if (blob.size <= 0 || blob.size > SHARED_FILE_MAX_BYTES) throw new HandoffError('too-large');
  const path = `handoffs/${uid}/${requestId}/${handoffObjectName()}`;
  if (!SHARED_FILE_PATH_RE.test(path)) throw new HandoffError('refused');
  const ctl = new AbortController();
  const stop = () => ctl.abort(signal?.reason);
  signal?.addEventListener('abort', stop);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new HandoffError('offline'));
    }, deps.timeoutMs ?? UPLOAD_TIMEOUT_MS);
  });
  let res: Response;
  try {
    const send = async () =>
      (deps.fetch ?? fetch)(`${HOST}/${encodeURIComponent(deps.bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
        method: 'POST', headers: await headers(deps, mime), body: blob, signal: ctl.signal,
      });
    res = await Promise.race([send(), late]);
  } catch (e) {
    if (signal?.aborted && (e as { name?: string }).name === 'AbortError') throw e;
    if (e instanceof HandoffError) throw e;
    throw new HandoffError('offline');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
  if (!res.ok) throw new HandoffError('refused');
  return path;
}

/** Takes an uploaded file back (the answer was not written, or the person changed their mind). Never throws. */
export async function removeHandoff(path: string, deps: HandoffDeps): Promise<void> {
  if (!SHARED_FILE_PATH_RE.test(path)) return;
  try {
    await (deps.fetch ?? fetch)(`${HOST}/${encodeURIComponent(deps.bucket)}/o/${encodeURIComponent(path)}`, { method: 'DELETE', headers: await headers(deps) });
  } catch {
    // the relay's cleanup removes what is left
  }
}
