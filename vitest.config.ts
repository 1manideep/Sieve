import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: [
      'shared',
      'web',
      'extension',
      { test: { name: 'rules', include: ['tests/rules/**/*.test.ts'], environment: 'node', testTimeout: 20_000 } },
    ],
  },
});
