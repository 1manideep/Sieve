import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_CHARS } from '@sieve/shared';
import type { ProposalPreview } from '@sieve/shared';
import { LIMITS, parsePageMessage, parsePanelMessage, parsePreview } from '../src/shared/validate';
import { DEPOSIT, LEASE, STATEMENT, hello, pending, resolved, withId } from './fixtures';

type Loose = Record<string, unknown>;

function mutate(p: ProposalPreview, fn: (draft: Loose) => void): unknown {
  const draft = JSON.parse(JSON.stringify(p)) as Loose;
  fn(draft);
  return draft;
}

describe('parsePageMessage: valid messages', () => {
  it('accepts hello and returns only the known fields', () => {
    expect(parsePageMessage({ ...hello(true, '1.2.3'), extra: 'dropped' })).toEqual({
      type: 'sieve/hello',
      version: 1,
      homeBase: true,
      appVersion: '1.2.3',
    });
  });

  it.each([0, 1, 20])('accepts pending with %i entries', (n) => {
    const list = Array.from({ length: n }, (_, i) => withId(DEPOSIT, `req-${i}`));
    const parsed = parsePageMessage(pending(list));
    expect(parsed).toEqual({ type: 'sieve/pending', version: 1, proposals: list });
  });

  it('accepts resolved', () => {
    expect(parsePageMessage({ ...resolved('req-1', 'approved'), note: 1 })).toEqual(resolved('req-1', 'approved'));
  });

  it('drops unknown fields inside previews and options', () => {
    const raw = mutate(DEPOSIT, (d) => {
      d.related = [{ recordId: 'gmail:abc' }];
      d.trace = [];
      (d.item as Loose).recordId = 'gmail:abc';
      (d.item as Loose).from = 'Dana <dana@example.com>';
      ((d.options as Loose[])[0] as Loose).trace = [];
      ((d.options as Loose[])[0] as Loose).image = { mime: 'image/jpeg' };
      (d.requester as Loose).secret = 'x';
    });
    const parsed = parsePreview(raw);
    expect(parsed).toEqual(DEPOSIT);
    expect(JSON.stringify(parsed)).not.toContain('gmail:abc');
  });

  it('accepts the other persona previews, an in-app requester and every warning kind', () => {
    expect(parsePreview(LEASE)).toEqual(LEASE);
    expect(parsePreview(STATEMENT)).toEqual(STATEMENT);
    const inApp = mutate(DEPOSIT, (d) => {
      d.requester = { kind: 'in-app', aiName: 'Gemini (in Sieve)' };
    });
    expect(parsePreview(inApp)?.requester).toEqual({ kind: 'in-app', aiName: 'Gemini (in Sieve)' });
    const kinds = ['ask-first', 'injection', 'hidden-text-removed', 'pii-redacted', 'pii-check-limited', 'cloud-fallback',
      'sample-data-cloud', 'unverified-answer', 'source-unchecked'];
    const all = mutate(DEPOSIT, (d) => {
      d.warnings = kinds.map((kind) => ({ kind, message: `about ${kind}` }));
    });
    expect(parsePreview(all)?.warnings).toHaveLength(9);
  });
});

