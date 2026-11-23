// The word list reaches the running app (20 section 9.2): fetched once, before a question is read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knownOrgWords, knownSenderWords } from './cues';
import { dictionaryReady, isDictionaryLoaded, isEnglishWord, resetDictionary } from './dictionary';
import { correctQuery } from './typos';

const LIST = 'payment\t35\nreceipt\t35\nfailed\t35\norder\t35\n';
const FROMS = ['Lumora <no-reply@mail.lumora.example>', 'Order Desk <orders@payment.example>'];

describe('dictionaryReady', () => {
  beforeEach(() => {
    resetDictionary();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetDictionary();
  });

  it('fetches the list once and turns on what reads it', async () => {
    const fetchMock = vi.fn(async () => new Response(LIST, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // before: no correction, and no sender or company word is known
    expect(isDictionaryLoaded()).toBe(false);
    expect(correctQuery('my paymnet receipt', null).fixes).toEqual([]);
    expect(knownOrgWords(FROMS).size).toBe(0);
    expect(knownSenderWords(FROMS).size).toBe(0);

    await Promise.all([dictionaryReady(), dictionaryReady()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isDictionaryLoaded()).toBe(true);
    expect(isEnglishWord('Payment')).toBe(true);
    expect(correctQuery('my paymnet receipt', null).corrected).toBe('my payment receipt');
    // a company's own word is known; an English word in a domain is not one
    expect([...knownOrgWords(FROMS)]).toEqual(['lumora']);
    expect(knownSenderWords(FROMS).has('lumora')).toBe(true);

    await dictionaryReady();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not hold a question up when the list is slow, and has it for the next one', async () => {
    vi.useFakeTimers();
    let answer: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    let done = false;
    const first = dictionaryReady(4000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(isDictionaryLoaded()).toBe(false);

    answer(new Response(LIST, { status: 200 }));
    await dictionaryReady(4000);
    expect(isDictionaryLoaded()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('goes on without the list when it cannot be fetched, and tries again on the next question', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await dictionaryReady();
    expect(isDictionaryLoaded()).toBe(false);
    expect(correctQuery('my paymnet receipt', null).fixes).toEqual([]);
    fetchMock.mockImplementation(async () => new Response(LIST, { status: 200 }));
    await dictionaryReady();
    expect(isDictionaryLoaded()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
