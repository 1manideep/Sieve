// 20 section 20, search: A-SR-2 to A-SR-8 and A-SR-10 on the seeded Playground with the hash embedder.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient, type HashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { nodeFile } from '../../../tests/harness/indexEnv';
import { setMlClient } from '../ml/client';
import type { EmbedInput, MlTask } from '../ml/protocol';
import { seedPlayground } from '../playground/seed';
import { addUploads } from '../sources/uploads';
import { MAX_PER_THREAD } from './config';
import { openDb, type SieveDb } from './db';
import { ingest } from './ingest';
import { wipeDb } from './lifecycle';
import { peekQueue } from './queue/ingestQueue';
import { relativeWhen } from './reasons';
import { relatedFor } from './related';
import type { RerankPassage, RerankResult } from './rerank';
import { CATEGORY_MIN_RESULTS, categoryFits, DATE_MIN_RESULTS, duplicatesOf, search, type SearchReport } from './search';

// The reranker's contract (rerank.ts), answered per test; by default it did not run, as when no model is loaded.
const rerankMock = vi.hoisted(() => ({
  impl: null as null | ((q: string, p: RerankPassage[], o: { budgetMs?: number; signal?: AbortSignal }) => Promise<RerankResult>),
  calls: [] as { question: string; passages: RerankPassage[]; budgetMs?: number }[],
}));
vi.mock('./rerank', () => ({
  RERANK_MAX_PASSAGES: 20,
  RERANK_BUDGET_MS: 40,
  warmupRerank: vi.fn(),
  rerank: vi.fn(async (question: string, passages: RerankPassage[], o: { budgetMs?: number; signal?: AbortSignal } = {}) => {
    rerankMock.calls.push({ question, passages, budgetMs: o.budgetMs });
    if (rerankMock.impl) return rerankMock.impl(question, passages, o);
    return { order: passages.map((x) => x.id), ran: false, ms: 0, reason: 'model-loading' };
  }),
}));
vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../../tests/harness/dataset')).assetsModule);

process.env.TZ = 'America/Chicago';
let db: SieveDb;
let ml: HashEmbedClient;

beforeAll(async () => {
  ml = createHashEmbedClient();
  setMlClient(ml);
  db = openDb('playground');
  await seedPlayground(db);
  await peekQueue(db)?.whenIdle();
});

afterAll(async () => {
  await wipeDb('playground');
  setMlClient(null);
});

