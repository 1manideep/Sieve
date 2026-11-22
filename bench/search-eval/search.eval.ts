// The offline search eval (bench/search-eval/README.md). It seeds the Playground the way the app does, optionally adds
// public distractor mail through the app's own ingest and queue, embeds with the real MiniLM q8 in a Node child
// process, and asks every question of questions.json through the app's own search(), the way prepareProposal asks
// it. The order it scores is the one the answer step reads: the first SELECT_MAX_PASSAGES candidates, newest first
// when the question asks for the latest (prepareProposal's own ordering when it exports one).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { VECTOR_K } from '@sieve/shared';
import type { Candidate, IndexRecord, QueryHints } from '@sieve/shared';
import { startNodeEmbedder, type NodeEmbedClient } from '../../tests/harness/nodeEmbedder';
import { CANDIDATE_POOL, SELECT_MAX_PASSAGES } from '../../web/src/ai/config';
import { PLAYGROUND_NOW } from '../../web/src/index/config';
import { asksLatest } from '../../web/src/index/cues';
import { openDb, type SieveDb } from '../../web/src/index/db';
import { loadDictionaryText } from '../../web/src/index/dictionary';
import { getRecord, ingestInternal } from '../../web/src/index/ingest';
import { whenVocabReady, wipeDb } from '../../web/src/index/lifecycle';
import { parseQuestion } from '../../web/src/index/parseQuestion';
import { peekQueue } from '../../web/src/index/queue/ingestQueue';
import { getRuntime } from '../../web/src/index/runtime';
import { search, type SearchReport } from '../../web/src/index/search';
import { setMlClient, type MlClient } from '../../web/src/ml/client';
import type { EmbedInput, EmbedOutput } from '../../web/src/ml/protocol';
import { seedPlayground } from '../../web/src/playground/seed';

vi.mock('@/ai', async () => (await import('../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../tests/harness/dataset')).assetsModule);
// The reranker's contract (web/src/index/rerank.ts), answered by this eval: "did not run", or the Node cross-encoder.
// Its budget is long on purpose: the eval measures the order a reranker gives, not how fast this machine runs it.
vi.mock('../../web/src/index/rerank', () => ({
  RERANK_MAX_PASSAGES: Number(process.env.EVAL_RERANK_POOL ?? 0) || 20,
  RERANK_BUDGET_MS: 600_000,
  warmupRerank: () => undefined,
  rerank: (question: string, passages: { id: string; text: string }[], opts: unknown) =>
    (globalThis as unknown as { __evalRerank: (q: string, p: { id: string; text: string }[], o: unknown) => Promise<unknown> }).__evalRerank(question, passages, opts),
}));

process.env.TZ = 'America/Chicago';

interface Question { id: string; type: string; q: string; answers: string[]; hints?: QueryHints; seedOnly?: boolean }
interface Row { id: string; type: string; rank: number; got: string[]; filters?: unknown; relaxed?: unknown; rerank?: unknown }
/** `latest: 'baseline'` scores with prepareProposal's ordering from before Nov 21 (for step-by-step tables). */
interface Tuning { label: string; tuning?: Record<string, unknown>; latest?: 'baseline' }

// run.mjs starts vitest from the repository root (jsdom gives this file no file: URL to resolve against)
const ROOT = process.cwd();
const HERE = `${ROOT}/bench/search-eval/`;
const QUESTIONS = (JSON.parse(readFileSync(HERE + 'questions.json', 'utf8')) as { questions: Question[] }).questions;
const OUT = process.env.EVAL_OUT ?? `${process.env.EVAL_CACHE ?? '/tmp'}/last-run.json`;
const CACHE = process.env.EVAL_CACHE ?? '';
const DISTRACTORS = process.env.EVAL_DISTRACTORS ?? '';
const RERANK_MODES = (process.env.EVAL_RERANK ?? 'none').split(',').filter(Boolean);
const SWEEP: Tuning[] = process.env.EVAL_SWEEP ? (JSON.parse(readFileSync(process.env.EVAL_SWEEP, 'utf8')) as Tuning[]) : [{ label: process.env.EVAL_LABEL ?? 'current' }];
const ONLY_SET = process.env.EVAL_SET ?? 'both';
const SPREAD_DAYS = Number(process.env.EVAL_SPREAD_DAYS ?? 75);
// --extra: more emails and their questions from a file outside the repository (your own mail stays out of it).
const EXTRA = process.env.EVAL_EXTRA ?? '';
// --depth: how many candidates are asked for and scored, to see how far down a missed item sits (default: the app's pool).
const DEPTH = Number(process.env.EVAL_DEPTH ?? 0) || CANDIDATE_POOL;
const RERANK_LIMIT = Number(process.env.EVAL_RERANK_LIMIT ?? 20);

