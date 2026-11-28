import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __EXTENSION_VERSION__: JSON.stringify('0.0.0-test'),
  },
  // Tests never read web/.env.local: the folder below holds no .env files, and test.env sets fake values.
  envDir: fileURLToPath(new URL('./src/test', import.meta.url)),
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    env: {
      VITE_FIREBASE_API_KEY: 'test-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-sieve.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-sieve',
      VITE_FIREBASE_APP_ID: 'test-app-id',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'test-sender-id',
      VITE_FIREBASE_DATABASE_URL: 'http://127.0.0.1:9000/?ns=demo-sieve-default-rtdb',
      VITE_FCM_VAPID_KEY: 'test-vapid-key',
      VITE_REPO_URL: 'https://example.com/sieve',
      VITE_USE_EMULATORS: 'false',
    },
  },
});
