// 70 section 17 acceptance tests that run in Vitest against the modules as built: 1 (corpus), 5 (XSS as text, the
// jsdom part), 6 (well-formed outputs), 7 and 12 (previews the side panel accepts), 9 (send-time refusals, on both the
// relay's local send check and robust/sendGuard), 10 (no paths in Firestore item refs). The rest need a real browser,
// the emulators or pytest; docs/review/robustness-audit.md lists them with the reason.
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { DEFAULT_CATEGORY_RULES, WARNING_ORDER, type IndexRecord, type PiiSpan, type Settings, type Warning } from '@sieve/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forAll, int, pick, seeded, stringOf } from '../../../../tests/harness/property';
import { corpus, ROBUST_DIR } from '../../../../tests/harness/robustCorpus';
import { CORPUS } from '../../../../tests/fixtures/robustness/manifest';
import { parsePreview } from '../../../../extension/src/shared/validate';
import { RedactedText } from '@/components/RedactedText/RedactedText';
import { forgetDb, openDbNamed, type SieveDb } from '@/index/db';
import { itemRefs, resetItemRefsForTests } from '@/app/services/itemRefs';
import { redact } from '@/privacy/redact';
import { entry, proposal } from '@/relay/__tests__/fixtures';
import { pendingPreviews, toPreview } from '@/relay/preview';
import { checkBeforeSend as relaySendCheck } from '@/relay/sendCheck';
import { decodeBytes } from '../charset';
import { isWellFormed, normalizeQuestion, truncateGraphemes } from '../question';
import { checkBeforeSend } from '../sendGuard';

// ---------------------------------------------------------------- 17.1 the corpus is complete and every case id is unique

describe('17.1 corpus', () => {
  it('every generated corpus file exists', () => {
    for (const e of CORPUS.filter((x) => x.origin === 'generated')) expect(existsSync(join(ROBUST_DIR, e.file)), e.file).toBe(true);
  });
  it('case ids are unique within each JSON file', () => {
    for (const e of CORPUS.filter((x) => x.origin === 'generated' && x.file.endsWith('.json') && x.file !== 'files/truncated.json')) {
      const ids = corpus(e.file).cases.map((c) => c.id);
      expect(new Set(ids).size, e.file).toBe(ids.length);
    }
  });
});

// ---------------------------------------------------------------- 17.5 XSS payloads render as text (jsdom part)

