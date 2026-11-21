#!/usr/bin/env node
/* eslint-disable no-control-regex -- the dataset checks look for control characters on purpose */
// Repository checks, `npm run check:repo` (docs/spec/60-testing-bench-submission.md section 3.12).
// Node only, no dependencies. Fails with a list of problems; warnings do not fail unless --strict.
//
// Sections 1 to 7: item 3, sample data (60 section 5.8, 20 section 20 A-DS-1, the bench task and canary
// consistency of 60 section 4.15) and item 4 for the data folders.
// Sections 8 to 14, over the files git would commit (tracked plus new, not ignored): item 1 secrets and
// .env files, item 2 the LICENSE hash and its README link, item 4 sizes, item 5 claims (60 section 4.12),
// no em or en dashes in the public text (40 section 1, 60 section 6.4), item 6 the production bundle
// (only when web/dist exists) and item 7 commit emails (a note, never a failure, even with --strict).
// Allowlisted fake values may live in scripts/check-repo.allow.json, each entry with a reason.
//
//   node scripts/check-repo.mjs            every check; placeholders and pending name checks warn
//   node scripts/check-repo.mjs --strict   the same, and every warning fails (use before submission)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'playground');
const STRICT = process.argv.includes('--strict');
const problems = [];
const warnings = [];
const notes = [];
const rel = (p) => relative(ROOT, p) || '.';
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const warn = (where, msg) => (STRICT ? problems : warnings).push(`${where}: ${msg}`);
/** Information that never fails the check, even with --strict (60 section 3.12 item 7 is "warning only"). */
const note = (where, msg) => notes.push(`${where}: ${msg}`);

// ---------------------------------------------------------------- constants (01 section 1, 20 section 18.1)

const CATEGORIES = ['Home', 'Work', 'Money', 'Health', 'Travel', 'Shopping', 'Personal', 'Newsletters', 'Photos'];
const DEFAULT_RULES = { Home: 'approve', Work: 'approve', Money: 'ask-first', Health: 'never', Travel: 'approve',
  Shopping: 'approve', Personal: 'approve', Newsletters: 'approve', Photos: 'approve' };
const PREVIEW_CHARS = 280;
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const COUNTS = { emails: 30, documents: 6, photos: 10 };
const PII_TYPES = ['email', 'phone', 'card', 'iban', 'ssn', 'account', 'name', 'address', 'dob', 'other'];
const ALEX = 'Alex Rivera <alex.rivera@inbox.example>';
const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

// 60 section 5.2: published test card numbers and example IBANs that may appear.
const TEST_CARDS = new Set(['4111111111111111', '4242424242424242', '4000056655665556', '5555555555554444',
  '5500000000000004', '2223003122003222', '378282246310005', '371449635398431', '6011111111111117',
  '6011000990139424', '3530111333300000', '30569309025904', '4012888888881881']);
const EXAMPLE_IBANS = new Set(['GB82WEST12345698765432', 'DE89370400440532013000', 'NL91ABNA0417164300',
  'FR1420041010050500013M02606', 'ES9121000418450200051332', 'IT60X0542811101000000123456', 'BE68539007547034']);

// 20 A-DS-1 and 60 section 5.3: names used in earlier drafts and spikes, plus scripts/brand-denylist.txt.
const DENYLIST = ['Contoso', 'Northwind', 'HomeGoods', 'FreshCart', 'Oakview', 'First Harbor', 'Skyline Air',
  'Harbor Inn', 'Shopwell', 'Gadget Hub', 'PayFriend', 'ParcelPoint', 'Notely', 'AI Weekly', 'Bright Smile',
  'Lakeside Medical', 'CornerCare', 'Northbeam', 'Riverside', 'Lakeshore Credit Union'];
// 60 section 5.3: no real brand in the data. A short list of well-known names, matched as whole words.
const REAL_BRANDS = ['Amazon', 'Walmart', 'Costco', 'PayPal', 'Venmo', 'Zelle', 'Chase', 'Wells Fargo',
  'Bank of America', 'Citibank', 'Capital One', 'American Express', 'Visa', 'Mastercard', 'Delta', 'United Airlines',
  'American Airlines', 'Southwest', 'Alaska Airlines', 'Hilton', 'Marriott', 'Hyatt', 'Airbnb', 'Uber', 'Lyft', 'FedEx',
  'UPS', 'USPS', 'DHL', 'Gmail', 'Google', 'Outlook', 'Microsoft', 'Apple', 'iPhone', 'Netflix', 'Spotify', 'Slack',
  'GitHub', 'Zoom', 'CVS', 'Walgreens', 'Kaiser', 'Comcast', 'Xfinity', 'ComEd', 'Nextdoor', 'Notion', 'Evernote',
  'Best Buy', 'REI', 'Patagonia', 'Etsy', 'eBay', 'Instacart', 'DoorDash', 'Target', 'OpenAI', 'ChatGPT', 'Chrome',
  'Firebase', 'Gemini'];

// ---------------------------------------------------------------- small helpers

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(rel(path), existsSync(path) ? `not valid JSON (${e.message})` : 'missing');
    return undefined;
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['.venv', 'node_modules', '__pycache__', 'originals', '.DS_Store', '.pytest_cache'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const TEXT_EXT = new Set(['.json', '.txt', '.md', '.html', '.htm', '.csv', '.eml', '.py', '.mjs', '.js', '.ts']);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stringsOf(value, skipKeys, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsOf(v, skipKeys, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!skipKeys.has(k)) stringsOf(v, skipKeys, out);
  }
  return out;
}

/** The text of a file to scan for identifiers: JSON string values (not numbers or hashes), else the file. */
function scanText(path) {
  const raw = readFileSync(path, 'utf8');
  if (extname(path) !== '.json') return raw;
  try {
    return stringsOf(JSON.parse(raw), new Set(['contentHash', 'textHash', 'v'])).join('\n');
  } catch {
    return raw;
  }
}

function luhn(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}

function ibanValid(s) {
  if (s.length < 15 || s.length > 34) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let m = 0;
  for (const ch of r) {
    const val = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of val) m = (m * 10 + Number(d)) % 97;
  }
  return m === 1;
}

// 11 section 6.2, exactly.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const ISO_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2})$/;
const chicagoOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'longOffset' });

function checkSeedDate(where, iso) {
  const m = ISO_OFFSET.exec(iso ?? '');
  if (!m) { fail(where, `date ${JSON.stringify(iso)} is not ISO 8601 with an offset`); return NaN; }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) { fail(where, `date ${iso} does not parse`); return NaN; }
  const tz = chicagoOffset.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (tz.replace('GMT', '') !== m[7]) fail(where, `date ${iso}: Chicago's offset at that moment is ${tz.replace('GMT', '')}`);
  const year = Number(m[1]);
  if (year < 2025 || year > 2026) fail(where, `date ${iso} is outside 2025 to 2026 (60 section 5.2)`);
  return ms;
}

// ---------------------------------------------------------------- image readers (JPEG, PNG)

function jpegSegments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  const segs = [];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`bad marker at ${i}`);
    let marker = buf[i + 1];
    i += 2;
    while (marker === 0xff) marker = buf[i++];
    if (marker === 0xd9 || marker === 0xda) { segs.push({ marker }); break; }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    const len = buf.readUInt16BE(i);
    segs.push({ marker, data: buf.subarray(i + 2, i + len) });
    i += len;
  }
  return segs;
}

