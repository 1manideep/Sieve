#!/usr/bin/env node
// usage: node scripts/build.mjs --mode dev|release|store [--watch]   (50 section 12.3)
// 1. Vite build. 2. Manifest per mode (version from package.json; release and store trust the hosted app only;
// store drops "key"). 3. Write <out>/manifest.json. 4. lint-dist (skipped in --watch). 5. Print mode, output and id.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { deriveExtensionId } from './ext-id.mjs';
import { lintDist } from './lint-dist.mjs';
import { isBuildMode, MODES, transformManifest } from './modes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string[]} argv */
function parseArgs(argv) {
  const at = argv.indexOf('--mode');
  const mode = at === -1 ? undefined : argv[at + 1];
  if (!mode || !isBuildMode(mode)) {
    console.error('usage: node scripts/build.mjs --mode dev|release|store [--watch]');
    process.exit(2);
  }
  return { mode, watch: argv.includes('--watch') };
}

/** @param {import('./modes.mjs').BuildMode} mode */
function writeManifest(mode) {
  const source = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const manifest = transformManifest(source, mode, version);
  const out = join(ROOT, MODES[mode].out);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

async function main() {
  const { mode, watch } = parseArgs(process.argv.slice(2));
  const result = await build({
    configFile: join(ROOT, 'vite.config.ts'),
    mode,
    logLevel: 'warn',
    build: watch ? { watch: {} } : {},
  });

  if (watch) {
    // Rollup watcher: rewrite the manifest after every rebuild (Vite empties the folder first).
    const watcher = /** @type {import('rollup').RollupWatcher} */ (result);
    watcher.on('event', (e) => {
      if (e.code === 'END') {
        const { out } = writeManifest(mode);
        console.log(`build: ${mode} rebuilt -> ${relative(ROOT, out)}`);
      }
    });
    return;
  }

  const { out, manifest } = writeManifest(mode);
  const problems = lintDist(out);
  if (problems.length) {
    console.error(`lint-dist: ${relative(ROOT, out)} failed`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const id = typeof manifest.key === 'string' ? deriveExtensionId(manifest.key) : '(store build: no key, the store assigns the same id)';
  console.log(`build: ${mode} -> ${relative(ROOT, out)} (lint-dist ok), extension id ${id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
