// Mail sent to yourself (20 section 15.5, Nov 21): the second tester planted emails by sending them to themselves, and
// Sieve never found them. Not the list query (the backfill lists sent mail too): a sent draft keeps its id, so its
// `messagesAdded` entry said DRAFT and was skipped, and SENT and INBOX came as `labelsAdded`, which incremental sync
// read only for TRASH and SPAM. Now a message that lands in the inbox or in sent by a label change is indexed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGmail } from '../../../../tests/harness/fakeGmail';
import { installFakeGis } from '../../../../tests/harness/fakeGis';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { dropDb, freshDb } from '../../../../tests/harness/indexEnv';
import type { SieveDb } from '../../index/db';
import { peekQueue } from '../../index/queue/ingestQueue';
import { setMlClient } from '../../ml/client';
import { connectGmail } from '../registry';
import { resetGmailAuth } from './auth';
import { resetGmailBucket } from './api';
import { UnitBucket } from './rateLimit';
import { runGmailSync } from './sync';

vi.mock('@/ai', async () => (await import('../../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/app/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/env')>();
  return { ...m, env: { ...m.env, googleOAuthClientId: 'test-client.apps.googleusercontent.com' } };
});

process.env.TZ = 'America/Chicago';
let gmail: FakeGmail;
let gis: ReturnType<typeof installFakeGis>;
let db: SieveDb;

type Labelled = { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] };
/** Gmail's history entry for a label change (FakeGmail keeps its log private). */
function logLabels(e: { labelsAdded?: Labelled[]; labelsRemoved?: Labelled[] }): void {
  (gmail as unknown as { log(entry: object): void }).log(e);
}

/** A draft that is then sent: the same id, DRAFT removed, the new labels added. */
function sendDraft(id: string, labels: string[]): void {
  const m = gmail.messages.get(id)!;
  m.labelIds = labels;
  const message = { id, threadId: m.threadId, labelIds: labels };
  logLabels({ labelsRemoved: [{ message, labelIds: ['DRAFT'] }], labelsAdded: [{ message, labelIds: labels }] });
}

beforeEach(async () => {
  setMlClient(createHashEmbedClient());
  resetGmailAuth();
  resetGmailBucket(new UnitBucket({ unitsPerMinute: 1e12, capacity: 1e9, maxConcurrency: 4 }));
  gmail = new FakeGmail();
  gmail.install();
  gis = installFakeGis({ token: gmail.token });
  db = freshDb('real');
});

afterEach(async () => {
  await dropDb(db);
  gmail.restoreFetch();
  gis.uninstall();
  resetGmailAuth();
  resetGmailBucket();
  setMlClient(null);
});

async function connect(): Promise<void> {
  await connectGmail(db);
  await runGmailSync(db);
  await peekQueue(db)?.whenIdle();
}

describe('mail sent to yourself', () => {
  it('the backfill already lists it: the query excludes only chats and drafts', async () => {
    gmail.add({ id: 'self-old', subject: 'Note to self', from: `Alex Rivera <${gmail.email}>`, text: 'The spare key is under the blue pot.', labelIds: ['SENT', 'INBOX'] }, { silent: true });
    await connect();
    expect(await db.records.get('gmail:self-old')).toBeDefined();
  });

  it('a draft sent to yourself after the backfill is indexed by incremental sync, like any other message in the inbox', async () => {
    gmail.add({ id: 'keep', subject: 'Lunch', text: 'Lunch on Friday.' });
    await connect();
    gmail.add({ id: 'self', subject: 'Planted note', from: `Alex Rivera <${gmail.email}>`, text: 'Remember the parking code for the garage.', labelIds: ['DRAFT'] });
    sendDraft('self', ['SENT', 'INBOX']);
    await runGmailSync(db);
    await peekQueue(db)?.whenIdle();
    expect(await db.records.get('gmail:self')).toMatchObject({ title: 'Planted note', kind: 'email' });
  });

  it('a draft sent to someone else is indexed too (the backfill lists sent mail); a draft that stays a draft is not', async () => {
    await connect();
    gmail.add({ id: 'sent', subject: 'To Dana', from: `Alex Rivera <${gmail.email}>`, text: 'Here is the move-out date.', labelIds: ['DRAFT'] });
    sendDraft('sent', ['SENT']);
    gmail.add({ id: 'draft', subject: 'Unsent', text: 'Still writing this.', labelIds: ['DRAFT'] });
    await runGmailSync(db);
    expect(await db.records.get('gmail:sent')).toBeDefined();
    expect(await db.records.get('gmail:draft')).toBeUndefined();
  });

  it('a label change on a message already indexed fetches nothing', async () => {
    gmail.add({ id: 'keep', subject: 'Lunch', text: 'Lunch on Friday.' });
    await connect();
    const before = gmail.calls.filter((c) => c.includes('/messages/keep')).length;
    const m = gmail.messages.get('keep')!;
    logLabels({ labelsAdded: [{ message: { id: 'keep', threadId: m.threadId, labelIds: m.labelIds }, labelIds: ['INBOX'] }] });
    await runGmailSync(db);
    expect(gmail.calls.filter((c) => c.includes('/messages/keep')).length).toBe(before);
  });
});
