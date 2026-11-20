// Realtime Database rules tests: docs/spec/30-relay-server.md section 17.5 R11 and 60 section 3.8.
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// emulators:exec sets these; the defaults are the ports in firebase.json.
function hostPort(value: string | undefined, fallback: number): { host: string; port: number } {
  const [host, port] = (value ?? `127.0.0.1:${fallback}`).split(':');
  return { host: host || '127.0.0.1', port: Number(port) || fallback };
}

let env: RulesTestEnvironment;
const TIMESTAMP = { '.sv': 'timestamp' };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sieve',
    database: { rules: readFileSync('database.rules.json', 'utf8'), ...hostPort(process.env.FIREBASE_DATABASE_EMULATOR_HOST, 9000) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
});

const online = { state: 'online', isHomeBase: true, lastChanged: TIMESTAMP };

describe('R11 presence', () => {
  it('the owner sets and clears its own presence; reads only its own', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(db.ref('presence/alice/device-aaaa').set(online));
    await assertSucceeds(db.ref('presence/alice/device-aaaa').onDisconnect().set({ ...online, state: 'offline' }));
    await assertSucceeds(db.ref('presence/alice').get());
    await assertSucceeds(db.ref('presence/alice/device-aaaa').remove());
  });

  it('another uid, an extra child, a bad state, a far-future time, anonymous and signed-out writes fail', async () => {
    const alice = env.authenticatedContext('alice').database();
    await assertFails(env.authenticatedContext('bob').database().ref('presence/alice/device-aaaa').set(online));
    await assertFails(env.authenticatedContext('bob').database().ref('presence/alice').get());
    await assertFails(alice.ref('presence/alice/device-aaaa').set({ ...online, ip: '1.2.3.4' }));
    await assertFails(alice.ref('presence/alice/device-aaaa').set({ ...online, state: 'busy' }));
    await assertFails(alice.ref('presence/alice/device-aaaa').set({ ...online, lastChanged: Date.now() + 3_600_000 }));
    await assertFails(alice.ref('presence/alice/device-aaaa').set({ state: 'online' }));
    await assertFails(alice.ref('presence/alice/x').set(online));
    const anon = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous', identities: {} } });
    await assertFails(anon.database().ref('presence/alice/device-aaaa').set(online));
    await assertFails(env.unauthenticatedContext().database().ref('presence/alice/device-aaaa').set(online));
    await assertFails(alice.ref('other/thing').set(1));
    await assertFails(alice.ref('/').get());
  });
});
