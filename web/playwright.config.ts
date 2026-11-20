// Playwright for the web app (40 section 19). The Playground and /prepare run against the dev server with the AI
// layer's e2e model seam (e2e/fixtures); Google-account and relay flows run in 60's suite.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --mode e2e --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Vite reads VITE_ variables from the environment too, so no .env.e2e file is needed. VITE_SIEVE_E2E turns on the
    // AI layer's model seam (60 section 3.9.1): Playwright's Chromium has no Gemini Nano, so availability and model
    // output come from window.__sieveE2E, set by e2e/fixtures/stubs.ts, while Sieve's real code runs around them.
    env: { VITE_E2E: 'true', VITE_USE_EMULATORS: 'true', VITE_SIEVE_E2E: '1' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'narrow',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
      testMatch: /playground-.*\.spec\.ts/,
    },
  ],
});
