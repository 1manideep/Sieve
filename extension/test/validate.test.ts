import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_CHARS } from '@sieve/shared';
import type { ProposalPreview } from '@sieve/shared';
import { LIMITS, parsePageMessage, parsePanelMessage, parsePreview, readPageMessage } from '../src/shared/validate';
import { DEPOSIT, LEASE, PREPARING_LEASE, STATEMENT, hello, pending, resolved, withId } from './fixtures';

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
  // Messages that are broken as a whole: nothing to act on, and each one counts toward MAX_INVALID.
  const bad: [string, unknown][] = [
    ['wrong version', { ...hello(), version: 2 }],
    ['missing version', { type: 'sieve/hello', homeBase: true, appVersion: '1' }],
    ['type not a string', { type: 7, version: 1 }],
    ['hello without appVersion', { type: 'sieve/hello', version: 1, homeBase: true }],
    ['hello with empty appVersion', { ...hello(), appVersion: '' }],
    ['hello with long appVersion', { ...hello(), appVersion: 'x'.repeat(41) }],
    ['hello with homeBase as string', { ...hello(), homeBase: 'yes' }],
    ['21 proposals', pending(Array.from({ length: 21 }, (_, i) => withId(DEPOSIT, `req-${i}`)))],
    ['proposals not an array', { type: 'sieve/pending', version: 1, proposals: { 0: DEPOSIT } }],
    ['message over 512 KB', { ...hello(), padding: 'p'.repeat(LIMITS.maxMessageChars) }],
    ['resolved with bad id', resolved('', 'approved')],
    ['resolved with an outcome that is not a string', { ...resolved('req-1', 'approved'), outcome: 3 }],
    ['non-object: string', 'sieve/hello'],
    ['non-object: null', null],
    ['non-object: number', 42],
    ['array instead of object', [hello()]],
  ];

  it.each(bad)('%s', (_name, raw) => {
    expect(parsePageMessage(raw)).toBeNull();
    expect(readPageMessage(raw)).toEqual({ kind: 'invalid' });
  });
});