function jpegInfo(buf) {
  const segs = jpegSegments(buf);
  const sof = segs.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker));
  const app1 = segs.filter((s) => s.marker === 0xe1);
  const exif = app1.find((s) => s.data.subarray(0, 6).toString('latin1') === 'Exif\0\0');
  const xmp = app1.find((s) => s.data.subarray(0, 29).toString('latin1') === 'http://ns.adobe.com/xap/1.0/\0');
  return {
    width: sof ? sof.data.readUInt16BE(3) : 0,
    height: sof ? sof.data.readUInt16BE(1) : 0,
    exif: exif ? parseTiff(exif.data.subarray(6)) : null,
    xmp: xmp ? xmp.data.subarray(29).toString('utf8') : null,
    otherApp: segs.filter((s) => s.marker >= 0xe2 && s.marker <= 0xef).map((s) => s.marker.toString(16)),
  };
}

function parseTiff(t) {
  const le = t.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  function ifd(off) {
    const n = u16(off);
    const tags = new Map();
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (SIZES[type] ?? 1) * count;
      const at = size <= 4 ? e + 8 : u32(e + 8);
      let value;
      if (type === 2) value = t.toString('latin1', at, at + count).replace(/\0+$/, '');
      else if (type === 3) value = Array.from({ length: count }, (_, j) => u16(at + 2 * j));
      else if (type === 4) value = Array.from({ length: count }, (_, j) => u32(at + 4 * j));
      else if (type === 5) value = Array.from({ length: count }, (_, j) => u32(at + 8 * j) / u32(at + 8 * j + 4));
      else value = t.subarray(at, at + size);
      tags.set(tag, value);
    }
    return { tags, next: u32(off + 2 + n * 12) };
  }
  const ifd0 = ifd(u32(4));
  const exifIfd = ifd0.tags.has(0x8769) ? ifd(ifd0.tags.get(0x8769)[0]).tags : new Map();
  const gpsIfd = ifd0.tags.has(0x8825) ? ifd(ifd0.tags.get(0x8825)[0]).tags : new Map();
  return { ifd0: ifd0.tags, exif: exifIfd, gps: gpsIfd, hasIfd1: ifd0.next !== 0 };
}

function pngInfo(buf) {
  if (buf.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG');
  const chunks = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    chunks.push(buf.toString('latin1', i + 4, i + 8));
    i += 12 + len;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), chunks };
}

// ---------------------------------------------------------------- load the dataset

const emailsDoc = readJson(join(DATA, 'emails.json'));
const documents = readJson(join(DATA, 'documents', 'documents.json'));
const photos = readJson(join(DATA, 'photos', 'photos.json'));
const captions = readJson(join(DATA, 'captions.json'));
const questions = readJson(join(DATA, 'questions.json'));
const manifest = readJson(join(DATA, 'manifest.json'));
const bundle = readJson(join(DATA, 'seed-bundle.json'));
if (!emailsDoc || !documents || !photos || !captions || !questions || !manifest || !bundle) {
  report();
}
const emails = emailsDoc.emails ?? [];
const seeds = new Map();            // seed id -> { kind, category, seed }
const seedDates = new Map();        // seed id -> epoch ms

// ---------------------------------------------------------------- 1. counts, ids, shapes of the seed files

function keysOnly(where, obj, allowed, required) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(where, `unknown field "${k}"`);
  for (const k of required) if (!(k in obj)) fail(where, `missing "${k}"`);
}

if (emailsDoc.version !== 1) fail('emails.json', 'version must be 1');
if (emails.length !== COUNTS.emails) fail('emails.json', `${emails.length} emails, expected ${COUNTS.emails}`);
emails.forEach((e, i) => {
  const id = `pg-mail-${String(i + 1).padStart(2, '0')}`;
  const where = `emails.json ${e.id}`;
  if (e.id !== id) fail(where, `expected id ${id} (ids are sequential)`);
  keysOnly(where, e, ['id', 'threadId', 'from', 'to', 'date', 'subject', 'category', 'sent', 'text', 'html'],
    ['id', 'threadId', 'from', 'to', 'date', 'subject', 'category']);
  if (!CATEGORIES.slice(0, 8).includes(e.category)) fail(where, `category ${e.category} is not an email category`);
  if (!e.text && !e.html) fail(where, 'needs text or html');
  const thread = i < 3 ? 'pg-thread-01' : `pg-thread-${id.slice(-2)}`;
  if (e.threadId !== thread) fail(where, `threadId should be ${thread}`);
  if (!['pg-mail-01', 'pg-mail-08'].includes(e.id) && e.to !== ALEX) fail(where, 'to should be Alex (20 section 19.1)');
  if (e.sent !== undefined && typeof e.sent !== 'boolean') fail(where, 'sent must be a boolean');
  seeds.set(e.id, { kind: 'email', category: e.category, seed: e });
  seedDates.set(e.id, checkSeedDate(where, e.date));
});
if (documents.length !== COUNTS.documents) fail('documents.json', `${documents.length} documents, expected ${COUNTS.documents}`);
documents.forEach((d, i) => {
  const where = `documents.json ${d.id}`;
  if (d.id !== `pg-doc-${String(i + 1).padStart(2, '0')}`) fail(where, 'ids must be sequential');
  keysOnly(where, d, ['id', 'file', 'kind', 'category', 'date'], ['id', 'file', 'kind', 'category', 'date']);
  if (!['document', 'note'].includes(d.kind)) fail(where, `kind ${d.kind}`);
  if (!CATEGORIES.slice(0, 8).includes(d.category)) fail(where, `category ${d.category}`);
  if (!existsSync(join(DATA, 'documents', d.file))) fail(where, `file documents/${d.file} is missing`);
  seeds.set(d.id, { kind: d.kind, category: d.category, seed: d });
  seedDates.set(d.id, checkSeedDate(where, d.date));
});
if (photos.length !== COUNTS.photos) fail('photos.json', `${photos.length} photos, expected ${COUNTS.photos}`);
photos.forEach((p, i) => {
  const where = `photos.json ${p.id}`;
  if (p.id !== `pg-photo-${String(i + 1).padStart(2, '0')}`) fail(where, 'ids must be sequential');
  keysOnly(where, p, ['id', 'file', 'date', 'hadGps', 'gps', 'place', 'description'], ['id', 'file', 'date', 'hadGps', 'description']);
  if (p.hadGps !== Boolean(p.gps)) fail(where, 'gps must be given exactly when hadGps is true');
  seeds.set(p.id, { kind: 'photo', category: 'Photos', seed: p });
  seedDates.set(p.id, checkSeedDate(where, p.date));
});
const categoriesUsed = new Set([...seeds.values()].map((s) => s.category));
for (const c of CATEGORIES) if (!categoriesUsed.has(c)) fail('dataset', `no item in category ${c}`);
const countCat = (c) => [...seeds.values()].filter((s) => s.category === c).length;
if (countCat('Money') < 3) fail('dataset', 'at least 3 Money items are required');
if (countCat('Health') < 3) fail('dataset', 'at least 3 Health items are required');
if (!emails.some((e, i) => i > 0 && e.threadId === emails[0].threadId)) fail('emails.json', 'no multi-message thread');

if (manifest.counts) {
  const c = manifest.counts;
  if (c.emails !== emails.length || c.documents !== documents.length || c.photos !== photos.length
    || c.records !== emails.length + documents.length + photos.length) fail('manifest.json', 'counts do not match the data');
}

// ---------------------------------------------------------------- 2. weekdays and the story's dates (A-DS-1)

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function checkWeekdays(where, text, itemMs) {
  const re = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s+(\d{4}))?/g;
  for (const m of text.matchAll(re)) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    const day = Number(m[3]);
    let year = m[4] ? Number(m[4]) : null;
    if (!year) {
      const ref = new Date(itemMs);
      const cands = [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1];
      year = cands.sort((a, b) => Math.abs(Date.UTC(a, month, day) - itemMs) - Math.abs(Date.UTC(b, month, day) - itemMs))[0];
    }
    const actual = WEEKDAYS[new Date(Date.UTC(year, month, day)).getUTCDay()];
    if (actual !== m[1]) fail(where, `"${m[0]}" but ${m[2]} ${day}, ${year} is a ${actual}`);
  }
}

