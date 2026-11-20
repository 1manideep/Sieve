// The robustness corpus against the modules as built (70 section 14, acceptance test 1): parseQuestion, the
// tokenizer, the Gmail query builder, MIME and charset handling, the readers, the Health safety net and the action
// check. Each case id is in a test name. `gap(...)` marks a requirement the built module does not meet yet.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHashEmbedClient } from '../../../../tests/harness/hashEmbedder';
import { corpus, corpusBytes, corpusCase, ROBUST_DIR } from '../../../../tests/harness/robustCorpus';
import { isHealthStrong } from '@/ai/tasks/codeLabel';
import { estimateTokens } from '@/ai/budget';
import { openDb, type SieveDb } from '@/index/db';
import { loadDictionaryText } from '@/index/dictionary';
import { whenVocabReady, wipeDb } from '@/index/lifecycle';
import { parseQuestion } from '@/index/parseQuestion';
import { terms } from '@/index/tokenize';
import { setMlClient } from '@/ml/client';
import { actionVerb, splitDraftRequest } from '@/pipeline/split';
import { cleanChars } from '@/privacy/sanitize/chars';
import { seedPlayground } from '@/playground/seed';
import { buildGmailQuery } from '@/sources/gmail/liveSearch';
import { decodeMimeWords, decodeSnippet, extractBodies } from '@/sources/gmail/mime';
import { decodeBytes as builtDecodeBytes } from '@/sources/readers/decode';
import { readFileForIndex } from '@/sources/readers';
import { decodeBytes } from '../charset';
import { gap } from './gap';

vi.mock('@/ai', async () => (await import('../../../../tests/harness/aiMock')).aiModule);
vi.mock('@/privacy', async () => (await import('../../../../tests/harness/privacyMock')).privacyModule);
vi.mock('@/privacy/sanitize/sanitize', async () => ({ sanitizeIncoming: (await import('../../../../tests/harness/privacyMock')).sanitizeIncoming }));
vi.mock('@/playground/assets', async () => (await import('../../../../tests/harness/dataset')).assetsModule);

process.env.TZ = 'America/Chicago';

// ---------------------------------------------------------------- dates (R-IN-11 to R-IN-14)

interface DateCase { id: string; question: string; now: string; locale: string; expected: { after?: string; before?: string; ambiguous: boolean; contentDate?: boolean; termsInclude?: string; gmail?: string[] } }
const DATE_GAPS: Record<string, string> = {
  'bill-due-nov-28': 'R-IN-12',     // read as an item date 2026-11-28; a content date gives no range and adds "nov 28" to terms
  'flight-on-dec-4': 'R-IN-12',     // read as 2025-12-04, boosting last year's flight; "on" before a date within 31 days is a content date
};

describe('dates.json with parseQuestion', () => {
  for (const c of (corpus('dates.json').cases as unknown as DateCase[])) {
    const run = () => {
      const p = parseQuestion(c.question, new Date(c.now), c.locale);
      const e = c.expected;
      if (e.contentDate) {
        expect(p.hints.after).toBeUndefined();
        expect(p.hints.before).toBeUndefined();
        if (e.termsInclude) expect((p.hints.terms ?? []).map((t) => t.toLowerCase())).toContain(e.termsInclude);
        return;
      }
      expect(p.hints.after).toBe(e.after);
      expect(p.hints.before).toBe(e.before);
      expect((p.hints.interpreted ?? []).some((i) => i.ambiguous)).toBe(e.ambiguous);
      if (e.gmail) for (const clause of e.gmail) expect(buildGmailQuery(p, () => 1).q).toContain(clause);
    };
    const g = DATE_GAPS[c.id];
    if (g) gap(g, c.id, run);
    else it(c.id, run);
  }
});

// ---------------------------------------------------------------- typos (R-IN-09, R-IN-10), on the seeded Playground index

