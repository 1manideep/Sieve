import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { MODES } from './scripts/modes.mjs';

// 60 section 3.4: node environment; component files start with `// @vitest-environment jsdom`.
// The build-time constants take their dev values (50 section 4.3).
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_MODE__: JSON.stringify('dev'),
    __APP_URL__: JSON.stringify(MODES.dev.appUrl),
    __ALLOWED_ORIGINS__: JSON.stringify(MODES.dev.origins),
  },
  test: {
    name: 'extension',
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    restoreMocks: true,
  },
});