// ---------------------------------------------------------------- 3. the seed bundle (01 IndexRecord, 20 section 18.2)

const byRef = new Map();
if (bundle.version !== manifest.seedVersion) fail('seed-bundle.json', `version ${bundle.version} differs from manifest seedVersion ${manifest.seedVersion}`);
if (bundle.model !== EMBEDDING_MODEL) fail('seed-bundle.json', `model must be ${EMBEDDING_MODEL}`);
if (typeof bundle.createdAt !== 'string') fail('seed-bundle.json', 'createdAt must be a string');
if (!Array.isArray(bundle.vectors)) fail('seed-bundle.json', 'vectors must be an array');
else if (bundle.vectors.length === 0) warn('seed-bundle.json', 'no vectors yet: run /dev/seed on the demo Mac (20 section 18.5); until then the app embeds the seeds after loading');
const RECORD_FIELDS = ['id', 'source', 'sourceRef', 'kind', 'title', 'from', 'threadId', 'date', 'preview', 'text', 'caption',
  'captionBy', 'photo', 'category', 'categoryBy', 'hiddenRemoved', 'injection', 'pii', 'sizeBytes', 'indexedAt',
  'contentHash', 'version', 'sourceModifiedAt', 'mentionedDays', 'enrich', 'privacyScan'];
const REQUIRED = ['id', 'source', 'sourceRef', 'kind', 'title', 'date', 'preview', 'category', 'categoryBy', 'hiddenRemoved',
  'pii', 'sizeBytes', 'indexedAt', 'contentHash', 'version'];
const records = bundle.records ?? [];
if (records.length !== seeds.size) fail('seed-bundle.json', `${records.length} records, expected ${seeds.size}`);
const canaryItems = new Set();
const canariesPath = join(ROOT, 'bench', 'canaries.json');
const canaries = existsSync(canariesPath) ? readJson(canariesPath)?.items ?? [] : [];
canaries.forEach((c) => canaryItems.add(c.item_id));

for (const r of records) {
  const where = `seed-bundle ${r.id}`;
  keysOnly(where, r, RECORD_FIELDS, REQUIRED);
  if (r.id !== `${r.source}:${r.sourceRef}` || r.source !== 'playground') fail(where, "id must be 'playground:' + the seed id");
  const s = seeds.get(r.sourceRef);
  if (!s) { fail(where, 'no seed entry with this id'); continue; }
  byRef.set(r.sourceRef, r);
  const seed = s.seed;
  if (r.kind !== (s.kind === 'email' ? 'email' : s.kind)) fail(where, `kind ${r.kind}, seed says ${s.kind}`);
  if (r.category !== s.category || r.categoryBy !== 'seed') fail(where, "category must be the seed's, categoryBy 'seed'");
  if (r.version !== 1) fail(where, 'version must be 1');
  if (!Number.isInteger(r.indexedAt) || !Number.isInteger(r.date)) fail(where, 'date and indexedAt are epoch ms integers');
  if (r.date !== seedDates.get(r.sourceRef)) fail(where, 'date differs from the seed date');
  if (r.preview.length > PREVIEW_CHARS || !r.preview) fail(where, `preview must be 1 to ${PREVIEW_CHARS} UTF-16 units`);
  if (r.title.length > 300 || !r.title) fail(where, 'title must be 1 to 300 units');
  if (!/^[0-9a-f]{64}$/.test(r.contentHash)) fail(where, 'contentHash must be SHA-256 hex');
  if (r.mentionedDays && (!Array.isArray(r.mentionedDays) || r.mentionedDays.length > 30 || r.mentionedDays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))) {
    fail(where, 'mentionedDays must be at most 30 YYYY-MM-DD strings');
  }
  let body;
  if (s.kind === 'email') {
    const e = seed;
    if (r.title !== e.subject.replace(/\s+/g, ' ').trim()) fail(where, 'title differs from the subject');
    if (r.from !== e.from || r.threadId !== e.threadId) fail(where, 'from or threadId differs from the seed');
    const hash = sha256(JSON.stringify([e.id, e.subject, e.from ?? '', Date.parse(e.date), e.html ?? null, e.text ?? null, 'full']));
    if (r.contentHash !== hash) fail(where, 'contentHash does not match the seed email (20 section 5.2); run tools/build.py');
    if (r.sizeBytes !== Buffer.byteLength(e.html ?? e.text ?? '', 'utf8')) fail(where, 'sizeBytes does not match the seed email');
    if (typeof r.text !== 'string') fail(where, 'emails need text');
    body = r.text ?? '';
    checkWeekdays(`emails.json ${e.id}`, `${e.text ?? ''}\n${e.html ?? ''}`, r.date);
  } else if (s.kind === 'photo') {
    const p = seed;
    const file = join(DATA, 'photos', p.file);
    if (r.title !== p.file) fail(where, 'title must be the file name');
    if (existsSync(file)) {
      const bytes = readFileSync(file);
      if (r.contentHash !== sha256(bytes) || r.sizeBytes !== bytes.length) fail(where, 'contentHash or sizeBytes does not match the photo file; run tools/build.py');
    }
    if (r.caption !== captions[p.id]?.caption || r.captionBy !== 'seed') fail(where, "caption must equal captions.json, captionBy 'seed'");
    if (r.preview !== r.caption) fail(where, 'a photo preview is its caption');
    if ('text' in r) fail(where, 'photos have no text');
    const m = r.photo ?? {};
    keysOnly(`${where}.photo`, m, ['takenAt', 'place', 'width', 'height', 'mime', 'hadGps'], ['width', 'height', 'mime', 'hadGps']);
    if (m.takenAt !== r.date || m.hadGps !== p.hadGps || (m.place ?? null) !== (p.place ?? null)) fail(where, 'photo meta differs from photos.json');
    body = r.caption ?? '';
  } else {
    const d = seed;
    const file = join(DATA, 'documents', d.file);
    if (r.title !== d.file) fail(where, 'title must be the file name');
    if (existsSync(file)) {
      const bytes = readFileSync(file);
      if (r.contentHash !== sha256(bytes) || r.sizeBytes !== bytes.length) fail(where, 'contentHash or sizeBytes does not match the file; run tools/build.py');
      if (extname(file) !== '.pdf') checkWeekdays(`documents/${d.file}`, bytes.toString('utf8'), r.date);
    }
    if (typeof r.text !== 'string') fail(where, 'documents need text');
    body = r.text ?? '';
  }
  // PII spans: offsets in UTF-16 units into the scanned text (11 section 6.1).
  for (const sp of r.pii ?? []) {
    if (!Number.isInteger(sp.start) || !Number.isInteger(sp.end) || sp.start < 0 || sp.end <= sp.start || sp.end > body.length) {
      fail(where, `pii span ${JSON.stringify(sp)} is outside the text`);
      continue;
    }
    if (!PII_TYPES.includes(sp.type) || !['validator', 'model', 'nano'].includes(sp.by)) fail(where, `pii span ${JSON.stringify(sp)} has a bad type or by`);
    const t = body.slice(sp.start, sp.end);
    const ok = { email: /@/.test(t), phone: (t.match(/\d/g) ?? []).length >= 7, address: /^(\d|P)/.test(t), name: /^\p{Lu}/u.test(t) }[sp.type];
    if (ok === false) fail(where, `pii span "${t}" does not look like a ${sp.type}`);
  }
  // Hidden text never reaches the record text (11 S4) and injection findings match the canaries.
  for (const h of r.hiddenRemoved ?? []) {
    if (typeof h !== 'string') fail(where, 'hiddenRemoved holds strings');
    else if (h.length >= 12 && body.includes(h)) fail(where, `hidden fragment is still in the text: "${h.slice(0, 60)}"`);
  }
  const inj = r.injection;
  if (!inj || typeof inj.suspicious !== 'boolean' || !['code', 'nano'].includes(inj.by)) fail(where, 'injection finding missing or malformed');
  else if (inj.suspicious !== canaryItems.has(r.sourceRef) && canaryItems.size) {
    fail(where, inj.suspicious ? 'flagged as an injection but is not a canary item' : 'a canary item that is not flagged');
  }
  // privacyScan and enrich (01 section 2, 11 section 2.3).
  const ps = r.privacyScan;
  if (!ps || typeof ps.textHash !== 'string' || !ps.pii || !ps.injection || !Array.isArray(ps.headerEntities)) fail(where, 'privacyScan missing or malformed');
  else {
    const expect = cyrb53(body + '\u0000' + (r.hiddenRemoved ?? []).join('\u0001')).toString(36);
    if (ps.textHash !== expect) fail(where, `privacyScan.textHash ${ps.textHash} should be ${expect} (11 section 6.2)`);
    for (const [k, st] of [...Object.entries(ps.pii), ...Object.entries(ps.injection)]) {
      if (!['validators', 'model', 'nano', 'code'].includes(k) || typeof st.version !== 'string' || !['code', 'device', 'cloud'].includes(st.ran)
        || typeof st.ms !== 'number' || !Number.isInteger(st.at)) fail(where, `privacyScan stage ${k} is malformed`);
    }
  }
  const marks = r.enrich ?? {};
  for (const [k, mk] of Object.entries(marks)) {
    if (!['label', 'caption'].includes(k) || mk.by !== 'seed' || !Number.isInteger(mk.v) || !Number.isInteger(mk.at)) fail(where, `enrich.${k} must be a seed mark`);
  }
  if (!marks.label || (s.kind === 'photo' && !marks.caption)) fail(where, 'seeds carry enrich marks for label (and caption for photos)');
}