describe('17.5 xss.json renders as plain text', () => {
  afterEach(() => {
    delete (window as unknown as { __xss?: unknown }).__xss;
  });
  for (const c of corpus<string, unknown>('xss.json').cases) {
    it(c.id, () => {
      const { container } = render(createElement(RedactedText, { text: c.input }));
      expect(container.textContent).toBe(c.input);
      expect(container.querySelectorAll('script, img, svg, iframe, a, style, meta, form, object, math').length).toBe(0);
      expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------- 17.6 outputs are well-formed

describe('17.6 well-formed outputs', () => {
  for (const c of corpus<{ text?: string; spans?: PiiSpan[] }, { removedValues?: string[]; unchanged?: boolean }>('outputs.json').cases.filter((x) => x.id.startsWith('spans-'))) {
    it(`redact ${c.id}`, () => {
      const out = redact(c.input.text ?? '', c.input.spans ?? []);
      expect(isWellFormed(out.text)).toBe(true);
      if (c.expected.unchanged) expect(out.text).toBe(c.input.text);
      for (const v of c.expected.removedValues ?? []) expect(out.text).not.toContain(v);
    });
  }

  it('redact stays well-formed for random grapheme texts and spans (1,000 runs)', () => {
    const pieces = corpus<string, unknown>('emoji-graphemes.json').cases.map((c) => c.input).concat(['a', ' ', 'Dana', '555-0142', '.']);
    const types: PiiSpan['type'][] = ['name', 'phone', 'email', 'card', 'address'];
    forAll((r) => {
      const text = stringOf(r, pieces, 25);
      const spans: PiiSpan[] = Array.from({ length: int(r, 0, 4) }, () => {
        const a = int(r, 0, text.length);
        return { start: a, end: Math.min(text.length, a + int(r, 0, 12)), type: pick(r, types), by: 'validator' };
      });
      return { text, spans };
    }, ({ text, spans }) => {
      expect(isWellFormed(redact(text, spans).text)).toBe(true);
    });
  });

  it('normalizeQuestion, truncateGraphemes and decodeBytes over the whole corpus are well-formed', () => {
    for (const c of corpus<string, unknown>('questions.json').cases) {
      expect(isWellFormed(normalizeQuestion(c.input).text)).toBe(true);
      for (const max of [0, 1, 7, 120, 500]) expect(isWellFormed(truncateGraphemes(normalizeQuestion(c.input).text, max))).toBe(true);
    }
    const r = seeded(17);
    for (let i = 0; i < 200; i++) expect(isWellFormed(decodeBytes(new Uint8Array(Array.from({ length: 40 }, () => int(r, 0, 255)))).text)).toBe(true);
  });
});

// ---------------------------------------------------------------- 17.7 and 17.12 the side panel accepts the previews

describe('17.7 and 17.12 previews the side panel accepts', () => {
  const warnings: Warning[] = Array.from({ length: 15 }, (_, i) => ({ kind: WARNING_ORDER[i % WARNING_ORDER.length] ?? 'ask-first', message: `Warning ${i} ${'🎂'.repeat(200)}` }));
  for (const [id, title] of [
    ['title-1000', 'Deposit '.repeat(125)],
    ['title-emoji', '👨\u200D👩\u200D👧'.repeat(60)],
    ['title-flags', '🇮🇳'.repeat(120)],
  ] as const) {
    it(`a ${id} subject with 15 long warnings passes parsePreview`, () => {
      const p = proposal({ warnings, item: { ...proposal().item!, title } });
      const preview = toPreview(entry({ proposal: p }));
      expect(parsePreview(preview)).not.toBeNull();
      expect(isWellFormed(preview!.item!.title)).toBe(true);
    });
  }

  it('a 500-unit emoji question appears in the panel (R-MCP-05)', () => {
    const question = '🎂'.repeat(250);
    const preview = toPreview(entry({ proposal: proposal({ question }) }));
    expect(parsePreview(preview)?.question).toBe(question);
  });

  it('a 600-unit question is cut at a grapheme boundary and still passes', () => {
    const preview = toPreview(entry({ proposal: proposal({ question: '🎂'.repeat(300) }) }));
    expect(parsePreview(preview)?.question.length).toBe(500);
  });

  it('one entry the panel would reject is dropped, so the others still arrive (R-RLY-12)', () => {
    const good = entry({ requestId: 'good', proposal: proposal({ requestId: 'good', createdAt: 1 }) });
    const bad = entry({ requestId: 'bad id', proposal: proposal({ requestId: 'bad id', createdAt: 2 }) });
    const { previews } = pendingPreviews([good, bad]);
    expect(previews.every((p) => parsePreview(p) !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------- 17.9 nothing is sent after a rule, grant or block change

describe('17.9 send-time refusals', () => {
  const rec = (id: string, category: IndexRecord['category']): IndexRecord => ({
    id, source: 'gmail', sourceRef: id.slice(6), kind: 'email', title: 'Your November statement is ready', date: 1, preview: '', category,
    categoryBy: 'code', hiddenRemoved: [], pii: [], sizeBytes: 1, indexedAt: 1, contentHash: 'h', version: 1,
  });
  const settings: Settings = { categoryRules: { ...DEFAULT_CATEGORY_RULES }, defaultStep: 'answer', cloudFallbackForOwnData: false, pushEnabled: false };
  const never: Settings = { ...settings, categoryRules: { ...settings.categoryRules, Money: 'never' } };
  const TEXT = 'Your balance on Nov 1 was $3,420.18.';
  const requester = { kind: 'outside' as const, grantId: 'grant-g', aiName: 'Helper' };
  const request = { status: 'awaiting-person' as const, maxStep: 'full' as const, allowedCategories: ['Money' as const], allowedSources: ['gmail' as const] };
  let db: SieveDb;
  let n = 0;
  beforeEach(async () => {
    db = openDbNamed(`sieve-robust-accept-${process.pid}-${++n}`, 'real');
    await db.records.put(rec('gmail:m11', 'Money'));
  });
  afterEach(async () => {
    db.close();
    forgetDb(db.name);
    await db.delete();
  });

  const cases: { id: string; settings: Settings; blocked: string[]; status: 'awaiting-person' | 'revoked'; categories: ('Money' | 'Home')[]; message: string }[] = [
    { id: 'rule-never', settings: never, blocked: [], status: 'awaiting-person', categories: ['Money'], message: 'Your rules now never share Money items. Nothing was sent.' },
    { id: 'grant-narrowed', settings, blocked: [], status: 'awaiting-person', categories: ['Home'], message: 'Helper may no longer ask about Money items. Nothing was sent.' },
    { id: 'revoked', settings, blocked: [], status: 'revoked', categories: ['Money'], message: 'This request was closed. Nothing was sent.' },
    { id: 'blocked', settings, blocked: ['gmail:m11'], status: 'awaiting-person', categories: ['Money'], message: 'You blocked this item for Helper. Nothing was sent.' },
  ];
  for (const c of cases) {
    it(`${c.id}: robust/sendGuard refuses with the exact message`, async () => {
      const r = await checkBeforeSend({
        db, step: 'answer', approvedText: TEXT, payloadText: TEXT, itemIds: ['gmail:m11'], question: 'what is my balance?', requester,
        settings: c.settings, blockedRecordIds: c.blocked, request: { ...request, status: c.status, allowedCategories: c.categories, expireAt: 10 }, now: 1,
      });
      expect(r).toMatchObject({ ok: false, message: c.message });
    });
    it(`${c.id}: the relay's built send check refuses with the exact message`, async () => {
      const r = await relaySendCheck({
        step: 'answer', approvedText: TEXT, payloadText: TEXT, itemIds: ['gmail:m11'], requester, settings: c.settings, blockedRecordIds: c.blocked,
        request: { ...request, status: c.status, allowedCategories: c.categories, deadline: 10 }, now: 1, getRecord: async (id) => db.records.get(id),
      });
      expect(r).toMatchObject({ ok: false, message: c.message });
    });
  }

  it('the relay\'s built send check refuses an unmasked card number (check 11, R-OUT-06)', async () => {
    const t = 'Card 4111 1111 1111 1111 was charged.';
    const r = await relaySendCheck({
      step: 'answer', approvedText: t, payloadText: t, itemIds: ['gmail:m11'], requester, settings, blockedRecordIds: [],
      request: { ...request, deadline: 10 }, now: 1, getRecord: async (id) => db.records.get(id),
    });
    expect(r.ok).toBe(false);
  });

  it('the relay\'s built send check refuses text with hidden characters (check 3, 70 section 3.3)', async () => {
    const t = `${TEXT}\u200B`;
    const r = await relaySendCheck({
      step: 'answer', approvedText: t, payloadText: t, itemIds: ['gmail:m11'], requester, settings, blockedRecordIds: [],
      request: { ...request, deadline: 10 }, now: 1, getRecord: async (id) => db.records.get(id),
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------- 17.10 no folder path in what reaches Firestore

describe('17.10 item refs carry no path or file name (R-OUT-10, 01 section 11.8)', () => {
  beforeEach(() => resetItemRefsForTests());
  it('folder ids become 64-hex HMAC refs', async () => {
    const ids = ['folder:Health/HIV test 2025.pdf', 'folder:taxes/2025/W-2.pdf', 'gmail:18c2f0a9d1e4b001'];
    const refs = await itemRefs('uid-test', ids);
    for (const r of refs) {
      expect(r).toMatch(/^[0-9a-f]{64}$/);
      expect(r).not.toContain('/');
      expect(r).not.toMatch(/W-2|HIV|Health/);
    }
    expect(new Set(refs).size).toBe(3);
  });
});
