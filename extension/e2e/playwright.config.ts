import { defineConfig } from '@playwright/test';

// 50 section 14.2. The stub home base is served on port 5173 (the dev manifest trusts http://localhost:5173 only),
// so stop the web dev server before running this suite.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  outputDir: '../test-results/e2e',
  use: { headless: true },
  webServer: {
    command: 'node serve-stub.mjs',
    url: 'http://localhost:5173/__health',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