// PDFs: the text in the file equals its source (20 section 19.3).
for (const d of documents) {
  if (extname(d.file) !== '.pdf') continue;
  const src = join(DATA, 'documents', 'src', basename(d.file, '.pdf') + '.txt');
  const pdf = join(DATA, 'documents', d.file);
  if (!existsSync(src)) { fail(`documents/${d.file}`, 'its source documents/src/*.txt is missing'); continue; }
  if (!existsSync(pdf)) continue;
  const raw = readFileSync(pdf).toString('latin1');
  const runs = [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const source = readFileSync(src, 'utf8');
  if (norm(runs.join(' ')) !== norm(source)) fail(`documents/${d.file}`, 'its text differs from its source; run tools/build.py');
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(source)) fail(`documents/src/${basename(src)}`, 'PDF sources must be plain ASCII');
  checkWeekdays(`documents/src/${basename(src)}`, source, seedDates.get(d.id));
  const rec = byRef.get(d.id);
  if (rec && !norm(rec.text ?? '').includes(norm(source).slice(0, 40))) fail(`seed-bundle ${rec.id}`, 'text does not start like the PDF source');
}

// ---------------------------------------------------------------- 4. photos, thumbnails and their metadata (60 section 5.4, 5.8 item 4)

const placeholders = new Set(manifest.photos?.placeholders ?? []);
for (const p of photos) {
  const where = `photos/${p.file}`;
  const file = join(DATA, 'photos', p.file);
  if (!existsSync(file)) { fail(where, 'missing'); continue; }
  const buf = readFileSync(file);
  const rec = byRef.get(p.id);
  if (buf.length > 600_000) fail(where, `${buf.length} bytes; at most 600 KB`);
  if (placeholders.has(p.file) && buf.length > 150_000) fail(where, 'placeholders stay under 150 KB');
  let info;
  try {
    info = extname(file).toLowerCase() === '.png' ? { ...pngInfo(buf), kind: 'png' } : { ...jpegInfo(buf), kind: 'jpeg' };
  } catch (e) {
    fail(where, e.message);
    continue;
  }
  if (Math.max(info.width, info.height) > 1600) fail(where, `${info.width} x ${info.height}; the long edge is at most 1600 px`);
  if (rec?.photo && (rec.photo.width !== info.width || rec.photo.height !== info.height
    || rec.photo.mime !== (info.kind === 'png' ? 'image/png' : 'image/jpeg'))) fail(where, 'width, height or mime differs from the seed record');
  if (info.kind === 'png') {
    const meta = info.chunks.filter((c) => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(c));
    if (meta.length) fail(where, `PNG metadata chunks ${meta.join(', ')}; PNGs carry none`);
    if (p.hadGps || p.place) fail(where, 'a PNG cannot carry the GPS or place photos.json gives');
  } else {
    const ex = info.exif;
    if (!ex) fail(where, 'no EXIF: the build writes the made-up date (and GPS)');
    else {
      const allowed = { ifd0: [0x010f, 0x0131, 0x8769, 0x8825], exif: [0x9003], gps: [1, 2, 3, 4] };
      for (const part of ['ifd0', 'exif', 'gps']) {
        for (const tag of ex[part].keys()) if (!allowed[part].includes(tag)) fail(where, `EXIF ${part} tag 0x${tag.toString(16)} is not in the manifest`);
      }
      if (ex.hasIfd1) fail(where, 'EXIF carries a thumbnail IFD');
      if (ex.ifd0.get(0x010f) !== 'Sieve Playground' || ex.ifd0.get(0x0131) !== 'sieve-playground-build') fail(where, 'EXIF Make or Software is not the build value');
      const local = p.date.slice(0, 19).replace('T', ' ').replace(/-/g, ':');
      if (ex.exif.get(0x9003) !== local) fail(where, `EXIF DateTimeOriginal ${ex.exif.get(0x9003)} should be ${local}`);
      if (p.hadGps) {
        const dec = (dms, ref) => (dms[0] + dms[1] / 60 + dms[2] / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1);
        const lat = ex.gps.has(2) ? dec(ex.gps.get(2), ex.gps.get(1)) : NaN;
        const lon = ex.gps.has(4) ? dec(ex.gps.get(4), ex.gps.get(3)) : NaN;
        if (!(Math.abs(lat - p.gps.lat) < 1e-4 && Math.abs(lon - p.gps.lon) < 1e-4)) fail(where, `EXIF GPS ${lat}, ${lon} differs from photos.json ${p.gps.lat}, ${p.gps.lon}`);
      } else if (ex.gps.size) fail(where, 'GPS in EXIF but hadGps is false');
    }
    const city = info.xmp ? /photoshop:City="([^"]*)"/.exec(info.xmp)?.[1] : undefined;
    if ((city ?? null) !== (p.place ?? null)) fail(where, `XMP city ${city ?? 'none'} differs from photos.json place ${p.place ?? 'none'}`);
    if (info.otherApp.length) fail(where, `extra APP segments ${info.otherApp.join(', ')}`);
  }
  const thumb = join(DATA, 'photos', 'thumbs', basename(p.file, extname(p.file)) + '.jpg');
  if (!existsSync(thumb)) fail(where, `thumbnail ${rel(thumb)} is missing`);
  else {
    try {
      const t = jpegInfo(readFileSync(thumb));
      if (Math.max(t.width, t.height) !== Math.min(320, Math.max(info.width, info.height))) fail(rel(thumb), `long edge ${Math.max(t.width, t.height)}, expected 320`);
      if (t.exif || t.xmp) fail(rel(thumb), 'thumbnails carry no metadata');
    } catch (e) {
      fail(rel(thumb), e.message);
    }
  }
}

