#!/usr/bin/env node
// Zips the release and store builds into ../artifacts/ with the manifest at the zip root (50 section 12.5).
//   artifacts/sieve-extension-<version>.zip         from extension/dist        (load unpacked; has key, same id)
//   artifacts/sieve-extension-<version>-store.zip   from extension/dist-store  (Web Store upload; no key)
// Run `npm audit --omit=dev` before uploading a release (50 section 10.1).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// SIEVE_ARTIFACTS_DIR overrides the output folder (used to check the script without touching the repo root).
const ARTIFACTS = process.env.SIEVE_ARTIFACTS_DIR ?? join(ROOT, '..', 'artifacts');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const jobs = [
  { from: join(ROOT, 'dist'), name: `sieve-extension-${version}.zip`, keyed: true },
  { from: join(ROOT, 'dist-store'), name: `sieve-extension-${version}-store.zip`, keyed: false },
];

mkdirSync(ARTIFACTS, { recursive: true });
for (const job of jobs) {
  const manifestPath = join(job.from, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`zip: ${job.from} has no manifest.json; run the release and store builds first`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== version) {
    console.error(`zip: ${job.from} was built for ${manifest.version}, package.json says ${version}`);
    process.exit(1);
  }
  // The release zip must carry the key (same id as the store item); the store zip must not.
  if (job.keyed !== (typeof manifest.key === 'string')) {
    console.error(`zip: ${job.from} ${job.keyed ? 'is missing' : 'must not have'} the manifest key`);
    process.exit(1);
  }
  const target = join(ARTIFACTS, job.name);
  rmSync(target, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', target, '.'], { cwd: job.from, stdio: 'inherit' });
  console.log(`zip: ${job.name}`);
}
