// Firestore security rules tests: docs/spec/30-relay-server.md section 17.5 (R1 to R10), 60 section 3.8, and the
// reconciliation rows of 01-contracts section 11 (11.6 answered -> revoked, 11.7 shared image, 11.8 item refs) plus
// the Playground outside assistant (00 D1). Run with `npm run test:rules`.
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// emulators:exec sets these; the defaults are the ports in firebase.json.
function hostPort(value: string | undefined, fallback: number): { host: string; port: number } {
  const [host, port] = (value ?? `127.0.0.1:${fallback}`).split(':');
  return { host: host || '127.0.0.1', port: Number(port) || fallback };
}

let env: RulesTestEnvironment;

const CATEGORIES = ['Home', 'Work', 'Money', 'Health', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos'];
const REF = 'a'.repeat(64);
const MIN = 60_000;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sieve',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

function fs(ctx: RulesTestContext): Firestore {
  return ctx.firestore() as unknown as Firestore;
}
const alice = () => fs(env.authenticatedContext('alice'));
const bob = () => fs(env.authenticatedContext('bob'));
const anonAlice = () =>
  fs(env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous', identities: {} } }));
const nobody = () => fs(env.unauthenticatedContext());

async function seed(path: string, data: DocumentData): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(fs(ctx), path), data);
  });
}

function ago(ms: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - ms);
}

function request(over: DocumentData = {}): DocumentData {
  return {
    requester: { kind: 'outside', grantId: 'grant-1', aiName: 'Test AI' },
    tool: 'sieve_answer',
    requestedStep: 'answer',
    maxStep: 'excerpt',
    allowedCategories: ['Home'],
    allowedSources: ['gmail'],
    question: 'What did my landlord say about the deposit?',
    status: 'queued',
    createdAt: ago(0),
    expireAt: Timestamp.fromMillis(Date.now() + 24 * 60 * MIN),
    ...over,
  };
}

function claimed(over: DocumentData = {}): DocumentData {
  return request({ status: 'claimed', claimedAt: ago(5_000), claimedBy: 'device-aaaa', ...over });
}

function payload(over: DocumentData = {}): DocumentData {
  return { step: 'answer', text: 'Your deposit was $1,200.', chars: 24, itemCount: 1, ...over };
}

function receipt(id: string, over: DocumentData = {}): DocumentData {
  return {
    id,
    requestId: id,
    requester: { kind: 'outside', grantId: 'grant-1', aiName: 'Test AI' },
    question: 'What did my landlord say about the deposit?',
    step: 'answer',
    itemRefs: [REF],
    status: 'pending-collection',
    decidedBy: 'app',
    chars: 24,
    createdAt: serverTimestamp(),
    ...over,
  };
}

async function seedDevices(): Promise<void> {
  const device = { label: 'Mac', isHomeBase: true, updatedAt: ago(0) };
  await seed('users/alice/devices/device-aaaa', device);
  await seed('users/alice/devices/device-bbbb', device);
}

function answerBatch(db: Firestore, id: string, response: DocumentData = payload()) {
  const b = writeBatch(db);
  b.update(doc(db, `users/alice/requests/${id}`), { status: 'answered', answeredAt: serverTimestamp(), response });
  b.set(doc(db, `users/alice/receipts/${id}`), receipt(id));
  return b;
}

describe('R1 claim', () => {
  it('owner claims a queued request with an existing device id; others cannot', async () => {
    await seedDevices();
    await seed('users/alice/requests/r1', request());
    const claim = { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'device-aaaa' };
    await assertFails(updateDoc(doc(bob(), 'users/alice/requests/r1'), claim));
    await assertFails(updateDoc(doc(nobody(), 'users/alice/requests/r1'), claim));
    await assertFails(updateDoc(doc(alice(), 'users/alice/requests/r1'), { ...claim, claimedBy: 'device-none' }));
    await assertFails(updateDoc(doc(alice(), 'users/alice/requests/r1'), { ...claim, claimedAt: ago(0) }));
    await assertSucceeds(updateDoc(doc(alice(), 'users/alice/requests/r1'), claim));
  });
});

describe('R2 protected request fields', () => {
  it.each([
    ['question', 'Something else?'],
    ['hints', { after: '2026-01-01' }],
    ['maxStep', 'full'],
    ['requester', { kind: 'outside', grantId: 'grant-2', aiName: 'X' }],
    ['allowedCategories', CATEGORIES],
    ['expireAt', Timestamp.fromMillis(Date.now() + 100 * 24 * 60 * MIN)],
  ])('changing %s fails', async (field, value) => {
    await seedDevices();
    await seed('users/alice/requests/r2', request());
    const db = alice();
    await assertFails(updateDoc(doc(db, 'users/alice/requests/r2'), { [field]: value }));
    await assertFails(
      updateDoc(doc(db, 'users/alice/requests/r2'), {
        status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'device-aaaa', [field]: value,
      }),
    );
  });
});

