// An outside assistant asks about an email that was indexed without its body (a sync that stopped before its bodies
// step: subject, sender and preview only). The real index and Gmail sync on FakeGmail, the real select and verify
// steps on a fake on-device model that answers only from the passages it is given.
// (a) Gmail can be asked: search fetches the body and the answer comes from it.
// (b) No Gmail token: an answer from the preview, or no match; never error.
// (c) The body arrives while the model reads the preview (a sync, or another tab, writes a new version): the
//     proposal is built from the fresh record, and an answer that no longer holds is read again once.
// (d) Gmail fails during the freshness check: the local copy with the "couldn't check" warning, never error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORY_RULES } from '@sieve/shared';
import type { Proposal, Settings } from '@sieve/shared';
import { FakeGmail } from '../../../../tests/harness/fakeGmail';
import { installFakeGis } from '../../../../tests/harness/fakeGis';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { dropDb, freshDb } from '../../../../tests/harness/indexEnv';
import { setLanguageModelForTests } from '@/ai/device/languageModel';
import { setHybridForTests } from '@/ai/hybrid';
import { createFakeHybrid, promptText, type FakeHybrid, type FakeReply } from '@/ai/testing/fakeHybrid';
import { installFakeLanguageModel } from '@/ai/testing/fakeLanguageModel';
import { resetAiForTests } from '@/ai/testing/reset';
import type { SieveDb } from '@/index/db';
import { ingestInternal } from '@/index/ingest';
import { peekQueue } from '@/index/queue/ingestQueue';
import { setMlClient } from '@/ml/client';
import { connectGmail } from '@/sources/registry';
import type { GmailMessage } from '@/sources/gmail/api';
import { resetGmailBucket } from '@/sources/gmail/api';
import { clearGmailToken, resetGmailAuth } from '@/sources/gmail/auth';
import { UnitBucket } from '@/sources/gmail/rateLimit';
import { rawFromMessage, runGmailSync } from '@/sources/gmail/sync';
import { LABELS, WARNINGS } from '../copy';
import { prepareProposal } from '../prepareProposal';
import type { PrepareInput } from '../types';

vi.mock('@/privacy', async () => ({
  ...(await import('./mocks/privacy')),
  // the index queue's privacy lane (scanRecord and its model status) and the sanitizer the index uses
  ...(await import('../../../../tests/harness/privacyMock')).privacyModule,
}));
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});

process.env.TZ = 'America/Chicago';

const SETTINGS: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
const OUTSIDE = { kind: 'outside' as const, grantId: 'g1', aiName: 'Outside Assistant' };
const QUESTION = 'How much was charged on Larkspur Supply receipt 5521-0098?';
const SENDER = 'Larkspur Supply <receipts@larkspur.example>';
const BODY = 'Thanks for your order from Larkspur Supply. Receipt 5521-0098. Amount charged: $48.20 to the card ending 4421. Reply to this email with any questions.';
// Gmail's preview of the same email, as the metadata step stores it
const PREVIEW_NO_AMOUNT = 'Thanks for your order from Larkspur Supply. Receipt 5521-0098.';
const PREVIEW_WITH_AMOUNT = 'Thanks for your order from Larkspur Supply. Receipt 5521-0098. Amount charged: $48.20';
const PREVIEW_CUT = 'Thanks for your order from Larkspur Supply. Receipt 5521-0098. Amount charged: $48';
const ID = 'gmail:rc1';

let gmail: FakeGmail;
let gis: ReturnType<typeof installFakeGis>;
let db: SieveDb;
let hybrid: FakeHybrid;
/** Runs once, while the select step reads its passages. */
let duringSelect: (() => Promise<void>) | null;

const AMOUNT = /\$\d+(?:\.\d{2})?/;

/** The passages of a select prompt: number, sender and text. */
function passagesOf(prompt: string): { n: string; from?: string; text: string }[] {
  const re = /(?:^|\n)(P\d+)\nKind: [^\n]*\n(?:From: ([^\n]*)\n)?Date: [^\n]*\nTitle: [^\n]*\nPassage:\n<<<\n([\s\S]*?)\n>>>/g;
  return [...prompt.matchAll(re)].map((m) => ({ n: m[1]!, from: m[2], text: m[3]! }));
}