describe('search', () => {
  it('A-SR-2: vector and keyword lists fused, the exact match first; at most k, no duplicate record or contentHash', async () => {
    let report: SearchReport | undefined;
    const res = await search(db, 'Where is order #88231?', { onReport: (r) => (report = r) });
    expect(res[0]?.recordId).toBe('playground:pg-mail-21');
    expect(res.length).toBe(7);                                  // VECTOR_K + KEYWORD_SAFETY_K, what the answer step reads
    expect(new Set(res.map((c) => c.recordId)).size).toBe(res.length);
    const hashes = await Promise.all(res.map(async (c) => (await db.records.get(c.recordId))?.contentHash));
    expect(new Set(hashes).size).toBe(res.length);
    expect(report?.fusion).toMatchObject({ vector: 46, live: 0 });
    expect(report?.fusion?.keyword).toBeGreaterThan(0);
    // scores are relevance next to the best candidate, best first
    expect(res[0]?.score).toBe(1);
    expect(res.every((c, i) => i === 0 || c.score <= (res[i - 1]?.score ?? 1))).toBe(true);
    expect((await search(db, 'Where is order #88231?', { k: 3 })).length).toBe(3);
  });

  it('A-SR-3: hard filters', async () => {
    await ingest(db, { source: 'upload', sourceRef: 'upload-filter', kind: 'note', title: 'deposit notes.txt', date: Date.now(), text: 'Notes about the deposit and the landlord.' }, 'own');
    const up = await search(db, 'deposit landlord', { sources: ['upload'] });
    expect(up.length).toBeGreaterThan(0);
    expect(up.every((c) => c.recordId.startsWith('upload:'))).toBe(true);
    const work = await search(db, 'planning agenda review', { categories: ['Work'] });
    expect(work.length).toBeGreaterThan(0);
    for (const c of work) expect((await db.records.get(c.recordId))?.category).toBe('Work');
  });

  it('A-SR-4: an outside assistant\'s dates are a filter: an item outside them is dropped, one that mentions a day inside them stays', async () => {
    let report: SearchReport | undefined;
    const nov = await search(db, 'Where is order 88231?', { hints: { after: '2026-11-01', before: '2026-11-30' }, onReport: (r) => (report = r) });
    expect(report?.filters).toEqual({ after: '2026-11-01', before: '2026-11-30' });
    expect(nov.map((c) => c.recordId)).toContain('playground:pg-mail-21');
    expect(nov.map((c) => c.recordId)).not.toContain('playground:pg-mail-22');    // Oct 25, mentions no November day
    // the flight email of Nov 8 says "Friday, December 4"
    const flight = await search(db, 'When does my flight to Seattle leave?', { hints: { after: '2026-12-04', before: '2026-12-04' }, onReport: (r) => (report = r) });
    expect(flight.map((c) => c.recordId)).toContain('playground:pg-mail-19');
  });

  it('a date filter that leaves fewer than DATE_MIN_RESULTS is dropped; its dates still rank, and the report says so', async () => {
    let report: SearchReport | undefined;
    // only the insurance declarations are from January 2026
    const out = await search(db, 'Where is order 88231?', { hints: { after: '2026-01-01', before: '2026-01-31' }, onReport: (r) => (report = r) });
    expect(DATE_MIN_RESULTS).toBe(3);
    expect(out.map((c) => c.recordId)).toContain('playground:pg-mail-21');
    expect(report?.dateRelaxed).toEqual({ after: '2026-01-01', before: '2026-01-31' });
    expect(report?.filters).toBeUndefined();
    expect(report?.hints).toMatchObject({ after: '2026-01-01', before: '2026-01-31' });
  });

  it('dates read from loose words rank and never filter; a date written out with its year filters', async () => {
    let report: SearchReport | undefined;
    const dec4 = await search(db, 'What do I have going on December 4?', { onReport: (r) => (report = r) });
    expect(report?.filters).toBeUndefined();
    expect(report?.hints).toMatchObject({ after: '2026-12-04', before: '2026-12-04' });
    expect(dec4.length).toBe(7);
    for (const q of ['What time does my plane take off on Friday?', 'picture of my kitty napping in the sun', 'What are Jordan and I doing this weekend?']) {
      await search(db, q, { onReport: (r) => (report = r) });
      expect(report?.filters?.after ?? report?.filters?.before).toBeUndefined();
    }
    const since = await search(db, 'emails since November 13, 2026', { onReport: (r) => (report = r) });
    expect(report?.filters).toEqual({ after: '2026-11-13' });
    expect(since.map((c) => c.recordId)).not.toContain('playground:pg-mail-11');   // Nov 3
  });

  it('the reranker reads the best passages and its order wins; when it does not run, the fused order stands', async () => {
    let report: SearchReport | undefined;
    const fused = await search(db, 'What did my landlord say about the deposit?', { onReport: (r) => (report = r) });
    expect(report?.rerank).toMatchObject({ ran: false, reason: 'model-loading' });
    const call = rerankMock.calls.at(-1);
    expect(call?.question).toBe('What did my landlord say about the deposit?');
    expect(call?.budgetMs).toBe(40);
    expect(call?.passages.length).toBeLessThanOrEqual(20);
    expect(call?.passages.every((x) => /^(playground|upload):/.test(x.id) && x.text.length > 0 && x.text.length <= 1000)).toBe(true);
    expect(call?.passages.slice(0, 3).map((x) => x.id)).toEqual(fused.slice(0, 3).map((c) => c.recordId));
    // a Health item (never) is not sent: no model reads its content
    expect(call?.passages.map((x) => x.id)).not.toContain('playground:pg-mail-15');
    const deposit = call?.passages.find((x) => x.id === 'playground:pg-mail-02');
    expect(deposit?.text).toContain('Re: Deposit for the apartment\nDana Whitfield');

    rerankMock.impl = async (_q, passages) => ({ order: [...passages].reverse().map((x) => x.id), ran: true, ms: 12 });
    const reranked = await search(db, 'What did my landlord say about the deposit?', { onReport: (r) => (report = r) });
    rerankMock.impl = null;
    const sent = (rerankMock.calls.at(-1)?.passages ?? []).map((x) => x.id);
    expect(report?.rerank).toEqual({ ran: true, ms: 12, passages: sent.length });
    expect(reranked[0]?.recordId).toBe(sent.at(-1));             // the reranker's first
    expect(reranked[0]?.recordId).not.toBe(fused[0]?.recordId);
  });

  it('a question for the latest keeps the fused order, which knows the dates; the reranker is not asked', async () => {
    let report: SearchReport | undefined;
    rerankMock.impl = async (_q, passages) => ({ order: [...passages].reverse().map((x) => x.id), ran: true, ms: 5 });
    const before = rerankMock.calls.length;
    await search(db, "What's the latest email from my bank?", { onReport: (r) => (report = r) });
    rerankMock.impl = null;
    expect(rerankMock.calls.length).toBe(before);
    expect(report?.rerank).toEqual({ ran: false, ms: 0, passages: 0, reason: 'asks-latest' });
  });

  it('a reranker that fails or overruns its budget leaves the fused order, with the reason', async () => {
    let report: SearchReport | undefined;
    const fused = (await search(db, 'Where is order #88231?')).map((c) => c.recordId);
    rerankMock.impl = async () => {
      throw new Error('model crashed');
    };
    expect((await search(db, 'Where is order #88231?', { onReport: (r) => (report = r) })).map((c) => c.recordId)).toEqual(fused);
    expect(report?.rerank).toMatchObject({ ran: false, reason: 'model-failed' });
    let aborted = false;
    rerankMock.impl = (_q, _p, o) => new Promise(() => o.signal?.addEventListener('abort', () => (aborted = true)));
    expect((await search(db, 'Where is order #88231?', { onReport: (r) => (report = r) })).map((c) => c.recordId)).toEqual(fused);
    rerankMock.impl = null;
    expect(report?.rerank).toMatchObject({ ran: false, reason: 'timeout' });
    expect(aborted).toBe(true);
  });

  it('a category hint from an outside assistant: the search looks only there, and Personal always fits', async () => {
    let report: SearchReport | undefined;
    const work = await search(db, 'planning agenda review', { hints: { categories: ['Work'] }, onReport: (r) => (report = r) });
    expect(work.length).toBeGreaterThanOrEqual(CATEGORY_MIN_RESULTS);
    for (const c of work) expect(['Work', 'Personal']).toContain((await db.records.get(c.recordId))?.category);
    expect(report?.filters).toEqual({ categories: ['Work'] });
    expect(report?.categoryRelaxed).toBeUndefined();
    expect(categoryFits(['Money'], 'Money')).toBe(true);
    expect(categoryFits(['Money'], 'Personal')).toBe(true);        // also where mail not sorted yet sits
    expect(categoryFits(['Money', 'Home'], 'Shopping')).toBe(false);
  });

  it('a category hint that leaves too little is dropped, and the search runs again without it', async () => {
    // Among the files the person added there is one note, filed under Home: a wrong guess of Travel finds nothing.
    let report: SearchReport | undefined;
    const res = await search(db, 'deposit landlord', { sources: ['upload'], hints: { categories: ['Travel'] }, onReport: (r) => (report = r) });
    expect(res.map((c) => c.recordId)).toContain('upload:upload-filter');
    expect(report?.categoryRelaxed).toEqual(['Travel']);
    expect(report?.filters).toBeUndefined();
  });

  it('the question\'s own words never set a category filter', async () => {
    let report: SearchReport | undefined;
    await search(db, 'anything under Work about planning?', { onReport: (r) => (report = r) });
    expect(report?.filters?.categories).toBeUndefined();
  });

  it('a sender the question or the request names is a filter, not a boost (T06, T07, T10)', async () => {
    // no HelloSign, Northgear or Google email in the seed data: nothing, instead of the best match
    expect(await search(db, 'Did HelloSign send me a document to sign?')).toEqual([]);
    expect(await search(db, 'When did my latest Northgear order ship?')).toEqual([]);
    expect(await search(db, 'Show me my Google verification emails')).toEqual([]);
    const voltwren = await search(db, 'Where is my order?', { hints: { from: 'Voltwren' } });
    expect(voltwren.map((c) => c.recordId)).toEqual(['playground:pg-mail-22']);
    // a role stays a boost
    let report: SearchReport | undefined;
    const landlord = await search(db, 'What did my landlord say about the deposit?', { hints: { from: 'my landlord' }, onReport: (r) => (report = r) });
    expect(landlord.length).toBeGreaterThan(3);
    expect(report?.filters).toBeUndefined();
  });

  it('a sender read from the question that no item is from, but titles hold, only ranks ("my latest SIP order")', async () => {
    await ingest(db, { source: 'gmail', sourceRef: 'sip-1', kind: 'email', title: 'SIP order summary', from: 'Kestrel Broking <noreply@mailer.kestrelbroking.example>', date: Date.now(), text: 'Your SIP order has been executed. Instrument: NIFTYBEES. Quantity: 12.' }, 'own');
    let report: SearchReport | undefined;
    const res = await search(db, 'How many NIFTYBEES units did my latest SIP order buy?', { onReport: (r) => (report = r) });
    expect(res.map((c) => c.recordId)).toContain('gmail:sip-1');
    expect(report?.senderDropped).toBe('SIP');
    expect(report?.filters?.sender).toBeUndefined();
    // a sender the asking assistant sent stays a filter, whatever the titles hold
    expect(await search(db, 'How many units did my latest order buy?', { hints: { from: 'SIP' } })).toEqual([]);
    // a name nothing in the index knows still finds nothing
    expect(await search(db, 'When did my latest Northgear order ship?')).toEqual([]);
    await db.records.delete('gmail:sip-1');
  });

  it("the sender's newest items join the list when the question asks for the latest (T04)", async () => {
    const res = await search(db, "What did Kestrelmoor's latest email say?");
    const ids = res.map((c) => c.recordId);
    expect(ids).toContain('playground:pg-mail-12');
    expect(ids.every((id) => id === 'playground:pg-mail-11' || id === 'playground:pg-mail-12')).toBe(true);
  });

  it('the newest items about a named thing join the list when the question asks for the latest and names no sender (Nov 22)', async () => {
    const day = 86_400_000;
    const from = 'Tallyo <noreply@tallyo.example>';
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(`gmail:plan-${i}`);
      await ingest(db, { source: 'gmail', sourceRef: `plan-${i}`, kind: 'email', title: `Your Lumora plan was changed, part ${i + 1}`, from, date: Date.now() - 3 * day - i * 60_000, text: `Your Lumora payment plan was updated. Payment plan ${i + 1}: the next payment of your payment plan is due soon. See your payment plan in the app.` }, 'sample');
    }
    ids.push('gmail:plan-failed');
    await ingest(db, { source: 'gmail', sourceRef: 'plan-failed', kind: 'email', title: 'Lumora payment did not go through', from, date: Date.now() - day, text: 'We could not collect it from your card. Add money and try again.' }, 'sample');
    const res = await search(db, 'What did the most recent email about my Lumora payment plan say?', { k: 10 });
    expect(res.map((c) => c.recordId)).toContain('gmail:plan-failed');
    await db.records.bulkDelete(ids);
  });

  it('a sender spelled as the request names it shuts out a near spelling; with no such sender the near spelling fits (Nov 22)', async () => {
    const at = Date.now();
    await ingest(db, { source: 'gmail', sourceRef: 'pp-real', kind: 'email', title: 'Your balance is low', from: 'Paywell <service@paywell.example>', date: at - 2 * 86_400_000, text: 'Your Paywell balance is below 25 dollars.' }, 'sample');
    await ingest(db, { source: 'gmail', sourceRef: 'pp-near', kind: 'email', title: 'Coffee on Friday?', from: 'Paywel Rao <paywel.rao@inbox.example>', date: at - 86_400_000, text: 'Are you free for coffee on Friday?' }, 'sample');
    let report: SearchReport | undefined;
    const res = await search(db, 'What was my most recent Paywell email about?', { hints: { from: 'Paywell' }, onReport: (r) => (report = r) });
    expect(res.map((c) => c.recordId)).toEqual(['gmail:pp-real']);
    expect(report?.filters).toMatchObject({ sender: 'Paywell', senderExact: true });
    // nobody is spelled "Paywel1": the near spelling finds both, as a typo should
    const typo = await search(db, 'What was my most recent email from them about?', { hints: { from: 'Paywel1' } });
    expect(typo.map((c) => c.recordId).sort()).toEqual(['gmail:pp-near', 'gmail:pp-real']);
    await db.records.bulkDelete(['gmail:pp-real', 'gmail:pp-near']);
  });

  it('two emails a sender really sent on the asked day keep the day filter; with only a mention of the day it is dropped (Nov 22)', async () => {
    const at = (m: number, d: number, h = 10) => new Date(2026, m - 1, d, h, 0).getTime();
    const from = 'Northside Gym <hello@northsidegym.example>';
    const mk = (ref: string, title: string, date: number, text: string) => ingest(db, { source: 'gmail', sourceRef: ref, kind: 'email', title, from, date, text }, 'sample');
    await mk('ng-class', 'Reminder: your class is tomorrow', at(3, 3), 'Your spin class is tomorrow at 7 AM. Bring a towel.');
    await mk('ng-lockers', 'New lockers in the changing room', at(3, 3, 17), 'We fitted new lockers this week.');
    await mk('ng-renew', 'Happy holidays and a reminder to renew', at(2, 27), 'Happy holidays! A reminder that your membership renews on March 1.');
    await peekQueue(db)?.whenIdle();
    const days = { after: '2026-03-03', before: '2026-03-03' };
    let report: SearchReport | undefined;
    const res = await search(db, 'What did my gym remind me about on March 3?', { hints: { from: 'Northside Gym', ...days }, now: at(3, 22), onReport: (r) => (report = r) });
    expect(res.map((c) => c.recordId).sort()).toEqual(['gmail:ng-class', 'gmail:ng-lockers']);
    expect(report?.dateRelaxed).toBeUndefined();
    // nothing from them is dated March 9: the days are doubted, and only rank
    const other = { after: '2026-03-09', before: '2026-03-09' };
    const loose = await search(db, 'What did my gym remind me about on March 9?', { hints: { from: 'Northside Gym', ...other }, now: at(3, 22), onReport: (r) => (report = r) });
    expect(loose.length).toBe(3);
    expect(report?.dateRelaxed).toEqual(other);
    await db.records.bulkDelete(['gmail:ng-class', 'gmail:ng-lockers', 'gmail:ng-renew']);
  });

  it('other words for the question find an item that shares none of the question\'s words (Nov 22)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(`gmail:apt-${i}`);
      await ingest(db, { source: 'gmail', sourceRef: `apt-${i}`, kind: 'email', title: `Northwind House: your badge request, part ${i + 1}`, from: 'Northwind Facilities <facilities@northwind.example>', date: Date.now() - (20 + i) * 86_400_000, text: 'Your badge request for our office building is complete. New staff can start using the staff portal.' }, 'sample');
    }
    ids.push('gmail:cage');
    await ingest(db, { source: 'gmail', sourceRef: 'cage', kind: 'email', title: 'Bike cage is not open yet', from: 'facilities@northwind.example', date: Date.now() - 60 * 86_400_000, text: 'Please keep locking bikes at the old racks until we say the cage is open.' }, 'sample');
    ml.setStatus('embed', { state: 'loading' });   // keyword only, so the test does not hang on what the stand-in embedder makes of it
    const q = 'Can I start using the new bicycle storage at my office building yet?';
    const plain = await search(db, q, { k: 10 });
    expect(plain.map((c) => c.recordId)).not.toContain('gmail:cage');
    const withWords = await search(db, q, { k: 10, expand: ['bike cage', 'bike racks', 'cycle parking'] });
    expect(withWords.map((c) => c.recordId).slice(0, 5)).toContain('gmail:cage');
    ml.setStatus('embed', { state: 'ready', device: 'wasm' });
    await db.records.bulkDelete(ids);
  });

  it('A-SR-5: embedder not ready gives keyword results and says so', async () => {
    ml.setStatus('embed', { state: 'loading' });
    let report: SearchReport | undefined;
    const res = await search(db, 'Where is order #88231?', { onReport: (r) => (report = r) });
    ml.setStatus('embed', { state: 'ready', device: 'wasm' });
    expect(report?.vector).toMatchObject({ ran: false, reason: 'model-loading' });
    expect(res[0]?.recordId).toBe('playground:pg-mail-21');
    expect(res.every((c) => c.matchedBy === 'keyword')).toBe(true);
  });

  it('A-SR-6: an orphan hit is dropped and its rows deleted', async () => {
    const id = 'playground:pg-mail-27';
    await db.records.delete(id);   // behind the in-memory indexes
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let report: SearchReport | undefined;
    const res = await search(db, 'Tensorfield Digest: 5 papers worth reading on-device models retrieval benchmark', { onReport: (r) => (report = r) });
    info.mockRestore();
    expect(res.map((c) => c.recordId)).not.toContain(id);
    expect(report?.repaired).toBeGreaterThanOrEqual(1);
    expect(await db.vectors.where('recordId').equals(id).count()).toBe(0);
  });

  it('A-SR-7: never items are returned, with no chunk', async () => {
    const res = await search(db, 'What do my test results say?');
    const health = res.find((c) => c.recordId === 'playground:pg-mail-15');
    expect(health).toBeDefined();
    expect(health?.chunk).toBeUndefined();
  });

  it('A-SR-8: reasons and relativeWhen', async () => {
    for (const q of ['What did my landlord say about the deposit?', "What's my latest bank balance?", 'Find the photo where I had five hot dogs in my mouth']) {
      for (const c of await search(db, q)) {
        expect(c.reason).toMatch(/^[^:]+: .+$/);
        expect(c.reason.length).toBeLessThanOrEqual(90);
        expect(c.reason).not.toMatch(/[—–]/);
      }
    }
    const now = Date.parse('2026-11-17T09:00:00-06:00');
    const d = (n: number) => relativeWhen(now - n * 86_400_000, now);
    expect([0, 1, 6, 7, 13, 14, 30, 59, 60, 400].map(d)).toEqual(['today', 'yesterday', '6 days ago', 'last week', 'last week', '2 weeks ago', 'last month', 'last month', '2 months ago', 'Oct 2025']);
    expect(relativeWhen(now + 86_400_000, now)).toBe('today');
  });

  it('A-SR-10: relatedFor(pg-mail-02) starts with the same thread and never includes itself', async () => {
    const rel = await relatedFor(db, 'playground:pg-mail-02', 'What did my landlord say about the deposit?');
    expect(rel.length).toBeLessThanOrEqual(3);
    expect(rel.slice(0, 2).map((c) => c.recordId).sort()).toEqual(['playground:pg-mail-01', 'playground:pg-mail-03']);
    expect(rel.map((c) => c.recordId)).not.toContain('playground:pg-mail-02');
    expect(rel[0]?.reason).toMatch(/same thread/);
  });

  it('70 R-MAIL-07: a long thread gives at most MAX_PER_THREAD candidates', async () => {
    for (let i = 0; i < 6; i++) {
      await ingest(db, { source: 'upload', sourceRef: `thread-${i}`, kind: 'note', title: `quartet rehearsal ${i}.txt`, threadId: 'long-thread', date: Date.now() - i * 1000, text: `Zebra quartet rehearsal notes, take ${i}.` }, 'own');
    }
    await peekQueue(db)?.whenIdle();
    const res = await search(db, 'zebra quartet rehearsal notes');
    const threads = await Promise.all(res.map(async (c) => (await db.records.get(c.recordId))?.threadId));
    expect(MAX_PER_THREAD).toBe(3);
    expect(threads.filter((t) => t === 'long-thread')).toHaveLength(MAX_PER_THREAD);
    expect(res.length).toBe(7);
  });

  it('one candidate per contentHash; duplicatesOf lists the other copies', async () => {
    const [a] = await addUploads(db, [nodeFile('Unique walrus contract text for copies.', 'contract.txt')]);
    const b = await ingest(db, { source: 'upload', sourceRef: 'copy-2', kind: 'note', title: 'contract copy.txt', date: Date.now(), text: 'Unique walrus contract text for copies.' }, 'own');
    await peekQueue(db)?.whenIdle();
    const res = await search(db, 'walrus contract');
    const ids = res.map((c) => c.recordId).filter((id) => id === a?.recordId || id === b.id);
    expect(ids).toHaveLength(1);
    const dups = await duplicatesOf(db, ids[0] as string);
    expect(dups.map((r) => r.id)).toEqual([ids[0] === b.id ? a?.recordId : b.id]);
  });
});

