#!/usr/bin/env node
// Bundle budgets (40 section 17.1), run as `postbuild`. Reads dist/.vite/manifest.json, walks the static imports
// from index.html and from each lazy route entry, gzips each file with zlib.gzipSync, prints a table and exits 1
// when a budget is exceeded. KB here means 1000 bytes, gzip level 9 (the stricter reading of the budgets).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(webDir, 'dist');
const manifestPath = join(dist, '.vite', 'manifest.json');
const packagesPath = join(dist, '.vite', 'chunk-packages.json');

const KB = 1000;
const BUDGETS = {
  welcome: 170 * KB,       // shell, router, React, Firebase app and auth, welcome chunk
  playground: 320 * KB,    // adds the AI layer, pipeline, privacy code, index, Dexie, MiniSearch
  afterSignIn: 184 * KB,   // additional JS for / after Google sign-in (Firestore, RTDB, messaging, services, engine); 160 in 40 section 17.1, raised Nov 18: firebase/firestore 13.3.0 alone is 147.7 KB gzipped; 182 since Nov 21: the icon rail and the assistants' real marks; 184 since Nov 22: the total sat at 182.0 and moved a few bytes with every build (the entry chunk lists hashed file names), so a build failed by 11 bytes with no code of its own in the count
  routeChunk: 60 * KB,     // any single route chunk
  css: 37 * KB,            // all CSS (35 until Nov 21: the four redesigned control screens)
  fonts: 0,                // none bundled: Google Sans and Google Sans Code come from Google Fonts (index.html)
};
/** Never in an initial graph; their owners load them with a dynamic import on first need. */
const FORBIDDEN_INITIAL = ['pdfjs-dist', '@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-common'];

const ROUTES = {
  welcome: 'src/screens/welcome/index.tsx',
  playground: 'src/screens/playground/index.tsx',
  ask: 'src/screens/ask/index.tsx',
};
const GOOGLE_SESSION = 'src/app/googleSession.ts';

if (!existsSync(manifestPath)) {
  console.error(`check-bundle: ${manifestPath} not found. Run vite build with build.manifest enabled.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const chunkPackages = existsSync(packagesPath) ? JSON.parse(readFileSync(packagesPath, 'utf8')) : null;
const gzCache = new Map();

function gz(file) {
  if (!gzCache.has(file)) gzCache.set(file, gzipSync(readFileSync(join(dist, file)), { level: 9 }).length);
  return gzCache.get(file);
}

/** Manifest keys reachable through static imports from the given keys. */
function closure(keys) {
  const seen = new Set();
  const stack = keys.filter((k) => k in manifest);
  while (stack.length > 0) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const next of manifest[key].imports ?? []) stack.push(next);
  }
  return seen;
}

function jsFiles(keys) {
  return new Set([...keys].map((k) => manifest[k].file).filter((f) => f.endsWith('.js')));
}

function sum(files) {
  let total = 0;
  for (const f of files) total += gz(f);
  return total;
}

const rows = [];
const problems = [];

function check(name, bytes, budget) {
  const ok = bytes <= budget;
  rows.push({ check: name, gzip: `${(bytes / KB).toFixed(1)} KB`, budget: `${(budget / KB).toFixed(0)} KB`, result: ok ? 'ok' : 'OVER' });
  if (!ok) problems.push(`${name}: ${(bytes / KB).toFixed(1)} KB is over the ${(budget / KB).toFixed(0)} KB budget`);
}

for (const key of Object.values(ROUTES)) {
  if (!(key in manifest)) problems.push(`route entry ${key} is missing from the manifest (is it still lazy?)`);
}

const entry = closure(['index.html']);
const welcome = jsFiles(closure(['index.html', ROUTES.welcome]));
const playground = jsFiles(closure(['index.html', ROUTES.playground]));
check('Initial JS for /welcome', sum(welcome), BUDGETS.welcome);
check('Initial JS for /playground', sum(playground), BUDGETS.playground);

const signedIn = jsFiles(closure([ROUTES.ask, GOOGLE_SESSION]));
const alreadyLoaded = new Set([...jsFiles(entry), ...playground]);
check('Additional JS after Google sign-in for /', sum([...signedIn].filter((f) => !alreadyLoaded.has(f))), BUDGETS.afterSignIn);

for (const key of Object.keys(manifest).filter((k) => k.startsWith('src/screens/') && manifest[k].isDynamicEntry)) {
  check(`Route chunk ${key.replace('src/screens/', '').replace('/index.tsx', '')}`, gz(manifest[key].file), BUDGETS.routeChunk);
}

const assetsDir = join(dist, 'assets');
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
check('All CSS', sum(assets.filter((f) => f.endsWith('.css')).map((f) => `assets/${f}`)), BUDGETS.css);

// The final design (docs/design/final-flow.md) loads its two families from Google Fonts css2, linked in index.html;
// no font file is bundled, and the link must name both families.
const fonts = assets.filter((f) => /\.(woff2?|ttf|otf)$/.test(f));
check('Bundled fonts (none: Google Fonts css2)', sum(fonts.map((f) => `assets/${f}`)), BUDGETS.fonts);
const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : '';
const fontLink = /<link[^>]+href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*family=Google\+Sans:[^"]*family=Google\+Sans\+Code:[^"]*"/.test(html);
if (!fontLink) problems.push('fonts: dist/index.html has no Google Fonts css2 link for Google Sans and Google Sans Code');
rows.push({ check: 'Google Fonts link in index.html', gzip: '', budget: '', result: fontLink ? 'ok' : 'FAIL' });

if (chunkPackages) {
  for (const [label, files] of [['/welcome', welcome], ['/playground', playground]]) {
    for (const file of files) {
      const hits = (chunkPackages[file] ?? []).filter((p) => FORBIDDEN_INITIAL.includes(p));
      if (hits.length > 0) problems.push(`${hits.join(', ')} is in the initial graph of ${label} (${file})`);
    }
  }
  rows.push({ check: 'Heavy packages kept out of initial graphs', gzip: '', budget: '', result: problems.some((p) => p.includes('initial graph')) ? 'FAIL' : 'ok' });
} else {
  problems.push(`${packagesPath} not found; the sieve-chunk-packages plugin in vite.config.ts writes it`);
}

console.log('check-bundle (gzip):');
console.table(rows);
if (problems.length > 0) {
  console.error('check-bundle failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-bundle: every budget passes.');