describe('R3 payload checks', () => {
  it.each([
    ['a step above maxStep', payload({ step: 'full' })],
    ['8001 characters', payload({ text: 'x'.repeat(8001), chars: 8000 })],
    ['a missing itemCount', { step: 'answer', text: 'T', chars: 1 }],
    ['an extra field', payload({ itemIds: ['gmail:1'] })],
    ['an image on the answer step', payload({ image: { mime: 'image/jpeg', base64: 'AAAA', width: 1, height: 1, bytes: 3 } })],
  ])('an answer with %s fails', async (_name, response) => {
    await seed('users/alice/requests/r3', claimed({ status: 'awaiting-person' }));
    await assertFails(answerBatch(alice(), 'r3', response).commit());
  });

  it('a valid answer with its receipt in one batch succeeds', async () => {
    await seed('users/alice/requests/r3', claimed({ status: 'awaiting-person' }));
    await assertSucceeds(answerBatch(alice(), 'r3').commit());
  });

  it('an answer may carry a short note (testing mode names the picked item by a code); a long one fails', async () => {
    await seed('users/alice/requests/r3', claimed({ status: 'awaiting-person' }));
    const withNote = (message: string) => {
      const db = alice();
      const b = writeBatch(db);
      b.update(doc(db, 'users/alice/requests/r3'), { status: 'answered', answeredAt: serverTimestamp(), response: payload(), message });
      b.set(doc(db, 'users/alice/receipts/r3'), receipt('r3'));
      return b;
    };
    await assertFails(withNote('x'.repeat(301)).commit());
    await assertSucceeds(withNote('picked r1of5-tx-g1-b1-cab12.cd34').commit());
  });

  it('a photo shared at the full step may carry its re-encoded image (11.7)', async () => {
    await seed('users/alice/requests/r3', claimed({ status: 'awaiting-person', maxStep: 'full' }));
    const image = { mime: 'image/jpeg', base64: 'A'.repeat(4000), width: 600, height: 400, bytes: 3000 };
    await assertSucceeds(answerBatch(alice(), 'r3', payload({ step: 'full', image })).commit());
  });

  describe('a file sent as itself (Nov 22)', () => {
    const sent = (path: string, over: DocumentData = {}) => ({ name: 'Lease_2026.pdf', mime: 'application/pdf', bytes: 182_000, path, ...over });
    const own = `handoffs/alice/r3/${'o'.repeat(24)}`;

    it('rides on the full step when the request asked for it, from this request\'s own place', async () => {
      await seed('users/alice/requests/r3', claimed({ status: 'awaiting-person', maxStep: 'full', wantFile: true }));
      await assertSucceeds(answerBatch(alice(), 'r3', payload({ step: 'full', file: sent(own) })).commit());
    });

    it.each([
      ['a request that did not ask for a file', { maxStep: 'full' }, payload({ step: 'full', file: sent(own) })],
      ['a smaller step', { maxStep: 'full', wantFile: true }, payload({ step: 'excerpt', file: sent(own) })],
      ["another person's place", { maxStep: 'full', wantFile: true }, payload({ step: 'full', file: sent(`handoffs/bob/r3/${'o'.repeat(24)}`) })],
      ["another request's place", { maxStep: 'full', wantFile: true }, payload({ step: 'full', file: sent(`handoffs/alice/r4/${'o'.repeat(24)}`) })],
      ['a place outside the handoffs', { maxStep: 'full', wantFile: true }, payload({ step: 'full', file: sent(`users/alice/r3/${'o'.repeat(24)}`) })],
      ['a file over 20 MB', { maxStep: 'full', wantFile: true }, payload({ step: 'full', file: sent(own, { bytes: 20 * 1024 * 1024 + 1 }) })],
      ['an extra field on the file', { maxStep: 'full', wantFile: true }, payload({ step: 'full', file: sent(own, { url: 'https://x.example/f' }) })],
      ['an image beside the file', { maxStep: 'full', wantFile: true }, payload({ step: 'full', file: sent(own), image: { mime: 'image/jpeg', base64: 'AAAA', width: 1, height: 1, bytes: 3 } })],
    ])('fails with %s', async (_name, request, response) => {
      await seed('users/alice/requests/r3', claimed({ status: 'awaiting-person', ...request }));
      await assertFails(answerBatch(alice(), 'r3', response).commit());
    });

    it('no client reads or writes a file link', async () => {
      await seed('fileLinks/abc', { uid: 'alice', path: own });
      await assertFails(getDoc(doc(alice(), 'fileLinks/abc')));
      await assertFails(setDoc(doc(alice(), 'fileLinks/mine'), { uid: 'alice', path: own }));
    });
  });

  it('V5: 3,000 Japanese characters and 7,999 units of emoji are allowed', async () => {
    await seed('users/alice/requests/v5a', claimed({ status: 'awaiting-person', maxStep: 'full' }));
    await seed('users/alice/requests/v5b', claimed({ status: 'awaiting-person', maxStep: 'full' }));
    const japanese = '日本語'.repeat(1000);
    const emoji = '\u{1F382}'.repeat(3999) + 'x';
    await assertSucceeds(answerBatch(alice(), 'v5a', payload({ step: 'full', text: japanese, chars: 3000 })).commit());
    await assertSucceeds(answerBatch(alice(), 'v5b', payload({ step: 'full', text: emoji, chars: 7999 })).commit());
  });
});

