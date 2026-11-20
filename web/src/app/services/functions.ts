// The Cloud Functions instance (40 section 10.5): region from VITE_FUNCTIONS_REGION, emulator when the flag is set.
// Only callables use it, so it loads when Settings or "What has AI seen?" first calls one.
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { EMULATOR_HOST, EMULATOR_PORTS, getFirebaseApp } from '@/app/firebase';
import { env } from '@/app/env';

let instance: Functions | undefined;

export function functionsInstance(): Functions {
  if (!instance) {
    instance = getFunctions(getFirebaseApp(), env.functionsRegion);
    if (env.useEmulators) connectFunctionsEmulator(instance, EMULATOR_HOST, EMULATOR_PORTS.functions);
  }
  return instance;
}

/** Test seam. */
export function setFunctionsForTests(fns: Functions | undefined): void {
  instance = fns;
}
