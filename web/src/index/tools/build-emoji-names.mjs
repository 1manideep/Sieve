// Builds web/src/index/emoji-names.json from unicode-emoji-json@0.9.0 (MIT): { [emoji]: name }, names only
// (20 section 7.5). Run from the repo root: node web/src/index/tools/build-emoji-names.mjs
// Also copies the package's MIT licence next to the output as emoji-names.LICENSE.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('unicode-emoji-json/package.json'));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
if (pkg.version !== '0.9.0') throw new Error(`Expected unicode-emoji-json 0.9.0, found ${pkg.version}`);

const source = JSON.parse(readFileSync(join(pkgDir, 'data-by-emoji.json'), 'utf8'));
const out = {};
for (const [emoji, entry] of Object.entries(source)) out[emoji] = entry.name;
writeFileSync(join(here, '..', 'emoji-names.json'), JSON.stringify(out) + '\n');
writeFileSync(join(here, '..', 'emoji-names.LICENSE'), readFileSync(join(pkgDir, 'LICENSE'), 'utf8'));
console.log(`emoji-names.json: ${Object.keys(out).length} entries (source has ${Object.keys(source).length})`);