describe('R4 transitions', () => {
  it('queued to answered, claimed to answered, answered to claimed, collected to anything fail', async () => {
    await seedDevices();
    await seed('users/alice/requests/q', request());
    await seed('users/alice/requests/c', claimed());
    await seed('users/alice/requests/a', claimed({ status: 'answered', answeredAt: ago(0), response: payload() }));
    await seed('users/alice/requests/x', claimed({ status: 'collected', collectedAt: ago(0) }));
    const db = alice();
    await assertFails(answerBatch(db, 'q').commit());
    await assertFails(answerBatch(db, 'c').commit());
    await assertFails(
      updateDoc(doc(db, 'users/alice/requests/a'), { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'device-aaaa' }),
    );
    for (const status of ['claimed', 'awaiting-person', 'answered', 'declined', 'error', 'revoked']) {
      await assertFails(updateDoc(doc(db, 'users/alice/requests/x'), { status }));
    }
    await assertFails(updateDoc(doc(db, 'users/alice/requests/q'), { status: 'expired' }));
    await assertFails(deleteDoc(doc(db, 'users/alice/requests/q')));
    await assertFails(setDoc(doc(db, 'users/alice/requests/new'), request()));
  });

  it('the allowed path: claim, awaiting-person, declined; claimed to no-match with a message', async () => {
    await seedDevices();
    await seed('users/alice/requests/p', request());
    await seed('users/alice/requests/n', claimed());
    const db = alice();
    await assertSucceeds(
      updateDoc(doc(db, 'users/alice/requests/p'), { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'device-aaaa' }),
    );
    await assertSucceeds(updateDoc(doc(db, 'users/alice/requests/p'), { status: 'awaiting-person' }));
    await assertFails(updateDoc(doc(db, 'users/alice/requests/p'), { status: 'declined', message: 'x'.repeat(301) }));
    await assertSucceeds(updateDoc(doc(db, 'users/alice/requests/p'), { status: 'declined', message: 'Not now.' }));
    await assertSucceeds(updateDoc(doc(db, 'users/alice/requests/n'), { status: 'no-match' }));
  });
});

describe('R5 decision window', () => {
  it('claim or answer when createdAt is 121 minutes old fails', async () => {
    await seedDevices();
    await seed('users/alice/requests/old', request({ createdAt: ago(121 * MIN) }));
    await seed('users/alice/requests/old2', claimed({ status: 'awaiting-person', createdAt: ago(121 * MIN) }));
    const db = alice();
    await assertFails(
      updateDoc(doc(db, 'users/alice/requests/old'), { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'device-aaaa' }),
    );
    await assertFails(answerBatch(db, 'old2').commit());
  });
});

describe('R6 reclaim', () => {
  it('another device may take over only after 120 s', async () => {
    await seedDevices();
    await seed('users/alice/requests/s60', claimed({ claimedAt: ago(60_000) }));
    await seed('users/alice/requests/s121', claimed({ claimedAt: ago(121_000) }));
    const db = alice();
    const by = (id: string) => ({ status: 'claimed', claimedAt: serverTimestamp(), claimedBy: id });
    await assertFails(updateDoc(doc(db, 'users/alice/requests/s60'), by('device-bbbb')));
    await assertSucceeds(updateDoc(doc(db, 'users/alice/requests/s60'), by('device-aaaa')));
    await assertSucceeds(updateDoc(doc(db, 'users/alice/requests/s121'), by('device-bbbb')));
  });
});

