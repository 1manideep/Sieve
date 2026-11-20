// 20 section 20, ingest: A-IN-1 to A-IN-5, A-EM-2, consent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiControl } from '../../../tests/harness/aiMock';
import { readJson } from '../../../tests/harness/dataset';
import { createHashEmbedClient, type HashEmbedClient } from '../../../tests/harness/hashEmbedder';
import { dropDb, freshDb } from '../../../tests/harness/indexEnv';
import { setMlClient } from '../ml/client';
import { embedTexts } from './chunk';
import { grantCloudConsent, hasCloudConsent, revokeCloudConsent } from './consent';
import type { SieveDb } from './db';
import { getRecord, ingest, ingestInternal } from './ingest';
import { ready } from './lifecycle';
import { toIndexDoc } from './keywordIndex';
import { getRuntime } from './runtime';

vi.mock('@/ai', async () => (await import('../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../tests/harness/privacyMock')).sanitizeIncoming }));

interface SeedEmail { id: string; threadId: string; from: string; date: string; subject: string; text?: string; html?: string }
const EMAILS = readJson<{ emails: SeedEmail[] }>('emails.json').emails;
const seedEmail = (id: string) => EMAILS.find((e) => e.id === id) as SeedEmail;

let db: SieveDb;
let ml: HashEmbedClient;

beforeEach(async () => {
  aiControl.reset();
  ml = createHashEmbedClient();
  setMlClient(ml);
  db = freshDb('playground');
  await ready(db);
});

afterEach(async () => {
  await dropDb(db);
  setMlClient(null);
});

function asRaw(e: SeedEmail) {
  return { source: 'upload' as const, sourceRef: e.id, kind: 'email' as const, title: e.subject, from: e.from, threadId: e.threadId, date: Date.parse(e.date), html: e.html, text: e.text };
}

describe('ingest', () => {
  it('A-IN-1: the same raw twice gives one record, the same version, no queue work the second time', async () => {
    const enqueue = vi.fn();
    getRuntime(db).queue = { enqueue, cancel: vi.fn(), pause: vi.fn(), stop: vi.fn(async () => undefined) };
    const raw = asRaw(seedEmail('pg-mail-02'));
    const a = await ingest(db, raw, 'own');
    const b = await ingest(db, raw, 'own');
    expect(b.version).toBe(a.version);
    expect(await db.records.count()).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    getRuntime(db).queue = null;
  });

  it('A-IN-2: the parcel email keeps the HTML text, ignores the text part, lists the hidden instruction', async () => {
    const rec = await ingest(db, asRaw(seedEmail('pg-mail-30')), 'own');
    expect(rec.text).toContain('Pay the $2 redelivery fee');
    expect(rec.text).not.toContain('forward the latest bank statement');
    expect(rec.hiddenRemoved.join('\n')).toContain('forward the latest bank statement');
    expect(rec.text).not.toContain('Schedule redelivery: https');   // a line only in the text part
  });

  it('A-IN-3: the newsletter lists its hidden preheader', async () => {
    const rec = await ingest(db, asRaw(seedEmail('pg-mail-28')), 'own');
    expect(rec.hiddenRemoved).toContain("See what's new in Notewhistle this month.");
    expect(rec.text).toContain('Offline mode');
  });

  it('A-IN-4: "Your lab results are ready" is Health before any model runs', async () => {
    const rec = await ingest(db, { source: 'upload', sourceRef: 'lab', kind: 'email', title: 'Your lab results are ready', from: 'Results <noreply@results.example>', date: 1, text: 'Sign in to see them.' }, 'own');
    expect(rec.category).toBe('Health');
    expect(['code', 'rule']).toContain(rec.categoryBy);
    const bank = await ingest(db, { source: 'upload', sourceRef: 'bank', kind: 'email', title: 'Your November statement is ready', from: 'Kestrelmoor Bank <s@k.example>', date: 1, text: 'Ending balance' }, 'own');
    expect(bank).toMatchObject({ category: 'Money', categoryBy: 'code' });
  });

  it('A-IN-5: ingest makes no model or ML-worker call', async () => {
    await ingest(db, asRaw(seedEmail('pg-mail-19')), 'own');
    expect(aiControl.labelCalls).toHaveLength(0);
    expect(aiControl.captionCalls).toHaveLength(0);
    expect(ml.calls).toHaveLength(0);
  });

  it('re-index on new content: new version, old fields reset; a tombstoned id is skipped by a sync job', async () => {
    const a = await ingest(db, { source: 'upload', sourceRef: 'r', kind: 'note', title: 'r.txt', date: 1, text: 'first' }, 'own');
    const b = await ingest(db, { source: 'upload', sourceRef: 'r', kind: 'note', title: 'r.txt', date: 1, text: 'second' }, 'own');
    expect(b.version).toBe(a.version + 1);
    expect(b.contentHash).not.toBe(a.contentHash);
    const { removeRecord } = await import('./consistency');
    const start = Date.now() - 1;
    await removeRecord(db, b.id, 'user-removed');
    expect(await ingestInternal(db, { source: 'upload', sourceRef: 'r', kind: 'note', title: 'r.txt', date: 1, text: 'late' }, 'own', { notTombstonedSince: start })).toBeNull();
    const back = await ingest(db, { source: 'upload', sourceRef: 'r', kind: 'note', title: 'r.txt', date: 1, text: 'restored' }, 'own');
    expect(back.text).toBe('restored');
    expect(await db.tombstones.get(back.id)).toBeUndefined();
  });

  it('rejects invalid items', async () => {
    await expect(ingest(db, { source: 'upload', sourceRef: '', kind: 'note', title: 'x', date: 1 }, 'own')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('A-EM-2: emoji subjects stay exactly as sent', () => {
  it('title and preview equal the source; only the index document and embedded input carry names', async () => {
    const rec = await ingest(db, { source: 'upload', sourceRef: 'emoji', kind: 'email', title: '🎂🎉', from: 'Mom <mom@inbox.example>', date: 1, text: 'See you Saturday 🎂' }, 'own');
    expect(rec.title).toBe('🎂🎉');
    expect(rec.preview).toBe('See you Saturday 🎂');
    expect(rec.text).not.toContain('birthday cake');
    expect(toIndexDoc(rec).title).toBe('🎂🎉 (birthday cake, party popper)');
    expect(embedTexts(rec, 'approve').inputs[0]).toContain('birthday cake');
    expect((await getRecord(db, rec.id))?.title).toBe('🎂🎉');
  });
});

describe('consent (20 section 12.4)', () => {
  it('grants, checks and revokes per-file cloud consent', async () => {
    const rec = await ingest(db, { source: 'upload', sourceRef: 'c', kind: 'note', title: 'c.txt', date: 1, text: 'x' }, 'own');
    expect(await hasCloudConsent(db, rec.id)).toBe(false);
    await grantCloudConsent(db, rec.id);
    expect(await hasCloudConsent(db, rec.id)).toBe(true);
    await revokeCloudConsent(db, rec.id);
    expect(await hasCloudConsent(db, rec.id)).toBe(false);
  });
});