describe('typos.json with parseQuestion and the Playground vocabulary', () => {
  let db: SieveDb;
  const NOW = new Date('2026-11-16T10:00:00');
  beforeAll(async () => {
    setMlClient(createHashEmbedClient());
    loadDictionaryText((await import('node:fs')).readFileSync(join(process.cwd(), 'web/src/index/dict/en-words.tsv'), 'utf8'));
    db = openDb('playground');
    await seedPlayground(db);
    await whenVocabReady(db);
  }, 60_000);
  afterAll(async () => {
    await wipeDb('playground');
    setMlClient(null);
  });

  const file = corpus<string, { corrected?: string }>('typos.json');
  for (const c of file.cases) {
    it(c.id, () => {
      const p = parseQuestion(c.input, NOW, 'en-US', { db });
      if (c.expected.corrected) expect(p.corrected).toBe(c.expected.corrected);
      else expect(p.corrected).not.toBe('');
    });
  }
  // A guard leaves the question unchanged unless the case states the built result: 20 section 9 also takes
  // candidates from the English word list, so guard-name ("dex") becomes "dec" (owner decision in the audit, R-IN-10).
  for (const c of file.guards as { id: string; input: string; expected: { corrected?: string } }[]) {
    it(c.id, () => {
      const p = parseQuestion(c.input, NOW, 'en-US', { db });
      expect(p.corrected).toBe(c.expected.corrected ?? p.normalized);
    });
  }
});

// ---------------------------------------------------------------- numbers (R-IN-15)

const NUMBER_GAPS = new Set(['n02', 'n03', 'n05', 'n10', 'n11', 'n12']);
describe('numbers.json with the keyword tokenizer', () => {
  for (const c of corpus<{ question: string; text: string }, { shared: string }>('numbers.json').cases) {
    const run = () => {
      const q = terms(c.input.question);
      const t = terms(c.input.text);
      expect(q).toContain(c.expected.shared);
      expect(t).toContain(c.expected.shared);
    };
    if (NUMBER_GAPS.has(c.id)) gap('R-IN-15', c.id, run);
    else it(c.id, run);
  }
});

// ---------------------------------------------------------------- questions at the search layer