describe('parsePageMessage: rejected messages', () => {
  const bad: [string, unknown][] = [
    ['wrong version', { ...hello(), version: 2 }],
    ['missing version', { type: 'sieve/hello', homeBase: true, appVersion: '1' }],
    ['unknown type', { type: 'sieve/everything', version: 1 }],
    ['hello without appVersion', { type: 'sieve/hello', version: 1, homeBase: true }],
    ['hello with empty appVersion', { ...hello(), appVersion: '' }],
    ['hello with long appVersion', { ...hello(), appVersion: 'x'.repeat(41) }],
    ['hello with homeBase as string', { ...hello(), homeBase: 'yes' }],
    ['21 proposals', pending(Array.from({ length: 21 }, (_, i) => withId(DEPOSIT, `req-${i}`)))],
    ['duplicate ids in one list', pending([DEPOSIT, withId(LEASE, DEPOSIT.requestId)])],
    ['proposals not an array', { type: 'sieve/pending', version: 1, proposals: { 0: DEPOSIT } }],
    ['options of length 2', pending([mutate(DEPOSIT, (d) => void (d.options = (d.options as unknown[]).slice(0, 2))) as ProposalPreview])],
    ['options out of order', pending([mutate(DEPOSIT, (d) => void (d.options = [...(d.options as unknown[])].reverse())) as ProposalPreview])],
    ['option text over MAX_PAYLOAD_CHARS', pending([mutate(DEPOSIT, (d) => {
      ((d.options as Loose[])[2] as Loose).text = 'x'.repeat(MAX_PAYLOAD_CHARS + 1);
    }) as ProposalPreview])],
    ["step: 'everything'", pending([mutate(DEPOSIT, (d) => void (((d.options as Loose[])[0] as Loose).step = 'everything')) as ProposalPreview])],
    ['requestedStep everything', pending([mutate(DEPOSIT, (d) => void (d.requestedStep = 'everything')) as ProposalPreview])],
    ['bad requestId characters', pending([withId(DEPOSIT, 'req/../1')])],
    ['outside requester without grantId', pending([mutate(DEPOSIT, (d) => void delete (d.requester as Loose).grantId) as ProposalPreview])],
    ['in-app requester with another name', pending([mutate(DEPOSIT, (d) => void (d.requester = { kind: 'in-app', aiName: 'Other' })) as ProposalPreview])],
    ['aiName over 80', pending([mutate(DEPOSIT, (d) => void ((d.requester as Loose).aiName = 'a'.repeat(81))) as ProposalPreview])],
    ['category not in CATEGORIES', pending([mutate(DEPOSIT, (d) => void ((d.item as Loose).category = 'Secrets')) as ProposalPreview])],
    ['title over 300', pending([mutate(DEPOSIT, (d) => void ((d.item as Loose).title = 't'.repeat(301))) as ProposalPreview])],
    ['date not positive', pending([mutate(DEPOSIT, (d) => void ((d.item as Loose).date = 0)) as ProposalPreview])],
    ['item null', pending([mutate(DEPOSIT, (d) => void (d.item = null)) as ProposalPreview])],
    ['warning message over 300 chars', pending([mutate(DEPOSIT, (d) => void (d.warnings = [{ kind: 'injection', message: 'w'.repeat(301) }])) as ProposalPreview])],
    ['13 warnings', pending([mutate(DEPOSIT, (d) => void (d.warnings = Array.from({ length: 13 }, () => ({ kind: 'injection', message: 'w' })))) as ProposalPreview])],
    ['unknown warning kind', pending([mutate(DEPOSIT, (d) => void (d.warnings = [{ kind: 'nothing', message: 'w' }])) as ProposalPreview])],
    ['unavailableReason over 200', pending([mutate(DEPOSIT, (d) => void (((d.options as Loose[])[2] as Loose).unavailableReason = 'r'.repeat(201))) as ProposalPreview])],
    ['chars not an integer', pending([mutate(DEPOSIT, (d) => void (((d.options as Loose[])[0] as Loose).chars = 1.5)) as ProposalPreview])],
    ['unknown outcome', pending([mutate(DEPOSIT, (d) => void (d.outcome = 'approved')) as ProposalPreview])],
    ['unknown rule', pending([mutate(DEPOSIT, (d) => void (d.rule = 'always')) as ProposalPreview])],
    ['question empty', pending([mutate(DEPOSIT, (d) => void (d.question = '')) as ProposalPreview])],
    ['question over 500', pending([mutate(DEPOSIT, (d) => void (d.question = 'q'.repeat(501))) as ProposalPreview])],
    ['message over 512 KB', { ...hello(), padding: 'p'.repeat(LIMITS.maxMessageChars) }],
    ['resolved with unknown outcome', { ...resolved('req-1', 'approved'), outcome: 'shared' }],
    ['resolved with bad id', resolved('', 'approved')],
    ['non-object: string', 'sieve/hello'],
    ['non-object: null', null],
    ['non-object: number', 42],
    ['array instead of object', [hello()]],
    ['array preview entry', pending([[DEPOSIT] as unknown as ProposalPreview])],
    ['options as object', pending([mutate(DEPOSIT, (d) => void (d.options = { 0: 1 })) as ProposalPreview])],
  ];

  it.each(bad)('%s', (_name, raw) => {
    expect(parsePageMessage(raw)).toBeNull();
  });

  it('rejects a whole pending list when one entry is broken', () => {
    const broken = mutate(LEASE, (d) => void (d.maxStep = 'everything')) as ProposalPreview;
    expect(parsePageMessage(pending([DEPOSIT, broken]))).toBeNull();
  });
});

describe('parsePanelMessage', () => {
  it('accepts the panel messages and drops unknown fields', () => {
    expect(parsePanelMessage({ type: 'panel/hello', visible: true, windowId: 3, x: 1 })).toEqual({ type: 'panel/hello', visible: true, windowId: 3 });
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: false })).toEqual({ type: 'panel/decide', requestId: 'req-1', approved: false });
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: true, step: 'excerpt' })).toEqual({
      type: 'panel/decide', requestId: 'req-1', approved: true, step: 'excerpt',
    });
    expect(parsePanelMessage({ type: 'panel/open-app' })).toEqual({ type: 'panel/open-app' });
  });

  it('rejects bad panel messages', () => {
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: true, step: 'everything' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/hello' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/dismiss', requestId: 'a b' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/unknown' })).toBeNull();
    expect(parsePanelMessage('panel/ping')).toBeNull();
  });
});
