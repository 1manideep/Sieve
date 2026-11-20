#!/usr/bin/env node
// The bench and video stack (60 section 4.7), in one terminal with prefixed logs:
//   1. firebase emulators:start --project $SIEVE_PROJECT_ID --only auth,firestore,database,functions
//   2. npm run dev -w web -- --mode bench   (reads the git-ignored web/.env.bench.local)
// The real project id is used so the web app's config and the functions share one emulator
// namespace; Firestore, Auth, Realtime Database and Functions are all emulated. Ctrl-C stops both.
// SIEVE_PROJECT_ID comes from the environment or from bench/.env.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function envFromFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function fail(message) {
  console.error(`bench:stack: ${message}`);
  process.exit(1);
}

const projectId = (process.env.SIEVE_PROJECT_ID || envFromFile(join(root, 'bench', '.env')).SIEVE_PROJECT_ID || '').trim();
if (!projectId) fail('Set SIEVE_PROJECT_ID (the real Firebase project id) in the environment or in bench/.env.');
if (!/^[a-z0-9-]{4,40}$/.test(projectId)) fail(`"${projectId}" does not look like a Firebase project id.`);

const firebaseBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase');
if (!existsSync(firebaseBin)) fail('The local firebase binary is missing. Run npm install at the repo root first.');
if (!existsSync(join(root, 'functions', '.secret.local'))) {
  fail('functions/.secret.local is missing (copy functions/.secret.local.example and fill in RATCHET_BROKER_SECRET).');
}
if (!existsSync(join(root, 'web', '.env.bench.local'))) {
  fail('web/.env.bench.local is missing (VITE_USE_EMULATORS=1, VITE_RELAY_FROM_PLAYGROUND=1, the VITE_FIREBASE_* config, the local App Check debug token).');
}

const children = [];
let stopping = false;

function run(name, command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`[${name}] ${line}`));
  }
  child.on('exit', (code, signal) => {
    console.log(`[${name}] exited${signal ? ` on ${signal}` : ` with code ${code}`}`);
    stopAll(code ?? 1);
  });
  children.push(child);
  return child;
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log(`bench:stack: emulators for project ${projectId}, web dev server in bench mode. Ctrl-C stops both.`);
run('emulators', firebaseBin, ['emulators:start', '--project', projectId, '--only', 'auth,firestore,database,functions']);
run('web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '-w', 'web', '--', '--mode', 'bench']);