/** A model that answers only from what it reads: the receipt's amount, if its passage holds one. */
function readingModel(): FakeHybrid {
  return createFakeHybrid(async (spec, parts): Promise<FakeReply> => {
    const prompt = promptText(parts);
    if (spec.purpose === 'select-answer') {
      const run = duringSelect;
      duringSelect = null;
      await run?.();
      const receipt = passagesOf(prompt).find((p) => p.from === SENDER);
      const amount = receipt ? AMOUNT.exec(receipt.text)?.[0] : undefined;
      const reply = receipt && amount ? { item: receipt.n, answer: `You were charged ${amount}.` } : { item: 'none', answer: '' };
      return { text: JSON.stringify(reply), source: 'on_device' };
    }
    if (spec.purpose === 'verify-answer') {
      const proposed = AMOUNT.exec(/Proposed answer: ([^\n]*)/.exec(prompt)?.[1] ?? '')?.[0];
      const passage = /Passage:\n<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1] ?? '';
      const answers = !!proposed && passage.split(/[^\d$.]/).includes(proposed);
      return { text: JSON.stringify({ answers, reason: answers ? 'The passage states the amount.' : 'The passage does not state it.' }), source: 'on_device' };
    }
    return { text: '{}', source: 'on_device' };   // the queue's background label call: no usable output, code label stays
  });
}

beforeEach(() => {
  resetAiForTests();
  setMlClient(createHashEmbedClient());
  resetGmailAuth();
  resetGmailBucket(new UnitBucket({ unitsPerMinute: 1e12, capacity: 1e9, maxConcurrency: 4 }));
  gmail = new FakeGmail();
  gmail.install();
  gis = installFakeGis({ token: gmail.token });
  db = freshDb('real');
  duringSelect = null;
  setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
  hybrid = readingModel();
  setHybridForTests(hybrid);
});

afterEach(async () => {
  await dropDb(db);
  gmail.restoreFetch();
  gis.uninstall();
  resetGmailAuth();
  resetGmailBucket();
  setMlClient(null);
  resetAiForTests();
});

/** The receipt and two other emails, synced; then the receipt as a sync that stopped before its bodies left it. */
async function receiptWithoutBody(preview: string): Promise<void> {
  gmail.add({ id: 'rc1', subject: 'Your Larkspur Supply receipt', from: SENDER, text: BODY });
  gmail.add({ id: 'n1', subject: 'Larkspur Supply weekly picks', from: 'Larkspur Supply <news@larkspur.example>', text: 'New notebooks and pens this week.' });
  gmail.add({ id: 'l1', subject: 'Lunch on Friday', from: 'Dana Whitfield <dana@thistlewick-pm.example>', text: 'Lunch on Friday at noon?' });
  await connectGmail(db);
  await runGmailSync(db);
  await peekQueue(db)?.whenIdle();
  const rec = await db.records.get(ID);
  await ingestInternal(db, { source: 'gmail', sourceRef: 'rc1', kind: 'email', title: rec!.title, from: rec!.from, threadId: rec!.threadId, date: rec!.date, text: preview }, 'own', { bodyPending: true });
  expect((await db.records.get(ID))?.text).toBeUndefined();
  gmail.calls = [];
}

/** The full message written to the index as a sync in another tab does, with no request to Gmail from this one. */
async function bodyWrittenElsewhere(): Promise<void> {
  const r = await rawFromMessage({ ...gmail.messages.get('rc1')!, internalDate: String(gmail.messages.get('rc1')!.internalDate) } as GmailMessage, 'full');
  await ingestInternal(db, r.raw, 'own', { sizeBytes: r.sizeBytes, sourceModifiedAt: r.internalDate, contentHash: r.contentHash });
}

function ask(over: Partial<PrepareInput> = {}): Promise<Proposal> {
  return prepareProposal({
    db, requestId: 'r1', question: QUESTION, requester: OUTSIDE, requestedStep: 'answer', maxStep: 'answer', settings: SETTINGS,
    dataClass: 'own', allowedSources: ['gmail'], hints: { terms: ['5521-0098'] }, ...over,
  });
}

const labels = (p: Proposal) => p.trace.map((s) => s.label);
const warningKinds = (p: Proposal) => p.warnings.map((w) => w.kind);