describe('questions.json at the search layer', () => {
  const q = (id: string) => corpusCase<string, Record<string, unknown>>('questions.json', id);
  const NOW = new Date('2026-11-16T10:00:00');

  gap('R-IN-05', 'homoglyph: a Cyrillic letter inside a Latin word is folded for search', () => {
    expect(terms(q('homoglyph').input)).toContain('landlord');
  });
  it('homoglyph-russian-word: a whole Cyrillic word is untouched', () => {
    expect(terms(q('homoglyph-russian-word').input)).toEqual([q('homoglyph-russian-word').input]);
  });
  gap('R-IN-06', 'nfd: tokens are accent folded', () => {
    expect(terms(q('nfd').input)).toContain('cafe');
  });
  it('fullwidth-digits and ligature: tokens are NFKC', () => {
    expect(terms(q('fullwidth-digits').input)).toContain('1200');
    expect(terms(q('ligature').input)).toContain('final');
  });
  gap('R-IN-08', 'es-deposit: "depósito" meets "deposit" after accent folding', () => {
    expect(terms(q('es-deposit').input)).toContain('deposito');
  });
  it('emoji-only and emoji-inline: names go to search text only', () => {
    for (const id of ['emoji-only', 'emoji-inline']) {
      const c = q(id);
      const p = parseQuestion(c.input, NOW, 'en-US');
      for (const g of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(c.input)) {
        if (/\p{Extended_Pictographic}/u.test(g.segment)) expect(p.corrected).toContain(g.segment);
      }
      expect(p.searchText).toContain(String(c.expected.searchIncludes));
    }
  });
  it('hi-question: no exception, no spelling change', () => {
    const p = parseQuestion(q('hi-question').input, NOW, 'en-US');
    expect(p.corrected).toBe(p.normalized);
  });
  it('gmail-operators: balanced quotes and no spam, trash or anywhere operators (R-MAIL-13)', () => {
    const p = parseQuestion(q('gmail-operators').input, NOW, 'en-US');
    const query = buildGmailQuery(p, () => 1).q;
    expect((query.match(/"/g) ?? []).length % 2).toBe(0);
    for (const op of ['in:spam', 'in:trash', 'in:anywhere']) expect(query).not.toContain(op);
  });
  it('forward-lease: the action verb is found and the lookup keeps the lease (R-IN-18)', () => {
    const s = splitDraftRequest(q('forward-lease').input);
    expect(actionVerb(s.lookup)).toBe('forward');
  });
  it('a 6,000-character Japanese passage estimates at least 6,000 tokens (R-MDL-09)', () => {
    expect(estimateTokens('検'.repeat(6000))).toBeGreaterThanOrEqual(6000);
  });
});

// ---------------------------------------------------------------- Gmail MIME and charsets (R-MAIL-01, 02, 05, 06, 09, R-EMO-05)

interface Part { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] }
interface Msg { payload: Part; snippet: string }
const bodyText = (m: Msg) => {
  const b = extractBodies(m.payload as never);
  return [b.text ?? '', b.html ?? ''].join('\n');
};

describe('gmail/*.json with mime.ts', () => {
  const charsetFiles = readdirSync(join(ROBUST_DIR, 'gmail')).filter((f) => f.startsWith('charset-')).sort();
  for (const f of charsetFiles) {
    const c = corpus<Msg, { text: string }>(`gmail/${f}`).cases[0];
    if (!c) continue;
    // windows-1252 included: robust/charset decodes it by table, the same in Node and Chrome (R-MAIL-02)
    it(c.id, () => expect(bodyText(c.input).trim()).toBe(c.expected.text));
  }

  for (const f of ['mime-deep-40', 'mime-400-parts', 'mime-bad-base64']) {
    const c = corpusCase<Msg, { includes: string[]; excludes?: string[] }>(`gmail/${f}.json`, f);
    it(c.id, () => {
      let text = '';
      expect(() => {
        text = bodyText(c.input);
      }).not.toThrow();
      for (const s of c.expected.includes) expect(text).toContain(s);
      for (const s of c.expected.excludes ?? []) expect(text).not.toContain(s);
    });
  }

  it('mime-no-type: no text, no throw', () => {
    const c = corpusCase<Msg, unknown>('gmail/mime-no-type.json', 'mime-no-type');
    const b = extractBodies(c.input.payload as never);
    expect(b.text).toBeUndefined();
    expect(b.html).toBeUndefined();
  });

  it('attachment-only: the attachment is counted, there is no body', () => {
    const c = corpusCase<Msg, { attachments: number }>('gmail/attachment-only.json', 'attachment-only');
    expect(extractBodies(c.input.payload as never)).toEqual({ attachments: c.expected.attachments });
  });

  gap('R-MAIL-06', 'invite-ics-only: a text/calendar part becomes text lines (later)', () => {
    const c = corpusCase<Msg, { includes: string[] }>('gmail/invite-ics-only.json', 'invite-ics-only');
    const text = bodyText(c.input);
    for (const s of c.expected.includes) expect(text).toContain(s);
  });

  gap('R-MAIL-03', 'qp-leftover: quoted-printable left in a part is decoded (later)', () => {
    const c = corpusCase<Msg, { text: string }>('gmail/qp-leftover.json', 'qp-leftover');
    expect(bodyText(c.input).trim()).toBe(c.expected.text);
  });

  it('control-chars: after cleanChars the text is well-formed with none of NUL, ESC, a lone surrogate or U+FFFE (R-MAIL-09)', () => {
    const c = corpusCase<Msg, { excludesCodePoints: number[]; includes: string[] }>('gmail/control-chars.json', 'control-chars');
    const text = cleanChars(bodyText(c.input)).text;
    for (const cp of c.expected.excludesCodePoints) expect([...text].some((ch) => ch.codePointAt(0) === cp)).toBe(false);
    for (const s of c.expected.includes) expect(text).toContain(s);
  });

  it('tracker-snippet: entities decoded with no parser (R-MAIL-05)', () => {
    const c = corpusCase<Msg, { snippet: string }>('gmail/tracker-snippet.json', 'tracker-snippet');
    expect(decodeSnippet(c.input.snippet)).toBe(c.expected.snippet);
  });

  for (const c of corpus<string, string>('gmail/subject-encoded.json').cases) {
    it(`subject-encoded ${c.id} with decodeMimeWords (R-EMO-05)`, () => expect(decodeMimeWords(c.input)).toBe(c.expected));
  }

  for (const id of ['health-de', 'health-fr', 'health-ja']) {
    it(`${id}: the Health safety net knows the phrase (R-MAIL-08)`, () => {
      const c = corpusCase<Msg & { payload: Part & { headers: { name: string; value: string }[] } }, unknown>(`gmail/${id}.json`, id);
      const h = (n: string) => c.input.payload.headers.find((x) => x.name === n)?.value ?? '';
      expect(isHealthStrong({ title: h('Subject'), from: h('From'), preview: bodyText(c.input) })).toBe(true);
    });
  }
  it('health-de-cooking: "Rezept" alone is not Health', () => {
    const c = corpusCase<Msg & { payload: Part & { headers: { name: string; value: string }[] } }, unknown>('gmail/health-de-cooking.json', 'health-de-cooking');
    const h = (n: string) => c.input.payload.headers.find((x) => x.name === n)?.value ?? '';
    expect(isHealthStrong({ title: h('Subject'), from: h('From'), preview: bodyText(c.input) })).toBe(false);
  });
});

// ---------------------------------------------------------------- files (R-FILE-01, 02, 07) with the readers

describe('files/ with readFileForIndex', () => {
  type F = { text?: string; skip?: string; indexed?: boolean; rawTextFallback?: boolean; textIncludes?: string; declared?: string };
  const cases = corpus<string, F>('files/expected.json').cases;
  const byId = (id: string) => cases.find((c) => c.id === id) as (typeof cases)[number];
  const blob = (rel: string) => new Blob([corpusBytes(rel) as Uint8Array<ArrayBuffer>]);

  it('empty.txt is indexed with empty text (R-FILE-01)', async () => {
    expect(await readFileForIndex(blob('files/empty.txt'), 'text')).toEqual({ kind: 'note', text: '' });
  });
  it('empty.pdf and empty.jpg are unreadable (R-FILE-01)', async () => {
    expect((await readFileForIndex(blob('files/empty.pdf'), 'pdf')).skip).toBe('unreadable');
    expect((await readFileForIndex(blob('files/empty.jpg'), 'jpeg')).skip).toBe('unreadable');
  });
  it('truncated.json falls back to its raw text (R-FILE-02)', async () => {
    const r = await readFileForIndex(blob('files/truncated.json'), 'json');
    expect(r.text).toContain(String(byId('truncated.json').expected.textIncludes));
  });
  it('binary.dat.txt is binary (R-FILE-07)', async () => {
    expect((await readFileForIndex(blob('files/binary.dat.txt'), 'text')).skip).toBe('binary');
  });
  for (const id of ['notes-utf16le-bom.txt', 'notes-utf16be-bom.txt', 'notes-utf8-bom.txt']) {
    it(`${id} decodes (R-FILE-07)`, async () => {
      expect((await readFileForIndex(blob(`files/${id}`), 'text')).text).toBe(byId(id).expected.text);
    });
  }
  it('notes-cp1252.txt reads through the built reader with the curly quotes and the euro sign (R-FILE-07)', async () => {
    expect((await readFileForIndex(blob('files/notes-cp1252.txt'), 'text')).text).toBe(byId('notes-cp1252.txt').expected.text);
  });
  it('notes-cp1252.txt decodes with robust/charset (table, same in Node and Chrome)', () => {
    expect(decodeBytes(corpusBytes('files/notes-cp1252.txt') as Uint8Array).text).toBe(byId('notes-cp1252.txt').expected.text);
  });
  it('notes-utf16le-nobom.txt: UTF-16 without a byte order mark is text, not binary (R-FILE-07)', async () => {
    expect((await readFileForIndex(blob('files/notes-utf16le-nobom.txt'), 'text')).text).toBe(byId('notes-utf16le-nobom.txt').expected.text);
  });
  it('notes-sjis.txt decodes with its declared label (folder files have none; see the audit)', () => {
    expect(builtDecodeBytes(corpusBytes('files/notes-sjis.txt') as Uint8Array, 'shift_jis').text).toBe(byId('notes-sjis.txt').expected.text);
  });
});
