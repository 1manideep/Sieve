// Firebase app and Auth (40 section 4.2). Firestore, Realtime Database, Messaging and Functions are never imported
// here: their instances are created on first use in app/services/* and relay/*, which only Google-session code loads.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { env } from './env';

/** Must match firebase.json "emulators". */
export const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, database: 9000, functions: 5001 } as const;

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

/** App + Auth + the AI layer's init (App Check). Idempotent. Never Firestore here. */
export function initFirebase(): FirebaseApp {
  if (app) return app;
  app = initializeApp({
    apiKey: env.firebase.apiKey,
    authDomain: env.firebase.authDomain,
    projectId: env.firebase.projectId,
    appId: env.firebase.appId,
    messagingSenderId: env.firebase.messagingSenderId || undefined,
    databaseURL: env.firebase.databaseURL || undefined,
  });
  auth = getAuth(app);
  if (env.useEmulators) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
  }
  startAi(app);
  return app;
}

export function getFirebaseApp(): FirebaseApp {
  return app ?? initFirebase();
}

export function getAuthInstance(): Auth {
  if (!auth) initFirebase();
  return auth as Auth;
}

/**
 * Calls the AI layer's initAi(app) (40 CR-2), which sets up App Check before any model call.
 * The AI layer is loaded with a dynamic import so it stays out of the /welcome bundle (40 section 17.1);
 * /playground and / load it in their own route graphs.
 */
function startAi(firebaseApp: FirebaseApp): void {
  import('@/ai')
    .then(({ initAi }) => initAi(firebaseApp))
    .catch((error: unknown) => {
      console.error('The AI layer did not start.', error);
    });
}
