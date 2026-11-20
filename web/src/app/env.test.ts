import { describe, expect, it } from 'vitest';
import { MissingEnvError, readEnv, type EnvSource } from './env';

const BOOT: EnvSource = {
  apiKey: 'key',
  authDomain: 'demo-sieve.firebaseapp.com',
  projectId: 'demo-sieve',
  appId: 'app',
};

describe('readEnv', () => {
  it('throws a readable error naming the missing variable', () => {
    const { projectId: _omit, ...rest } = BOOT;
    expect(() => readEnv(rest)).toThrow('Missing VITE_FIREBASE_PROJECT_ID. Copy web/.env.example to web/.env.local.');
    expect(() => readEnv(rest)).toThrow(MissingEnvError);
  });

  it('names every missing boot variable at once', () => {
    expect(() => readEnv({})).toThrow(
      'Missing VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID. Copy web/.env.example to web/.env.local.',
    );
  });

  it('treats blank values as missing', () => {
    expect(() => readEnv({ ...BOOT, appId: '  ' })).toThrow('Missing VITE_FIREBASE_APP_ID.');
  });

  it('reads the emulator and e2e flags as "true" or "1"', () => {
    expect(readEnv({ ...BOOT, useEmulators: 'true' }).useEmulators).toBe(true);
    expect(readEnv({ ...BOOT, useEmulators: '1' }).useEmulators).toBe(true);
    expect(readEnv({ ...BOOT, useEmulators: 'false' }).useEmulators).toBe(false);
    expect(readEnv(BOOT).useEmulators).toBe(false);
    expect(readEnv({ ...BOOT, sieveE2e: '1' }).e2e).toBe(true);
    expect(readEnv({ ...BOOT, e2e: 'true' }).e2e).toBe(true);
    expect(readEnv({ ...BOOT, e2e: '', sieveE2e: '' }).e2e).toBe(false);
  });

  it('defaults the functions region and leaves the extension off', () => {
    const env = readEnv(BOOT);
    expect(env.functionsRegion).toBe('us-central1');
    expect(env.extensionId).toBeUndefined();
    expect(readEnv({ ...BOOT, extensionId: 'abcdefghijklmnopabcdefghijklmnop' }).extensionId).toBe('abcdefghijklmnopabcdefghijklmnop');
  });
});