describe('search, when the question embedding fails', () => {
  /**
   * The question's embedding is the one foreground run; the background queue's runs still reach the hash embedder.
   * `fail` stands in for the model on the question and gives what it throws.
   */
  function failQuestionEmbed(fail: () => unknown) {
    const real = ml.run.bind(ml);
    const questions: string[][] = [];
    const spy = vi.spyOn(ml, 'run').mockImplementation((async (task: MlTask, input: unknown, o?: { priority?: 'foreground' | 'background'; signal?: AbortSignal }) => {
      if (o?.priority !== 'foreground') return real(task, input, o);
      questions.push((input as EmbedInput).texts);
      throw fail();
    }) as typeof ml.run);
    return { questions, restore: () => spy.mockRestore() };
  }

  afterEach(() => vi.restoreAllMocks());

  it('a worker that rejects: no vector list, the keyword list answers, and the report says model-failed', async () => {
    await peekQueue(db)?.whenIdle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = failQuestionEmbed(() => new Error('The on-device model stopped working.'));
    let report: SearchReport | undefined;
    const res = await search(db, 'Where is order #88231?', { onReport: (r) => (report = r) });
    f.restore();
    expect(f.questions).toHaveLength(1);
    expect(report?.vector).toMatchObject({ ran: false, reason: 'model-failed' });
    expect(report?.vector.ms).toBeGreaterThanOrEqual(0);
    expect(report?.fusion?.vector).toBe(0);
    expect(res[0]?.recordId).toBe('playground:pg-mail-21');
    expect(res.every((c) => c.matchedBy === 'keyword')).toBe(true);
    // one console line that names the error and never the question
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toBe('Error: The on-device model stopped working.');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('88231');
  });

  it("the client's time limit: the report says timeout, and the pass that drops a date filter does not wait for the model again", async () => {
    await peekQueue(db)?.whenIdle();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = failQuestionEmbed(() => new DOMException('The on-device model took too long.', 'TimeoutError'));
    let report: SearchReport | undefined;
    // only the insurance declarations are from January 2026, so the date filter is dropped and a second pass runs
    const res = await search(db, 'Where is order 88231?', { hints: { after: '2026-01-01', before: '2026-01-31' }, onReport: (r) => (report = r) });
    f.restore();
    expect(report?.dateRelaxed).toEqual({ after: '2026-01-01', before: '2026-01-31' });
    expect(f.questions).toHaveLength(1);
    expect(report?.vector).toEqual({ ran: false, ms: 0, reason: 'timeout' });
    expect(res.map((c) => c.recordId)).toContain('playground:pg-mail-21');
  });

  it('a stopped search stays stopped: an AbortError from the model is passed on, and so is a stop during a failure', async () => {
    await peekQueue(db)?.whenIdle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = failQuestionEmbed(() => new DOMException('The operation was aborted.', 'AbortError'));
    await expect(search(db, 'Where is order #88231?')).rejects.toMatchObject({ name: 'AbortError' });
    f.restore();
    // the caller stops the search while the model fails with another error: the stop wins
    const ctl = new AbortController();
    const g = failQuestionEmbed(() => {
      ctl.abort();
      return new Error('The on-device model stopped working.');
    });
    await expect(search(db, 'Where is order #88231?', { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    g.restore();
    expect(warn).not.toHaveBeenCalled();
  });
});