describe('R7 functions-only collections', () => {
  it('connectors, grants and audit cannot be written by clients; owners read their own', async () => {
    await seed('connectors/abc', { uid: 'alice', grantId: 'g' });
    await seed('users/alice/grants/g1', { aiName: 'A', maxStep: 'answer' });
    await seed('audit/alice', { seq: 1, lastHash: 'h' });
    await seed('audit/alice/entries/0000000001', { seq: 1 });
    const db = alice();
    await assertFails(getDoc(doc(db, 'connectors/abc')));
    await assertFails(getDoc(doc(nobody(), 'connectors/abc')));
    await assertFails(setDoc(doc(db, 'connectors/abc'), { uid: 'alice' }));
    await assertFails(setDoc(doc(db, 'users/alice/grants/g2'), { aiName: 'A' }));
    await assertFails(updateDoc(doc(db, 'users/alice/grants/g1'), { maxStep: 'full' }));
    await assertFails(setDoc(doc(db, 'audit/alice'), { seq: 2 }));
    await assertFails(setDoc(doc(db, 'audit/alice/entries/0000000002'), { seq: 2 }));
    await assertFails(getDoc(doc(db, 'debug_pushes/x')));
    await assertSucceeds(getDoc(doc(db, 'users/alice/grants/g1')));
    await assertSucceeds(getDoc(doc(db, 'audit/alice')));
    await assertSucceeds(getDoc(doc(db, 'audit/alice/entries/0000000001')));
  });

  it('another user and a signed-out visitor read nothing of alice', async () => {
    await seed('users/alice', { createdAt: ago(0) });
    await seed('users/alice/grants/g1', { aiName: 'A' });
    await seed('users/alice/requests/r', request());
    await seed('audit/alice', { seq: 1 });
    for (const db of [bob(), nobody()]) {
      for (const path of ['users/alice', 'users/alice/grants/g1', 'users/alice/requests/r', 'audit/alice']) {
        await assertFails(getDoc(doc(db, path)));
      }
    }
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/requests/r')));
  });
});

describe('R8 anonymous owners', () => {
  it('cannot write a device, a receipt or a request update for real data', async () => {
    await seedDevices();
    await seed('users/alice/requests/r8', request());
    const db = anonAlice();
    await assertFails(setDoc(doc(db, 'users/alice/devices/device-cccc'), { label: 'X', isHomeBase: true, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r8'), receipt('r8')));
    await assertFails(
      updateDoc(doc(db, 'users/alice/requests/r8'), { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'device-aaaa' }),
    );
  });

  it('may serve its own Playground request (00 D1) without a device doc', async () => {
    await seed('users/alice/requests/pg', request({ allowedSources: ['playground'], maxStep: 'full' }));
    const db = anonAlice();
    await assertSucceeds(
      updateDoc(doc(db, 'users/alice/requests/pg'), { status: 'claimed', claimedAt: serverTimestamp(), claimedBy: 'playground-tab' }),
    );
    await assertSucceeds(updateDoc(doc(db, 'users/alice/requests/pg'), { status: 'awaiting-person' }));
    await assertSucceeds(
      updateDoc(doc(db, 'users/alice/requests/pg'), { status: 'answered', answeredAt: serverTimestamp(), response: payload() }),
    );
    await assertFails(
      updateDoc(doc(fs(env.authenticatedContext('eve', { firebase: { sign_in_provider: 'anonymous', identities: {} } })), 'users/alice/requests/pg'), { status: 'revoked', response: deleteField() }),
    );
  });
});

describe('R9 receipts', () => {
  it('a receipt may say the size of a file sent as itself, on a full-step share only (Nov 22)', async () => {
    const db = alice();
    await seed('users/alice/requests/r9', claimed({ status: 'awaiting-person', maxStep: 'full' }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/receipts/r9'), receipt('r9', { step: 'full', fileBytes: 182_000 })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9b'), receipt('r9b', { step: 'answer', fileBytes: 182_000 })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9c'), receipt('r9c', { step: 'full', fileBytes: 0 })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9d'), receipt('r9d', { step: 'full', fileBytes: 20 * 1024 * 1024 + 1 })));
  });

  it('rejects a wrong id, a delivered outside receipt, a client createdAt, updates and deletes', async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9'), receipt('r9', { id: 'other' })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9'), receipt('r9', { status: 'delivered' })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9'), receipt('r9', { createdAt: ago(0) })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/r9'), receipt('r9', { requestId: 'another' })));
    await assertSucceeds(setDoc(doc(db, 'users/alice/receipts/r9'), receipt('r9')));
    await assertFails(updateDoc(doc(db, 'users/alice/receipts/r9'), { chars: 0 }));
    await assertFails(updateDoc(doc(db, 'users/alice/receipts/r9'), { status: 'revoked' }));
    await assertFails(deleteDoc(doc(db, 'users/alice/receipts/r9')));
  });

  it('in-app receipts are delivered, never pending-collection', async () => {
    const db = alice();
    const inApp = { requester: { kind: 'in-app', aiName: 'Gemini (in Sieve)' }, requestId: 'local-1' };
    await assertFails(setDoc(doc(db, 'users/alice/receipts/i1'), receipt('i1', inApp)));
    await assertSucceeds(setDoc(doc(db, 'users/alice/receipts/i1'), receipt('i1', { ...inApp, status: 'delivered' })));
  });

  it('11.8: item references are 64 hex characters, never record ids or file paths', async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, 'users/alice/receipts/p1'), receipt('p1', { itemRefs: ['folder:taxes/2025/W-2.pdf'] })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/p1'), receipt('p1', { itemRefs: [REF, 'gmail:18c2'] })));
    await assertFails(setDoc(doc(db, 'users/alice/receipts/p1'), receipt('p1', { itemIds: [REF] })));
    await assertSucceeds(setDoc(doc(db, 'users/alice/receipts/p1'), receipt('p1', { itemRefs: [REF, 'b'.repeat(64)] })));
    await assertFails(setDoc(doc(db, 'users/alice/blocked/b1'), { recordId: 'folder:taxes/W-2.pdf', grantId: '*', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'users/alice/blocked/b1'), { recordRef: 'folder:taxes/W-2.pdf', grantId: '*', createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/blocked/b1'), { recordRef: REF, grantId: '*', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'users/alice/blocked/b1'), { grantId: 'g' }));
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/blocked/b1')));
  });
});

