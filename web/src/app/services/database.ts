// The Realtime Database instance (40 sections 4.2 and 11.4): created on first use, emulator when the flag is set.
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';
import { EMULATOR_HOST, EMULATOR_PORTS, getFirebaseApp } from '@/app/firebase';
import { env, requireEnv } from '@/app/env';

let instance: Database | undefined;

export function rtdb(): Database {
  if (!instance) {
    instance = getDatabase(getFirebaseApp(), requireEnv('databaseURL'));
    if (env.useEmulators) connectDatabaseEmulator(instance, EMULATOR_HOST, EMULATOR_PORTS.database);
  }
  return instance;
}

/** Test seam. */
export function setRtdbForTests(db: Database | undefined): void {
  instance = db;
}
