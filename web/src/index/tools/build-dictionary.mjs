// Builds web/src/index/dict/en-words.tsv, the English word list for typo correction (20 section 9.2).
//
// Source: SCOWL (Kevin Atkinson, see dict/Copyright), American spelling, sizes up to 50 ("medium"), as
// published in the npm package wordlist-english@1.2.1 (SCOWL 2016 data). The SCOWL v2 `scowl word-list`
// tool named in 20 section 9.2 gives the same sizes; to switch, change SOURCES below to read its output.
// Sizes 10, 20 and 35 are written as level 35 (common), 40 and 50 as level 50.
//
// Run: npm pack wordlist-english@1.2.1, unpack it, then
//   node web/src/index/tools/build-dictionary.mjs <path to the unpacked package folder>
//
// The SCOWL lists in that package leave out words with apostrophes and a few informal words, so a small
// supplement (contractions without their apostrophe, and informal words people type into a search box)
// is added at level 35. Lines are `word<TAB>35` or `word<TAB>50`, lowercase ASCII letters only, sorted.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) throw new Error('Pass the folder of the unpacked wordlist-english package.');

const SOURCES = [
  [35, ['english-words-10', 'english-words-20', 'english-words-35', 'american-words-10', 'american-words-20', 'american-words-35']],
  [50, ['english-words-40', 'english-words-50', 'american-words-40', 'american-words-50']],
];

const SUPPLEMENT = (
  'dont doesnt didnt cant couldnt wont wouldnt shouldnt isnt arent wasnt werent hasnt havent hadnt mustnt ' +
  'im ive youre youve youd youll hes shes theyre theyve theyd theyll weve whats whos wheres whens hows whys ' +
  'thats theres heres lets aint yall ok pic pics selfie selfies screenshot screenshots wifi inbox app apps ' +
  'emails email online offline login logins signup url urls pdf pdfs doc docs'
).split(' ');

const levels = new Map();
for (const [level, files] of SOURCES) {
  for (const file of files) {
    const words = JSON.parse(readFileSync(join(src, `${file}.json`), 'utf8'));
    for (const raw of words) {
      const w = raw.toLowerCase().replace(/'/g, '');
      if (!/^[a-z]+$/.test(w)) continue;
      levels.set(w, Math.min(levels.get(w) ?? 99, level));
    }
  }
}
for (const w of SUPPLEMENT) levels.set(w, 35);

const lines = [...levels.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([w, l]) => `${w}\t${l}`);
writeFileSync(join(here, '..', 'dict', 'en-words.tsv'), lines.join('\n') + '\n');
copyFileSync(join(src, 'Copyright'), join(here, '..', 'dict', 'Copyright'));
const common = lines.filter((l) => l.endsWith('\t35')).length;
console.log(`en-words.tsv: ${lines.length} words (${common} at level 35, ${lines.length - common} at level 50)`);