describe('a newer page: values this build does not know (0.1.1)', () => {
  // One proposal that fails a check is left out; the rest of the list still shows, and the message is valid.
  const badProposals: [string, unknown][] = [
    ['options of length 2', mutate(DEPOSIT, (d) => void (d.options = (d.options as unknown[]).slice(0, 2)))],
    ['options out of order', mutate(DEPOSIT, (d) => void (d.options = [...(d.options as unknown[])].reverse()))],
    ['option text over MAX_PAYLOAD_CHARS', mutate(DEPOSIT, (d) => {
      ((d.options as Loose[])[2] as Loose).text = 'x'.repeat(MAX_PAYLOAD_CHARS + 1);
    })],
    ["step: 'everything'", mutate(DEPOSIT, (d) => void (((d.options as Loose[])[0] as Loose).step = 'everything'))],
    ['requestedStep everything', mutate(DEPOSIT, (d) => void (d.requestedStep = 'everything'))],
    ['bad requestId characters', withId(DEPOSIT, 'req/../1')],
    ['outside requester without grantId', mutate(DEPOSIT, (d) => void delete (d.requester as Loose).grantId)],
    ['in-app requester with another name', mutate(DEPOSIT, (d) => void (d.requester = { kind: 'in-app', aiName: 'Other' }))],
    ['aiName over 80', mutate(DEPOSIT, (d) => void ((d.requester as Loose).aiName = 'a'.repeat(81)))],
    ['category not in CATEGORIES', mutate(DEPOSIT, (d) => void ((d.item as Loose).category = 'Secrets'))],
    ['title over 300', mutate(DEPOSIT, (d) => void ((d.item as Loose).title = 't'.repeat(301)))],
    ['date not positive', mutate(DEPOSIT, (d) => void ((d.item as Loose).date = 0))],
    ['item null', mutate(DEPOSIT, (d) => void (d.item = null))],
    ['a known warning kind with a message over 300 chars', mutate(DEPOSIT, (d) => void (d.warnings = [{ kind: 'injection', message: 'w'.repeat(301) }]))],
    ['a warning without a kind', mutate(DEPOSIT, (d) => void (d.warnings = [{ message: 'w' }]))],
    ['13 warnings', mutate(DEPOSIT, (d) => void (d.warnings = Array.from({ length: 13 }, () => ({ kind: 'injection', message: 'w' }))))],
    ['unavailableReason over 200', mutate(DEPOSIT, (d) => void (((d.options as Loose[])[2] as Loose).unavailableReason = 'r'.repeat(201)))],
    ['chars not an integer', mutate(DEPOSIT, (d) => void (((d.options as Loose[])[0] as Loose).chars = 1.5))],
    ['unknown outcome', mutate(DEPOSIT, (d) => void (d.outcome = 'needs-a-new-screen'))],
    ['unknown rule', mutate(DEPOSIT, (d) => void (d.rule = 'always'))],
    ['question empty', mutate(DEPOSIT, (d) => void (d.question = ''))],
    ['question over 500', mutate(DEPOSIT, (d) => void (d.question = 'q'.repeat(501)))],
    ['textHash with spaces', mutate(DEPOSIT, (d) => void (d.textHash = 'not a hash'))],
    ['textHash over 64 chars', mutate(DEPOSIT, (d) => void (d.textHash = 'a'.repeat(65)))],
    ['array preview entry', [DEPOSIT]],
    ['options as object', mutate(DEPOSIT, (d) => void (d.options = { 0: 1 }))],
  ];

  it.each(badProposals)('skips one proposal with %s and keeps the rest', (_name, broken) => {
    expect(parsePreview(broken)).toBeNull();
    const read = readPageMessage(pending([LEASE, broken as ProposalPreview, STATEMENT]));
    expect(read).toEqual({ kind: 'message', msg: pending([LEASE, STATEMENT]), skipped: 1 });
  });

  it('drops a warning of an unknown kind and keeps the proposal and its other warnings', () => {
    const raw = mutate(DEPOSIT, (d) => {
      d.warnings = [
        { kind: 'a-kind-from-next-week', message: 'Something new to know.' },
        { kind: 'injection', message: 'This email asks the assistant to do something.' },
        { kind: 'another-new-kind', message: '' },
      ];
    });
    expect(parsePreview(raw)?.warnings).toEqual([{ kind: 'injection', message: 'This email asks the assistant to do something.' }]);
    const read = readPageMessage(pending([raw as ProposalPreview]));
    expect(read.kind).toBe('message');
    expect(read.kind === 'message' && read.skipped).toBe(0);
  });

  it('keeps the first of two proposals with the same id', () => {
    expect(readPageMessage(pending([DEPOSIT, withId(LEASE, DEPOSIT.requestId), LEASE]))).toEqual({
      kind: 'message',
      msg: pending([DEPOSIT, LEASE]),
      skipped: 1,
    });
  });

  it('a list where nothing can be read is still a valid, empty list', () => {
    const broken = mutate(DEPOSIT, (d) => void (d.outcome = 'later')) as ProposalPreview;
    expect(readPageMessage(pending([broken, withId(broken as ProposalPreview, 'req-2')]))).toEqual({ kind: 'message', msg: pending([]), skipped: 2 });
  });

  it('ignores a message type or a resolved outcome it does not know, without counting it as invalid', () => {
    expect(readPageMessage({ type: 'sieve/everything', version: 1 })).toEqual({ kind: 'unknown' });
    expect(readPageMessage({ ...resolved('req-1', 'approved'), outcome: 'revoked' })).toEqual({ kind: 'unknown' });
    expect(parsePageMessage({ type: 'sieve/everything', version: 1 })).toBeNull();
  });

  it('keeps a well-formed text hash, and leaves it out when the page sent none', () => {
    const hashed = { ...DEPOSIT, textHash: '0a1b2c3d4e5f6789' };
    expect(parsePreview(hashed)).toEqual(hashed);
    expect(parsePreview(DEPOSIT)).not.toHaveProperty('textHash');
  });
});