describe('11.6 the home base revokes an uncollected answer', () => {
  it('answered -> revoked with the payload deleted, and the receipt revoked in the same batch', async () => {
    await seed('users/alice/requests/rv', claimed({ status: 'answered', answeredAt: ago(0), response: payload(), createdAt: ago(150 * MIN) }));
    await seed('users/alice/receipts/rv', { ...receipt('rv'), createdAt: ago(0) });
    const db = alice();
    await assertFails(updateDoc(doc(db, 'users/alice/requests/rv'), { status: 'revoked' }));
    const lone = writeBatch(db);
    lone.update(doc(db, 'users/alice/receipts/rv'), { status: 'revoked' });
    await assertFails(lone.commit());
    const b = writeBatch(db);
    b.update(doc(db, 'users/alice/requests/rv'), { status: 'revoked', response: deleteField(), message: 'The person took this back.' });
    b.update(doc(db, 'users/alice/receipts/rv'), { status: 'revoked' });
    await assertSucceeds(b.commit());
  });
});

describe('R10 settings and devices', () => {
  const rules = Object.fromEntries(CATEGORIES.map((c) => [c, 'approve']));
  const settings = { categoryRules: rules, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: true };

  it('rejects a missing category and an unknown rule value; accepts full valid settings', async () => {
    const db = alice();
    const { Photos: _omit, ...missing } = rules;
    await assertFails(setDoc(doc(db, 'users/alice'), { settings: { ...settings, categoryRules: missing } }));
    await assertFails(setDoc(doc(db, 'users/alice'), { settings: { ...settings, categoryRules: { ...rules, Health: 'sometimes' } } }));
    await assertFails(setDoc(doc(db, 'users/alice'), { settings, extra: true }));
    await assertFails(setDoc(doc(bob(), 'users/alice'), { settings }));
    await assertSucceeds(setDoc(doc(db, 'users/alice'), { settings, createdAt: serverTimestamp(), homeBaseDeviceId: 'device-aaaa' }));
    await assertFails(deleteDoc(doc(db, 'users/alice')));
  });

  it('devices: the owner registers one with an FID; updatedAt must be the server time', async () => {
    const db = alice();
    const device = { label: 'Mac mini', isHomeBase: true, fcmToken: 'cGVyc29uYWwtZmlkLTAx22', updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(db, 'users/alice/devices/short'), device));
    await assertFails(setDoc(doc(db, 'users/alice/devices/device-aaaa'), { ...device, updatedAt: ago(0) }));
    await assertFails(setDoc(doc(db, 'users/alice/devices/device-aaaa'), { ...device, ip: '1.2.3.4' }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/devices/device-aaaa'), device));
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/devices/device-aaaa')));
  });
});
