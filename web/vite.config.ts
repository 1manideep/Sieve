import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Vendor chunks (40 section 17.2). Firestore, RTDB, messaging and functions stay out of the first load. */
const CHUNKS: [name: string, pattern: RegExp][] = [
  ['react', /\/node_modules\/(react|react-dom|react-router|react-router-dom|@remix-run\/router|scheduler|zustand|use-sync-external-store)\//],
  ['firebase-ai', /\/node_modules\/(firebase\/(ai|app-check)|@firebase\/(ai|app-check))\//],
  ['firebase-firestore', /\/node_modules\/(firebase\/firestore|@firebase\/firestore|@firebase\/webchannel-wrapper)\//],
  ['firebase-rtdb', /\/node_modules\/(firebase\/database|@firebase\/database)\//],
  ['firebase-messaging', /\/node_modules\/(firebase\/messaging|@firebase\/(messaging|installations))\//],
  ['firebase-functions', /\/node_modules\/(firebase\/functions|@firebase\/functions)\//],
  ['firebase-core', /\/node_modules\/(firebase\/(app|auth)|@firebase\/(app|auth|component|logger|util)|idb)\//],
];

/**
 * App modules with a chunk of their own. The Playground tab's extension port (relay/playgroundBridge.ts, 50 section 11)
 * is imported by the Playground screen and, later, by its lazily loaded assistant code. Left to Rollup it lands inside
 * the screen's chunk, the later chunk then imports that chunk, and the screen stops being a keyed route entry in the
 * manifest (which scripts/check-bundle.mjs reads for the /playground budget).
 */
const APP_CHUNKS: [name: string, pattern: RegExp][] = [['playground-bridge', /\/src\/relay\/playgroundBridge\.ts$/]];

function manualChunks(id: string): string | undefined {
  const path = id.replaceAll('\\', '/');
  for (const [name, pattern] of CHUNKS) if (pattern.test(path)) return name;
  for (const [name, pattern] of APP_CHUNKS) if (pattern.test(path)) return name;
  return undefined;
}

/** The npm package a module id belongs to, or undefined for app code. */
function packageOf(id: string): string | undefined {
  const matches = [...id.replaceAll('\\', '/').matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
  return matches.at(-1)?.[1];
}

/**
 * Writes dist/.vite/chunk-packages.json: the npm packages inside each output chunk.
 * scripts/check-bundle.mjs reads it to prove that heavy packages stay out of the first load (40 section 17.1).
 */
function chunkPackages(): Plugin {
  return {
    name: 'sieve-chunk-packages',
    apply: 'build',
    generateBundle(_options, bundle) {
      const out: Record<string, string[]> = {};
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== 'chunk') continue;
        const packages = new Set<string>();
        for (const id of item.moduleIds) {
          const name = packageOf(id);
          if (name) packages.add(name);
        }
        out[fileName] = [...packages].sort();
      }
      this.emitFile({ type: 'asset', fileName: '.vite/chunk-packages.json', source: JSON.stringify(out, null, 2) });
    },
  };
}

/**
 * The messaging service worker (40 section 10.6): web/sw/firebase-messaging-sw.template.js with the Firebase version
 * and the public web config filled in, served at /firebase-messaging-sw.js in dev and emitted unhashed in the build.
 */
function sieveMessagingSw(env: Record<string, string>): Plugin {
  const fileName = 'firebase-messaging-sw.js';
  const render = (): string => {
    const template = readFileSync(new URL('./sw/firebase-messaging-sw.template.js', import.meta.url), 'utf8');
    const firebasePkg = createRequire(import.meta.url).resolve('firebase/package.json');
    const { version } = JSON.parse(readFileSync(firebasePkg, 'utf8')) as { version: string };
    const config = {
      apiKey: env.VITE_FIREBASE_API_KEY ?? '',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
      projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
      appId: env.VITE_FIREBASE_APP_ID ?? '',
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    };
    return template
      .split('\n')
      .filter((line) => !line.startsWith('/* global '))   // the lint hint for the placeholders, not needed in the output
      .join('\n')
      .replaceAll('__FIREBASE_VERSION__', version)
      .replaceAll('__FIREBASE_CONFIG__', JSON.stringify(config));
  };
  return {
    name: 'sieve-messaging-sw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${fileName}`) return next();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(render());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: render() });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  if (mode === 'production' && env.VITE_APPCHECK_DEBUG_TOKEN) {
    throw new Error('VITE_APPCHECK_DEBUG_TOKEN must not be set for a production build');
  }

  return {
    plugins: [react(), chunkPackages(), sieveMessagingSw(env)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // onnxruntime-web's build without the wasm bundled in: the ML worker loads the runtime at run time from /ort/
      // (env.ts wasmPaths; scripts/fetch-models.mjs copies it there), so no unused 21 MB wasm lands in dist/assets.
      conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    worker: { format: 'es' },   // the ML worker (web/src/ml) is an ES module worker
    server: {
      port: 5173,
      // Playwright's server (--mode e2e) serves one snapshot of the code: a file saved during a run must not reload
      // the page under a test. Dependency-optimizer reloads still reach the page over the HMR socket.
      ...(mode === 'e2e' ? { watch: null } : {}),
      // Same-origin /mcp in dev, as Hosting gives in production: the functions emulator answers a cross-origin
      // preflight with 405. /mcp/<secret> goes to the emulated function, which reads the secret from /<secret>.
      proxy: {
        '/mcp': {
          target: 'http://127.0.0.1:5001',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/mcp/, `/${env.VITE_FIREBASE_PROJECT_ID || 'demo-sieve'}/us-central1/mcp`),
        },
      },
    },
    build: {
      manifest: true,
      rollupOptions: {
        output: { manualChunks },
      },
    },
  };
});