// ---------- the embedder, with a disk cache keyed by the exact input text (the model and its settings are fixed)

function cachedEmbedder(inner: NodeEmbedClient): MlClient & { save(): void; close(): void } {
  const path = CACHE ? `${CACHE}/embed-cache-minilm-q8.json` : '';
  const cache = new Map<string, string>(path && existsSync(path) ? Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : []);
  let added = 0;
  const key = (t: string) => createHash('sha1').update(t).digest('hex');
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    const v = new Float32Array(buf.byteLength / 4);
    new Uint8Array(v.buffer).set(buf);
    return v;
  };
  return {
    warmup: (task) => inner.warmup(task),
    status: (task) => inner.status(task),
    subscribe: (fn) => inner.subscribe(fn),
    async run<I, O>(task: Parameters<MlClient['run']>[0], input: I): Promise<O> {
      const { texts } = input as unknown as EmbedInput;
      const missing = [...new Set(texts.filter((t) => !cache.has(key(t))))];
      if (missing.length > 0) {
        const out = await inner.run<EmbedInput, EmbedOutput>(task, { texts: missing });
        missing.forEach((t, i) => {
          const v = out.data.slice(i * out.dims, (i + 1) * out.dims);
          cache.set(key(t), Buffer.from(v.buffer).toString('base64'));
          added++;
        });
      }
      const dims = 384;
      const data = new Float32Array(texts.length * dims);
      texts.forEach((t, i) => data.set(decode(cache.get(key(t)) as string), i * dims));
      return { dims, count: texts.length, data } as unknown as O;
    },
    save() {
      if (path && added > 0) writeFileSync(path, JSON.stringify(Object.fromEntries(cache)));
    },
    close() {
      inner.close();
    },
  };
}

// ---------- the Node cross-encoder (rerank-server.mjs), only when a run asks for it

let rerankChild: ChildProcessWithoutNullStreams | null = null;
const rerankPending = new Map<number, (r: { scores?: number[]; ms?: number; error?: string }) => void>();
let rerankId = 1;

async function startReranker(): Promise<void> {
  if (rerankChild) return;
  const child = spawn(process.execPath, [HERE + 'rerank-server.mjs'], { env: { ...process.env, RERANK_CACHE: `${CACHE}/models` } });
  rerankChild = child;
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const rl = createInterface({ input: child.stdout });
  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => reject(new Error(`rerank server exited ${code}: ${stderr.slice(0, 400)}`)));
    rl.on('line', (line) => {
      const msg = JSON.parse(line) as { ready?: boolean; id?: number; scores?: number[]; ms?: number; error?: string };
      if (msg.ready) return resolve();
      const done = msg.id !== undefined ? rerankPending.get(msg.id) : undefined;
      if (!done || msg.id === undefined) return;
      rerankPending.delete(msg.id);
      done(msg);
    });
  });
}

function scorePairs(query: string, passages: string[]): Promise<{ scores?: number[]; ms?: number; error?: string }> {
  const id = rerankId++;
  return new Promise((resolve) => {
    rerankPending.set(id, resolve);
    rerankChild?.stdin.write(JSON.stringify({ id, query, passages }) + '\n');
  });
}