describe('an email indexed without its body (Nov 21, 2026)', () => {
  it('(a) Gmail can be asked: search fetches the body and the answer comes from it', async () => {
    await receiptWithoutBody(PREVIEW_NO_AMOUNT);
    const p = await ask({ maxStep: 'full' });
    expect(p.outcome).toBe('ready');
    expect(p.item?.recordId).toBe(ID);
    expect(p.options[0]?.text).toBe('You were charged $48.20.');
    expect(p.options[2]?.text).toContain('card ending 4421');
    expect(labels(p)).toContain(LABELS.excerptChosen);
    expect(warningKinds(p)).not.toContain('unverified-answer');
    expect(warningKinds(p)).not.toContain('source-unchecked');
    expect((await db.records.get(ID))?.text).toContain('$48.20');
  });

  it('(a) the same with only a sender hint', async () => {
    await receiptWithoutBody(PREVIEW_NO_AMOUNT);
    const p = await ask({ hints: { from: 'Larkspur Supply' } });
    expect(p.outcome).toBe('ready');
    expect(p.options[0]?.text).toBe('You were charged $48.20.');
  });

  it('(b) no Gmail token, the preview has the amount: answered from the preview, with the warning', async () => {
    await receiptWithoutBody(PREVIEW_WITH_AMOUNT);
    clearGmailToken();
    const p = await ask();
    expect(p.outcome).toBe('ready');
    expect(p.options[0]?.text).toBe('You were charged $48.20.');
    expect(warningKinds(p)).toContain('source-unchecked');
    expect(gmail.calls).toEqual([]);   // nothing was asked of Gmail
  });

  it('(b) no Gmail token, the preview lacks the amount: no match, never error', async () => {
    await receiptWithoutBody(PREVIEW_NO_AMOUNT);
    clearGmailToken();
    const p = await ask();
    expect(p.outcome).toBe('no-match');
  });

  it('(c) a sync fetches the body while the model reads the preview: the proposal is built from the fresh record', async () => {
    await receiptWithoutBody(PREVIEW_WITH_AMOUNT);
    clearGmailToken();   // Gmail waits for the person's OK: search cannot fetch the body
    // The person clicks Continue while Sieve reads: the sync takes the stored token back and fetches the missing body.
    duringSelect = () => runGmailSync(db);
    const p = await ask({ maxStep: 'full' });
    expect((await db.records.get(ID))?.text).toContain('card ending 4421');
    expect(p.outcome).toBe('ready');
    expect(labels(p)).toContain(LABELS.freshChangedHolds('email'));
    expect(p.options[0]?.text).toBe('You were charged $48.20.');
    expect(p.options[1]?.text).toContain('Amount charged: $48.20 to the card ending 4421.');
    expect(p.options[2]?.text).toContain('card ending 4421');
    expect(warningKinds(p)).not.toContain('source-unchecked');   // the sync's token checked it with Gmail
  });

  it('(c) an answer read from a cut-off preview does not hold on the body: the model reads the email again, once', async () => {
    await receiptWithoutBody(PREVIEW_CUT);
    clearGmailToken();
    duringSelect = () => runGmailSync(db);
    const p = await ask();
    expect(labels(p)).toContain(LABELS.freshChangedReread('email'));
    expect(hybrid.callsFor('select-answer')).toHaveLength(2);
    expect(p.outcome).toBe('ready');
    expect(p.options[0]?.text).toBe('You were charged $48.20.');   // not the cut-off "$48"
  });

  it('(c) the body arrives while Gmail cannot be asked: the fresh record, and the warning stays', async () => {
    await receiptWithoutBody(PREVIEW_WITH_AMOUNT);
    clearGmailToken();
    duringSelect = bodyWrittenElsewhere;
    const p = await ask({ maxStep: 'full' });
    expect(p.outcome).toBe('ready');
    expect(labels(p)).toContain(LABELS.freshChangedHolds('email'));
    expect(p.options[2]?.text).toContain('card ending 4421');
    expect(p.warnings).toContainEqual(WARNINGS.sourceUnchecked());
  });

  it('(d) Gmail refuses the freshness check: the local copy with the warning, not error', async () => {
    await receiptWithoutBody(PREVIEW_NO_AMOUNT);
    // search fetched the body; then every Gmail call fails while the item is checked
    duringSelect = async () => gmail.script([{ match: 'GET /messages/*', status: 403, times: 5, body: { error: { code: 403, message: 'no', errors: [{ reason: 'insufficientPermissions' }] } } }]);
    const p = await ask();
    expect(p.outcome).toBe('ready');
    expect(p.options[0]?.text).toBe('You were charged $48.20.');
    expect(p.warnings).toContainEqual(WARNINGS.sourceUnchecked());
    expect(labels(p)).not.toContain(LABELS.freshGmailFailed);
  });
});
