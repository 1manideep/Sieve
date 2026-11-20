// The home base's Firestore writes against the Firestore emulator (40 section 18, 60 sections 3.5 and 3.6).
// Runs only under `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST set); skipped otherwise.
// Until the functions package lands the real rules (30 section 15.1), run it with a permissive test-only rules
// file passed to the emulator, never by editing the repo's firestore.rules.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  collection,
  initializeFirestore,
  setDoc,
  Timestamp,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import type { Receipt } from '@sieve/shared';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const run = describe.skipIf(!host);

run('home base writes on the Firestore emulator', () => {
  let app: FirebaseApp;
  let db: Firestore;
  let uid: string;
  let mod: {
    requests: typeof import('./requests');
    receipts: typeof import('@/app/services/receipts');
    devices: typeof import('@/app/services/devices');
    userDoc: typeof import('@/app/services/userDoc');
  };

  beforeAll(async () => {
    const [h, p] = (host as string).split(':');
    app = initializeApp({ projectId: 'demo-sieve', apiKey: 'demo-key', appId: 'demo-app' }, `emulator-${Date.now()}`);
    db = initializeFirestore(app, { experimentalForceLongPolling: true });
    connectFirestoreEmulator(db, h, Number(p));
    const sdk = await import('@/app/services/firestore');
    sdk.setFirestoreForTests(db);
    mod = {
      requests: await import('./requests'),
      receipts: await import('@/app/services/receipts'),
      devices: await import('@/app/services/devices'),
      userDoc: await import('@/app/services/userDoc'),
    };
  });

  afterAll(async () => {
    const sdk = await import('@/app/services/firestore');
    sdk.setFirestoreForTests(undefined);
    await terminate(db);
    await deleteApp(app);
  });

  beforeEach(() => {
    uid = `u${Math.random().toString(36).slice(2, 10)}`;
  });

  async function seedRequest(id: string, over: Record<string, unknown> = {}) {
    const now = Date.now();
    await setDoc(doc(db, 'users', uid, 'requests', id), {
      requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' },
      tool: 'sieve_answer',
      requestedStep: 'answer',
      maxStep: 'full',
      allowedCategories: ['Home'],
      allowedSources: ['gmail'],
      question: 'What did my landlord say?',
      status: 'queued',
      createdAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + 86_400_000),
      ...over,
    });
  }

  const receipt = (status: Receipt['status']): Receipt => ({
    id: 'ignored', requestId: 'r1', requester: { kind: 'outside', grantId: 'g1', aiName: 'Gemini CLI' }, question: 'What did my landlord say?',
    step: 'answer', itemIds: ['folder:taxes/2025/W-2.pdf'], status, decidedBy: 'app', chars: 24, createdAt: Date.now(),
  });

  it('two home bases race one queued doc: exactly one claim succeeds (AT-12, R-PLAT-05)', async () => {
    await seedRequest('r1');
    const results = await Promise.all([
      mod.requests.claimRequest(uid, 'r1', 'devAAAAAAAA'),
      mod.requests.claimRequest(uid, 'r1', 'devBBBBBBBB'),
    ]);
    expect(results.filter((r) => r === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r === 'taken')).toHaveLength(1);
    const d = (await getDoc(doc(db, 'users', uid, 'requests', 'r1'))).data()!;
    expect(d.status).toBe('claimed');
    expect(d.claimedAt).toBeInstanceOf(Timestamp);
  });

  it('claim, awaiting, answered: the response and the receipt land in one transaction (AT-13)', async () => {
    await seedRequest('r1');
    expect(await mod.requests.claimRequest(uid, 'r1', 'dev1xxxxx')).toBe('claimed');
    expect(await mod.requests.markAwaiting(uid, 'r1', 'dev1xxxxx')).toBe('ok');
    const response = { step: 'answer' as const, text: 'Your deposit was $1,200, paid on March 3.', chars: 41, itemCount: 1 };
    expect(await mod.requests.finishRequest(uid, 'r1', 'dev1xxxxx', { status: 'answered', response, receipt: receipt('pending-collection') })).toBe('ok');
    const req = (await getDoc(doc(db, 'users', uid, 'requests', 'r1'))).data()!;
    expect(req).toMatchObject({ status: 'answered', response });
    const rc = (await getDoc(doc(db, 'users', uid, 'receipts', 'r1'))).data()!;
    expect(rc).toMatchObject({ id: 'r1', requestId: 'r1', status: 'pending-collection', chars: 24 });
    expect(rc).not.toHaveProperty('itemIds');
    expect(rc.itemRefs).toHaveLength(1);
    expect(JSON.stringify(rc)).not.toContain('taxes');
    expect(await mod.requests.finishRequest(uid, 'r1', 'dev1xxxxx', { status: 'declined', message: 'x', receipt: receipt('declined') })).toBe('gone');
  });

  it('revoking a pending-collection receipt withdraws the answer and blocks the item for that AI', async () => {
    await seedRequest('r1', { status: 'awaiting-person', claimedBy: 'dev1xxxxx', claimedAt: Timestamp.now() });
    const response = { step: 'answer' as const, text: 'Answer.', chars: 7, itemCount: 1 };
    await mod.requests.finishRequest(uid, 'r1', 'dev1xxxxx', { status: 'answered', response, receipt: receipt('pending-collection') });
    const view = mod.receipts.toReceiptView('r1', (await getDoc(doc(db, 'users', uid, 'receipts', 'r1'))).data()!)!;
    await mod.receipts.revokeReceipt(uid, view);
    const req = (await getDoc(doc(db, 'users', uid, 'requests', 'r1'))).data()!;
    expect(req.status).toBe('revoked');
    expect(req).not.toHaveProperty('response');
    expect((await getDoc(doc(db, 'users', uid, 'receipts', 'r1'))).data()!.status).toBe('revoked');
    const blocked = (await getDocs(collection(db, 'users', uid, 'blocked'))).docs.map((d) => d.data());
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ grantId: 'g1', recordRef: view.itemIds[0] });
  });

  it('the user doc is created once with defaults; missing settings are filled, existing ones kept', async () => {
    expect(await mod.userDoc.ensureUserDoc(uid)).toEqual({ isNew: true });
    await mod.userDoc.updateSetting(uid, 'settings.categoryRules.Money', 'never');
    await setDoc(doc(db, 'users', uid), { settings: { categoryRules: { Money: 'never' }, defaultStep: 'full' } }, { merge: false });
    expect(await mod.userDoc.ensureUserDoc(uid)).toEqual({ isNew: false });
    const s = (await getDoc(doc(db, 'users', uid))).data()!.settings;
    expect(s.categoryRules.Money).toBe('never');
    expect(s.categoryRules.Health).toBe('never');
    expect(s.defaultStep).toBe('full');
    expect(s.pushEnabled).toBe(false);
  });

  it('one home base at a time: setHomeBase moves it, clearHomeBase forgets it', async () => {
    await mod.userDoc.ensureUserDoc(uid);
    await mod.devices.setHomeBase(uid, 'devAAAAAAAA', 'Mac mini');
    await mod.devices.setHomeBase(uid, 'devBBBBBBBB', 'Laptop');
    expect((await getDoc(doc(db, 'users', uid))).data()!.homeBaseDeviceId).toBe('devBBBBBBBB');
    expect((await getDoc(doc(db, 'users', uid, 'devices', 'devAAAAAAAA'))).data()).toMatchObject({ isHomeBase: false, label: 'Mac mini' });
    await mod.devices.setDevicePush(uid, 'devBBBBBBBB', 'fid-123');
    expect((await getDoc(doc(db, 'users', uid, 'devices', 'devBBBBBBBB'))).data()).toMatchObject({ fcmToken: 'fid-123', isHomeBase: true, label: 'Laptop' });
    await mod.devices.setDevicePush(uid, 'devBBBBBBBB', null);
    expect((await getDoc(doc(db, 'users', uid, 'devices', 'devBBBBBBBB'))).data()).not.toHaveProperty('fcmToken');
    await mod.devices.clearHomeBase(uid, 'devBBBBBBBB');
    expect((await getDoc(doc(db, 'users', uid))).data()).not.toHaveProperty('homeBaseDeviceId');
    expect((await getDoc(doc(db, 'users', uid, 'devices', 'devBBBBBBBB'))).data()!.isHomeBase).toBe(false);
  });
});
