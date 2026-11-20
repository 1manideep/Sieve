import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { isBuildMode, MODES } from './scripts/modes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url)); // the package is "type": "module"

// 50 section 12.2. Modes: dev | release | store (scripts/modes.mjs); build.mjs passes the mode.
export default defineConfig(({ mode }) => {
  if (!isBuildMode(mode)) throw new Error(`unknown mode ${mode}`);
  const m = MODES[mode];
  return {
    root: resolve(__dirname, 'src'),
    publicDir: resolve(__dirname, 'public'),
    plugins: [react()],
    define: {
      __BUILD_MODE__: JSON.stringify(mode),
      __APP_URL__: JSON.stringify(m.appUrl),
      __ALLOWED_ORIGINS__: JSON.stringify(m.origins),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir: resolve(__dirname, m.out),
      emptyOutDir: true,
      target: 'chrome116',
      minify: false, // reviewable build (50 section 10.3)
      sourcemap: mode === 'dev',
      modulePreload: { polyfill: false }, // no inline script and no fetch() in the panel page
      assetsInlineLimit: 0, // never inline fonts or images as data: URLs; the CSP allows 'self' only
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'src/background.ts'),
          sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    server: { fs: { allow: [resolve(__dirname, '..')] } },
  };
});