let rerankMode = 'none';
const rerankStats = { calls: 0, passages: 0, ms: 0 };
(globalThis as unknown as { __evalRerank: unknown }).__evalRerank = async (question: string, passages: { id: string; text: string }[]) => {
  if (rerankMode !== 'model' || passages.length === 0) return { order: passages.map((p) => p.id), ran: false, ms: 0, reason: 'unsupported' };
  // as rerank.ts does: fewer than RERANK_MIN_PASSAGES (4) is not reranked; when the budget only fits some, the first
  // ones are scored and sorted and the rest stay after them in order
  if (passages.length < 4) return { order: passages.map((p) => p.id), ran: false, ms: 0 };
  const scoredN = Math.min(passages.length, RERANK_LIMIT);
  const res = await scorePairs(question, passages.slice(0, scoredN).map((p) => p.text));
  if (!res.scores) throw new Error(res.error ?? 'rerank failed');
  rerankStats.calls++;
  rerankStats.passages += scoredN;
  rerankStats.ms += res.ms ?? 0;
  const head = passages.slice(0, scoredN).map((p, i) => ({ id: p.id, s: res.scores?.[i] ?? -Infinity, i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.id);
  return { order: [...head, ...passages.slice(scoredN).map((p) => p.id)], ran: true, ms: res.ms ?? 0 };
};

// ---------- public distractor mail (downloaded by run.mjs into a temp folder)

const HAM_NAMES = ['Avery Holt', 'Blake Imbert', 'Casey Lindqvist', 'Devon Marsh', 'Emery Quill', 'Finley Roarke', 'Gray Sutter', 'Harper Tolland', 'Indy Vance', 'Jules Wexley', 'Kai Yarrow', 'Logan Zell', 'Morgan Ashby', 'Noel Brannock', 'Oakley Cray', 'Parker Dunmore', 'Quinn Elsner', 'Reese Fallow', 'Sage Gorran', 'Tatum Hessel'];

function seededHash(s: string): number {
  return createHash('sha1').update(s).digest().readUInt32BE(0);
}

async function addDistractors(db: SieveDb, path: string): Promise<number> {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  let n = 0;
  for (const line of lines) {
    const m = JSON.parse(line) as { message_id: number; subject?: string; message?: string; label_text: string };
    const text = (m.message ?? '').trim();
    if (!text) continue;
    const h = seededHash(String(m.message_id));
    const spam = m.label_text === 'spam';
    const name = spam ? 'Special Offers' : (HAM_NAMES[h % HAM_NAMES.length] as string);
    const addr = spam ? `offers${h % 97}@promo-mail.example` : `${name.toLowerCase().replace(' ', '.')}@corp-mail.example`;
    // Spread over the 75 days before the Playground clock, where the seed mail sits, so recency cannot tell them apart.
    const date = PLAYGROUND_NOW - ((h % (SPREAD_DAYS * 24)) + 1) * 3_600_000;
    await ingestInternal(db, {
      source: 'playground', sourceRef: `distractor-${m.message_id}`, kind: 'email', title: (m.subject ?? '').trim() || '(no subject)',
      from: `${name} <${addr}>`, threadId: `distractor-${m.message_id}`, date, text,
    }, 'sample', { deferSave: true });
    n++;
  }
  await peekQueue(db)?.whenIdle();
  await getRuntime(db).keyword.flush();
  return n;
}

interface ExtraFile { items: { id: string; title: string; from: string; date: string; text?: string }[]; questions: Question[] }

/** Emails from a file outside the repository, through the app's own ingest and queue, as the distractors are. */
async function addExtra(db: SieveDb, path: string): Promise<ExtraFile> {
  const extra = JSON.parse(readFileSync(path, 'utf8')) as ExtraFile;
  for (const it of extra.items) {
    await ingestInternal(db, { source: 'playground', sourceRef: it.id, kind: 'email', title: it.title, from: it.from, threadId: it.id, date: Date.parse(it.date), text: it.text ?? '' }, 'sample', { deferSave: true });
  }
  await peekQueue(db)?.whenIdle();
  await getRuntime(db).keyword.flush();
  return extra;
}

// ---------- asking the way prepareProposal asks

type Ordering = (list: { rec: IndexRecord; cand: Candidate }[], filters: SearchReport['filters'], question: string) => { rec: IndexRecord; cand: Candidate }[];
interface PipelineHelpers { inAppHints?: (p: ReturnType<typeof parseQuestion>) => QueryHints; latestOrder?: Ordering }
let helpers: PipelineHelpers = {};

/** prepareProposal before Nov 21: every candidate newest first, the newest VECTOR_K with a sender or date filter. */
const baselineLatest: Ordering = (list, filters) => {
  let out = [...list].sort((a, b) => b.rec.date - a.rec.date);
  if (filters?.sender || filters?.after || filters?.before) out = out.slice(0, VECTOR_K);
  return out;
};

let useBaselineLatest = false;

async function ask(db: SieveDb, q: Question): Promise<{ ids: string[]; report?: SearchReport }> {
  let report: SearchReport | undefined;
  let lookup = q.q;
  let hints = q.hints;
  if (!q.hints) {
    // the in-app path (prepareProposal step 3): the corrected question, the parsed hints without from and source
    const p = parseQuestion(q.q, new Date(PLAYGROUND_NOW), 'en-US', { db });
    if (helpers.inAppHints) hints = helpers.inAppHints(p);
    else {
      const { from: _from, source: _source, ...parsed } = p.hints;
      hints = parsed;
    }
    if (p.corrected) lookup = p.corrected;
  }
  const cands = await search(db, lookup, { ...(hints ? { hints } : {}), ...(DEPTH !== CANDIDATE_POOL ? { k: DEPTH } : {}), onReport: (r) => (report = r) });
  let list: { rec: IndexRecord; cand: Candidate }[] = [];
  for (const c of cands) {
    const rec = await getRecord(db, c.recordId);
    if (rec && list.length < DEPTH) list.push({ rec, cand: c });
  }
  if (asksLatest(lookup) && list.length > 1) list = (useBaselineLatest ? baselineLatest : helpers.latestOrder ?? baselineLatest)(list, report?.filters, lookup);
  // scored at 7 so recall at 5 and at 7 can be compared; the answer step reads the first SELECT_MAX_PASSAGES
  void SELECT_MAX_PASSAGES;
  return { ids: list.map((x) => x.rec.id.replace('playground:', '')), report };
}

function summarize(rows: Row[]) {
  const n = rows.length;
  const at = (k: number) => rows.filter((r) => r.rank >= 1 && r.rank <= k).length / n;
  const mrr = rows.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / n;
  return { n, r1: at(1), r3: at(3), r5: at(5), r7: at(7), mrr };
}

const results: unknown[] = [];

async function evalSet(db: SieveDb, set: string, questions: Question[]): Promise<void> {
  for (const cfg of SWEEP) {
    useBaselineLatest = cfg.latest === 'baseline';
    if (cfg.tuning) {
      const config = (await import('../../web/src/index/config')) as unknown as { SEARCH_TUNING?: Record<string, unknown> };
      if (!config.SEARCH_TUNING) throw new Error('This code has no SEARCH_TUNING to sweep.');
      const base = ((globalThis as unknown as { __tuningBase?: Record<string, unknown> }).__tuningBase ??= structuredClone(config.SEARCH_TUNING));
      Object.assign(config.SEARCH_TUNING, structuredClone(base), cfg.tuning);
    }
    for (const mode of RERANK_MODES) {
      rerankMode = mode;
      const rows: Row[] = [];
      const t0 = performance.now();
      for (const q of questions) {
        const { ids, report } = await ask(db, q);
        const rank = ids.findIndex((id) => q.answers.includes(id)) + 1;
        const r = report as (SearchReport & { dateRelaxed?: unknown; rerank?: unknown }) | undefined;
        rows.push({ id: q.id, type: q.type, rank, got: ids, filters: r?.filters, relaxed: r?.dateRelaxed ?? r?.categoryRelaxed, rerank: r?.rerank });
      }
      const ms = Math.round(performance.now() - t0);
      const byType: Record<string, ReturnType<typeof summarize>> = {};
      for (const t of [...new Set(rows.map((r) => r.type))]) byType[t] = summarize(rows.filter((r) => r.type === t));
      const summary = summarize(rows);
      const reranked = rows.filter((r) => (r.rerank as { ran?: boolean } | undefined)?.ran).length;
      if (mode === 'model' && reranked < rows.length) console.info(`    the reranker ran for ${reranked} of ${rows.length} questions`);
      results.push({ set, config: cfg.label, rerank: mode, summary, byType, rows, ms, reranked });
      console.info(`${set.padEnd(11)} ${cfg.label.padEnd(24)} rerank=${mode.padEnd(5)} R@1 ${(summary.r1 * 100).toFixed(0)} R@3 ${(summary.r3 * 100).toFixed(0)} R@5 ${(summary.r5 * 100).toFixed(0)} R@7 ${(summary.r7 * 100).toFixed(0)} MRR ${summary.mrr.toFixed(3)} (n ${summary.n}, ${ms} ms)`);
      for (const r of rows) if (r.rank !== 1) console.info(`    ${r.rank ? `rank ${r.rank}` : 'MISS  '} ${r.id.padEnd(20)} ${r.got.slice(0, 5).join(', ')}`);
    }
  }
}

describe('search eval', () => {
  let ml: ReturnType<typeof cachedEmbedder>;
  let db: SieveDb;

  beforeAll(async () => {
    try {
      helpers = (await import('../../web/src/pipeline/prepareProposal')) as unknown as PipelineHelpers;
    } catch {
      helpers = {};
    }
    ml = cachedEmbedder(await startNodeEmbedder());
    setMlClient(ml);
    loadDictionaryText(readFileSync(`${ROOT}/web/src/index/dict/en-words.tsv`, 'utf8'));
    db = openDb('playground');
    await seedPlayground(db);
    await peekQueue(db)?.whenIdle();
    await whenVocabReady(db);
    if (RERANK_MODES.includes('model')) await startReranker();
  });

  afterAll(async () => {
    ml?.save();
    writeFileSync(OUT, JSON.stringify({ createdAt: new Date().toISOString(), helpers: Object.keys(helpers).filter((k) => k === 'inAppHints' || k === 'latestOrder'), rerankStats, results }, null, 2));
    await wipeDb('playground');
    setMlClient(null);
    ml?.close();
    rerankChild?.kill();
  });

  it('asks every question', async () => {
    if (ONLY_SET !== 'distractors') await evalSet(db, 'seed', QUESTIONS);
    if (DISTRACTORS && ONLY_SET !== 'seed') {
      const n = await addDistractors(db, DISTRACTORS);
      ml.save();
      console.info(`added ${n} distractor emails`);
      await evalSet(db, `seed+${n}`, QUESTIONS.filter((q) => !q.seedOnly));
    }
    if (EXTRA) {
      const extra = await addExtra(db, EXTRA);
      ml.save();
      console.info(`added ${extra.items.length} extra emails`);
      await evalSet(db, `extra+${extra.items.length}`, extra.questions);
    }
  });
});