// captions.json (20 section 19.1)
for (const p of photos) {
  const c = captions[p.id];
  if (!c) { fail('captions.json', `no caption for ${p.id}`); continue; }
  keysOnly(`captions.json ${p.id}`, c, ['caption', 'captionBy', 'madeBy', 'madeAt'], ['caption', 'captionBy', 'madeBy', 'madeAt']);
  if (c.captionBy !== 'seed' || !['nano-on-device', 'hand-written'].includes(c.madeBy)) fail(`captions.json ${p.id}`, "captionBy 'seed', madeBy 'nano-on-device' or 'hand-written'");
  if (!c.caption || c.caption.length > 300) fail(`captions.json ${p.id}`, 'one sentence, at most 300 units');
}
for (const k of Object.keys(captions)) if (!photos.some((p) => p.id === k)) fail('captions.json', `caption for unknown photo ${k}`);

// SOURCES.md: one row per photo with a source and a licence (00 D10, 60 section 5.7).
const sourcesPath = join(DATA, 'SOURCES.md');
const sourcesMd = existsSync(sourcesPath) ? readFileSync(sourcesPath, 'utf8') : '';
if (!sourcesMd) fail('data/playground/SOURCES.md', 'missing');
const LICENCE_OK = /^(Apache-2\.0|CC0(-1\.0)?|Public domain|CC-BY(-SA)?-[34]\.0|CC BY(-SA)? [34]\.0|Unsplash License|Pexels License|Pixabay Content License)\b/i;
for (const p of photos) {
  const row = sourcesMd.split('\n').find((l) => l.startsWith('|') && l.split('|')[1]?.trim() === `photos/${p.file}`);
  const where = `SOURCES.md photos/${p.file}`;
  if (!row) { fail(where, 'no row for this photo'); continue; }
  const [, , shows, source, licence] = row.split('|').map((c) => c.trim());
  if (!shows || !source || !licence) fail(where, 'needs what it shows, a source and a licence');
  else if (!LICENCE_OK.test(licence) || /\b(NC|ND|NonCommercial|NoDerivatives)\b/i.test(licence)) fail(where, `licence "${licence}" does not allow reuse in a public repo`);
  const isPlaceholderRow = /placeholder/i.test(source);
  if (isPlaceholderRow !== placeholders.has(p.file)) fail(where, isPlaceholderRow ? 'marked placeholder, but the build used an original' : 'the build still drew a placeholder for this file');
  if (isPlaceholderRow) warn(where, 'still a placeholder: replace it with a free-to-use picture before submission (photos/README.md)');
}

// NAMES.md: every sender domain belongs to a listed name (60 section 5.3 and 5.8 item 6).
const namesPath = join(DATA, 'NAMES.md');
const namesMd = existsSync(namesPath) ? readFileSync(namesPath, 'utf8') : '';
if (!namesMd) fail('data/playground/NAMES.md', 'missing');
const nameRows = namesMd.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l)).slice(1).map((l) => l.split('|').map((c) => c.trim()));
const listedDomains = new Set(nameRows.flatMap((r) => (r[3] ?? '').split(/[,\s]+/).filter((d) => d.includes('.'))));
for (const e of emails) {
  for (const addr of [e.from, e.to]) {
    const domain = /@([^>\s]+)>?$/.exec(addr ?? '')?.[1];
    if (domain && !listedDomains.has(domain)) fail('NAMES.md', `sender or recipient domain ${domain} (${e.id}) is not listed`);
  }
}
const pendingNames = nameRows.filter((r) => /pending/i.test(r[5] ?? '')).map((r) => r[1]);
if (pendingNames.length) warn('NAMES.md', `${pendingNames.length} invented names are not checked yet (20 section 21.18)`);

// ---------------------------------------------------------------- 5. suggested questions and bench tasks (20 section 19.5, 60 section 4.15)

const allIds = (s) => [s.expectTop, ...(s.expectInTopK ?? []), ...(s.expectInTopKAnyOf ?? []), ...(s.distractors ?? [])].filter(Boolean);
const suggestionIds = new Set();
for (const s of questions.suggestions ?? []) {
  const where = `questions.json ${s.id}`;
  if (suggestionIds.has(s.id)) fail(where, 'duplicate id');
  suggestionIds.add(s.id);
  for (const id of allIds(s)) if (!seeds.has(id)) fail(where, `expected item ${id} does not exist`);
  if (!s.expectTop) {
    if (!s.dynamic) fail(where, 'needs expectTop, or dynamic for a question about an added item');
    continue;
  }
  const top = byRef.get(s.expectTop);
  if (s.expectInTopK?.length && !s.expectInTopK.includes(s.expectTop)) fail(where, 'expectTop must be among expectInTopK');
  if (s.category && seeds.get(s.expectTop)?.category !== s.category) fail(where, `${s.expectTop} is not in ${s.category}`);
  if (s.category && s.rule !== DEFAULT_RULES[s.category]) fail(where, `rule ${s.rule} is not the default for ${s.category}`);
  if (s.chunkMustCover && !(top?.text ?? '').includes(s.chunkMustCover)) fail(where, `"${s.chunkMustCover}" is not in ${s.expectTop}`);
}
for (const id of ['landlord', 'hotdog', 'bank', 'health', 'parcel', 'mytest', 'upload']) if (!suggestionIds.has(id)) fail('questions.json', `chip ${id} (40 section 13.9) is missing`);

