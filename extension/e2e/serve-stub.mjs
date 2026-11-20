#!/usr/bin/env node
// Serves e2e/stub/ on port 5173 for the extension e2e tests, on both 127.0.0.1 and ::1 (50 section 14.2).
// /__health answers 200. Refuses to start when 5173 is taken (for example by `npm run dev`).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5173;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'stub');
/** @type {Record<string, string>} */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

/** @param {string} host @returns {Promise<import('node:http').Server>} */
function listen(host) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => void handle(req, res));
    server.once('error', reject);
    server.listen({ port: PORT, host, exclusive: true }, () => resolve(server));
  });
}

try {
  await listen('127.0.0.1');
} catch (e) {
  const code = /** @type {{ code?: string }} */ (e).code;
  console.error(code === 'EADDRINUSE'
    ? `serve-stub: port ${PORT} is taken. Stop the web dev server (npm run dev) before npm run e2e:ext.`
    : `serve-stub: cannot listen on 127.0.0.1:${PORT} (${code ?? e})`);
  process.exit(1);
}
try {
  await listen('::1');
} catch (e) {
  const code = /** @type {{ code?: string }} */ (e).code;
  if (code === 'EADDRINUSE') {
    console.error(`serve-stub: port ${PORT} is taken on ::1. Stop the web dev server before npm run e2e:ext.`);
    process.exit(1);
  }
  // No IPv6 on this machine: 127.0.0.1 is enough.
}
console.log(`serve-stub: http://localhost:${PORT}/`);