describe('since Nov 23: requests being prepared, Gmail running out, the reason a decision failed', () => {
  it('keeps the requests being prepared and the Gmail flag, with only their known fields', () => {
    const extra = { ...PREPARING_LEASE, auto: true, wait: 'hidden', label: 'Reading 2 files with the on-device model…', secret: 'x' };
    expect(parsePageMessage({ ...pending([DEPOSIT]), preparing: [extra], gmail: 'ended' })).toEqual({
      ...pending([DEPOSIT]),
      preparing: [{ ...PREPARING_LEASE, auto: true, wait: 'hidden' }],
      gmail: 'ended',
    });
  });

  it('leaves out a request being prepared it cannot read, an unknown wait and a second one with the same id; the list still counts', () => {
    const read = readPageMessage({
      ...pending([DEPOSIT]),
      preparing: [{ ...PREPARING_LEASE, wait: 'later' }, { ...PREPARING_LEASE, aiName: '' }, PREPARING_LEASE, { ...PREPARING_LEASE, elapsedMs: -1, requestId: 'r2' }],
      gmail: 'maybe',
    });
    expect(read).toEqual({ kind: 'message', msg: { ...pending([DEPOSIT]), preparing: [PREPARING_LEASE] }, skipped: 0 });
    expect(parsePageMessage({ ...pending([]), preparing: 'none' })).toEqual(pending([]));
  });

  it("keeps the app's reason on resolved, and why auto-approve left a preview waiting", () => {
    const reason = "Couldn't upload the file. Nothing was sent. Check your connection and try again.";
    expect(parsePageMessage({ ...resolved('req-1', 'error'), message: reason })).toEqual({ ...resolved('req-1', 'error'), message: reason });
    expect(parsePageMessage({ ...resolved('req-1', 'error'), message: 3 })).toEqual(resolved('req-1', 'error'));
    expect(parsePreview({ ...DEPOSIT, autoWaits: 'file' })).toEqual({ ...DEPOSIT, autoWaits: 'file' });
    expect(parsePreview({ ...DEPOSIT, autoWaits: 'someday' })).toEqual(DEPOSIT);
  });
});

describe('parsePanelMessage', () => {
  it('accepts the panel messages and drops unknown fields', () => {
    expect(parsePanelMessage({ type: 'panel/hello', visible: true, windowId: 3, x: 1 })).toEqual({ type: 'panel/hello', visible: true, windowId: 3 });
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: false })).toEqual({ type: 'panel/decide', requestId: 'req-1', approved: false });
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: true, step: 'excerpt' })).toEqual({
      type: 'panel/decide', requestId: 'req-1', approved: true, step: 'excerpt',
    });
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: true, step: 'answer', textHash: '0a1b2c3d4e5f6789' })).toEqual({
      type: 'panel/decide', requestId: 'req-1', approved: true, step: 'answer', textHash: '0a1b2c3d4e5f6789',
    });
    expect(parsePanelMessage({ type: 'panel/open-app' })).toEqual({ type: 'panel/open-app' });
    expect(parsePanelMessage({ type: 'panel/open-side', windowId: 9 })).toEqual({ type: 'panel/open-side' });
  });

  it('keeps the surface of a hello only when it is popup or panel', () => {
    expect(parsePanelMessage({ type: 'panel/hello', visible: true, windowId: 3, surface: 'popup' })).toEqual({
      type: 'panel/hello', visible: true, windowId: 3, surface: 'popup',
    });
    expect(parsePanelMessage({ type: 'panel/hello', visible: false, surface: 'panel' })).toEqual({ type: 'panel/hello', visible: false, surface: 'panel' });
    expect(parsePanelMessage({ type: 'panel/hello', visible: true, surface: 'tab' })).toEqual({ type: 'panel/hello', visible: true });
    expect(parsePanelMessage({ type: 'panel/hello', visible: true, surface: 1 })).toEqual({ type: 'panel/hello', visible: true });
  });

  it('rejects bad panel messages', () => {
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: true, step: 'everything' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/decide', requestId: 'req-1', approved: true, step: 'answer', textHash: 'a b' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/hello' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/dismiss', requestId: 'a b' })).toBeNull();
    expect(parsePanelMessage({ type: 'panel/unknown' })).toBeNull();
    expect(parsePanelMessage('panel/ping')).toBeNull();
  });
});