function dateForms(ms, iso) {
  const m = ISO_OFFSET.exec(iso ?? '');
  if (!m) return [];
  const month = MONTHS[Number(m[2]) - 1];
  const M = month[0].toUpperCase() + month.slice(1);
  const d = Number(m[3]);
  return [`${M} ${d}`, `${M.slice(0, 3)} ${d}`, `${M} ${d}, ${m[1]}`, `${m[1]}-${m[2]}-${m[3]}`];
}
const tasksPath = join(ROOT, 'bench', 'tasks.json');
if (existsSync(tasksPath)) {
  const tasks = readJson(tasksPath)?.tasks ?? [];
  if (tasks.map((t) => t.id).join() !== Array.from({ length: 10 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`).join()) fail('bench/tasks.json', 'tasks must be T01 to T10');
  for (const t of tasks) {
    const where = `bench/tasks.json ${t.id}`;
    if (!t.item_id) {
      if (t.expect_kind !== 'not-found') fail(where, 'only a not-found task may have no item');
      continue;
    }
    const s = seeds.get(t.item_id);
    const r = byRef.get(t.item_id);
    if (!s || !r) { fail(where, `item ${t.item_id} is not in the dataset`); continue; }
    if (t.category && s.category !== t.category) fail(where, `item ${t.item_id} is ${s.category}, the task says ${t.category}`);
    const src = s.kind === 'document' && extname(s.seed.file) === '.pdf' ? readFileSync(join(DATA, 'documents', 'src', basename(s.seed.file, '.pdf') + '.txt'), 'utf8') : '';
    const hay = [r.title, r.text ?? '', s.seed.html ?? '', s.seed.text ?? '', r.caption ?? '', src, ...dateForms(r.date, s.seed.date)].join('\n').replace(/\s+/g, ' ').toLowerCase();
    for (const group of t.expect ?? []) {
      if (!group.some((alt) => hay.includes(alt.toLowerCase()))) fail(where, `none of ${JSON.stringify(group)} is in ${t.item_id}`);
    }
  }
}
for (const c of canaries) {
  const s = seeds.get(c.item_id);
  if (!s) { fail('bench/canaries.json', `item ${c.item_id} does not exist`); continue; }
  const raw = `${s.seed.html ?? ''}\n${s.seed.text ?? ''}`;
  for (const ph of c.phrases ?? []) if (!raw.includes(ph)) fail('bench/canaries.json', `phrase "${ph}" is not in ${c.item_id}`);
  for (const id of c.target_items ?? []) if (!seeds.has(id)) fail('bench/canaries.json', `target item ${id} does not exist`);
  const rec = byRef.get(c.item_id);
  if (rec && (c.phrases ?? []).some((ph) => (rec.text ?? '').includes(ph))) fail(`seed-bundle ${rec.id}`, 'a canary phrase is in the sanitized text');
}

// ---------------------------------------------------------------- 6. identifiers, names and dashes in every data file (60 section 5.8 items 1 to 3)

const scanRoots = [join(ROOT, 'data'), join(ROOT, 'e2e', 'fixtures'), join(ROOT, 'extension', 'e2e')];
const files = scanRoots.flatMap((d) => walk(d));
const ALLOWED_DOMAIN = (d) => /(^|\.)example\.(com|net|org)$/i.test(d) || /\.example$/i.test(d);
const denyExtra = existsSync(join(ROOT, 'scripts', 'brand-denylist.txt'))
  ? readFileSync(join(ROOT, 'scripts', 'brand-denylist.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const denyRe = new RegExp(`\\b(${[...DENYLIST, ...denyExtra].map(escapeRe).join('|')})\\b`, 'i');
const brandRe = new RegExp(`\\b(${REAL_BRANDS.map(escapeRe).join('|')})\\b`);
const isDataContent = (p) => p.startsWith(DATA) && !p.includes(`${join(DATA, 'tools')}`) && !['README.md', 'SOURCES.md', 'NAMES.md'].includes(basename(p));
let totalBytes = 0;
const sizeReported = new Set();
const wifiPassword = /\bwi-?fi\b\W+(?:\w+\W+){0,3}?password|\bpassword\b\W+(?:\w+\W+){0,3}?wi-?fi\b/i;

for (const file of files) {
  const size = statSync(file).size;
  totalBytes += size;
  const where = rel(file);
  if (size > 2 * 1024 * 1024) {
    fail(where, `${(size / 1048576).toFixed(1)} MB; tracked files stay under 2 MB (60 section 3.12 item 4)`);
    sizeReported.add(where);
  }
  if (!TEXT_EXT.has(extname(file).toLowerCase())) continue;
  const raw = readFileSync(file, 'utf8');
  if (raw.includes(EM_DASH) || raw.includes(EN_DASH)) fail(where, 'contains an em or en dash');
  const text = scanText(file);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
    if (!ALLOWED_DOMAIN(m[1])) fail(where, `email address ${m[0]} is not under a reserved domain`);
  }
  for (const m of text.matchAll(/\bhttps?:\/\/([A-Za-z0-9.-]+)/g)) {
    if (!ALLOWED_DOMAIN(m[1]) && file.startsWith(DATA) && isDataContent(file)) fail(where, `link to ${m[1]} is not under a reserved domain`);
  }
  for (const m of text.matchAll(/(?<![\d-])(?:\+?1[-.\s])?(?:\(\d{3}\)\s?|\d{3}[-.\s])(\d{3})[-.\s](\d{4})(?![\d-])/g)) {
    if (m[1] !== '555' || Number(m[2]) < 100 || Number(m[2]) > 199) fail(where, `phone number ${m[0]} is outside 555-0100 to 555-0199`);
  }
  for (const m of text.matchAll(/(?<![\d-])(\d{3})-(\d{4})(?![\d-])/g)) {
    if (m[1] !== '555' || Number(m[2]) < 100 || Number(m[2]) > 199) fail(where, `phone-like ${m[0]} is outside 555-0100 to 555-0199`);
  }
  for (const m of text.matchAll(/(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length >= 13 && luhn(d) && new Set(d).size > 1 && !TEST_CARDS.has(d)) fail(where, `card-like number ${m[0]} is not a published test number`);
  }
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g)) {
    const s = m[0].replace(/ /g, '');
    if (ibanValid(s) && !EXAMPLE_IBANS.has(s)) fail(where, `IBAN-like ${m[0]} is not a published example`);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{3})-(\d{2})-(\d{4})(?!\d)/g)) {
    if (!/^987-65-432\d$/.test(m[0])) fail(where, `SSN-like ${m[0]} is outside 987-65-4320 to 987-65-4329`);
  }
  if (isDataContent(file)) {
    const content = text.replace(/<!--[\s\S]*?-->/g, '');
    if (content.includes('--')) fail(where, 'contains "--" outside an HTML comment');
    const deny = denyRe.exec(text);
    if (deny) fail(where, `uses "${deny[1]}", a name from the brand denylist`);
    const brand = brandRe.exec(text);
    if (brand) fail(where, `uses "${brand[1]}", a real brand name (60 section 5.3)`);
    if (wifiPassword.test(text)) fail(where, 'mentions a wifi password (bench task T10 must have no answer)');
  }
}

// ---------------------------------------------------------------- 7. sizes and git-ignore (20 section 18.2, 60 section 3.12)

const bundleBytes = existsSync(join(DATA, 'seed-bundle.json')) ? statSync(join(DATA, 'seed-bundle.json')).size : 0;
if (bundleBytes > 300 * 1024) fail('seed-bundle.json', `${Math.round(bundleBytes / 1024)} KB; at most 300 KB (20 section 18.2)`);
const dataBytes = walk(DATA).reduce((n, f) => n + statSync(f).size, 0);
if (dataBytes > 8 * 1024 * 1024) fail('data/playground', `${(dataBytes / 1048576).toFixed(1)} MB; keep the Playground download small (20 section 18.3)`);
const gitignore = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim()) : [];
if (!gitignore.some((l) => l === '.venv/' || l === '.venv' || l === 'data/playground/tools/.venv/')) fail('.gitignore', 'data/playground/tools/.venv must be ignored');
if (!gitignore.includes('data/playground/photos/originals/')) fail('.gitignore', 'data/playground/photos/originals/ must be ignored (20 section 19.4)');

// ---------------------------------------------------------------- 8. the files git would commit (60 section 3.12)

/** Tracked files plus new files that are not ignored: everything the next commit can contain. */
function repoFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [...new Set(out.toString('utf8').split('\0').filter(Boolean))]
      .filter((f) => existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile())
      .sort();
  } catch (e) {
    fail('git ls-files', `could not list the repository files (${e.message.split('\n')[0]}); run inside a git clone`);
    return [];
  }
}
const repo = repoFiles();

/** A file's text, or null for binary files (a NUL byte in the first 8 KB). */
function textOf(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString('utf8');
}
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// scripts/check-repo.allow.json (optional): { "secrets": [{ file, rule?, match?, reason }], "env": [{ file, reason }],
// "sizes": [{ file, reason }] }. Every entry needs a reason. The built-in entries below follow the specs.
const ALLOW_PATH = join(ROOT, 'scripts', 'check-repo.allow.json');
const allowJson = existsSync(ALLOW_PATH) ? readJson(ALLOW_PATH) ?? {} : {};
const BUILT_IN_ALLOW = {
  secrets: [
    { file: 'docs/spec/60-testing-bench-submission.md', rule: 'service account', reason: 'section 3.12 quotes the pattern this check looks for' },
  ],
  env: [
    { file: 'functions/.env', reason: '30 section 2.3: the deployed function params, committed on purpose; checked below for secret-like names' },
    { file: 'functions/.env.demo-sieve', reason: '30 section 2.3: emulator values for the demo-sieve project; checked below for secret-like names' },
  ],
  sizes: [],
};
const allow = {};
for (const kind of ['secrets', 'env', 'sizes']) {
  const extra = Array.isArray(allowJson[kind]) ? allowJson[kind] : [];
  extra.forEach((entry, i) => {
    if (typeof entry?.file !== 'string' || typeof entry?.reason !== 'string' || !entry.reason.trim()) {
      fail('scripts/check-repo.allow.json', `${kind}[${i}] needs a "file" and a "reason"`);
    }
  });
  allow[kind] = [...BUILT_IN_ALLOW[kind], ...extra.filter((e) => typeof e?.file === 'string' && typeof e?.reason === 'string')];
}
const allowed = (kind, file, rule, match) =>
  allow[kind].some((e) => e.file === file && (e.rule === undefined || e.rule === rule) && (e.match === undefined || e.match === match));

// ---------------------------------------------------------------- 9. secrets and .env files (60 section 3.12 item 1)

// The Firebase web config (project id, app id, sender id, auth domain) is public and matches none of these. Web API
// keys stay out of the repo anyway (60 section 2.1 rule 1); a fake one goes in the allow file with a reason.
const SECRET_RULES = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['service account', /"type"\s*:\s*"service_account"/g],
  ['App Check debug token', /\b(?:FIREBASE|VITE)_APPCHECK_DEBUG_TOKEN\s*[:=]\s*['"]?[0-9a-fA-F-]{36}/g],
  ['connector link secret', /\/mcp\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g],   // 30 section 5: token_urlsafe(32)
  ['broker secret', /\bRATCHET_BROKER_SECRET\s*[:=]\s*['"]?[0-9a-f]{64}/g],  // 30 section 3
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g],
  ['OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}/g],
];
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_KEY|CREDENTIAL)/i;
const mask = (s) => `${s.slice(0, 8)}...`;
let scannedText = 0;

for (const file of repo) {
  const abs = join(ROOT, file);
  const name = basename(file);
  if (name.startsWith('.env')) {
    const isExample = name === '.env.example' || file === 'web/.env.e2e';
    if (!isExample && !allowed('env', file)) fail(file, 'a committed .env file; only .env.example files and web/.env.e2e may be tracked');
    const envText = readFileSync(abs, 'utf8');
    for (const [i, line] of envText.split('\n').entries()) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m || !SECRET_NAME.test(m[1])) continue;
      const value = m[2].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
      if (name === '.env.example' && value) fail(`${file}:${i + 1}`, `${m[1]} has a value; example files leave secrets empty`);
      else if (!isExample) fail(`${file}:${i + 1}`, `${m[1]} looks like a secret; it belongs in a git-ignored file or a Secret Manager param`);
    }
  }
  const text = textOf(abs);
  if (text === null) continue;
  scannedText += 1;
  for (const [rule, re] of SECRET_RULES) {
    for (const m of text.matchAll(re)) {
      if (allowed('secrets', file, rule, m[0])) continue;
      fail(`${file}:${lineAt(text, m.index)}`, `${rule} (${mask(m[0])}); remove it, rotate it, or allowlist a fake value with a reason`);
    }
  }
}

// ---------------------------------------------------------------- 10. LICENSE (60 section 3.12 item 2)

const LICENSE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
const licensePath = join(ROOT, 'LICENSE');
if (!existsSync(licensePath)) fail('LICENSE', 'missing');
else if (sha256(readFileSync(licensePath)) !== LICENSE_SHA256) fail('LICENSE', 'differs from the unmodified Apache-2.0 text committed on Nov 15');
else if (!repo.includes('LICENSE')) fail('LICENSE', 'not tracked by git');
const readmePath = join(ROOT, 'README.md');
const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
if (!readme) fail('README.md', 'missing');
else if (!/\]\((?:\.\/)?LICENSE\)/.test(readme.split('\n').slice(0, 5).join('\n'))) fail('README.md', 'the first 5 lines must link LICENSE');

// ---------------------------------------------------------------- 11. sizes (60 section 3.12 item 4)

for (const file of repo) {
  if (sizeReported.has(file) || allowed('sizes', file)) continue;
  const size = statSync(join(ROOT, file)).size;
  if (size > 2 * 1024 * 1024) fail(file, `${(size / 1048576).toFixed(1)} MB; tracked files stay under 2 MB unless allowlisted with a reason`);
}

// ---------------------------------------------------------------- 12. claims: no number until measured (60 section 4.12)

const BENCH_START = '<!-- bench:start -->';
const BENCH_END = '<!-- bench:end -->';
const LINE_MARKER = '<!-- bench -->';
const CLAIM_PATTERNS = [
  /\d[\d,.]*\s*(%|x\b|times\b)/i,
  /\b(fewer|less|more|smaller)\b.{0,40}\b(characters|emails|items|data)\b/i,
];
const NOT_MEASURED_BLOCK = [
  BENCH_START,
  '### The measured number',
  '',
  'Not measured yet. The method is described below; results appear here only after the bench has run.',
  BENCH_END,
].join('\n');

// bench/sieve_bench/report.py fmt(), human_date(), README_TEMPLATE and LINES_TEMPLATES, mirrored exactly.
function benchFmt(v) {
  if (v === null || v === undefined) return 'not measured';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? v.toLocaleString('en-US')
      : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return String(v);
}
function benchArm(data) {
  return new Proxy({}, {
    get(_, key) {
      if (!data || !(key in data)) throw new Error(`summary.json has no value for ${String(key)}`);
      return benchFmt(data[key]);
    },
  });
}
function benchDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return 'on an unknown date';
  const month = MONTHS[Number(m[2]) - 1];
  return `${month[0].toUpperCase()}${month.slice(1)} ${Number(m[3])}, ${m[1]}`;
}
function benchReadmeBlock(summary) {
  const b = benchArm(summary.b);
  const s = benchArm(summary.s);
  return `${BENCH_START}
### The measured number

Same assistant (${summary.model_id} through the Gemini API, temperature 0), same 10 tasks, same sample data. "Direct access" is a typical mail and files connector: search, then read whole items. ${summary.approval_line} Median of ${summary.n_runs} runs each, range in brackets. Measured ${benchDate(summary.date)}.

| What crossed into the outside model | Direct access | Sieve |
|---|---|---|
| Characters received | ${b.chars} [${b.chars_min} to ${b.chars_max}] | ${s.chars} [${s.chars_min} to ${s.chars_max}] |
| Whole items received | ${b.whole} | ${s.whole} |
| Excerpts received | ${b.excerpts} | ${s.excerpts} |
| Answer-only replies | ${b.answers} | ${s.answers} |
| Item summaries received | ${b.summaries} | ${s.summaries} |
| Items whose verbatim text reached the model | ${b.items} | ${s.items} |
| Health or Money items whose content reached the model (verbatim or as an approved answer) | ${b.private} | ${s.private} |
| Health or Money items listed in search results | ${b.private_listed} | ${s.private_listed} |
| Photos received | ${b.photos} | ${s.photos} |
| Tasks where the hidden instruction reached the model | ${b.inj} of 10 | ${s.inj} of 10 |
| Tasks answered correctly | ${b.correct} of 10 | ${s.correct} of 10 |

${summary.headline}

Method, per-task results and raw logs: [bench/results/${summary.set_id}/report.md](bench/results/${summary.set_id}/report.md).
${BENCH_END}`;
}
function benchLines(summary) {
  const b = benchArm(summary.b);
  const s = benchArm(summary.s);
  return [
    `Across the 10 tasks, the outside model received ${b.chars} characters through direct access and ${s.chars} through Sieve.`,
    `Through direct access the model received ${b.whole} whole items and summaries of ${b.summaries} items; through Sieve it received ${s.whole} whole items, ${s.excerpts} excerpts and ${s.answers} answer-only replies.`,
    `Health or Money items whose content reached the model (verbatim or as an approved answer): ${b.private} through direct access and ${s.private} through Sieve.`,
    `The hidden instruction reached the model in ${b.inj} of 10 tasks through direct access and in ${s.inj} of 10 through Sieve.`,
    `Tasks answered correctly: ${b.correct} of 10 through direct access and ${s.correct} of 10 through Sieve.`,
  ].map((t) => `${t} ${LINE_MARKER}`);
}

const latestPath = join(ROOT, 'bench', 'results', 'LATEST');
let measuredLines = null;   // null: nothing measured, so no bench line may appear
let expectedBlock = NOT_MEASURED_BLOCK;
if (existsSync(latestPath)) {
  const setId = readFileSync(latestPath, 'utf8').trim();
  const summary = readJson(join(ROOT, 'bench', 'results', setId, 'summary.json'));
  if (summary && !summary.complete) fail('bench/results/LATEST', `${setId} is not a complete measurement`);
  else if (summary) {
    try {
      expectedBlock = benchReadmeBlock(summary);
      measuredLines = benchLines(summary);
    } catch (e) {
      fail(`bench/results/${setId}/summary.json`, e.message);
      expectedBlock = null;
    }
  }
}
if (readme) {
  const start = readme.indexOf(BENCH_START);
  const end = readme.indexOf(BENCH_END);
  if (start < 0 || end < start) fail('README.md', `no bench block (${BENCH_START} ... ${BENCH_END})`);
  else if (expectedBlock !== null && readme.slice(start, end + BENCH_END.length) !== expectedBlock) {
    fail('README.md', existsSync(latestPath)
      ? 'the bench block differs from report.py for bench/results/LATEST; run python -m sieve_bench report --update-readme'
      : 'with no bench/results/LATEST the bench block must be the "Not measured yet" text exactly');
  }
}

const inRepo = (prefix) => repo.filter((f) => f.startsWith(prefix));
const CLAIM_FILES = [...new Set(['README.md', ...inRepo('docs/submission/'), ...inRepo('docs/video/'), 'extension/store/listing.md'])]
  .filter((f) => f.endsWith('.md') && existsSync(join(ROOT, f)));
for (const file of CLAIM_FILES) {
  let inside = false;
  for (const [i, line] of readFileSync(join(ROOT, file), 'utf8').split('\n').entries()) {
    if (line.includes(BENCH_START)) inside = true;
    const where = `${file}:${i + 1}`;
    if (!inside && line.trimEnd().endsWith(LINE_MARKER)) {
      if (!measuredLines) fail(where, 'a bench line, but nothing is measured yet (bench/results/LATEST is absent)');
      else if (!measuredLines.some((l) => line.trimEnd().endsWith(l))) fail(where, 'a bench line that python -m sieve_bench lines did not print for the current set');
    } else if (!inside && CLAIM_PATTERNS.some((p) => p.test(line))) {
      fail(where, `looks like a measured claim: "${line.trim().slice(0, 100)}"; only generated bench lines may state numbers`);
    }
    if (line.includes(BENCH_END)) inside = false;
  }
}

// ---------------------------------------------------------------- 13. no em or en dashes in the public text (40 section 1, 60 section 6.4)

const DASH_FILES = [...new Set(['README.md', ...inRepo('docs/submission/'), ...inRepo('docs/video/'), ...inRepo('extension/store/'),
  ...inRepo('web/src/copy/')])].filter((f) => !/\.test\.[jt]sx?$/.test(f) && existsSync(join(ROOT, f)));
for (const file of DASH_FILES) {
  const text = textOf(join(ROOT, file));
  if (text === null) continue;
  for (const [i, line] of text.split('\n').entries()) {
    if (line.includes(EM_DASH)) fail(`${file}:${i + 1}`, 'contains an em dash');
    else if (line.includes(EN_DASH)) fail(`${file}:${i + 1}`, 'contains an en dash');
  }
}

// ---------------------------------------------------------------- 14. the production bundle (60 section 3.12 item 6, 3.9.1)

const DIST = join(ROOT, 'web', 'dist');
let distChecked = 0;
if (existsSync(DIST)) {
  // App Check debug tokens from the local, git-ignored env files: their values must never reach the bundle.
  const localTokens = [];
  for (const dir of [ROOT, join(ROOT, 'web')]) {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('.env') || !statSync(join(dir, name)).isFile()) continue;
      for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
        const m = /^\s*VITE_APPCHECK_DEBUG_TOKEN\s*=\s*['"]?([^'"\s#]+)/.exec(line);
        if (m && !['true', '1', 'false', '0'].includes(m[1].toLowerCase())) localTokens.push({ value: m[1], from: rel(join(dir, name)) });
      }
    }
  }
  const DIST_TEXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt', '.svg', '.webmanifest']);
  let e2eNamed = false;
  let emulators = false;
  for (const file of walk(DIST).filter((f) => DIST_TEXT.has(extname(f).toLowerCase()))) {
    const text = readFileSync(file, 'utf8');
    const where = rel(file);
    distChecked += 1;
    if (text.includes('fakeModel')) fail(where, 'contains "fakeModel": the e2e model seam is in the production bundle (60 section 3.9.1)');
    for (const m of text.matchAll(/\bVITE_(?:SIEVE_)?E2E\s*:\s*"([^"]*)"/g)) {
      if (m[1] !== '' && !['0', 'false'].includes(m[1].toLowerCase())) fail(where, `built with ${m[0]}: the e2e seams are on`);
    }
    if (text.includes('VITE_SIEVE_E2E')) e2eNamed = true;
    for (const m of text.matchAll(/\bVITE_APPCHECK_DEBUG_TOKEN\s*:\s*"([^"]+)"/g)) fail(where, `built with an App Check debug token (${mask(m[1])})`);
    for (const m of text.matchAll(/\bFIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*['"]([0-9a-fA-F-]{36})['"]/g)) fail(where, `sets an App Check debug token (${mask(m[1])})`);
    for (const t of localTokens) if (text.includes(t.value)) fail(where, `contains the App Check debug token from ${t.from}`);
    if (/\bVITE_USE_EMULATORS\s*:\s*"(?:true|1)"/i.test(text)) emulators = true;
  }
  if (e2eNamed) note('web/dist', 'names VITE_SIEVE_E2E with an empty value (web/src/app/env.ts reads import.meta.env as a whole); the seam itself is not in the bundle');
  if (emulators) note('web/dist', 'was built with VITE_USE_EMULATORS on; rebuild without it before deploying');
}

// ---------------------------------------------------------------- 15. commit emails (60 section 3.12 item 7, a note only)

try {
  const out = execFileSync('git', ['log', '--format=%ae'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const authors = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
  const other = authors.filter((a) => !a.toLowerCase().endsWith('@users.noreply.github.com'));
  if (other.length) note('git log', `commit authors not on a GitHub noreply address: ${other.join(', ')} (switch with git config user.email before the next commit)`);
} catch {
  note('git log', 'no commits to read authors from');
}

report(records.length, files.length, totalBytes,
  `; ${repo.length} repository files (${scannedText} text) scanned for secrets, ${CLAIM_FILES.length} for claims, ${DASH_FILES.length} for dashes${distChecked ? `, ${distChecked} web/dist files` : ''}`);

function report(recordCount = 0, fileCount = 0, bytes = 0, repoPart = '') {
  for (const n of notes) console.log(`note     ${n}`);
  for (const w of warnings) console.log(`warning  ${w}`);
  if (problems.length) {
    console.error(`check:repo found ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`check:repo: OK (${recordCount} seed records, ${fileCount} data files, ${(bytes / 1048576).toFixed(2)} MB${repoPart})${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`);
  process.exit(0);
}
