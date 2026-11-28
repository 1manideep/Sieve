#!/usr/bin/env node
// Builds the extension's release build and zips it into web/public/downloads/sieve-extension-<version>.zip, so the
// site serves the same extension people load unpacked (manifest at the zip root, with the key: same id as the store
// item, so the web app's bridge finds it). Run by `npm run ext:zip`, wired into prebuild. The folder is git-ignored.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(webDir, '..', 'extension');
const outDir = join(webDir, 'public', 'downloads');
const { version } = JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8'));

execFileSync(process.execPath, [join(extDir, 'scripts', 'build.mjs'), '--mode', 'release'], { cwd: extDir, stdio: 'inherit' });

const dist = join(extDir, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
if (manifest.version !== version) throw new Error(`extension-zip: dist is ${manifest.version}, package.json says ${version}`);
if (typeof manifest.key !== 'string') throw new Error('extension-zip: the release manifest must carry the key (same id)');

mkdirSync(outDir, { recursive: true });
for (const old of readdirSync(outDir)) if (/^sieve-extension-.*\.zip$/.test(old)) rmSync(join(outDir, old));
const target = join(outDir, `sieve-extension-${version}.zip`);
execFileSync('zip', ['-r', '-X', '-q', target, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`extension-zip: public/downloads/sieve-extension-${version}.zip (${Math.round(statSync(target).size / 1000)} KB)`);
