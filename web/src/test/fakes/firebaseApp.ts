// Fake `firebase/app`: vi.mock('firebase/app', () => import('@/test/fakes/firebaseApp')).
import { vi } from 'vitest';

export const initializeApp = vi.fn((options: object) => ({ name: '[DEFAULT]', options, automaticDataCollectionEnabled: false }));
