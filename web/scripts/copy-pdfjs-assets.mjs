#!/usr/bin/env node
// Copies pdf.js's CMaps and standard fonts into web/public/pdfjs/ so the PDF reader (20 section 16) never fetches
// them from a CDN. Run by `npm run assets:pdfjs`, wired into predev and prebuild. The folder is git-ignored.
import { cp, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json', { paths: [webDir] }));

const targets = [
  ['cmaps', 'cmaps'],
  ['standard_fonts', 'standard_fonts'],
];

for (const [src, dest] of targets) {
  const from = join(pdfjsDir, src);
  const to = join(webDir, 'public', 'pdfjs', dest);
  await stat(from);
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: true });
  console.log(`copy-pdfjs-assets: ${src} -> public/pdfjs/${dest}`);
}
