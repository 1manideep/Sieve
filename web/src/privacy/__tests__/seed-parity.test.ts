// Parity with the Playground seed bundle, which data/playground/tools/privacy.py (a port of this module's plain-code
// rules) precomputed: same text and hidden fragments, same validator spans, same injection finding, same text hash,
// same header entities, for every seed record. Skipped when the dataset is not in the checkout.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IndexRecord, PiiSpan } from '@sieve/shared';
import { beforeAll, describe, expect, test } from 'vitest';
import { checkInjection } from '../injection/check';
import { detectPii, runPiiStage } from '../pii/detect';
import { sanitizeIncoming } from '../sanitize/sanitize';
import { headerText, recordTextHash, scanText } from '../scan/scan';
import { noModel } from './helpers';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/playground');
const present = existsSync(join(dataDir, 'seed-bundle.json')) && existsSync(join(dataDir, 'emails.json'));

interface SeedEmail { id: string; html?: string; text?: string }
const bundle = present ? (JSON.parse(readFileSync(join(dataDir, 'seed-bundle.json'), 'utf8')) as { records: IndexRecord[] }) : { records: [] };
const emails = present ? (JSON.parse(readFileSync(join(dataDir, 'emails.json'), 'utf8')) as { emails: SeedEmail[] }).emails : [];

const strip = (spans: readonly PiiSpan[]) => spans.map(({ start, end, type, by }) => ({ start, end, type, by }));

beforeAll(() => noModel());

describe.skipIf(!present)('seed bundle parity with the Python port', () => {
  test.each(emails.map((e) => [e.id, e] as const))('sanitizeIncoming %s', (_id, e) => {
    const rec = bundle.records.find((r) => r.id === `playground:${e.id}`)!;
    const out = e.html ? sanitizeIncoming({ html: e.html }) : sanitizeIncoming({ text: e.text ?? '' });
    expect(out.text).toBe(rec.text);
    expect(out.hiddenRemoved).toEqual(rec.hiddenRemoved);
  });

  test.each(bundle.records.map((r) => [r.id, r] as const))('validators, injection, hash, header %s', async (_id, rec) => {
    const text = scanText(rec);
    const stage = await runPiiStage('validators', text, { data: 'sample', prior: [] });
    expect(strip(stage.spans)).toEqual(strip(rec.pii));
    const { finding } = await checkInjection(text, 'sample', { model: false, extraText: rec.hiddenRemoved });
    expect(finding).toEqual(rec.injection);
    expect(recordTextHash(rec)).toBe(rec.privacyScan?.textHash);
    const header = headerText(rec);
    const { spans } = header ? await detectPii(header, 'sample', { stages: ['validators'] }) : { spans: [] };
    expect(spans.map((s) => ({ text: header.slice(s.start, s.end), type: s.type }))).toEqual((rec.privacyScan?.headerEntities ?? []).map((h) => ({ text: h.text, type: h.type })));
  });

  test('report', () => {
    console.log(`seed parity: ${emails.length} emails re-sanitized and ${bundle.records.length} records re-checked against the Python port`);
    expect(bundle.records.length).toBeGreaterThan(0);
  });
});
